"""Garmin: read-only daily summaries. Garmin's official Health API is for approved business partners, so this uses the
unofficial community `garminconnect` library (logs in with your credentials/tokens, supports MFA). It can break when Garmin
changes things — every call fails soft into Data health, and manual CSV/TCX/FIT import keeps the module useful regardless.
Only derived daily summaries are stored; the password stays in .env; tokens are cached in data/garmin-tokens."""
import os, io, csv, re, json, uuid, threading, xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from flask import request, jsonify

_pending = {}      # MFA state while waiting for the code
_lock = threading.Lock()


def day_id(day):   # deterministic: devices/syncs merge instead of duplicating
    return "9a7a1c00-0000-4000-8000-" + day.replace("-", "").rjust(12, "0")


def act_id(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "garmin-activity:" + str(key)))


def _g(d, *path, default=None):
    for p in path:
        if isinstance(d, dict) and p in d and d[p] is not None:
            d = d[p]
        elif isinstance(d, list) and isinstance(p, int) and len(d) > p:
            d = d[p]
        else:
            return default
    return d


def map_day(day, stats=None, sleep=None, hrv=None, maxm=None, body=None, readiness=None):
    """Raw Garmin payloads -> our small daily summary. Every field optional."""
    out = {"day": day}
    if stats:
        out.update(steps=_g(stats, "totalSteps"), rhr=_g(stats, "restingHeartRate"), stress=_g(stats, "averageStressLevel"),
                   body_battery=_g(stats, "bodyBatteryMostRecentValue", default=_g(stats, "bodyBatteryHighestValue")),
                   active_min=(_g(stats, "moderateIntensityMinutes", default=0) or 0) + (_g(stats, "vigorousIntensityMinutes", default=0) or 0),
                   calories=_g(stats, "totalKilocalories"))
    if sleep:
        secs = _g(sleep, "dailySleepDTO", "sleepTimeSeconds")
        out["sleep_h"] = round(secs / 3600, 2) if secs else None
        out["sleep_score"] = _g(sleep, "dailySleepDTO", "sleepScores", "overall", "value")
    if hrv:
        out["hrv"] = _g(hrv, "hrvSummary", "lastNightAvg"); out["hrv_status"] = _g(hrv, "hrvSummary", "status")
    if maxm:
        out["vo2max"] = _g(maxm, 0, "generic", "vo2MaxPreciseValue", default=_g(maxm, 0, "generic", "vo2MaxValue"))
    if body:
        w = _g(body, "totalAverage", "weight")
        out["weight"] = round(w / 1000, 1) if w and w > 500 else w
    if readiness:
        out["readiness"] = _g(readiness, 0, "score")
    return {k: v for k, v in out.items() if v is not None}


def map_activity(a):
    typ = _g(a, "activityType", "typeKey", default="other")
    return {"day": (a.get("startTimeLocal") or "")[:10], "type": typ, "name": a.get("activityName"), "distance_km": round((a.get("distance") or 0) / 1000, 2),
            "duration_min": round((a.get("duration") or 0) / 60, 1), "avg_hr": a.get("averageHR"), "calories": a.get("calories"), "gid": a.get("activityId")}


def tokdir_default():
    return os.path.join(os.environ.get("LIFE_DATA", "data"), "garmin-tokens")


def connected(tokdir=None):
    """True once a one-time sign-in has left tokens behind (Pulse-style: after that the password is never used again)."""
    d = tokdir or tokdir_default()
    return os.path.isdir(d) and any(os.scandir(d))


def _with_tokens(tokdir):
    """Reuse saved tokens (the library refreshes them itself). No email, no password, no code: this can never make Garmin send a verification email."""
    from garminconnect import Garmin
    g = Garmin()
    g.login(tokdir)
    return g


