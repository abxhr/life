"""Later-phase integrations: wealth app (read-only), more added per phase. Everything fails soft into Data health."""
import time
import requests
from flask import jsonify, request

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
