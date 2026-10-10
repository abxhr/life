"""Work Capture: generates the self-contained HTML for the locked-down work PC, plus its tiny server surface."""
import os, re, base64, json, hashlib, secrets, uuid
from flask import request, jsonify, Response

ROOT = os.path.dirname(os.path.abspath(__file__))
S = os.path.join(ROOT, "static")


def _font(name):
    return "data:font/woff2;base64," + base64.b64encode(open(os.path.join(S, "fonts", name), "rb").read()).decode()


def build_page(endpoint, token):
    css = open(os.path.join(S, "css", "app.css"), encoding="utf8").read().replace('@import url("../fonts/fonts.css");', "")
    faces = (f"@font-face{{font-family:'Gaegu';font-weight:400;src:url({_font('Gaegu-400.woff2')}) format('woff2')}}"
             f"@font-face{{font-family:'Gaegu';font-weight:700;src:url({_font('Gaegu-700.woff2')}) format('woff2')}}")
    tpl = open(os.path.join(S, "work", "work-capture.template.html"), encoding="utf8").read()
    cfg = "window.LIFE_CFG=" + json.dumps({"endpoint": endpoint, "token": token}).replace("</", "<\\/")
    qr = open(os.path.join(S, "vendor", "qrcode.js"), encoding="utf8").read()
    js = open(os.path.join(S, "work", "work-capture.js"), encoding="utf8").read()
    return tpl.replace("/*__CSS__*/", faces + css).replace("/*__QR__*/", qr).replace("/*__CFG__*/", cfg).replace("/*__JS__*/", js)


def register(app, login_required, db, now_iso, audit, kv_get, kv_set):
    @app.route("/api/ping", methods=["GET", "OPTIONS"])
    def ping():  # unauthenticated, reveals nothing: only lets the work page test reachability
        return jsonify(ok=True), 200, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type"}

    @app.get("/api/work/page")
    @login_required
    def work_page():
        endpoint = request.args.get("endpoint", "").strip().rstrip("/")
        if endpoint and not re.match(r"^https://[\w.\-:]+$", endpoint):
            return jsonify(error="Server address must look like https://life.example.com"), 400
        token = ""
        if endpoint:
            token = "lc_" + secrets.token_urlsafe(24)
            c = db()
            c.execute("INSERT INTO capture_tokens(id,label,hash,created_at) VALUES(?,?,?,?)", (str(uuid.uuid4()), "work-page", hashlib.sha256(token.encode()).hexdigest(), now_iso()))
            c.commit()
        audit("work_page", endpoint or "offline-only")
        return Response(build_page(endpoint, token), mimetype="text/html", headers={"Content-Disposition": "attachment; filename=work-capture.html"})

    @app.post("/api/work/seen")
    @login_required
    def work_seen():
        tier = (request.get_json() or {}).get("tier")
        if tier in ("qr", "paste"):
            w = kv_get("work_seen", {}) or {}
            w[tier] = now_iso()
            kv_set("work_seen", w)
        return jsonify(ok=True)

    @app.get("/api/work/status")
    @login_required
    def work_status():
        w = kv_get("work_seen", {}) or {}
        row = db().execute("SELECT MAX(last_used) m FROM capture_tokens WHERE label='work-page'").fetchone()
        w["direct"] = row["m"]
        return jsonify(w)
