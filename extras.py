"""Later-phase integrations: wealth app (read-only), more added per phase. Everything fails soft into Data health."""
import time
import requests
from flask import jsonify, request
from flask import request as _rq

_cache = {}


def register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit):
    import gmail, garmin, assistant
    assistant.register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit)
    garmin.register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit)

    @app.post("/api/gmail/sync")
    @login_required
    def gmail_sync():
        return jsonify(gmail.sync(upsert, raw_db, set_state, settings, now_iso))

    import json as _json
    from flask import request as _rq

    @app.get("/api/health/series")
    @login_required
    def health_series():
        """Blood-test values are stored encrypted; this decrypts them for trend charts (authenticated, same user)."""
        import app as core
        out = {}
        for r in db().execute("SELECT data FROM records WHERE kind='health_record' AND deleted_at IS NULL"):
            d = _json.loads(r["data"])
            if d.get("rtype") != "bloodtest":
                continue
            try:
                v = float(core.dec(d["value"])) if str(d.get("value", "")).startswith("enc:") else float(d.get("value"))
            except (TypeError, ValueError):
                continue
            out.setdefault(d.get("name", "?"), []).append({"date": d.get("date"), "value": v, "unit": d.get("unit", "")})
        for k in out:
            out[k].sort(key=lambda x: x["date"] or "")
        return jsonify(out)

    register_share(app, login_required, db, raw_db, kv_get, settings, now_iso, upsert, audit)

    @app.post("/api/wealth/expense")
    @login_required
    def wealth_expense():
        """Quick-add 'spent 45 AED on lunch' into the wealth app, if it exposes POST /api/life/expense. Otherwise: clear message."""
        s = settings(); j = _rq.get_json() or {}
        if not (s.get("wealth_url") and s.get("wealth_token")):
            return jsonify(error="Wealth app isn't connected (Settings)."), 400
        try:
            r = requests.post(s["wealth_url"].rstrip("/") + "/api/life/expense", json={"amount": float(j["amount"]), "currency": j.get("currency") or s["currency"], "note": str(j.get("note", ""))[:200], "category": j.get("category")}, headers={"Authorization": "Bearer " + s["wealth_token"]}, timeout=6)
            if r.status_code == 404:
                return jsonify(error="Your wealth app doesn't have the quick-add endpoint yet (see SETUP notes)."), 501
            r.raise_for_status()
            audit("expense_quick_add", f"{j.get('amount')} {j.get('currency')}")
            return jsonify(ok=True)
        except Exception as ex:
            return jsonify(error="Couldn't reach the wealth app: " + str(ex)[:80]), 502

    register_more(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit)

    @app.get("/api/wealth/summary")
    @login_required
    def wealth_summary():
        """Expected contract on the wealth app: GET {url}/api/life/summary with Bearer token ->
        {net_worth, currency, goals:[{name,current,target,deadline}], upcoming:[{name,amount,due,kind}], budget:{...}}"""
        s = settings()
        url, tok = (s.get("wealth_url") or "").rstrip("/"), s.get("wealth_token")
        if not url or not tok:
            return jsonify(configured=False)
        c = _cache.get("wealth")
        if c and time.time() - c[0] < 600:
            return jsonify(c[1])
        try:
            r = requests.get(url + "/api/life/summary", headers={"Authorization": "Bearer " + tok}, timeout=6)
            r.raise_for_status()
            _cache["wealth"] = (time.time(), r.json())
            set_state("wealth", True)
            return jsonify(r.json())
        except Exception as e:
            set_state("wealth", False, str(e)[:160])
            return jsonify(configured=True, error="wealth app unreachable")


def register_more(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit):
    @app.get("/api/fx")
    @login_required
    def fx():
        base = (request.args.get("base", "AED") or "AED").upper()[:3]
        key = "fx:" + base
        c = _cache.get(key)
        if c and time.time() - c[0] < 12 * 3600:
            return jsonify(c[1])
        try:
            r = requests.get("https://api.frankfurter.app/latest", params={"from": base}, timeout=6)
            r.raise_for_status()
            j = {"base": base, "rates": r.json().get("rates", {}), "date": r.json().get("date")}
            _cache[key] = (time.time(), j)
            set_state("fx", True)
            return jsonify(j)
        except Exception as e:
            set_state("fx", False, str(e)[:160])
            return jsonify(base=base, rates={}, error="rates unavailable")


def tick_extras(raw_db, set_state, settings, now_iso, upsert):
    """Daily wealth snapshot (read-only pull) so goals and the year-in-review can show a net-worth line."""
    s = settings()
    if not (s.get("wealth_url") and s.get("wealth_token")):
        return
    day = time.strftime("%Y%m%d")
    rid = "5ea1b000-0000-4000-8000-" + day.rjust(12, "0")
    c = raw_db()
    try:
        if c.execute("SELECT 1 FROM records WHERE id=?", (rid,)).fetchone():
            return
        r = requests.get(s["wealth_url"].rstrip("/") + "/api/life/summary", headers={"Authorization": "Bearer " + s["wealth_token"]}, timeout=6)
        r.raise_for_status()
        j = r.json()
        if j.get("net_worth") is not None:
            upsert(c, {"id": rid, "kind": "wealth_snapshot", "data": {"day": time.strftime("%Y-%m-%d"), "net_worth": j["net_worth"], "currency": j.get("currency")}})
            c.commit()
        set_state("wealth", True)
    except Exception as ex:
        set_state("wealth", False, str(ex)[:160])
    finally:
        c.close()


