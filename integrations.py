"""Integrations. Each one fails soft: errors go to sync_state (Data health), never crash the app."""
import os, re, json, time, uuid, threading
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo
import requests
from flask import request, jsonify

INTEGRATIONS = ["calendar_feeds", "telegram", "web_push", "weather", "fx", "garmin", "gmail", "wealth", "ai", "backup"]
_last = {}


def register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit):
    # ----- ICS feeds -----
    @app.get("/api/ics")
    @login_required
    def ics_events():
        a, b = request.args.get("from", ""), request.args.get("to", "9999")
        rows = db().execute("SELECT * FROM feed_events WHERE start<? AND end>=? ORDER BY start", (b, a)).fetchall()
        return jsonify([dict(r) for r in rows])

    @app.post("/api/ics/refresh")
    @login_required
    def ics_refresh():
        refresh_feeds(raw_db, set_state, settings)
        return jsonify(ok=True)

    # ----- Telegram / notification test -----
    @app.post("/api/notify/test")
    @login_required
    def notify_test():
        ok, err = telegram_send(settings(), "Life test: this is how reminders will reach you.")
        set_state("telegram", ok, err)
        return jsonify(telegram=ok, error=err)

    @app.post("/api/telegram/webhook/<secret>")
    def tg_hook(secret):
        """Telegram -> inbox. Only the configured chat id may capture."""
        if secret != os.environ.get("TELEGRAM_WEBHOOK_SECRET", "-"):
            return "", 404
        m = (request.get_json(silent=True) or {}).get("message") or {}
        if str((m.get("chat") or {}).get("id")) != str(settings().get("telegram_chat_id")) or not m.get("text"):
            return "", 200
        c = raw_db()
        upsert(c, {"id": str(uuid.uuid4()), "kind": "inbox", "data": {"text": m["text"][:2000], "source": "telegram"}})
        c.commit()
        return "", 200

    # ----- Work capture generator (tier 0/1) -----
    import workcapture
    workcapture.register(app, login_required, db, now_iso, audit, kv_get, kv_set)

    # ----- link title (SSRF-safe: public IPs only) -----
    @app.get("/api/linkmeta")
    @login_required
    def linkmeta():
        url = request.args.get("url", "")
        try:
            for _ in range(4):
                if not public_url(url):
                    return jsonify(error="blocked"), 400
                r = requests.get(url, timeout=6, stream=True, allow_redirects=False, headers={"User-Agent": "Mozilla/5.0 Life"})
                if r.is_redirect:
                    url = requests.compat.urljoin(url, r.headers.get("Location", ""))
                    continue
                html = r.raw.read(400_000, decode_content=True).decode("utf8", "ignore")
                t = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
                d = re.search(r"""<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)""", html, re.I)
                import html as H
                return jsonify(title=H.unescape(t.group(1)).strip()[:200] if t else "", desc=H.unescape(d.group(1))[:300] if d else "")
        except Exception as e:
            return jsonify(error=str(e)[:100]), 502
        return jsonify(error="too many redirects"), 502

    # ----- weather -----
    @app.get("/api/weather")
    @login_required
    def weather():
        lat, lon = request.args.get("lat", "25.2"), request.args.get("lon", "55.27")
        key = f"weather:{lat}:{lon}"
        cached = _last.get(key)
        if cached and time.time() - cached[0] < 1800:
            return jsonify(cached[1])
        try:
            r = requests.get("https://api.open-meteo.com/v1/forecast", timeout=8, params={
                "latitude": lat, "longitude": lon, "current": "temperature_2m,weather_code,precipitation",
                "daily": "temperature_2m_max,precipitation_probability_max,weather_code", "timezone": "auto", "forecast_days": 3})
            r.raise_for_status()
            _last[key] = (time.time(), r.json())
            set_state("weather", True)
            return jsonify(r.json())
        except Exception as e:
            set_state("weather", False, str(e)[:200])
            return jsonify(error="weather unavailable"), 502

    # later phases
    try:
        import extras
        extras.register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit)
    except ImportError:
        pass


def public_url(u):
    import socket, ipaddress
    from urllib.parse import urlparse
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        return all(ipaddress.ip_address(i[4][0]).is_global for i in socket.getaddrinfo(p.hostname, p.port or 443))
    except Exception:
        return False


