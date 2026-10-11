"""Face ID / Touch ID unlock: WebAuthn passkeys (ES256, which is what iPhone, Mac and Android create), verified here with `cryptography`: no extra dependency.
Server-side checks on every sign-in: the challenge we issued, the origin, the app's identity hash (rpIdHash), that the device verified the USER (Face ID / passcode),
and the signature over the authenticator data with the stored public key. A stolen cookie alone is not enough once "Require Face ID" is on."""
import json, time, base64, secrets, hashlib
from flask import request, jsonify, session
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature

b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
unb64u = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def cbor_decode(b, i=0):
    """Minimal CBOR (definite lengths only, which is all WebAuthn uses). Returns (value, next_index)."""
    major, info = b[i] >> 5, b[i] & 31; i += 1
    if info < 24:
        n = info
    elif info in (24, 25, 26, 27):
        size = {24: 1, 25: 2, 26: 4, 27: 8}[info]; n = int.from_bytes(b[i:i + size], "big"); i += size
    else:
        raise ValueError("unsupported CBOR")
    if major == 0: return n, i
    if major == 1: return -1 - n, i
    if major == 2: return bytes(b[i:i + n]), i + n
    if major == 3: return bytes(b[i:i + n]).decode(), i + n
    if major == 4:
        out = []
        for _ in range(n):
            v, i = cbor_decode(b, i); out.append(v)
        return out, i
    if major == 5:
        out = {}
        for _ in range(n):
            k, i = cbor_decode(b, i); v, i = cbor_decode(b, i); out[k] = v
        return out, i
    if major == 7: return {20: False, 21: True, 22: None}.get(info), i
    raise ValueError("unsupported CBOR")


def _client_data(raw, typ, challenge, origin):
    cd = json.loads(raw)
    if cd.get("type") != typ or cd.get("challenge") != challenge or cd.get("origin") != origin:
        raise ValueError("challenge or origin mismatch")


def _origin():
    o = request.headers.get("Origin", "")
    if not (o.startswith("https://") or o.startswith(("http://localhost", "http://127.0.0.1"))):
        raise ValueError("passkeys need https")
    return o, o.split("://", 1)[1].split(":")[0].strip("[]")


def local_request():
    """The password still works from the PC itself, as a way back in if the phone is lost."""
    return request.host.split(":")[0] in ("127.0.0.1", "localhost", "[::1]")


