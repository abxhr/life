"""Assistant: Claude via a server-side proxy (the key never reaches the browser).
- Read-only tools run here; every MUTATING tool call is returned to the browser as a confirm card and applied there (offline-first store), then logged + undoable.
- Privacy: per-module data toggles, health excluded unless enabled, ID/passport/account numbers scrubbed, and a preview of exactly what will be sent.
- Cost: month meter with a hard cap. Models are configurable (Settings); defaults are the current Sonnet / Haiku / Opus.
- LIFE_AI_MOCK=1 swaps in a deterministic fake model so the whole pipeline is testable without a key."""
import os, re, json, time, uuid
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from flask import request, jsonify, Response, stream_with_context

# USD per million tokens (input, output). Estimates from Anthropic's published list at build time; editable in Settings (ai_prices).
PRICES = {"claude-sonnet-5-5": [2, 10], "claude-sonnet-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-opus-5-5": [4, 20], "claude-opus-5": [5, 25], "claude-opus-4-8": [5, 25], "claude-fable-5-1": [10, 50], "claude-haiku-4-5": [1, 5], "claude-sonnet-4-6": [3, 15]}
EFFORT = {"chat": "medium", "fast": "low", "plan": "high"}
LOW_RISK = {"create_task", "add_note", "add_list_item", "log_mood", "create_reminder"}

# ---------- tool definitions ----------
def T(name, desc, props, req=()):
    return {"name": name, "description": desc, "input_schema": {"type": "object", "properties": props, "required": list(req), "additionalProperties": False}}

S, N = {"type": "string"}, {"type": "number"}
READ_TOOLS = [
    T("search_notes", "Full-text search the user's notes, tasks and list items. Use before answering questions about what they saved or wrote.", {"query": S}, ["query"]),
    T("list_tasks", "List the user's open tasks. Optionally filter by due date range or context.", {"due_before": S, "context": S, "limit": N}),
    T("query_calendar", "Calendar events (native and subscribed feeds) between two dates (YYYY-MM-DD).", {"from": S, "to": S}, ["from", "to"]),
    T("list_items", "Items in the user's lists (restaurants, places to play, things to do, etc.). Filter by list name or text.", {"list": S, "query": S}),
    T("goal_progress", "The user's goals with progress fields (target, current, milestones).", {}),
    T("get_travel", "Countries visited/wanted, trips, and document expiry dates (never document numbers).", {}),
    T("read_health", "Recent daily health summaries and mood. Only available if the user enabled health data for the assistant.", {"days": N}),
    T("wealth_summary", "Read-only net worth, upcoming bills/renewals from the user's wealth app, if connected.", {}),
]
WRITE_TOOLS = [
    T("create_task", "Create a task.", {"title": S, "due": {"type": "string", "description": "YYYY-MM-DD"}, "due_time": {"type": "string", "description": "HH:MM"}, "priority": {"type": "number", "description": "1 urgent..4 low"}, "context": {"type": "string", "enum": ["personal", "work", "work-outside-work", "errands", "home"]}, "notes": S}, ["title"]),
    T("update_task", "Change fields of an existing task.", {"id": S, "title": S, "due": S, "due_time": S, "priority": N, "notes": S}, ["id"]),
    T("complete_task", "Mark a task done.", {"id": S}, ["id"]),
    T("create_reminder", "Create a reminder at a date/time (local time of the user).", {"title": S, "date": S, "time": S, "critical": {"type": "boolean"}}, ["title", "date"]),
    T("create_event", "Create a calendar event.", {"title": S, "date": S, "start": S, "end": S, "location": S}, ["title", "date"]),
    T("add_note", "Save a note.", {"title": S, "body": S, "tags": {"type": "array", "items": S}}, ["body"]),
    T("add_list_item", "Add an item to one of the user's lists (by list name).", {"list": S, "title": S, "notes": S}, ["list", "title"]),
    T("log_mood", "Log mood and energy (1-5).", {"mood": N, "energy": N, "note": S}),
    T("mark_visited", "Mark a country as visited (ISO alpha-2 code like FR).", {"country": S, "start": S, "end": S, "notes": S}, ["country"]),
    T("create_trip", "Create a trip.", {"name": S, "start": S, "end": S, "countries": {"type": "array", "items": S}}, ["name"]),
    T("remember", "Save a durable fact about the user (preference, constraint). Shown on their Memory page; they can delete it.", {"text": S}, ["text"]),
]
TOOL_NAMES = {t["name"] for t in READ_TOOLS}
WRITE_NAMES = {t["name"] for t in WRITE_TOOLS}


