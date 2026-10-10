"""Phone-first UX review: demo data, 390x844, key screens (and detail pages). Output: tests/shots/ux-<n>-<name>.png"""
import os, sys, time, subprocess, tempfile, shutil, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 5066; BASE = f"http://127.0.0.1:{PORT}"; OUT = os.path.join(ROOT, "tests", "shots")
scheme = sys.argv[1] if len(sys.argv) > 1 else "light"
PAGES = [("today", "today"), ("tasks", "tasks"), ("inbox", "inbox"), ("calendar", "calendar"), ("notes", "notes"), ("lists", "lists"), ("goals", "goals"), ("travel", "travel"), ("health", "health"), ("more", "more"), ("settings", "settings"),
         ("assistant", "assistant"), ("review", "review"), ("admin", "admin"), ("vault", "vault"), ("people", "people"), ("do", "do")]
tmp = tempfile.mkdtemp(); srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT), LIFE_AI_MOCK="1"), cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
os.makedirs(OUT, exist_ok=True)
try:
    for _ in range(50):
        try: urllib.request.urlopen(BASE + "/api/me"); break
        except Exception: time.sleep(.3)
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme, is_mobile=True, has_touch=True, device_scale_factor=2); pg = ctx.new_page()
        pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell")
        pg.evaluate("async () => { const m = await fetch('/api/me').then(r => r.json()); await fetch('/api/demo', {method:'POST', headers:{'X-CSRF': m.csrf}}); }"); pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(1500)
        shots = []
        for i, (name, route) in enumerate(PAGES):
            pg.goto(f"{BASE}/#/{route}"); pg.wait_for_timeout(900); f = f"{OUT}/ux-{scheme}-{i:02d}-{name}.png"; pg.screenshot(path=f, full_page=name in ("today", "settings", "more", "tasks")); shots.append(f)
        # detail pages
        for name, sel_js in (("country-fr", "location.hash = '#/travel/c/FR'"), ("trip", "location.hash = '#/travel/t/' + [...document.querySelectorAll('a[href^=\"#/travel/t/\"]')][0]?.href.split('/t/')[1]"), ("capture", "document.querySelector('.tabbar .mid').click()")):
            if name == "trip":
                pg.goto(f"{BASE}/#/travel?tab=trips"); pg.wait_for_timeout(800)
            pg.evaluate(sel_js); pg.wait_for_timeout(900); pg.screenshot(path=f"{OUT}/ux-{scheme}-9{len(shots)}-{name}.png"); shots.append(name)
            if name == "capture": pg.keyboard.press("Escape")
        b.close()
finally:
    srv.terminate(); srv.wait(); shutil.rmtree(tmp, ignore_errors=True)
print("shots done")
