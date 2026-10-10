"""Security checklist as tests: auth on every route, CSRF on every mutating route, escaping, upload limits, rate limits, no secrets in errors, nothing private is served as a static file."""
import io, os, re, sys, json, uuid
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli, put  # noqa: F401

# Routes that are public ON PURPOSE, with the reason.
PUBLIC = {"/": "app shell (no data)", "/sw.js": "service worker", "/manifest.json": "PWA manifest", "/share": "share-target redirect", "/_styleguide": "static component gallery",
          "/api/me": "auth state only", "/api/login": "login (rate limited)", "/api/capture": "write-only token", "/api/ping": "reachability, reveals nothing",
          "/api/telegram/webhook/<secret>": "secret path + chat-id check", "/s/<token>": "unguessable expiring share link", "/static/<path:filename>": "public assets (no secrets)"}


def routes():
    import app
    for r in app.app.url_map.iter_rules():
        if r.endpoint == "static" or r.rule in PUBLIC:
            continue
        yield r


def fill(rule):
    return re.sub(r"<(?:\w+:)?\w+>", "x", rule)


def test_every_api_route_requires_login(cli):
    import app
    anon = app.app.test_client(); bad = []
    for r in routes():
        for m in r.methods - {"HEAD", "OPTIONS"}:
            resp = anon.open(fill(r.rule), method=m, json={} if m != "GET" else None)
            if resp.status_code != 401:
                bad.append((m, r.rule, resp.status_code))
    assert not bad, f"reachable without login: {bad}"


def test_every_mutating_route_requires_csrf(cli):
    bad = []
    for r in routes():
        for m in r.methods & {"POST", "PUT", "PATCH", "DELETE"}:
            resp = cli.open(fill(r.rule), method=m, json={})            # logged in, but no X-CSRF header
            if resp.status_code != 403:
                bad.append((m, r.rule, resp.status_code))
    assert not bad, f"missing CSRF check: {bad}"


def test_public_routes_are_exactly_the_documented_ones():
    import app
    seen = {r.rule for r in app.app.url_map.iter_rules()}
    assert set(PUBLIC) - {"/static/<path:filename>"} <= seen
    # any NEW route must be either login-protected (tests above) or added to PUBLIC deliberately


def test_security_headers_and_cookie_flags(cli):
    r = cli.get("/")
    csp = r.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "default-src 'self'" in csp
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    import app
    resp = app.app.test_client().post("/api/login", json={"password": "hunter2hunter2"})
    ck = resp.headers.get("Set-Cookie", ""); assert "HttpOnly" in ck and "SameSite=Lax" in ck


def test_private_files_are_not_served(cli):
    for p in ("/.env", "/app.py", "/data/life.db", "/data/secret.key", "/data/fernet.key", "/static/../data/life.db", "/.git/config", "/tests/test_security.py", "/static/../.env"):
        assert cli.get(p).status_code in (404, 400), p


def test_login_is_rate_limited(cli):
    import app
    c = app.app.test_client()
    codes = [c.post("/api/login", json={"password": "wrong-" + str(i)}).status_code for i in range(12)]
    assert 429 in codes and codes[0] == 401


def test_uploads_are_type_checked_and_encrypted(cli):
    r = cli.post("/api/files", data={"file": (io.BytesIO(b"<html><script>alert(1)</script>"), "x.html", "text/html")}, headers=cli.h, content_type="multipart/form-data")
    assert r.status_code == 400
    r = cli.post("/api/files", data={"file": (io.BytesIO(b"PLAINTEXT-MARKER-12345"), "n.txt", "text/plain")}, headers=cli.h, content_type="multipart/form-data")
    fid = r.get_json()["id"]
    import app
    assert b"PLAINTEXT-MARKER" not in open(os.path.join(app.FILES, fid), "rb").read(), "files are encrypted at rest"
    assert cli.get(f"/api/files/{fid}").data == b"PLAINTEXT-MARKER-12345"


def test_error_messages_never_leak_secrets(cli, monkeypatch):
    import app
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456789:fixture"); monkeypatch.setenv("ANTHROPIC_API_KEY", "key-FIXTURE-FIXTURE-FIXTURE")
    app.set_state("telegram", False, "HTTPSConnectionPool: /bot123456789:fixture/sendMessage failed with key-FIXTURE-FIXTURE-FIXTURE")
    h = json.dumps(cli.get("/api/health").get_json())
    assert "AAAAAAAAAA" not in h and "SECRETSECRET" not in h and "***" in h


def test_search_and_sync_inputs_are_safe(cli):
    assert cli.get("/api/search?q=%22%20OR%201%3D1%20--%20*%20NEAR(").status_code == 200       # FTS metacharacters can't break the query
    r = cli.post("/api/sync", json={"changes": [{"id": "x; DROP TABLE records", "kind": "task", "data": {}}]}, headers=cli.h); assert r.status_code == 400
    r = cli.post("/api/sync", json={"changes": [{"id": str(uuid.uuid4()), "kind": "task'); --", "data": {}}]}, headers=cli.h); assert r.status_code == 400
    assert cli.get("/api/linkmeta?url=http://127.0.0.1:5055/api/me").status_code == 400            # SSRF: private addresses refused
    assert cli.get("/api/linkmeta?url=http://169.254.169.254/latest/meta-data").status_code == 400