def register(app, login_required, kv_get, kv_set, settings, rate_ok, audit):
    keys = lambda: kv_get("passkeys", []) or []

    def pending(kind):
        c = session.pop("pk_" + kind, None)
        if not c or time.time() - c["t"] > 300:
            raise ValueError("expired: try again")
        return c["c"]

    @app.get("/api/passkey/status")
    def pk_status():
        return jsonify(has=bool(keys()), required=bool(settings().get("faceid_required") and keys()))

    @app.post("/api/passkey/register/options")
    @login_required
    def pk_reg_options():
        try:
            origin, rp = _origin()
        except ValueError as e:
            return jsonify(error=str(e)), 400
        ch = b64u(secrets.token_bytes(32)); session["pk_reg"] = {"c": ch, "t": time.time(), "o": origin, "rp": rp}
        return jsonify(challenge=ch, rp={"id": rp, "name": "Life"}, user={"id": b64u(b"life-owner"), "name": "me", "displayName": "Me"}, pubKeyCredParams=[{"type": "public-key", "alg": -7}],
                       authenticatorSelection={"authenticatorAttachment": "platform", "residentKey": "preferred", "userVerification": "required"}, attestation="none", timeout=60000,
                       excludeCredentials=[{"type": "public-key", "id": k["id"]} for k in keys() if k["rp"] == rp])

    @app.post("/api/passkey/register/verify")
    @login_required
    def pk_reg_verify():
        j = request.get_json(silent=True) or {}
        try:
            st = session.pop("pk_reg", None)
            if not st or time.time() - st["t"] > 300: raise ValueError("expired: try again")
            r = j["response"]; _client_data(unb64u(r["clientDataJSON"]), "webauthn.create", st["c"], st["o"])
            att, _ = cbor_decode(unb64u(r["attestationObject"])); ad = att["authData"]
            if ad[:32] != hashlib.sha256(st["rp"].encode()).digest(): raise ValueError("wrong app identity")
            flags = ad[32]
            if not (flags & 0x01 and flags & 0x04 and flags & 0x40): raise ValueError("Face ID / passcode check was not performed")
            n = int.from_bytes(ad[53:55], "big"); cred_id = ad[55:55 + n]
            cose, _ = cbor_decode(ad, 55 + n)
            if cose.get(3) != -7 or cose.get(-1) != 1: raise ValueError("unsupported key type")
            ec.EllipticCurvePublicNumbers(int.from_bytes(cose[-2], "big"), int.from_bytes(cose[-3], "big"), ec.SECP256R1()).public_key()   # valid point?
        except Exception as e:
            return jsonify(error="Couldn't save that passkey: " + str(e)[:100]), 400
        ks = [k for k in keys() if k["id"] != b64u(cred_id)]
        ks.append({"id": b64u(cred_id), "x": b64u(cose[-2]), "y": b64u(cose[-3]), "count": int.from_bytes(ad[33:37], "big"), "rp": st["rp"], "origin": st["o"],
                   "name": str(j.get("name") or "This device")[:40], "created": time.strftime("%Y-%m-%d")})
        kv_set("passkeys", ks); audit("passkey_add", ks[-1]["name"])
        return jsonify(ok=True)

    @app.post("/api/passkey/login/options")
    def pk_login_options():
        try:
            origin, rp = _origin()
        except ValueError as e:
            return jsonify(error=str(e)), 400
        mine = [k for k in keys() if k["rp"] == rp and k["origin"] == origin]
        if not mine:
            return jsonify(error="No Face ID is set up for this address yet."), 404
        ch = b64u(secrets.token_bytes(32)); session["pk_login"] = {"c": ch, "t": time.time(), "o": origin, "rp": rp}
        return jsonify(challenge=ch, rpId=rp, allowCredentials=[{"type": "public-key", "id": k["id"]} for k in mine], userVerification="required", timeout=60000)

    @app.post("/api/passkey/login/verify")
    def pk_login_verify():
        if not rate_ok("pk:" + (request.remote_addr or ""), 12, 300):
            return jsonify(error="Too many tries. Wait a few minutes."), 429
        j = request.get_json(silent=True) or {}
        try:
            st = session.pop("pk_login", None)
            if not st or time.time() - st["t"] > 300: raise ValueError("expired: try again")
            ks = keys(); k = next((x for x in ks if x["id"] == j.get("id") and x["rp"] == st["rp"] and x["origin"] == st["o"]), None)
            if not k: raise ValueError("unknown passkey")
            r = j["response"]; cd = unb64u(r["clientDataJSON"]); ad = unb64u(r["authenticatorData"])
            _client_data(cd, "webauthn.get", st["c"], st["o"])
            if ad[:32] != hashlib.sha256(st["rp"].encode()).digest(): raise ValueError("wrong app identity")
            if not (ad[32] & 0x01 and ad[32] & 0x04): raise ValueError("Face ID / passcode check was not performed")
            pub = ec.EllipticCurvePublicNumbers(int.from_bytes(unb64u(k["x"]), "big"), int.from_bytes(unb64u(k["y"]), "big"), ec.SECP256R1()).public_key()
            pub.verify(unb64u(r["signature"]), ad + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
            count = int.from_bytes(ad[33:37], "big")
            if count and k["count"] and count <= k["count"]: raise ValueError("replayed or cloned passkey")
            k["count"] = max(count, k["count"]); kv_set("passkeys", ks)
        except (InvalidSignature, ValueError, KeyError, TypeError) as e:
            audit("passkey_fail", type(e).__name__)
            return jsonify(error="Face ID didn't check out: " + (str(e)[:80] if not isinstance(e, InvalidSignature) else "bad signature")), 401
        session.clear(); session.permanent = True
        session["ok"] = True; session["csrf"] = secrets.token_hex(16); session["unlocked"] = True; session["seen"] = time.time()
        return jsonify(ok=True, csrf=session["csrf"])

    @app.get("/api/passkey")
    @login_required
    def pk_list():
        return jsonify([{"id": k["id"], "name": k["name"], "created": k["created"]} for k in keys()])

    @app.delete("/api/passkey/<kid>")
    @login_required
    def pk_delete(kid):
        ks = [k for k in keys() if k["id"] != kid]
        kv_set("passkeys", ks)
        if not ks:   # no passkey left: never leave the app requiring one
            cur = kv_get("settings", {}) or {}; cur["faceid_required"] = False; kv_set("settings", cur)
        return jsonify(ok=True)

    @app.post("/api/lock")
    def pk_lock():   # no CSRF on purpose: locking is harmless, and the page calls it from a background beacon
        session["unlocked"] = False
        return "", 204
