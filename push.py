"""Web Push (VAPID). iOS needs the app installed to the Home Screen; Telegram is the fallback channel. Dead subscriptions are pruned."""
import os, json, base64, uuid
from flask import request, jsonify

_vapid = None


def vapid(data_dir):
    """Load or create the VAPID key pair (data/vapid_private.pem). Returns (Vapid, public key as base64url for the browser)."""
    global _vapid
    if _vapid:
        return _vapid
    from py_vapid import Vapid
    from cryptography.hazmat.primitives import serialization
    path = os.path.join(data_dir, "vapid_private.pem")
    v = Vapid()
    if os.path.exists(path):
        v = Vapid.from_file(path)
    else:
        v.generate_keys()
        v.save_key(path)
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    _vapid = (v, base64.urlsafe_b64encode(raw).rstrip(b"=").decode())
    return _vapid


def send_all(raw_db, data_dir, title, body="", tag=None, url=None):
    """Send to every subscribed device. Returns (delivered, last_error)."""
    from pywebpush import webpush, WebPushException
    v, _ = vapid(data_dir)
    c = raw_db(); n = 0; err = ""
    try:
        for r in c.execute("SELECT id,data FROM records WHERE kind='push_sub' AND deleted_at IS NULL").fetchall():
            sub = json.loads(r["data"])["sub"]
            try:
                webpush(subscription_info=sub, data=json.dumps({"title": title, "body": body, "tag": tag, "url": url or "/#/today"}), vapid_private_key=v, vapid_claims={"sub": "mailto:" + (os.environ.get("VAPID_SUBJECT") or "life@localhost.invalid")}, ttl=3600, timeout=8)
                n += 1
            except WebPushException as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                if code in (404, 410):      # subscription is gone: prune it
                    c.execute("UPDATE records SET deleted_at=datetime('now') WHERE id=?", (r["id"],)); c.commit()
                else:
                    err = str(e)[:160]
            except Exception as e:
                err = str(e)[:160]
    finally:
        c.close()
    return n, err


def register(app, login_required, db, raw_db, set_state, now_iso, upsert, audit, data_dir):
    @app.get("/api/push/key")
    @login_required
    def push_key():
        return jsonify(key=vapid(data_dir)[1])

    @app.post("/api/push/subscribe")
    @login_required
    def push_sub():
        sub = (request.get_json() or {}).get("subscription") or {}
        if not str(sub.get("endpoint", "")).startswith("https://") or "keys" not in sub:
            return jsonify(error="That doesn't look like a push subscription."), 400
        rid = str(uuid.uuid5(uuid.NAMESPACE_URL, sub["endpoint"]))      # same device -> same record
        c = db(); upsert(c, {"id": rid, "kind": "push_sub", "data": {"sub": sub, "ua": request.headers.get("User-Agent", "")[:120]}}); c.commit()
        set_state("web_push", True, "", "device subscribed")
        return jsonify(ok=True)

    @app.post("/api/push/test")
    @login_required
    def push_test():
        n, err = send_all(raw_db, data_dir, "Life", "Test: this is how reminders will reach you.", "test")
        set_state("web_push", n > 0 or not err, err if n == 0 else "", f"{n} device(s)")
        return jsonify(delivered=n, error=err or (None if n else "No device is subscribed yet."))