def _client(email, pw, tokdir):
    """The one-time sign-in with email + password. MFA -> NeedsMFA (enter the code once). Saves the tokens so this never has to happen again.
    In return_on_mfa mode the library returns BEFORE saving anything, so we save explicitly."""
    from garminconnect import Garmin
    g = Garmin(email, pw, return_on_mfa=True)
    res = g.login(tokdir)
    if isinstance(res, tuple) and res and res[0] == "needs_mfa":
        with _lock:
            _pending["g"], _pending["state"] = g, res[1]
        raise NeedsMFA()
    os.makedirs(tokdir, exist_ok=True)
    g.client.dump(tokdir)
    return _with_tokens(tokdir)


class NeedsMFA(Exception):
    pass


def sync(upsert, raw_db, set_state, now_iso, days=3, interactive=False):
    """interactive=True only for the Sync/Connect button. The background scheduler (interactive=False) NEVER signs in with a password,
    because every password sign-in makes Garmin email a security code. If the saved tokens stop working it just says so and waits for you."""
    tokdir = tokdir_default()
    os.makedirs(tokdir, exist_ok=True)
    if connected(tokdir):
        try:
            return _pull(_with_tokens(tokdir), upsert, raw_db, set_state, days)
        except Exception as e:
            if not interactive:
                set_state("garmin", False, f"Garmin sign-in expired ({str(e)[:100]}). Press Sync now in Health to reconnect once; Life won't retry by itself, so no more emails.")
                return {"ok": False, "reason": "reauth"}
    email, pw = os.environ.get("GARMIN_EMAIL"), os.environ.get("GARMIN_PASSWORD")
    if not interactive:
        set_state("garmin", False, "", "not connected yet: press Sync now in Health once to sign in (Garmin sends one code, and that's the only time)")
        return {"ok": False, "reason": "not connected"}
    if not email or not pw:
        set_state("garmin", False, "", "not configured (Garmin email and password in Settings → Garmin) — manual import still works")
        return {"ok": False, "reason": "not configured"}
    try:
        g = _client(email, pw, tokdir)
    except NeedsMFA:
        set_state("garmin", False, "Garmin wants a verification code (MFA). Enter it in Health → Import & sync. This is the only time.")
        return {"ok": False, "reason": "mfa"}
    except Exception as e:
        set_state("garmin", False, f"login failed: {str(e)[:160]}")
        return {"ok": False, "reason": "login"}
    return _pull(g, upsert, raw_db, set_state, days)


def _pull(g, upsert, raw_db, set_state, days):
    c = raw_db(); n = 0; partial = []
    try:
        for i in range(days):
            day = (date.today() - timedelta(days=i)).isoformat()
            parts = {}
            for key, fn in (("stats", lambda: g.get_stats(day)), ("sleep", lambda: g.get_sleep_data(day)), ("hrv", lambda: g.get_hrv_data(day)),
                            ("maxm", lambda: g.get_max_metrics(day)), ("readiness", lambda: g.get_training_readiness(day)), ("body", lambda: g.get_body_composition(day, day))):
                try:
                    parts[key] = fn()
                except Exception as e:      # one metric missing must not lose the rest
                    if i == 0:
                        partial.append(key)
            d = map_day(day, **parts)
            if len(d) > 1:
                upsert(c, {"id": day_id(day), "kind": "garmin_daily", "data": d}); n += 1
        try:
            for a in g.get_activities(0, 30):
                m = map_activity(a)
                if m["day"]:
                    upsert(c, {"id": act_id(m["gid"]), "kind": "garmin_activity", "data": m})
        except Exception:
            partial.append("activities")
        c.commit()
        set_state("garmin", True, "", f"{n} day(s)" + (f"; unavailable: {', '.join(partial)}" if partial else ""))
        return {"ok": True, "days": n, "partial": partial}
    except Exception as e:
        set_state("garmin", False, str(e)[:200])
        return {"ok": False, "reason": str(e)[:200]}
    finally:
        c.close()


