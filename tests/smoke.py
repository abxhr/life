"""Playwright smoke: fresh DB -> set password -> visit every page, desktop + 390px, both themes, open the sheets, capture, assert zero console errors.
Run:  .venv/Scripts/python tests/smoke.py [--shots]"""
import os, sys, subprocess, time, tempfile, shutil, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5056; BASE = f"http://127.0.0.1:{PORT}"
ROUTES = ["today", "inbox", "tasks", "calendar", "notes", "lists", "goals", "travel", "health", "assistant", "review", "settings", "work", "do", "people", "vault", "admin", "more"]
SHOTS = "--shots" in sys.argv
OUT = os.path.join(ROOT, "tests", "shots")

def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errors = []
    try:
        for _ in range(40):
            try: urllib.request.urlopen(BASE + "/api/me"); break
            except Exception: time.sleep(.3)
        if SHOTS: os.makedirs(OUT, exist_ok=True)
        with sync_playwright() as p:
            b = p.chromium.launch()
            for vp, name in (({"width": 1360, "height": 860}, "desktop"), ({"width": 390, "height": 844}, "mobile")):
                for scheme in ("light", "dark"):
                    ctx = b.new_context(viewport=vp, color_scheme=scheme, is_mobile=name == "mobile", has_touch=name == "mobile")
                    pg = ctx.new_page()
                    pg.on("console", lambda m, t=f"{name}/{scheme}": m.type == "error" and errors.append(f"[{t}] console: {m.text}"))
                    pg.on("pageerror", lambda e, t=f"{name}/{scheme}": errors.append(f"[{t}] pageerror: {e}"))
                    pg.goto(BASE); pg.wait_for_selector("input[type=password]")
                    pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter")
                    pg.wait_for_selector(".shell", timeout=8000)
                    # capture something through the sheet
                    pg.click(".tabbar .mid") if name == "mobile" else pg.click(".cap-box input")
                    pg.wait_for_selector(".dialog input.cap-input")
                    pg.fill(".dialog input.cap-input", "call mum tomorrow 3pm #family !high")
                    pg.wait_for_selector(".dialog .parsed .chip")
                    if SHOTS: pg.screenshot(path=f"{OUT}/{name}-{scheme}-capture.png")
                    pg.keyboard.press("Control+Enter"); pg.wait_for_selector(".toast")
                    pg.wait_for_function("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))", timeout=10000)   # the service worker really installs and activates
                    h = pg.evaluate("fetch('/api/health').then(r => r.json())"); st = {x['name']: x for x in h['states']}
                    assert st['scheduler']['last_ok'] and not st['scheduler']['last_error'], f"background scheduler not healthy: {st['scheduler']}"
                    for r in ROUTES:
                        pg.goto(f"{BASE}/#/{r}"); pg.wait_for_selector(".view, .page > *", timeout=8000); pg.wait_for_timeout(350)
                        if name == "mobile" and scheme == "light":
                            over = pg.evaluate("""() => [...document.querySelectorAll('.page *')].filter(e => { const r = e.getBoundingClientRect(); if (r.right <= 394 || r.width === 0) return false; for (let p = e; p && p.classList; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; if (getComputedStyle(p).position === 'fixed') return false; } return true; }).slice(0, 3).map(e => e.tagName + '.' + String(e.className).slice(0, 30))""")
                            assert not over, f"mobile horizontal overflow on #{r}: {over}"
                        if SHOTS: pg.screenshot(path=f"{OUT}/{name}-{scheme}-{r}.png", full_page=False)
                    ctx.close()
            b.close()
    finally:
        srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)
    if errors:
        print("FAIL"); [print(" ", e) for e in dict.fromkeys(errors)]; sys.exit(1)
    print("smoke OK: %d pages x 2 viewports x 2 themes, zero console errors" % len(ROUTES))

if __name__ == "__main__": main()
