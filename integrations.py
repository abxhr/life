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
    if now - _last.get('tgpoll', 0) > 30:
        _last['tgpoll'] = now
        telegram_poll(raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert)
        daily_agenda(raw_db, set_state, kv_get, kv_set, settings)
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
        chan = d.get("channels") or "all"          # all | telegram | push | inapp
        if chan in ("all", "telegram"):
            ok, err = telegram_send(s, ("‼ " if crit else "⏰ ") + title)
            if err and "not configured" not in err:
                set_state("telegram", False, err)
            elif ok:
                set_state("telegram", True)
        if chan in ("all", "push"):
            try:
                import push
                n, perr = push.send_all(raw_db, os.environ.get("LIFE_DATA", "data"), ("Important: " if crit else "") + title, "", rid)
                if n:
                    set_state("web_push", True, "", f"{n} device(s)")
                elif perr:
                    set_state("web_push", False, perr)
            except Exception as ex:
                set_state("web_push", False, str(ex)[:160])
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


# ---------- Telegram inbound (long-poll, so no public URL is needed) + daily agenda ----------
def agenda_text(raw_db, s):
    tz = ZoneInfo(s["timezone"])
    today = datetime.now(tz).date().isoformat()
    c = raw_db()
    try:
        lines = [f"☀ Good morning {s['name']} — {datetime.now(tz).strftime('%A %d %b')}"]
        ev = []
        for r in c.execute("SELECT data FROM records WHERE kind='event' AND deleted_at IS NULL"):
            d = json.loads(r["data"])
            if d.get("date") == today:
                ev.append((d.get("start") or "00:00", d.get("title")))
        for r in c.execute("SELECT title,start,allday FROM feed_events WHERE substr(start,1,10) BETWEEN ? AND ?", (today, today)):
            if not r["allday"]:
                ev.append((datetime.fromisoformat(r["start"].replace("Z", "+00:00")).astimezone(tz).strftime("%H:%M"), r["title"]))
        tasks = []
        for r in c.execute("SELECT data FROM records WHERE kind='task' AND deleted_at IS NULL"):
            d = json.loads(r["data"])
            if not d.get("done") and not d.get("someday") and d.get("due") and d["due"] <= today:
                tasks.append(("⚠ " if d["due"] < today else "") + d.get("title", ""))
        if ev:
            lines.append("\nCalendar:\n" + "\n".join(f"  {t} {n}" for t, n in sorted(ev)))
        if tasks:
            lines.append("\nDue / slipped:\n" + "\n".join("  • " + t for t in tasks[:12]))
        if not ev and not tasks:
            lines.append("\nNothing scheduled. A clear day.")
        return "\n".join(lines)
    finally:
        c.close()


def telegram_poll(raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert):
    tok, s = os.environ.get("TELEGRAM_BOT_TOKEN"), settings()
    chat = str(s.get("telegram_chat_id") or "")
    if not tok or not chat:
        return
    try:
        r = requests.get(f"https://api.telegram.org/bot{tok}/getUpdates", params={"offset": kv_get("tg_offset", 0), "timeout": 0}, timeout=10)
        r.raise_for_status()
        c = raw_db()
        try:
            for u in r.json().get("result", []):
                kv_set("tg_offset", u["update_id"] + 1)
                m = u.get("message") or {}
                if str((m.get("chat") or {}).get("id")) != chat or not m.get("text"):
                    continue                                      # only YOUR chat can talk to Life
                text = m["text"].strip()
                if text.startswith("/agenda"):
                    telegram_send(s, agenda_text(raw_db, s))
                elif text.startswith("/"):
                    telegram_send(s, "Send me any text to drop it in your inbox. /agenda shows today.")
                else:
                    rid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"telegram:{u['update_id']}"))
                    upsert(c, {"id": rid, "kind": "inbox", "data": {"text": text[:2000], "source": "telegram"}})
                    c.commit()
                    telegram_send(s, "✓ in your inbox")
        finally:
            c.close()
        set_state("telegram", True)
    except Exception as e:
        set_state("telegram", False, str(e)[:160])


def daily_agenda(raw_db, set_state, kv_get, kv_set, settings):
    s = settings()
    if not s.get("agenda_push"):
        return
    tz = ZoneInfo(s["timezone"]); now = datetime.now(tz)
    if now.strftime("%H:%M") < s.get("agenda_time", "07:30") or kv_get("last_agenda") == now.date().isoformat():
        return
    if now.weekday() not in [(d - 1) % 7 for d in s.get("work_days", [1, 2, 3, 4, 5])] and s.get("agenda_workdays_only", True):
        kv_set("last_agenda", now.date().isoformat()); return
    ok, err = telegram_send(s, agenda_text(raw_db, s))
    kv_set("last_agenda", now.date().isoformat())
    if not ok and err and "not configured" not in err:
        set_state("telegram", False, err)
