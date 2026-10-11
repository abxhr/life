"""Read-only feeds for the iPhone: a Calendar subscription (.ics) and a plain-text "my day" for Siri / Shortcuts.
Reached by a private URL token (Calendar can't send headers). Titles and dates only: no notes, health, money or document numbers. Rotate the token to cut off an old link."""
import json, secrets, hmac
from datetime import datetime, timedelta, date, timezone
from zoneinfo import ZoneInfo
from flask import request, jsonify, Response


def _esc(t):
    return str(t or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _fold(line):
    out = []
    while len(line.encode()) > 74:
        cut = 74
        while len(line[:cut].encode()) > 74:
            cut -= 1
        out.append(line[:cut]); line = " " + line[cut:]
    return "\r\n".join(out + [line])


def _d(d):
    return d.replace("-", "")


def build_ics(rows, tz, now=None):
    """rows: [(kind, id, data)] -> a VCALENDAR string."""
    now = now or datetime.now(timezone.utc); today = now.astimezone(tz).date()
    lo, hi = (today - timedelta(days=30)).isoformat(), (today + timedelta(days=400)).isoformat()
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Life//personal//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Life", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"]
    stamp = now.strftime("%Y%m%dT%H%M%SZ")

    def ev(uid, title, start=None, end=None, day=None, day_end=None, alarm=None, rrule=None):
        e = ["BEGIN:VEVENT", f"UID:{uid}@life", f"DTSTAMP:{stamp}", f"SUMMARY:{_esc(title)}"]
        if day:   # all-day (DTEND is the day after the last day)
            e += [f"DTSTART;VALUE=DATE:{_d(day)}", f"DTEND;VALUE=DATE:{_d(day_end or (date.fromisoformat(day) + timedelta(days=1)).isoformat())}"]
        else:
            e += [f"DTSTART:{start.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}", f"DTEND:{end.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"]
        if rrule: e.append("RRULE:" + rrule)
        for a in ([alarm] if isinstance(alarm, str) else alarm or []):
            e += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(title)}", f"TRIGGER:{a}", "END:VALARM"]
        out.extend(e + ["END:VEVENT"])

    def local(dstr, hhmm):
        return datetime.fromisoformat(f"{dstr}T{hhmm}").replace(tzinfo=tz)

    for kind, rid, d in rows:
        try:
            if kind == "task" and d.get("due") and not d.get("done") and lo <= d["due"] <= hi:
                if d.get("due_time"):
                    s = local(d["due"], d["due_time"]); ev(rid, "☐ " + (d.get("title") or "Task"), start=s, end=s + timedelta(minutes=30), alarm="PT0S")
                else:
                    ev(rid, "☐ " + (d.get("title") or "Task"), day=d["due"])
            elif kind == "event" and d.get("date") and lo <= d["date"] <= hi:
                if d.get("allday") or not d.get("start"):
                    ev(rid, d.get("title") or "Event", day=d["date"], day_end=(date.fromisoformat(d.get("end_date") or d["date"]) + timedelta(days=1)).isoformat())
                else:
                    s = local(d["date"], d["start"]); e_ = local(d.get("end_date") or d["date"], d.get("end") or d["start"]); ev(rid, d.get("title") or "Event", start=s, end=max(e_, s + timedelta(minutes=15)))
            elif kind == "reminder" and d.get("remind_at") and not d.get("acked"):
                s = datetime.fromisoformat(d["remind_at"].replace("Z", "+00:00"))
                if lo <= s.astimezone(tz).date().isoformat() <= hi:
                    ev(rid, "⏰ " + (d.get("title") or "Reminder"), start=s, end=s + timedelta(minutes=15), alarm="PT0S")
            elif kind == "trip" and d.get("start"):
                ev(rid, "✈ " + (d.get("name") or "Trip"), day=d["start"], day_end=(date.fromisoformat(d.get("end") or d["start"]) + timedelta(days=1)).isoformat())
            elif kind == "travel_doc" and d.get("expiry") and d["expiry"] >= lo:   # any future expiry, however far
                ev(rid, "⏳ " + (d.get("name") or "Document") + " expires", day=d["expiry"], alarm=["-P90D", "-P30D"])
            elif kind == "person" and len(d.get("birthday") or "") >= 5:
                md = d["birthday"][-5:]; ev(rid, "🎂 " + (d.get("name") or "Birthday"), day=f"{today.year}-{md}", rrule="FREQ=YEARLY")
        except (ValueError, KeyError):
            continue   # one odd record must never break the feed
    out.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in out) + "\r\n"


