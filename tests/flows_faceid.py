"""Playwright + Chromium's virtual authenticator (it acts like Face ID): set up Face ID in Settings, require it, lock, then unlock with a tap.
Run:  .venv/Scripts/python tests/flows_faceid.py"""
import os, sys, subprocess, time, tempfile, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5064; BASE = f"http://localhost:{PORT}"   # a passkey's identity must be a domain name, not an IP, so the page is opened as "localhost"


def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/me"); break
            except Exception: time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}); pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            cdp = ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
            cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {"protocol": "ctap2", "transport": "internal", "hasResidentKey": True, "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})
            pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell", timeout=8000)
            pg.goto(f"{BASE}/#/settings"); pg.wait_for_selector("summary:has-text('Face ID')"); pg.click("summary:has-text('Face ID')")
            pg.click("button:has-text('Set up Face ID on this device')"); pg.wait_for_selector(".dialog input"); pg.fill(".dialog input", "My iPhone"); pg.click(".dialog .btn.primary")
            pg.wait_for_selector("text=My iPhone", timeout=8000)                                    # the passkey was created and verified by the server
            pg.check("text=Only open Life with Face ID"); pg.wait_for_selector("select:has(option:text-is('As soon as I leave the app'))")
            pg.select_option("select:has(option:text-is('As soon as I leave the app'))", "0"); pg.wait_for_timeout(500)
            s = pg.evaluate("fetch('/api/settings').then(r => r.json())"); assert s["faceid_required"] is True and s["lock_minutes"] == 0, s
            pg.evaluate("fetch('/api/lock', {method: 'POST'})"); pg.reload()                         # "I left the app": the next open is locked
            pg.wait_for_selector("button:has-text('Unlock with Face ID')"); assert not pg.query_selector(".shell"), "no data behind the lock"
            assert not pg.query_selector("input[type=password]"), "password box is not offered on the lock screen"
            pg.click("button:has-text('Unlock with Face ID')"); pg.wait_for_selector(".shell", timeout=10000)   # one tap, Face ID, in
            assert pg.evaluate("fetch('/api/settings').then(r => r.status)") == 200
            assert not errs, errs
            b.close()
        print("face id flow OK")
    finally:
        srv.terminate()


main()