def register_share(app, login_required, db, raw_db, kv_get, settings, now_iso, upsert, audit):
    """Expiring, read-only share pages for ONE trip itinerary or ONE list. Server-rendered HTML, no JS, nothing else reachable."""
    import html as H, secrets, json as _json
    from datetime import datetime, timedelta, timezone
    from flask import Response, abort, request as rq

    @app.post("/api/share")
    @login_required
    def share_new():
        j = rq.get_json() or {}
        if j.get("kind") not in ("list", "trip"):
            return jsonify(error="bad kind"), 400
        r = db().execute("SELECT id FROM records WHERE id=? AND kind=? AND deleted_at IS NULL", (j.get("id"), j["kind"])).fetchone()
        if not r:
            return jsonify(error="not found"), 404
        tok = secrets.token_urlsafe(18)
        exp = (datetime.now(timezone.utc) + timedelta(days=max(1, min(60, int(j.get("days") or 7))))).strftime("%Y-%m-%dT%H:%M:%SZ")
        import uuid
        c = db(); upsert(c, {"id": str(uuid.uuid4()), "kind": "share", "data": {"token": tok, "target": j["id"], "what": j["kind"], "expires": exp}}); c.commit()
        audit("share_new", f"{j['kind']}:{j['id'][:8]}")
        return jsonify(url="/s/" + tok, expires=exp)

    @app.get("/api/shares")
    @login_required
    def share_list():
        return jsonify([{"id": r["id"], **{k: v for k, v in _json.loads(r["data"]).items() if k != "token"}, "url": "/s/" + _json.loads(r["data"])["token"]} for r in db().execute("SELECT id,data FROM records WHERE kind='share' AND deleted_at IS NULL")])

    def page(title, body):
        css = "body{font:19px/1.5 'Segoe Print','Bradley Hand',cursive;background:#f3edda;color:#1d2233;max-width:680px;margin:0 auto;padding:24px 20px 60px}h1{font-size:2.4rem;margin:0 0 4px}h2{font-size:1.5rem;margin:24px 0 4px;border-bottom:1.5px dashed #b9b095}.m{color:#6a6d78}li{margin:2px 0}footer{margin-top:40px;color:#6a6d78;font-size:.85rem}"
        return Response(f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><meta name=robots content=noindex><title>{H.escape(title)}</title><style>{css}</style></head><body>{body}<footer>Shared read-only from a private notebook. This link expires.</footer></body></html>", mimetype="text/html", headers={"X-Robots-Tag": "noindex", "Cache-Control": "no-store"})

    @app.get("/s/<token>")
    def share_view(token):
        for r in raw_db().execute("SELECT data FROM records WHERE kind='share' AND deleted_at IS NULL"):
            d = _json.loads(r["data"])
            if secrets.compare_digest(d.get("token", ""), token):
                break
        else:
            abort(404)
        if d["expires"] < datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
            return page("Link expired", "<h1>This link has expired</h1><p class=m>Ask the sender for a fresh one.</p>"), 410
        c = raw_db()
        tgt = c.execute("SELECT data FROM records WHERE id=? AND deleted_at IS NULL", (d["target"],)).fetchone()
        if not tgt:
            abort(404)
        t = _json.loads(tgt["data"]); e = H.escape
        if d["what"] == "list":
            items = [_json.loads(x["data"]) for x in c.execute("SELECT data FROM records WHERE kind='list_item' AND deleted_at IS NULL AND json_extract(data,'$.list')=?", (d["target"],))]
            lis = "".join(f"<li><b>{e(str(i.get('title','')))}</b> <span class=m>{e(' · '.join(str(i[k]) for k in ('cuisine','city','area','activity','price','status') if i.get(k)))}</span>{'<br><span class=m>'+e(str(i['notes']))+'</span>' if i.get('notes') else ''}</li>" for i in sorted(items, key=lambda x: str(x.get("title", "")).lower()))
            return page(t.get("name", "List"), f"<h1>{e(t.get('name',''))}</h1><ul>{lis}</ul>")
        days_, parts = {}, []
        for x in c.execute("SELECT data FROM records WHERE kind='trip_item' AND deleted_at IS NULL AND json_extract(data,'$.trip')=?", (d["target"],)):
            i = _json.loads(x["data"]); days_.setdefault(i.get("date", ""), []).append(i)
        bks = [_json.loads(x["data"]) for x in c.execute("SELECT data FROM records WHERE kind='booking' AND deleted_at IS NULL AND json_extract(data,'$.trip')=?", (d["target"],))]
        for day in sorted(set(days_) | {b.get("start") for b in bks if b.get("start")}):
            rows = [f"<li>{e(b.get('start_time') or '')} <b>{e(b.get('title',''))}</b> <span class=m>{e(b.get('terminal') or '')}</span></li>" for b in bks if b.get("start") == day]   # no confirmation numbers, links or costs
            rows += [f"<li>{e(i.get('time') or '')} {e(re_clean(i.get('title','')))}</li>" for i in sorted(days_.get(day, []), key=lambda z: (z.get("order") or 0))]
            parts.append(f"<h2>{e(day)}</h2><ul>{''.join(rows)}</ul>")
        return page(t.get("name", "Trip"), f"<h1>{e(t.get('name',''))}</h1><p class=m>{e(str(t.get('start') or ''))} → {e(str(t.get('end') or ''))}</p>{''.join(parts)}")


def re_clean(s):
    import re
    return re.sub(r"@-?\d+\.\d+,\s*-?\d+\.\d+", "", s).strip()