def brief_text(rows, tz, name, now=None):
    """The day in a few plain lines (what Siri reads out)."""
    now = (now or datetime.now(timezone.utc)).astimezone(tz); today = now.date().isoformat()
    tasks = sorted([d for k, _, d in rows if k == "task" and not d.get("done") and d.get("due") and d["due"] <= today], key=lambda d: (d.get("priority") or 3, d.get("due_time") or "99"))
    events = sorted([d for k, _, d in rows if k == "event" and d.get("date") == today and d.get("start")], key=lambda d: d["start"])
    soon = [d for k, _, d in rows if k == "reminder" and d.get("remind_at") and not d.get("acked") and 0 <= (datetime.fromisoformat(d["remind_at"].replace("Z", "+00:00")) - now).total_seconds() <= 86400]
    lines = [f"Good {'morning' if now.hour < 12 else 'afternoon' if now.hour < 18 else 'evening'}{', ' + name if name else ''}. It's {now.strftime('%A %d %B')}."]
    if events: lines.append("Today: " + "; ".join(f"{e['start']} {e.get('title', '')}" for e in events[:4]) + ".")
    if tasks: lines.append(f"{len(tasks)} thing{'s' if len(tasks) != 1 else ''} to do: " + ", ".join(t.get("title", "") for t in tasks[:5]) + (f" and {len(tasks) - 5} more." if len(tasks) > 5 else "."))
    else: lines.append("Nothing due today.")
    if soon: lines.append("Coming up: " + ", ".join(r.get("title", "") for r in soon[:3]) + ".")
    return " ".join(lines)


def register(app, login_required, db, raw_db, kv_get, kv_set, settings, audit):
    def token(make=False):
        t = kv_get("feed_token")
        if not t and make:
            t = secrets.token_urlsafe(24); kv_set("feed_token", t)
        return t

    def rows():
        c = raw_db()
        try:
            return [(r["kind"], r["id"], json.loads(r["data"])) for r in c.execute("SELECT kind,id,data FROM records WHERE deleted_at IS NULL AND kind IN ('task','event','reminder','trip','travel_doc','person')")]
        finally:
            c.close()

    def authed(tok):
        import app as core
        if not core.rate_ok("feed:" + (request.remote_addr or ""), 120, 60):
            return False
        t = token(); return bool(t) and hmac.compare_digest(tok, t)

    @app.get("/feed/<tok>/life.ics")
    def feed_ics(tok):
        if not authed(tok):
            return "", 404
        s = settings(); return Response(build_ics(rows(), ZoneInfo(s["timezone"])), mimetype="text/calendar", headers={"Cache-Control": "no-store"})

    @app.get("/feed/<tok>/today.txt")
    def feed_today(tok):
        if not authed(tok):
            return "", 404
        s = settings(); return Response(brief_text(rows(), ZoneInfo(s["timezone"]), s.get("name", "")), mimetype="text/plain; charset=utf-8", headers={"Cache-Control": "no-store"})

    @app.get("/api/feed")
    @login_required
    def feed_info():
        t = token(); base = request.host_url.rstrip("/")
        return jsonify(on=bool(t), ics=f"{base}/feed/{t}/life.ics" if t else "", webcal=("webcal://" + request.host + f"/feed/{t}/life.ics") if t else "", today=f"{base}/feed/{t}/today.txt" if t else "")

    @app.post("/api/feed/rotate")
    @login_required
    def feed_rotate():
        kv_set("feed_token", secrets.token_urlsafe(24)); audit("feed_rotate")
        return feed_info()