# ---------- manual import (works when the library breaks) ----------
def parse_activities_csv(text):
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    out = []
    for r in rows:
        low = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        day = (low.get("date") or low.get("start time") or "")[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}", day):
            continue
        def num(k):
            try: return float(low.get(k, "").replace(",", "").replace("--", "") or 0)
            except ValueError: return 0.0
        t = low.get("time") or low.get("duration") or "0:00:00"; parts = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", t)]
        mins = parts[0] * 60 + parts[1] + parts[2] / 60 if len(parts) >= 3 else parts[0] + parts[1] / 60 if len(parts) == 2 else (parts[0] if parts else 0)
        out.append({"day": day, "type": (low.get("activity type") or "other").lower().replace(" ", "_"), "name": low.get("title"), "distance_km": num("distance"), "duration_min": round(mins, 1), "avg_hr": num("avg hr") or None, "calories": num("calories") or None, "gid": f"csv:{day}:{low.get('time')}:{low.get('distance')}"})
    return out


def parse_tcx(data):
    ns = {"t": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"}
    root = ET.fromstring(data)
    out = []
    for a in root.iterfind(".//t:Activity", ns):
        laps = a.findall("t:Lap", ns); dist = sum(float(l.findtext("t:DistanceMeters", "0", ns)) for l in laps); secs = sum(float(l.findtext("t:TotalTimeSeconds", "0", ns)) for l in laps)
        hrs = [float(x.text) for x in a.iterfind(".//t:HeartRateBpm/t:Value", ns)]
        out.append({"day": (a.findtext("t:Id", "", ns))[:10], "type": (a.get("Sport") or "other").lower(), "name": None, "distance_km": round(dist / 1000, 2), "duration_min": round(secs / 60, 1), "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None, "calories": sum(int(l.findtext("t:Calories", "0", ns)) for l in laps) or None, "gid": f"tcx:{a.findtext('t:Id', '', ns)}"})
    return out


def parse_fit(data):
    from fitparse import FitFile
    f = FitFile(io.BytesIO(data)); out = []
    for s in f.get_messages("session"):
        v = s.get_values(); st = v.get("start_time")
        out.append({"day": st.date().isoformat() if st else "", "type": str(v.get("sport") or "other").lower(), "name": None, "distance_km": round((v.get("total_distance") or 0) / 1000, 2), "duration_min": round((v.get("total_timer_time") or 0) / 60, 1), "avg_hr": v.get("avg_heart_rate"), "calories": v.get("total_calories"), "gid": f"fit:{st}"})
    return out


def register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit):
    @app.post("/api/garmin/sync")
    @login_required
    def garmin_sync():
        return jsonify(sync(upsert, raw_db, set_state, now_iso, days=int((request.get_json(silent=True) or {}).get("days", 7)), interactive=True))

    @app.post("/api/garmin/mfa")
    @login_required
    def garmin_mfa():
        code = (request.get_json() or {}).get("code", "").strip()
        with _lock:
            g, state = _pending.get("g"), _pending.get("state")
        if not g:
            return jsonify(error="No Garmin login is waiting for a code. Press Sync first."), 400
        try:
            g.resume_login(state, code)
            tokdir = tokdir_default(); os.makedirs(tokdir, exist_ok=True)
            g.client.dump(tokdir)   # save the tokens: after this, no password and no more codes
            with _lock:
                _pending.clear()
            return jsonify(_pull(g, upsert, raw_db, set_state, 7))
        except Exception as e:
            return jsonify(error="That code didn't work: " + str(e)[:100]), 400

    @app.post("/api/garmin/import")
    @login_required
    def garmin_import():
        f = request.files.get("file")
        if not f:
            return jsonify(error="No file"), 400
        raw = f.read(10_000_000); name = (f.filename or "").lower()
        try:
            acts = parse_tcx(raw) if name.endswith(".tcx") else parse_fit(raw) if name.endswith(".fit") else parse_activities_csv(raw.decode("utf8", "ignore"))
        except Exception as e:
            return jsonify(error=f"Couldn't read that file: {str(e)[:100]}"), 400
        c = db(); n = 0
        for a in acts:
            if a.get("day"):
                upsert(c, {"id": act_id(a["gid"]), "kind": "garmin_activity", "data": {**a, "source": "import"}}); n += 1
        c.commit()
        set_state("garmin", True, "", f"imported {n} activities from file")
        return jsonify(ok=True, imported=n)
