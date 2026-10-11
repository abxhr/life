"""Face ID (WebAuthn passkeys): a fake authenticator with a real P-256 key registers, signs in, and every way of cheating is refused."""
import os, sys, json, time, hashlib, base64, struct
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from test_backend import cli  # noqa: F401

ORIGIN, RP = "https://phone.example.ts.net:8443", "phone.example.ts.net"
b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
unb64u = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def cbor(v):
    def head(major, n):
        return bytes([major << 5 | n]) if n < 24 else bytes([major << 5 | 24, n]) if n < 256 else bytes([major << 5 | 25]) + n.to_bytes(2, "big")
    if isinstance(v, bool): return b"\xf5" if v else b"\xf4"
    if isinstance(v, int): return head(0, v) if v >= 0 else head(1, -1 - v)
    if isinstance(v, bytes): return head(2, len(v)) + v
    if isinstance(v, str): return head(3, len(v.encode())) + v.encode()
    if isinstance(v, dict): return head(5, len(v)) + b"".join(cbor(k) + cbor(x) for k, x in v.items())
    raise TypeError(v)


class Phone:
    """What an iPhone does: holds a private key, signs challenges after Face ID."""
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1()); self.cred = os.urandom(16); self.count = 0
    def register(self, challenge, origin=ORIGIN, rp=RP, flags=0x45):
        n = self.key.public_key().public_numbers()
        cose = {1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")}
        ad = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + struct.pack(">I", 0) + b"\0" * 16 + struct.pack(">H", len(self.cred)) + self.cred + cbor(cose)
        cd = json.dumps({"type": "webauthn.create", "challenge": challenge, "origin": origin}).encode()
        return {"id": b64u(self.cred), "response": {"clientDataJSON": b64u(cd), "attestationObject": b64u(cbor({"fmt": "none", "attStmt": {}, "authData": ad}))}, "name": "My iPhone"}
    def assert_(self, challenge, origin=ORIGIN, rp=RP, flags=0x05, sign_with=None):
        self.count += 1
        ad = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + struct.pack(">I", self.count)
        cd = json.dumps({"type": "webauthn.get", "challenge": challenge, "origin": origin}).encode()
        sig = (sign_with or self.key).sign(ad + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64u(self.cred), "response": {"clientDataJSON": b64u(cd), "authenticatorData": b64u(ad), "signature": b64u(sig)}}


def enroll(cli, phone):
    o = cli.post("/api/passkey/register/options", json={}, headers={**cli.h, "Origin": ORIGIN}).get_json()
    assert o["rp"]["id"] == RP and o["authenticatorSelection"]["userVerification"] == "required"
    r = cli.post("/api/passkey/register/verify", json=phone.register(o["challenge"]), headers=cli.h); assert r.status_code == 200, r.get_json()


def login(app_, phone, **kw):
    anon = app_.app.test_client(); H = {"Origin": ORIGIN}
    o = anon.post("/api/passkey/login/options", json={}, headers=H).get_json()
    return anon, anon.post("/api/passkey/login/verify", json=phone.assert_(o["challenge"], **kw), headers=H)


def test_register_then_sign_in_and_refuse_every_trick(cli):
    import app
    phone = Phone(); enroll(cli, phone)
    assert cli.get("/api/passkey").get_json()[0]["name"] == "My iPhone"
    anon, r = login(app, phone); assert r.status_code == 200 and anon.get("/api/me").get_json()["authed"] is True      # a brand-new device signs in with Face ID alone
    for label, kw in (("wrong origin", {"origin": "https://evil.example"}), ("wrong app identity", {"rp": "evil.example"}), ("no Face ID flag", {"flags": 0x01}),
                      ("someone else's key", {"sign_with": ec.generate_private_key(ec.SECP256R1())})):
        a2, r = login(app, phone, **kw); assert r.status_code == 401 and not a2.get("/api/me").get_json()["authed"], label
    anon = app.app.test_client(); H = {"Origin": ORIGIN}; o = anon.post("/api/passkey/login/options", json={}, headers=H).get_json()
    good = phone.assert_(o["challenge"]); assert anon.post("/api/passkey/login/verify", json=good, headers=H).status_code == 200
    assert anon.post("/api/passkey/login/verify", json=good, headers=H).status_code == 401                              # a captured sign-in cannot be replayed
    assert app.app.test_client().post("/api/passkey/login/options", json={}, headers={"Origin": "https://other.example"}).status_code == 404   # no key for that address
    assert app.app.test_client().post("/api/passkey/login/options", json={}, headers={"Origin": "http://insecure.example"}).status_code == 400  # passkeys need https


def test_require_face_id_locks_after_idle_and_keeps_the_password_off_the_phone(cli, monkeypatch):
    import app
    assert cli.post("/api/settings", json={"faceid_required": True}, headers=cli.h) and app.settings()["faceid_required"] is False     # can't require it before a passkey exists
    phone = Phone(); enroll(cli, phone)
    cli.post("/api/settings", json={"faceid_required": True, "lock_minutes": 5}, headers=cli.h)
    assert app.settings()["faceid_required"] is True and cli.get("/api/settings").status_code == 200                                      # this session stays unlocked
    real = time.time; monkeypatch.setattr(time, "time", lambda: real() + 6 * 60)                                                           # 6 minutes in the background
    assert cli.get("/api/settings").status_code == 401 and cli.get("/api/settings").get_json()["error"] == "locked"
    me = cli.get("/api/me").get_json(); assert me["locked"] is True and me["authed"] is False and me["faceid"] is True and me["csrf"] is None
    monkeypatch.setattr(time, "time", real)
    anon = app.app.test_client()
    r = anon.post("/api/login", json={"password": "hunter2hunter2"}, environ_overrides={"HTTP_HOST": "phone.example.ts.net:8443"}); assert r.status_code == 403   # not from the phone
    r = anon.post("/api/login", json={"password": "hunter2hunter2"}); assert r.status_code == 200                                         # from the PC itself it still works (way back in)
    cli.post("/api/lock"); assert cli.get("/api/settings").status_code == 401                                                              # "lock when I switch away"
    a2, r = login(app, phone); assert r.status_code == 200 and a2.get("/api/settings").status_code == 200                                  # Face ID unlocks
    kid = a2.get("/api/passkey").get_json()[0]["id"]; a2.delete("/api/passkey/" + kid, headers={"X-CSRF": a2.get("/api/me").get_json()["csrf"]})
    assert app.settings()["faceid_required"] is False                                                                                      # no passkey left: the app never requires one