# ---------- privacy ----------
SCRUBS = [(re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b"), "[iban]"), (re.compile(r"\b(?:\d[ -]?){12,19}\b"), "[card/account]"), (re.compile(r"\b[A-Z]{1,2}\d{6,9}\b"), "[id]"), (re.compile(r"\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b"), "[id]"), (re.compile(r"\b\d{6,}\b"), "[number]")]


def scrub(text):
    for rx, rep in SCRUBS:
        text = rx.sub(rep, text)
    return text


def strip_sensitive(obj):
    """Deep-scrub strings in anything we send out."""
    if isinstance(obj, str):
        return scrub(obj)
    if isinstance(obj, list):
        return [strip_sensitive(x) for x in obj]
    if isinstance(obj, dict):
        return {k: strip_sensitive(v) for k, v in obj.items()}
    return obj


def register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit):
    def recs(kind, pred=None, limit=500):
        out = []
        for r in db().execute("SELECT id,data,updated_at FROM records WHERE kind=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?", (kind, limit)):
            d = json.loads(r["data"]); d["id"] = r["id"]
            if not pred or pred(d):
                out.append(d)
        return out

    def month_key():
        return "ai_usage:" + datetime.now().strftime("%Y-%m")

    def prices(model):
        p = (settings().get("ai_prices") or {}).get(model) or PRICES.get(model) or [5, 25]
        return p

    def spend(model, usage):
        u = kv_get(month_key(), {"in": 0, "out": 0, "cost": 0.0, "calls": 0})
        i, o = getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0
        cr = getattr(usage, "cache_read_input_tokens", 0) or 0
        p = prices(model)
        u["in"] += i + cr; u["out"] += o; u["calls"] += 1
        u["cost"] = round(u["cost"] + (i * p[0] + o * p[1] + cr * p[0] * 0.1) / 1e6, 5)
        kv_set(month_key(), u)

    def over_cap():
        cap = float(settings().get("ai_monthly_cap_usd") or 0)
        return cap > 0 and kv_get(month_key(), {"cost": 0})["cost"] >= cap

    def configured():
        return bool(os.environ.get("ANTHROPIC_API_KEY")) or os.environ.get("LIFE_AI_MOCK") == "1"

    def client():
        if os.environ.get("LIFE_AI_MOCK") == "1":
            from mock_ai import MockClient
            return MockClient()
        import anthropic
        return anthropic.Anthropic()   # key from ANTHROPIC_API_KEY (.env), never exposed to the browser

    def model_for(tier):
        s = settings()
        return {"chat": s["ai_model"], "fast": s["ai_fast_model"], "plan": s["ai_strong_model"]}[tier]

    # ---------- context ----------
    def snapshot(modules, health_ok):
        tz = ZoneInfo(settings()["timezone"]); today = datetime.now(tz).date()
        out = {}
        if "tasks" in modules:
            ts = recs("task", lambda d: not d.get("done") and not d.get("someday"))
            ts.sort(key=lambda d: (d.get("due") or "9999", d.get("priority") or 3))
            out["open_tasks"] = [{"id": d["id"], "title": d.get("title"), "due": d.get("due"), "priority": d.get("priority"), "ctx": d.get("ctx")} for d in ts[:25]]
        if "notes" in modules:
            out["recent_notes"] = [{"id": d["id"], "title": d.get("title") or (d.get("body") or "")[:40]} for d in recs("note", None, 15)]
        if "lists" in modules:
            ls = {l["id"]: l for l in recs("list")}
            out["lists"] = [{"name": l.get("name"), "type": l.get("type"), "items": sum(1 for i in recs("list_item", lambda x: x.get("list") == l["id"], 1000))} for l in ls.values()]
        if "goals" in modules:
            out["goals"] = [{"id": g["id"], "title": g.get("title"), "why": g.get("why"), "status": g.get("status"), "deadline": g.get("deadline")} for g in recs("goal", lambda g: g.get("status") == "active")]
        if "travel" in modules:
            out["trips"] = [{"id": t["id"], "name": t.get("name"), "start": t.get("start"), "end": t.get("end")} for t in recs("trip")][:10]
            out["document_expiries"] = [{"name": d.get("name"), "type": d.get("type"), "expiry": d.get("expiry")} for d in recs("travel_doc")]   # never numbers
        if health_ok:
            out["health_last_3_days"] = [{k: d.get(k) for k in ("day", "sleep_h", "steps", "rhr", "body_battery")} for d in sorted(recs("garmin_daily"), key=lambda x: x.get("day", ""), reverse=True)[:3]]
            out["mood_last_3_days"] = [{k: d.get(k) for k in ("day", "mood", "energy")} for d in sorted(recs("mood_log"), key=lambda x: x.get("day", ""), reverse=True)[:6]]
        return out

    def build_system(ctxinfo, modules, health_ok):
        s = settings(); tz = ZoneInfo(s["timezone"]); now = datetime.now(tz)
        persona = {"coach": "Warm but direct, like a good coach: encourage, then name the next step.", "friend": "Warm and direct, like a thoughtful friend. Never preachy or cheesy.", "nonsense": "No-nonsense and brief. No pleasantries."}.get(s.get("persona"), "Warm and direct.")
        mem = [m.get("text") for m in recs("assistant_memory")]
        parts = [f"You are Life's assistant for one person, {s['name']}, inside their private life-management app. {persona}",
                 f"Now: {now.strftime('%A %Y-%m-%d %H:%M')} ({s['timezone']}). Home currency {s['currency']}. Work week: days {s['work_days']} (0=Sun).",
                 "Ground answers in the user's own data (snapshot + tools). When you refer to a saved item, append its reference like [ref:task:ID], [ref:note:ID], [ref:goal:ID] or [ref:trip:ID] so the app can link it. If you don't know, say so; never invent personal data.",
                 "To change anything, call a tool; the user sees a confirm card first. Prefer one tool call per distinct action. Do not claim something was done until the tool result says so.",
                 "You are not a doctor, lawyer, financial adviser or visa authority: flag uncertainty and point to official sources for medical, legal, financial and visa questions.",
                 "Keep replies short and concrete. Plain text; no tables unless asked."]
        if mem:
            parts.append("What you know about the user (they can edit this):\n- " + "\n- ".join(mem))
        parts.append("Snapshot of their data (may be partial; use tools for detail):\n" + json.dumps(strip_sensitive(snapshot(modules, health_ok)), ensure_ascii=False))
        if ctxinfo:
            parts.append("The user is currently looking at: " + json.dumps(strip_sensitive(ctxinfo), ensure_ascii=False)[:1500])
        return "\n\n".join(parts)

    def tools_for(health_ok, wealth_ok):
        t = [x for x in READ_TOOLS if (x["name"] != "read_health" or health_ok) and (x["name"] != "wealth_summary" or wealth_ok)]
        return t + WRITE_TOOLS

    # ---------- read-tool execution ----------
    def run_read(name, inp, modules, health_ok):
        if name == "search_notes":
            m = " ".join('"' + w + '"*' for w in re.sub(r"[^\w\s]", " ", inp.get("query", "")).split())
            if not m:
                return []
            rows = db().execute("SELECT f.id,f.kind,r.data FROM fts f JOIN records r ON r.id=f.id WHERE fts MATCH ? AND r.deleted_at IS NULL LIMIT 12", (m,)).fetchall()
            return strip_sensitive([{"kind": r["kind"], "id": r["id"], "title": json.loads(r["data"]).get("title") or json.loads(r["data"]).get("name"), "text": (json.loads(r["data"]).get("body") or json.loads(r["data"]).get("notes") or "")[:300]} for r in rows])
        if name == "list_tasks":
            ts = recs("task", lambda d: not d.get("done"))
            if inp.get("due_before"): ts = [d for d in ts if d.get("due") and d["due"] <= inp["due_before"]]
            if inp.get("context"): ts = [d for d in ts if d.get("ctx") == inp["context"]]
            ts.sort(key=lambda d: d.get("due") or "9999")
            return strip_sensitive([{"id": d["id"], "title": d.get("title"), "due": d.get("due"), "time": d.get("due_time"), "priority": d.get("priority"), "ctx": d.get("ctx")} for d in ts[: int(inp.get("limit") or 30)]])
        if name == "query_calendar":
            a, b = inp["from"], inp["to"]
            ev = [{"title": d.get("title"), "date": d.get("date"), "start": d.get("start"), "end": d.get("end")} for d in recs("event", lambda d: a <= (d.get("date") or "") <= b)]
            for r in db().execute("SELECT title,start,end FROM feed_events WHERE substr(start,1,10)>=? AND substr(start,1,10)<=? ORDER BY start LIMIT 60", (a, b)):
                ev.append({"title": r["title"], "start_utc": r["start"], "source": "calendar feed"})
            return strip_sensitive(ev)
        if name == "list_items":
            ls = {l["id"]: l.get("name") for l in recs("list")}
            q = (inp.get("query") or "").lower(); ln = (inp.get("list") or "").lower()
            its = recs("list_item", lambda d: (not ln or ln in (ls.get(d.get("list")) or "").lower()) and (not q or q in json.dumps(d).lower()), 600)
            return strip_sensitive([{"id": d["id"], "list": ls.get(d.get("list")), "title": d.get("title"), "status": d.get("status"), "city": d.get("city") or d.get("area"), "cuisine": d.get("cuisine"), "rating": d.get("rating"), "notes": (d.get("notes") or "")[:120]} for d in its[:40]])
        if name == "goal_progress":
            return strip_sensitive([{"id": g["id"], "title": g.get("title"), "status": g.get("status"), "deadline": g.get("deadline"), "target": g.get("target"), "milestones_done": sum(1 for m in g.get("milestones", []) if m.get("done")), "milestones": len(g.get("milestones", []))} for g in recs("goal")])
        if name == "get_travel":
            return strip_sensitive({"countries": [{"code": c.get("code"), "status": c.get("status")} for c in recs("country")], "visits": [{"country": v.get("country"), "start": v.get("start")} for v in recs("visit")], "trips": [{"id": t["id"], "name": t.get("name"), "start": t.get("start"), "end": t.get("end")} for t in recs("trip")], "documents": [{"name": d.get("name"), "type": d.get("type"), "expiry": d.get("expiry")} for d in recs("travel_doc")]})
        if name == "read_health":
            if not health_ok:
                return {"error": "Health data is not enabled for the assistant."}
            n = int(inp.get("days") or 7); cut = (date.today() - timedelta(days=n)).isoformat()
            return {"daily": [d for d in recs("garmin_daily", lambda d: d.get("day", "") >= cut)], "mood": [d for d in recs("mood_log", lambda d: d.get("day", "") >= cut)]}
        if name == "wealth_summary":
            import requests
            s = settings()
            try:
                r = requests.get(s["wealth_url"].rstrip("/") + "/api/life/summary", headers={"Authorization": "Bearer " + s["wealth_token"]}, timeout=6); r.raise_for_status()
                return strip_sensitive(r.json())
            except Exception:
                return {"error": "wealth app unreachable"}
        return {"error": "unknown tool"}

    # ---------- the conversation endpoint (SSE) ----------
    def sse(obj):
        return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"

    def prepare(body):
        s = settings()
        modules = set(s.get("ai_enabled_modules") or [])
        health_ok = bool(s.get("ai_health"))
        wealth_ok = "wealth" in modules and bool(s.get("wealth_url"))
        tier = body.get("tier") if body.get("tier") in EFFORT else "chat"
        system = build_system(body.get("context"), modules, health_ok)
        tools = tools_for(health_ok, wealth_ok)
        msgs = strip_sensitive(body.get("messages") or [])
        return s, modules, health_ok, tier, system, tools, msgs

    @app.get("/api/ai/status")
    @login_required
    def ai_status():
        s = settings(); u = kv_get(month_key(), {"in": 0, "out": 0, "cost": 0.0, "calls": 0})
        return jsonify(configured=configured(), mock=os.environ.get("LIFE_AI_MOCK") == "1", models={"chat": s["ai_model"], "fast": s["ai_fast_model"], "plan": s["ai_strong_model"]}, usage=u, cap=s.get("ai_monthly_cap_usd"), over_cap=over_cap())

    @app.post("/api/ai/preview")
    @login_required
    def ai_preview():
        s, modules, health_ok, tier, system, tools, msgs = prepare(request.get_json() or {})
        return jsonify(model=model_for(tier), system=system, tools=[t["name"] for t in tools], messages=msgs[-6:], chars=len(system) + sum(len(json.dumps(m)) for m in msgs), modules=sorted(modules), health=health_ok)

    @app.post("/api/ai/chat")
    @login_required
    def ai_chat():
        if not configured():
            return jsonify(error="The assistant isn't set up: add ANTHROPIC_API_KEY to .env and restart."), 400
        body = request.get_json() or {}
        s, modules, health_ok, tier, system, tools, msgs = prepare(body)
        if over_cap():
            return jsonify(error=f"You've reached this month's AI cap (${s.get('ai_monthly_cap_usd')}). Raise it in Settings if you want to continue."), 402
        model = model_for(tier)

        @stream_with_context
        def gen():
            c = client(); messages = list(msgs); done_results = []
            try:
                for _ in range(6):
                    kw = dict(model=model, max_tokens=8000, system=system, messages=messages, tools=tools, output_config={"effort": EFFORT[tier]})
                    with c.messages.stream(**kw) as st:
                        for t in st.text_stream:
                            yield sse({"type": "text", "delta": t})
                        final = st.get_final_message()
                    spend(model, final.usage)
                    if final.stop_reason == "refusal":
                        yield sse({"type": "end", "stop": "refusal", "text": "I can’t help with that one."}); return
                    content = [b.model_dump(mode="json", exclude_none=True) for b in final.content]
                    uses = [b for b in content if b.get("type") == "tool_use"]
                    if final.stop_reason != "tool_use" or not uses:
                        yield sse({"type": "end", "stop": final.stop_reason, "assistant_content": content, "done_results": done_results, "pending": []}); return
                    results, pending = [], []
                    for u in uses:
                        if u["name"] in WRITE_NAMES:
                            pending.append({"id": u["id"], "name": u["name"], "input": u["input"], "low_risk": u["name"] in LOW_RISK})
                        else:
                            yield sse({"type": "status", "tool": u["name"]})
                            try:
                                out = run_read(u["name"], u["input"], modules, health_ok)
                            except Exception as e:
                                out = {"error": str(e)[:100]}
                            results.append({"type": "tool_result", "tool_use_id": u["id"], "content": json.dumps(out, ensure_ascii=False)[:12000]})
                    if pending:   # hand control to the browser: confirm cards. It resumes with all tool_results in one user message.
                        yield sse({"type": "end", "stop": "confirm", "assistant_content": content, "done_results": results, "pending": pending}); return
                    messages = messages + [{"role": "assistant", "content": content}, {"role": "user", "content": results}]
                yield sse({"type": "end", "stop": "loop_limit", "pending": []})
            except Exception as e:
                name = type(e).__name__
                msg = "Rate limited — try again in a minute." if "RateLimit" in name else "The AI service is unreachable right now." if "Connection" in name else "Something went wrong talking to the AI: " + str(e)[:120]
                set_state("ai", False, msg)
                yield sse({"type": "error", "error": msg})
            else:
                set_state("ai", True, "", f"{model}")
        return Response(gen(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ---------- one-shot helpers (fast / strong models) ----------
    def complete(tier, system, user, max_tokens=1200):
        if not configured() or over_cap():
            return None
        c = client(); model = model_for(tier)
        r = c.messages.create(model=model, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": strip_sensitive(user)}], output_config={"effort": EFFORT[tier]})
        spend(model, r.usage)
        return "".join(b.text for b in r.content if b.type == "text").strip()

    @app.post("/api/ai/briefing")
    @login_required
    def ai_briefing():
        facts = (request.get_json() or {}).get("facts", {})
        try:
            t = complete("fast", "Write ONE or TWO short sentences that brief the user on their day from these facts. Warm, specific, no cheer-leading, no emoji. Mention the first meeting time and anything due if present; if sleep was short, suggest going easy and picking one big thing. Output only the sentences.", json.dumps(facts))
            return jsonify(text=t)
        except Exception as e:
            return jsonify(text=None, error=str(e)[:100])

    @app.post("/api/ai/triage")
    @login_required
    def ai_triage():
        text = (request.get_json() or {}).get("text", "")
        try:
            t = complete("fast", 'Decide where an inbox item belongs. Reply with JSON only: {"dest":"task|note|list_item|reminder|goal","reason":"<6 words"}.', text, 200)
            return jsonify(json.loads(re.search(r"\{.*\}", t or "{}", re.S).group(0)))
        except Exception:
            return jsonify(dest=None)

    NOTE_ACTIONS = {"summarise": "Summarise this note in 3-5 bullet points.", "tasks": "Extract concrete action items as a Markdown checklist (- [ ] ...). Only what is actually in the note.", "cleanup": "Clean up the writing: fix typos and structure, keep the author's voice and all facts. Return the full revised note.", "list": "Turn the content into a clean Markdown bullet list.", "translate": "Translate to English (or to Arabic if it is already English). Return only the translation."}

    @app.post("/api/ai/note-action")
    @login_required
    def ai_note_action():
        j = request.get_json() or {}
        if j.get("action") not in NOTE_ACTIONS:
            return jsonify(error="unknown action"), 400
        try:
            t = complete("chat", NOTE_ACTIONS[j["action"]] + " Output only the result; the user reviews it before anything is saved.", j.get("text", ""), 3000)
            return jsonify(text=t) if t else (jsonify(error="The assistant isn't available (not configured or at its cap)."), 400)
        except Exception as e:
            return jsonify(error="AI error: " + str(e)[:100]), 502

    @app.post("/api/ai/weekly")
    @login_required
    def ai_weekly():
        facts = (request.get_json() or {}).get("facts", {})
        try:
            t = complete("plan", "Draft a short weekly review in Markdown for the user from these facts: '## What went well' (2-3 bullets), '## What drained you' (1-2 bullets, only if the data hints at it), '## Next week' (3 suggested priorities). Be specific, honest, kind; no filler.", json.dumps(facts), 1500)
            return jsonify(text=t)
        except Exception as e:
            return jsonify(text=None, error=str(e)[:100])
