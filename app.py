"""Life - private single-user life manager. Flask + SQLite (WAL). See README.md."""
import os, json, uuid, time, sqlite3, secrets, hashlib, hmac, threading, zipfile, io, re, shutil, glob
from datetime import datetime, timezone, timedelta
from functools import wraps
import passkeys
from flask import Flask, request, jsonify, session, send_from_directory, g, abort, Response

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LIFE_DATA", os.path.join(ROOT, "data"))
os.makedirs(DATA, exist_ok=True)
DB_PATH = os.path.join(DATA, "life.db")


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for ln in open(p, encoding="utf8"):
            ln = ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k, v = ln.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


load_env()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def secret_file(name, maker):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        with open(p, "w") as f:
            f.write(maker())
    return open(p).read().strip()


app = Flask(__name__, static_folder=os.path.join(ROOT, "static"), static_url_path="/static")
app.secret_key = os.environ.get("LIFE_SECRET") or secret_file("secret.key", lambda: secrets.token_hex(32))
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.environ.get("LIFE_HTTPS") == "1",
                  PERMANENT_SESSION_LIFETIME=timedelta(days=60), SEND_FILE_MAX_AGE_DEFAULT=0, MAX_CONTENT_LENGTH=25 * 1024 * 1024)

SCHEMA = """
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS ix_kind ON records(kind, deleted_at);
CREATE INDEX IF NOT EXISTS ix_upd ON records(updated_at);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sync_state(name TEXT PRIMARY KEY, last_ok TEXT, last_error TEXT, last_try TEXT, info TEXT);
CREATE TABLE IF NOT EXISTS sync_log(ts TEXT, msg TEXT);
CREATE TABLE IF NOT EXISTS audit_log(ts TEXT, who TEXT, action TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS capture_tokens(id TEXT PRIMARY KEY, label TEXT, hash TEXT, created_at TEXT, revoked_at TEXT, last_used TEXT, uses INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS feed_events(feed TEXT, uid TEXT, start TEXT, end TEXT, allday INTEGER, title TEXT, loc TEXT, PRIMARY KEY(feed, uid, start));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT, mime TEXT, size INTEGER, created_at TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(id UNINDEXED, kind UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=15)
        g.db.row_factory = sqlite3.Row
    return g.db


def raw_db():
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    c = raw_db()
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(SCHEMA)
    c.commit()
    c.close()


@app.teardown_appcontext
def _close(e):
    d = g.pop("db", None)
    if d:
        d.close()


# ---------- kv / settings ----------
DEFAULT_SETTINGS = {
    "name": "friend", "timezone": "Asia/Dubai", "currency": "AED", "work_days": [1, 2, 3, 4, 5],
    "work_start": "09:00", "work_end": "18:00", "evening_from": "20:00", "quiet_from": "23:00", "quiet_to": "07:00",
    "theme": "system", "density": "comfortable", "feeds": [], "activities": ["padel", "football", "tennis", "badminton", "bowling", "karting", "hiking", "beach", "board games"],
    "tabs": ["today", "tasks", "calendar", "notes"], "telegram_chat_id": "", "ai_model": "claude-sonnet-5-5", "ai_fast_model": "claude-haiku-5-5",
    "ai_strong_model": "claude-opus-5-5", "ai_monthly_cap_usd": 10, "ai_enabled_modules": ["tasks", "notes", "lists", "goals", "travel"],
    "persona": "friend", "wealth_url": "", "wealth_token": "", "openai_key": "", "ai_provider": "openai", "oa_model": "gpt-5-mini", "oa_fast_model": "gpt-5-nano", "oa_strong_model": "gpt-5", "briefing_ai": True, "mood_prompts": False, "today_hidden": [], "agenda_push": False, "agenda_time": "07:30", "agenda_workdays_only": True, "cycle_tracking": False,
    "faceid_required": False, "lock_minutes": 5, "nationality": "", "residency": "", "notify": {"channels": "both", "categories": {}}, "home_lat": 25.25, "home_lon": 55.36, "stay_rules": None, "areas": None, "email_in_allowed": [], "ai_health": False, "ai_features": {}, "ai_prices": None, "ai_proactive": {}, "ai_auto_low": False, "year_start_month": 1,
}
# Integration credentials: set in Settings (stored encrypted); a blank setting falls back to the same name in .env
ENV_SETTINGS = {"anthropic_api_key": "ANTHROPIC_API_KEY", "telegram_bot_token": "TELEGRAM_BOT_TOKEN", "telegram_webhook_secret": "TELEGRAM_WEBHOOK_SECRET", "gmail_user": "GMAIL_USER",
                "gmail_app_password": "GMAIL_APP_PASSWORD", "garmin_email": "GARMIN_EMAIL", "garmin_password": "GARMIN_PASSWORD", "omdb_key": "OMDB_API_KEY"}
DEFAULT_SETTINGS.update({k: "" for k in ENV_SETTINGS})
SECRET_SETTINGS = {"wealth_token", "openai_key", "anthropic_api_key", "telegram_bot_token", "telegram_webhook_secret", "gmail_app_password", "garmin_password", "omdb_key"}
_ENV_FILE = {v: os.environ.get(v) for v in ENV_SETTINGS.values()}   # what .env / the OS gave us, to fall back to
_applied = set()


def kv_get(k, default=None):
    r = raw_db().execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(r["v"]) if r else default


def kv_set(k, v):
    c = raw_db()
    c.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))
    c.commit()
    c.close()


def settings():
    s = dict(DEFAULT_SETTINGS)
    s.update(kv_get("settings", {}) or {})
    for k in SECRET_SETTINGS:
        if isinstance(s.get(k), str) and s[k].startswith("enc:"):
            s[k] = dec(s[k])
    return s


def apply_env():
    """Push the credentials saved in Settings into this process's environment (the integrations read os.environ per call, so no restart is needed).
    Only variables we set ourselves are touched; clearing a setting puts back what .env / the OS had."""
    s = settings()
    for k, var in ENV_SETTINGS.items():
        v = (s.get(k) or "").strip()
        if v:
            os.environ[var] = v; _applied.add(var)
        elif var in _applied:
            _applied.discard(var)
            if _ENV_FILE.get(var):
                os.environ[var] = _ENV_FILE[var]
            else:
                os.environ.pop(var, None)


def audit(action, detail=""):
    c = raw_db()
    c.execute("INSERT INTO audit_log VALUES(?,?,?,?)", (now_iso(), request.remote_addr if request else "sys", action, str(detail)[:500]))
    c.commit()
    c.close()


def redact(t):
    t = str(t or "")
    for k in ("TELEGRAM_BOT_TOKEN", "ANTHROPIC_API_KEY", "GMAIL_APP_PASSWORD", "GARMIN_PASSWORD", "VAPID_PRIVATE_KEY", "LIFE_FERNET_KEY", "LIFE_SECRET"):
        v = os.environ.get(k)
        if v and len(v) > 5:
            t = t.replace(v, "***")
    st = settings()
    for k in SECRET_SETTINGS:
        w = st.get(k)
        if w and len(w) > 5:
            t = t.replace(w, "***")
    return re.sub(r"bot\d{6,}:[\w-]{20,}", "bot***", re.sub(r"sk-ant-[\w-]+", "sk-ant-***", t))


def set_state(name, ok, err="", info=""):
    err, info = redact(err), redact(info)
    c = raw_db()
    t = now_iso()
    c.execute("""INSERT INTO sync_state(name,last_ok,last_error,last_try,info) VALUES(?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET last_ok=COALESCE(?,last_ok), last_error=?, last_try=?, info=?""",
              (name, t if ok else None, err, t, info, t if ok else None, err, t, info))
    c.commit()
    c.close()


# ---------- encryption of sensitive fields ----------
from cryptography.fernet import Fernet, InvalidToken

_fk = os.environ.get("LIFE_FERNET_KEY") or secret_file("fernet.key", lambda: Fernet.generate_key().decode())
FERNET = Fernet(_fk.encode())
SENSITIVE = {"travel_doc": ["number"], "health_record": ["value", "notes", "policy"], "vault_doc": ["number"], "emergency": ["insurance_no", "blood"]}


def enc(v):
    return "enc:" + FERNET.encrypt(str(v).encode()).decode() if v and not str(v).startswith("enc:") else v


def dec(v):
    try:
        return FERNET.decrypt(v[4:].encode()).decode()
    except (InvalidToken, Exception):
        return ""


def mask_out(kind, data):
    for f in SENSITIVE.get(kind, []):
        v = data.get(f)
        if isinstance(v, str) and v.startswith("enc:"):
            p = dec(v)
            data[f] = "••••" + p[-4:] if len(p) > 4 else "••••"
            data[f + "_enc"] = True
    return data


# ---------- auth ----------
PBKDF2_ROUNDS = 600_000   # OWASP's current figure for PBKDF2-HMAC-SHA256


def hash_pw(pw, salt=None, rounds=PBKDF2_ROUNDS):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), rounds).hex()
    return f"v2${rounds}${salt}${h}"


def check_pw(pw, stored):
    if stored.startswith("v2$"):
        _, rounds, salt, h = stored.split("$")
        return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(rounds)).hex(), h)
    salt, h = stored.split("$")   # the original format: 310,000 rounds
    return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 310_000).hex(), h)


_attempts = {}


def rate_ok(key, limit, window):
    t = time.time()
    a = [x for x in _attempts.get(key, []) if t - x < window]
    if len(a) >= limit:
        _attempts[key] = a
        return False
    a.append(t)
    _attempts[key] = a
    return True


def faceid_locked():
    """With "Require Face ID" on, a signed-in session also needs a recent Face ID unlock. lock_minutes is how long the app may sit in the background (0 = lock when you switch away)."""
    s = settings()
    if not (s.get("faceid_required") and kv_get("passkeys")):
        return False
    mins = int(s.get("lock_minutes") or 0)
    return not session.get("unlocked") or time.time() - session.get("seen", 0) > mins * 60 + (10 if mins == 0 else 0)


def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if not session.get("ok"):
            return jsonify(error="auth"), 401
        if faceid_locked():
            return jsonify(error="locked"), 401
        session["seen"] = time.time()
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not hmac.compare_digest(request.headers.get("X-CSRF", ""), session.get("csrf", "x")):
                return jsonify(error="csrf"), 403
        return f(*a, **k)
    return w


@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["X-Frame-Options"] = "DENY"
    r.headers["Referrer-Policy"] = "same-origin"
    r.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; "
                                            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.tile.openstreetmap.org; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; "
                                            "base-uri 'self'; form-action 'self'; object-src 'none'")
    r.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()"
    r.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if os.environ.get("LIFE_HTTPS") == "1":
        r.headers["Strict-Transport-Security"] = "max-age=31536000"
    return r


@app.get("/api/me")
def me():
    has_pw = kv_get("pw") is not None
    if session.get("ok") and not session.get("csrf"):
        session["csrf"] = secrets.token_hex(16)
    locked = bool(session.get("ok")) and faceid_locked()
    s = settings(); required = bool(s.get("faceid_required") and kv_get("passkeys"))
    return jsonify(setup=not has_pw, authed=bool(session.get("ok")) and not locked, locked=locked, faceid=required, lock_minutes=int(s.get("lock_minutes") or 0),
                   csrf=session.get("csrf") if session.get("ok") and not locked else None)


@app.post("/api/login")
def login():
    j = request.get_json(silent=True) or {}
    pw = j.get("password", "")
    if not rate_ok("login:" + (request.remote_addr or ""), 8, 300):
        return jsonify(error="Too many tries. Wait a few minutes."), 429
    stored = kv_get("pw")
    if stored is not None and settings().get("faceid_required") and kv_get("passkeys") and not passkeys.local_request():
        return jsonify(error="Face ID is required here. The password only works from the PC itself."), 403
    if stored is None:  # first-run setup
        if len(pw) < 8:
            return jsonify(error="Use at least 8 characters."), 400
        kv_set("pw", hash_pw(pw))
        audit("setup")
    elif not check_pw(pw, stored):
        audit("login_fail")
        return jsonify(error="That's not it."), 401
    elif not stored.startswith("v2$") or int(stored.split("$")[1]) < PBKDF2_ROUNDS:
        kv_set("pw", hash_pw(pw))   # upgrade an older hash now that we have the password in hand
    session.clear()
    session.permanent = True
    session["ok"] = True
    session["csrf"] = secrets.token_hex(16)
    session["unlocked"] = True; session["seen"] = time.time()
    return jsonify(ok=True, csrf=session["csrf"])


@app.post("/api/logout")
@login_required
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/password")
@login_required
def change_pw():
    j = request.get_json() or {}
    if not check_pw(j.get("old", ""), kv_get("pw")) or len(j.get("new", "")) < 8:
        return jsonify(error="Check the old password; new one needs 8+ characters."), 400
    kv_set("pw", hash_pw(j["new"]))
    audit("pw_change")
    return jsonify(ok=True)


# ---------- settings ----------
@app.get("/api/settings")
@login_required
def get_settings():
    s = settings()
    for k in SECRET_SETTINGS:
        if s.get(k):
            s[k] = "set"
    return jsonify(s)


@app.post("/api/settings")
@login_required
def put_settings():
    j = request.get_json() or {}
    cur = kv_get("settings", {}) or {}
    for k, v in j.items():
        if k in SECRET_SETTINGS and v == "set":
            continue
        if k in DEFAULT_SETTINGS:
            cur[k] = enc(v.strip()) if k in SECRET_SETTINGS and isinstance(v, str) else v
    if cur.get("faceid_required") and not kv_get("passkeys"):
        cur["faceid_required"] = False
    kv_set("settings", cur)
    session["unlocked"] = True; session["seen"] = time.time()
    apply_env()
    return jsonify(ok=True)


# ---------- records / sync ----------
def text_of(kind, d):
    parts = [str(d.get(k, "")) for k in ("title", "name", "body", "text", "notes", "city", "cuisine", "tags", "why") if d.get(k)]
    if isinstance(d.get("tags"), list):
        parts.append(" ".join(d["tags"]))
    if kind in SENSITIVE:
        return ""
    return " ".join(parts)


def row_out(r):
    d = json.loads(r["data"])
    return {"id": r["id"], "kind": r["kind"], "data": mask_out(r["kind"], d), "created_at": r["created_at"],
            "updated_at": r["updated_at"], "deleted_at": r["deleted_at"]}


def merge_fields(old, new, old_t, new_ts):
    """field-level last-write-wins. `_t` maps field->iso time of last edit."""
    nt = new.get("_t") or {}
    out, ot = dict(old), dict(old_t)
    conflicts = []
    for k, v in new.items():
        if k == "_t":
            continue
        t = nt.get(k) or new_ts
        if k in out and out[k] != v and ot.get(k, "") > t:
            conflicts.append(k)
            continue
        out[k] = v
        ot[k] = t
    out["_t"] = ot
    return out, conflicts


def upsert(c, ch):
    rid, kind = ch["id"], ch["kind"]
    if not re.fullmatch(r"[a-z_]{2,30}", kind or "") or not re.fullmatch(r"[0-9a-fA-F-]{8,40}", rid or ""):
        raise ValueError("bad id/kind")
    ts = ch.get("updated_at") or now_iso()
    new = ch.get("data") or {}
    # keep masked placeholders from overwriting real ciphertext
    r = c.execute("SELECT * FROM records WHERE id=?", (rid,)).fetchone()
    old = json.loads(r["data"]) if r else {}
    for f in SENSITIVE.get(kind, []):
        if f in new:
            if new.get(f + "_enc") and isinstance(new[f], str) and new[f].startswith("•"):
                new[f] = old.get(f)
            else:
                new[f] = enc(new[f])
        new.pop(f + "_enc", None)
    stamp = now_iso()
    if r is None:
        new["_t"] = {k: (new.get("_t") or {}).get(k, ts) for k in new if k != "_t"}
        c.execute("INSERT INTO records VALUES(?,?,?,?,?,?)", (rid, kind, json.dumps(new), ch.get("created_at") or ts, stamp, ch.get("deleted_at")))
        merged = new
    else:
        merged, conf = merge_fields(old, new, old.get("_t", {}), ts)
        if conf:
            c.execute("INSERT INTO sync_log VALUES(?,?)", (stamp, f"{kind} {rid[:8]}: kept newer server value for {', '.join(conf)}"))
        if kind == "note" and merged.get("body") != old.get("body") and old.get("body") is not None:
            vid = str(uuid.uuid4())
            c.execute("INSERT INTO records VALUES(?,?,?,?,?,NULL)", (vid, "note_version", json.dumps({"note": rid, "body": old.get("body"), "title": old.get("title")}), stamp, stamp))
            old_v = c.execute("SELECT id FROM records WHERE kind='note_version' AND json_extract(data,'$.note')=? ORDER BY created_at DESC LIMIT -1 OFFSET 20", (rid,)).fetchall()
            for o in old_v:
                c.execute("DELETE FROM records WHERE id=?", (o["id"],))
        dele = ch.get("deleted_at") if "deleted_at" in ch else r["deleted_at"]
        if r["updated_at"] > ts and "deleted_at" in ch and ch["deleted_at"] and not r["deleted_at"]:
            dele = r["deleted_at"]  # newer edit beats older delete
        c.execute("UPDATE records SET data=?, updated_at=?, deleted_at=? WHERE id=?", (json.dumps(merged), stamp, dele, rid))
    c.execute("DELETE FROM fts WHERE id=?", (rid,))
    t = text_of(kind, merged)
    if t:
        c.execute("INSERT INTO fts(id,kind,text) VALUES(?,?,?)", (rid, kind, t))


@app.get("/api/sync")
@login_required
def sync_get():
    since = request.args.get("since", "")
    rows = db().execute("SELECT * FROM records WHERE updated_at>? ORDER BY updated_at LIMIT 5000", (since,)).fetchall()
    return jsonify(now=now_iso(), records=[row_out(r) for r in rows], more=len(rows) == 5000)


@app.post("/api/sync")
@login_required
def sync_post():
    changes = (request.get_json() or {}).get("changes", [])
    c = db()
    n = 0
    try:
        for ch in changes[:500]:
            upsert(c, ch)
            n += 1
        c.commit()
    except ValueError as e:
        c.rollback()
        return jsonify(error=str(e)), 400
    ids = [ch["id"] for ch in changes[:500]]
    rows = c.execute(f"SELECT * FROM records WHERE id IN ({','.join('?' * len(ids))})", ids).fetchall() if ids else []
    return jsonify(ok=True, applied=n, records=[row_out(r) for r in rows], now=now_iso())


@app.get("/api/reveal/<rid>/<field>")
@login_required
def reveal(rid, field):
    r = db().execute("SELECT kind,data FROM records WHERE id=?", (rid,)).fetchone()
    if not r or field not in SENSITIVE.get(r["kind"], []):
        abort(404)
    audit("reveal", f"{r['kind']}:{rid[:8]}.{field}")
    return jsonify(value=dec(json.loads(r["data"]).get(field, "")))


@app.get("/api/search")
@login_required
def search():
    q = re.sub(r"[^\w\s]", " ", request.args.get("q", "")).strip()
    if not q:
        return jsonify([])
    m = " ".join('"' + w + '"*' for w in q.split())   # quoted: OR / AND / NEAR are literal words, not FTS operators
    rows = db().execute("""SELECT f.id, f.kind, snippet(fts,2,'[',']','…',10) sn, r.data FROM fts f JOIN records r ON r.id=f.id
        WHERE fts MATCH ? AND r.deleted_at IS NULL ORDER BY rank LIMIT 30""", (m,)).fetchall()
    return jsonify([{"id": r["id"], "kind": r["kind"], "snippet": r["sn"], "title": json.loads(r["data"]).get("title") or json.loads(r["data"]).get("name") or ""} for r in rows])


@app.post("/api/trash/purge")
@login_required
def trash_purge():
    """Permanently delete records that are already in the trash (explicit user action). ids=[...] or all=true."""
    j = request.get_json() or {}
    c = db()
    if j.get("all"):
        ids = [r["id"] for r in c.execute("SELECT id FROM records WHERE deleted_at IS NOT NULL AND kind NOT IN ('note_version')")]
    else:
        ids = [i for i in (j.get("ids") or []) if isinstance(i, str)][:2000]
    n = 0
    for rid in ids:
        r = c.execute("SELECT id FROM records WHERE id=? AND deleted_at IS NOT NULL", (rid,)).fetchone()   # never touches live records
        if r:
            c.execute("DELETE FROM records WHERE id=?", (rid,)); c.execute("DELETE FROM fts WHERE id=?", (rid,)); c.execute("DELETE FROM records WHERE kind='note_version' AND json_extract(data,'$.note')=?", (rid,)); n += 1
    c.commit()
    audit("trash_purge", n)
    return jsonify(ok=True, purged=n, ids=ids if not j.get("all") else [])


@app.get("/api/sync-log")
@login_required
def sync_log():
    return jsonify([dict(r) for r in db().execute("SELECT * FROM sync_log ORDER BY ts DESC LIMIT 50")])


# ---------- capture tokens (write-only) ----------
@app.get("/api/tokens")
@login_required
def tokens_list():
    return jsonify([dict(r) for r in db().execute("SELECT id,label,created_at,revoked_at,last_used,uses FROM capture_tokens ORDER BY created_at DESC")])


@app.post("/api/tokens")
@login_required
def tokens_new():
    label = (request.get_json() or {}).get("label", "work")[:40]
    tok = "lc_" + secrets.token_urlsafe(24)
    c = db()
    tid = str(uuid.uuid4())
    c.execute("INSERT INTO capture_tokens(id,label,hash,created_at) VALUES(?,?,?,?)", (tid, label, hashlib.sha256(tok.encode()).hexdigest(), now_iso()))
    c.commit()
    audit("token_new", label)
    return jsonify(id=tid, token=tok)  # shown once


@app.delete("/api/tokens/<tid>")
@login_required
def tokens_revoke(tid):
    c = db()
    c.execute("UPDATE capture_tokens SET revoked_at=? WHERE id=?", (now_iso(), tid))
    c.commit()
    return jsonify(ok=True)


@app.route("/api/capture", methods=["POST", "OPTIONS"])
def capture():
    """Write-only: can add inbox items, reads nothing. Token in Authorization: Bearer."""
    if request.method == "OPTIONS":
        return Response(status=204, headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST"})
    cors = {"Access-Control-Allow-Origin": "*"}
    tok = request.headers.get("Authorization", "")[7:]
    if not rate_ok("cap:" + (request.remote_addr or ""), 60, 60):
        return jsonify(error="slow down"), 429, cors
    c = db()
    row = c.execute("SELECT id FROM capture_tokens WHERE hash=? AND revoked_at IS NULL", (hashlib.sha256(tok.encode()).hexdigest(),)).fetchone()
    if not row:
        return jsonify(error="bad token"), 401, cors
    items = (request.get_json(silent=True) or {}).get("items", [])[:100]
    added = 0
    for it in items:
        text = str(it.get("text", ""))[:2000].strip()
        if not text:
            continue
        key = hashlib.sha256(text.lower().encode()).hexdigest()[:16] + str(it.get("ref", ""))
        rid = str(uuid.uuid5(uuid.NAMESPACE_URL, "capture:" + key))  # dedupe
        if c.execute("SELECT 1 FROM records WHERE id=?", (rid,)).fetchone():
            continue
        upsert(c, {"id": rid, "kind": "inbox", "data": {"text": text, "source": "work-capture", "context": "work"}})
        added += 1
    c.execute("UPDATE capture_tokens SET last_used=?, uses=uses+1 WHERE id=?", (now_iso(), row["id"]))
    c.commit()
    return jsonify(ok=True, added=added), 200, cors


# ---------- files (encrypted at rest) ----------
FILES = os.path.join(DATA, "files")
os.makedirs(FILES, exist_ok=True)
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"}


@app.post("/api/files")
@login_required
def file_up():
    f = request.files.get("file")
    if not f or f.mimetype not in ALLOWED_MIME:
        return jsonify(error="Only images, PDF or text."), 400
    blob = f.read()
    fid = str(uuid.uuid4())
    with open(os.path.join(FILES, fid), "wb") as o:
        o.write(FERNET.encrypt(blob))
    c = db()
    c.execute("INSERT INTO files VALUES(?,?,?,?,?)", (fid, re.sub(r"[^\w. -]", "_", f.filename or "file")[:80], f.mimetype, len(blob), now_iso()))
    c.commit()
    return jsonify(id=fid, name=f.filename, mime=f.mimetype)


@app.get("/api/files/<fid>")
@login_required
def file_get(fid):
    r = db().execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
    if not r:
        abort(404)
    blob = FERNET.decrypt(open(os.path.join(FILES, r["id"]), "rb").read())
    return Response(blob, mimetype=r["mime"], headers={"Content-Disposition": f'inline; filename="{r["name"]}"', "Cache-Control": "private, max-age=3600"})


# ---------- export / import / backup ----------
def all_records(c):
    return [row_out(r) for r in c.execute("SELECT * FROM records")]


@app.get("/api/export")
@login_required
def export():
    c = db()
    recs = [dict(r, data=json.loads(r["data"])) for r in c.execute("SELECT * FROM records")]  # ciphertext stays encrypted
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("life.json", json.dumps({"exported": now_iso(), "settings": {k: v for k, v in settings().items() if k not in SECRET_SETTINGS}, "records": recs}, indent=1))
        for r in recs:
            if r["kind"] == "note" and not r["deleted_at"]:
                d = r["data"]
                z.writestr(f"notes/{re.sub(r'[^\w -]', '', d.get('title') or r['id'][:8])[:50]}-{r['id'][:6]}.md", f"# {d.get('title','')}\n\n{d.get('body','')}\n")
    audit("export")
    return Response(mem.getvalue(), mimetype="application/zip", headers={"Content-Disposition": "attachment; filename=life-export.zip"})


@app.post("/api/import")
@login_required
def import_():
    f = request.files.get("file")
    try:
        z = zipfile.ZipFile(f.stream)
        j = json.loads(z.read("life.json"))
    except Exception:
        return jsonify(error="That's not a Life export."), 400
    c = db()
    for r in j["records"]:
        raw = r["data"]
        c.execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?)", (r["id"], r["kind"], json.dumps(raw), r["created_at"], now_iso(), r["deleted_at"]))
        c.execute("DELETE FROM fts WHERE id=?", (r["id"],))
        t = text_of(r["kind"], raw)
        if t:
            c.execute("INSERT INTO fts(id,kind,text) VALUES(?,?,?)", (r["id"], r["kind"], t))
    c.commit()
    audit("import", len(j["records"]))
    return jsonify(ok=True, count=len(j["records"]))


BACKUPS = os.path.join(DATA, "backups")


def do_backup():
    os.makedirs(BACKUPS, exist_ok=True)
    dst = os.path.join(BACKUPS, f"life-{datetime.now().strftime('%Y%m%d')}.db")
    src = raw_db()
    out = sqlite3.connect(dst)
    src.backup(out)
    out.close()
    src.close()
    for old in sorted(glob.glob(os.path.join(BACKUPS, "life-*.db")))[:-14]:
        os.remove(old)
    set_state("backup", True, info=os.path.basename(dst))


@app.post("/api/backup")
@login_required
def backup_now():
    do_backup()
    return jsonify(ok=True)


@app.get("/api/backup/download")
@login_required
def backup_download():
    """A consistent copy of the database as a zip, ready for the Files app. ?key=1 adds the encryption key (needed to read passport numbers etc. after a restore): keep that file private."""
    import zipfile, tempfile
    src = raw_db(); fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    out = sqlite3.connect(tmp); src.backup(out); out.close(); src.close()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp, "life.db")
        if request.args.get("key") == "1":
            z.write(os.path.join(DATA, "fernet.key"), "fernet.key")
    os.unlink(tmp); audit("backup_download", "with key" if request.args.get("key") == "1" else "")
    return Response(buf.getvalue(), mimetype="application/zip", headers={"Content-Disposition": f"attachment; filename=life-backup-{datetime.now().strftime('%Y%m%d')}.zip", "Cache-Control": "no-store"})


@app.post("/api/demo")
@login_required
def demo_load():
    """Explicit demo data: everything tagged demo:true so it can be removed in one click."""
    from demo import make_demo
    c = db()
    n = 0
    for ch in make_demo():
        ch["data"]["demo"] = True
        upsert(c, ch)
        n += 1
    c.commit()
    return jsonify(ok=True, n=n)


@app.delete("/api/demo")
@login_required
def demo_clear():
    c = db()
    t = now_iso()
    ids = [r["id"] for r in c.execute("SELECT id FROM records WHERE json_extract(data,'$.demo')=1")]
    c.executemany("UPDATE records SET deleted_at=?, updated_at=? WHERE id=?", [(t, t, i) for i in ids])
    c.commit()
    return jsonify(ok=True, n=len(ids))


# ---------- data health ----------
@app.get("/api/health")
@login_required
def health():
    states = [dict(r) for r in db().execute("SELECT * FROM sync_state")]
    from integrations import INTEGRATIONS
    known = {s["name"] for s in states}
    for n in INTEGRATIONS:
        if n not in known:
            states.append({"name": n, "last_ok": None, "last_error": "", "last_try": None, "info": "not configured"})
    return jsonify(states=states, counts={r["kind"]: r["n"] for r in db().execute("SELECT kind, COUNT(*) n FROM records WHERE deleted_at IS NULL GROUP BY kind")},
                   db_kb=os.path.getsize(DB_PATH) // 1024, tier=kv_get("work_tier", "none"))


# ---------- pages ----------
@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html", max_age=0)


@app.get("/sw.js")
def sw():
    files, newest = ["/", "/manifest.json"], max(os.path.getmtime(os.path.join(ROOT, "index.html")), os.path.getmtime(os.path.join(ROOT, "sw.js")))
    for base, _, names in os.walk(app.static_folder):
        for n in names:
            p = os.path.join(base, n)
            if os.path.basename(base) == "splash":   # iOS launch images: fetched by iOS itself, not needed offline
                continue
            files.append("/static/" + os.path.relpath(p, app.static_folder).replace("\\", "/"))
            newest = max(newest, os.path.getmtime(p))
    body = open(os.path.join(ROOT, "sw.js"), encoding="utf8").read().replace("__V__", str(int(newest))).replace("__FILES__", json.dumps(files))
    return Response(body, mimetype="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/share")
def share():  # fallback if the service worker isn't controlling yet
    from urllib.parse import urlencode
    from flask import redirect
    return redirect("/#/capture?" + urlencode({k: request.args.get(k, "") for k in ("title", "text", "url")}))


@app.get("/manifest.json")
def manifest():
    return send_from_directory(ROOT, "manifest.json", mimetype="application/manifest+json")


@app.get("/_styleguide")
def styleguide():
    return send_from_directory(ROOT, "styleguide.html", max_age=0)


passkeys.register(app, login_required, kv_get, kv_set, settings, rate_ok, audit)
import integrations  # noqa: E402  (registers routes: ics, telegram, weather, work capture, garmin, ai ...)
integrations.register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit)


def scheduler():
    last_backup = None
    while True:
        try:
            today = datetime.now().strftime("%Y%m%d")
            if last_backup != today:
                do_backup()
                last_backup = today
            integrations.tick(raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert)
        except Exception as e:  # never let the loop die — but never fail silently either
            print("scheduler:", redact(e))
            set_state("scheduler", False, f"background jobs hit an error: {e}")
        else:
            set_state("scheduler", True, "", "reminders, syncs and backups running")
        time.sleep(30)


def main():
    init_db()
    threading.Thread(target=scheduler, daemon=True).start()
    host, port = os.environ.get("LIFE_HOST", "127.0.0.1"), int(os.environ.get("LIFE_PORT", "5055"))
    if os.environ.get("LIFE_DEBUG") == "1":
        app.run(host=host, port=port, threaded=True)          # Flask dev server: development only
    else:
        from waitress import serve                              # production-grade WSGI server (works on Windows)
        print(f"Life is running on http://{host}:{port}")
        serve(app, host=host, port=port, threads=8, ident="life")


init_db()
cur_s = kv_get("settings", {}) or {}
if any(isinstance(cur_s.get(k), str) and cur_s[k] and not cur_s[k].startswith("enc:") for k in SECRET_SETTINGS):   # keys saved before encryption existed
    kv_set("settings", {k: enc(v) if k in SECRET_SETTINGS and isinstance(v, str) else v for k, v in cur_s.items()})
apply_env()
if __name__ == "__main__":
    main()