# ---------- Telegram ----------
def telegram_send(s, text):
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), s.get("telegram_chat_id")
    if not tok or not chat:
        return False, "Telegram not configured (bot token in .env, chat id in Settings)"
    try:
        r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage", json={"chat_id": chat, "text": text}, timeout=10)
        return (r.ok, "" if r.ok else r.text[:200])
    except Exception as e:
        return False, str(e)[:200]


# ---------- ICS parsing (small, enough for Google/Apple feeds) ----------
def _unfold(t):
    return re.sub(r"\r?\n[ \t]", "", t).splitlines()


def _dt(val, params, tz):
    allday = "VALUE=DATE" in params or re.fullmatch(r"\d{8}", val) is not None
    if allday:
        d = datetime.strptime(val[:8], "%Y%m%d")
        return d.replace(tzinfo=tz), True
    z = re.search(r"TZID=([^;:]+)", params)
    if val.endswith("Z"):
        return datetime.strptime(val, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc), False
    try:
        zone = ZoneInfo(z.group(1)) if z else tz
    except Exception:
        zone = tz
    return datetime.strptime(val[:15], "%Y%m%dT%H%M%S").replace(tzinfo=zone), False


def parse_ics(text, tz, win_from, win_to):
    out, cur = [], None
    for ln in _unfold(text):
        if ln == "BEGIN:VEVENT":
            cur = {}
        elif ln == "END:VEVENT" and cur is not None:
            try:
                out.extend(_expand(cur, tz, win_from, win_to))
            except Exception:
                pass
            cur = None
        elif cur is not None and ":" in ln:
            name, val = ln.split(":", 1)
            base = name.split(";")[0]
            if base in ("DTSTART", "DTEND", "SUMMARY", "UID", "RRULE", "LOCATION", "STATUS", "RECURRENCE-ID"):
                cur[base] = (val, name)
            elif base == "EXDATE":
                cur.setdefault("EXDATE", []).append(val)
    return out


WD = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _expand(ev, tz, a, b):
    if "DTSTART" not in ev or ev.get("STATUS", ("",))[0] == "CANCELLED":
        return []
    s, allday = _dt(ev["DTSTART"][0], ev["DTSTART"][1], tz)
    e = _dt(ev["DTEND"][0], ev["DTEND"][1], tz)[0] if "DTEND" in ev else s + (timedelta(days=1) if allday else timedelta(hours=1))
    dur = e - s
    title, uid, loc = ev.get("SUMMARY", ("(busy)",))[0].replace("\\,", ",").replace("\\n", " "), ev.get("UID", (str(uuid.uuid4()),))[0], ev.get("LOCATION", ("",))[0].replace("\\,", ",")
    starts = [s]
    if "RRULE" in ev:
        r = dict(p.split("=", 1) for p in ev["RRULE"][0].split(";") if "=" in p)
        n, count, until = int(r.get("INTERVAL", 1)), int(r.get("COUNT", 0)) or None, None
        if "UNTIL" in r:
            until = _dt(r["UNTIL"], "", tz)[0]
            if until.tzinfo is None:
                until = until.replace(tzinfo=tz)
        starts, cur, k = [], s, 0
        days = [WD[x[-2:]] for x in r["BYDAY"].split(",")] if r.get("BYDAY") else None
        while cur < b and k < 3000 and (not until or cur <= until) and (not count or len(starts) < count):
            f = r.get("FREQ")
            if f == "WEEKLY" and days:
                wk = cur - timedelta(days=cur.weekday())
                for d in sorted(days):
                    x = wk + timedelta(days=d)
                    x = x.replace(hour=s.hour, minute=s.minute, second=s.second)
                    if x >= s and (not until or x <= until) and (not count or len(starts) < count):
                        starts.append(x)
                cur = wk + timedelta(weeks=n)
            else:
                starts.append(cur)
                if f == "DAILY":
                    cur += timedelta(days=n)
                elif f == "WEEKLY":
                    cur += timedelta(weeks=n)
                elif f == "MONTHLY":
                    m = cur.month - 1 + n
                    try:
                        cur = cur.replace(year=cur.year + m // 12, month=m % 12 + 1)
                    except ValueError:
                        cur = cur.replace(year=cur.year + m // 12, month=m % 12 + 1, day=28)
                elif f == "YEARLY":
                    try:
                        cur = cur.replace(year=cur.year + n)
                    except ValueError:
                        cur = cur.replace(year=cur.year + n, day=28)
                else:
                    break
            k += 1
    ex = set(v[:8] for xs in ev.get("EXDATE", []) for v in xs.split(","))
    res = []
    for st in starts:
        if st.strftime("%Y%m%d") in ex or st + dur < a or st > b:
            continue
        en = st + dur
        res.append({"uid": uid, "start": st.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if not allday else st.strftime("%Y-%m-%d"),
                    "end": en.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if not allday else en.strftime("%Y-%m-%d"),
                    "allday": int(allday), "title": title, "loc": loc})
    return res


def refresh_feeds(raw_db, set_state, settings):
    s = settings()
    feeds = [f for f in s.get("feeds", []) if f.get("url")]
    if not feeds:
        set_state("calendar_feeds", True, info="no feeds added")
        return
    tz = ZoneInfo(s["timezone"])
    a, b = datetime.now(tz) - timedelta(days=30), datetime.now(tz) + timedelta(days=180)
    errs = []
    c = raw_db()
    for f in feeds:
        try:
            r = requests.get(f["url"], timeout=15, headers={"User-Agent": "Life/1.0"})
            r.raise_for_status()
            evs = parse_ics(r.text, tz, a, b)
            c.execute("DELETE FROM feed_events WHERE feed=?", (f.get("id") or f["url"][-12:],))
            for e in evs:
                c.execute("INSERT OR REPLACE INTO feed_events VALUES(?,?,?,?,?,?,?)", (f.get("id") or f["url"][-12:], e["uid"], e["start"], e["end"], e["allday"], e["title"], e["loc"]))
            c.commit()
        except Exception as ex:
            errs.append(f"{f.get('name', 'feed')}: {str(ex)[:100]}")
    c.close()
    set_state("calendar_feeds", not errs, "; ".join(errs), info=f"{len(feeds)} feed(s)")


# ---------- scheduler tick: reminders + feeds ----------
def due_items(c):
    t = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    for r in c.execute("SELECT id,kind,data FROM records WHERE kind IN ('reminder','task') AND deleted_at IS NULL"):
        d = json.loads(r["data"])
        at = d.get("remind_at")
        if not at or d.get("done") or d.get("acked"):
            continue
        if at[:16] <= t:
            yield r["id"], r["kind"], d


def tick(raw_db, set_state, kv_get, settings, now_iso, upsert):
    s = settings()
    now = time.time()
    if now - _last.get("feeds", 0) > 20 * 60:
        _last["feeds"] = now
        refresh_feeds(raw_db, set_state, settings)
    if now - _last.get('gmail', 0) > 6 * 3600 and os.environ.get('GMAIL_USER'):
        _last['gmail'] = now
        try:
            import gmail
            gmail.sync(upsert, raw_db, set_state, settings, now_iso)
        except Exception as e:
            print('gmail:', e)
    if now - _last.get('garmin', 0) > 4 * 3600 and os.environ.get('GARMIN_EMAIL'):
        _last['garmin'] = now
        try:
            import garmin
            garmin.sync(upsert, raw_db, set_state, now_iso, days=3)
        except Exception as e:
            print('garmin:', e)
    if now - _last.get('wealthsnap', 0) > 6 * 3600:
        _last['wealthsnap'] = now
        try:
            import extras
            extras.tick_extras(raw_db, set_state, settings, now_iso, upsert)
        except Exception as e:
            print('wealth snapshot:', e)
    if now - _last.get('auto', 0) > 1800:
        _last['auto'] = now
        try:
            auto_reminders(raw_db, set_state, settings, now_iso, upsert)
        except Exception as e:
            print('auto_reminders:', e)
    c = raw_db()
    tz = ZoneInfo(s["timezone"])
    hhmm = datetime.now(tz).strftime("%H:%M")
    qf, qt = s["quiet_from"], s["quiet_to"]
    quiet = (hhmm >= qf or hhmm < qt) if qf > qt else (qf <= hhmm < qt)
    for rid, kind, d in list(due_items(c)):
        crit = d.get("critical")
        last = d.get("last_fired")
        if last and not (crit and time.time() - datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp() > 600):
            continue
        if last and not crit:
            continue
        if quiet and not crit:
            continue
        title = d.get("title") or d.get("text") or "Reminder"
        ok, err = telegram_send(s, ("‼ " if crit else "⏰ ") + title)
        if err and "not configured" not in err:
            set_state("telegram", False, err)
        elif ok:
            set_state("telegram", True)
        d["last_fired"] = now_iso()
        d["fired_n"] = d.get("fired_n", 0) + 1
        row = c.execute("SELECT created_at FROM records WHERE id=?", (rid,)).fetchone()
        upsert(c, {"id": rid, "kind": kind, "data": {"last_fired": d["last_fired"], "fired_n": d["fired_n"]}, "created_at": row["created_at"], "updated_at": now_iso()})
        c.commit()
    c.close()


# ---------- auto-generated reminders: document expiries, birthdays, trip departures ----------
def _patch(c, upsert, now_iso, rid, kind, data):
    row = c.execute("SELECT created_at FROM records WHERE id=?", (rid,)).fetchone()
    upsert(c, {"id": rid, "kind": kind, "data": data, "created_at": row["created_at"], "updated_at": now_iso()})
    c.commit()


def auto_reminders(raw_db, set_state, settings, now_iso, upsert):
    s = settings()
    tz = ZoneInfo(s["timezone"])
    now_l = datetime.now(tz)
    today = now_l.date()
    c = raw_db()
    try:
        if now_l.hour < 7:  # nothing before the morning; quiet hours respected
            return
        for r in c.execute("SELECT id,data FROM records WHERE kind='travel_doc' AND deleted_at IS NULL"):
            d = json.loads(r["data"])
            if not d.get("expiry"):
                continue
            left = (date.fromisoformat(d["expiry"]) - today).days
            done = set(d.get("notified") or [])
            due = [a for a in (180, 90, 30, 7) if left <= a and a not in done]
            if due and left >= -365:
                ok, _ = telegram_send(s, f"\u23f3 {d.get('name', 'Document')} {'expires in %d days' % left if left >= 0 else 'expired %d days ago' % -left}")
                _patch(c, upsert, now_iso, r["id"], "travel_doc", {"notified": sorted(done | set(due))})
        for r in c.execute("SELECT id,data FROM records WHERE kind='person' AND deleted_at IS NULL"):
            d = json.loads(r["data"])
            b = d.get("birthday") or ""
            if len(b) >= 5 and b[-5:] == today.strftime("%m-%d") and d.get("notified_year") != today.year:
                telegram_send(s, f"\U0001f382 {d.get('name')}'s birthday today")
                _patch(c, upsert, now_iso, r["id"], "person", {"notified_year": today.year})
        for r in c.execute("SELECT id,data FROM records WHERE kind='trip' AND deleted_at IS NULL"):
            d = json.loads(r["data"])
            if not d.get("start") or d.get("status") == "done":
                continue
            n = (date.fromisoformat(d["start"]) - today).days
            done = set(d.get("notified") or [])
            for key, hit in (("T7", n == 7), ("T1", n == 1)):
                if hit and key not in done:
                    telegram_send(s, f"\u2708 {d.get('name')} starts in {n} day{'s' if n > 1 else ''}. Check the list: passport, visa, packing.")
                    done.add(key)
                    _patch(c, upsert, now_iso, r["id"], "trip", {"notified": sorted(done)})
        for r in c.execute("SELECT id,data FROM records WHERE kind='booking' AND deleted_at IS NULL"):
            d = json.loads(r["data"])
            if d.get("type") != "flight" or not d.get("start") or not d.get("start_time") or d.get("notified_3h"):
                continue
            dep = datetime.fromisoformat(d["start"] + "T" + d["start_time"]).replace(tzinfo=tz)
            if timedelta(0) <= dep - now_l <= timedelta(hours=3):
                telegram_send(s, f"\u2708 Leave soon: {d.get('title')} departs {d['start_time']}" + (f", terminal {d['terminal']}" if d.get("terminal") else ""))
                _patch(c, upsert, now_iso, r["id"], "booking", {"notified_3h": True})
    finally:
        c.close()
