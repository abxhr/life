"""Screenshots with demo data loaded (for review): tests/shots/demo-<viewport>-<theme>-<page>.png"""
import os, sys, time, subprocess, tempfile, shutil, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 5063; BASE = f"http://127.0.0.1:{PORT}"; OUT = os.path.join(ROOT, "tests", "shots")
PAGES = ["today", "tasks", "calendar", "notes", "lists", "goals", "travel", "health", "review", "settings"]
tmp = tempfile.mkdtemp(); srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT), LIFE_AI_MOCK="1"), cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
os.makedirs(OUT, exist_ok=True)
try:
    for _ in range(50):
        try: urllib.request.urlopen(BASE + "/api/me"); break
        except Exception: time.sleep(.3)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for vp, name in (({"width": 1360, "height": 860}, "desktop"), ({"width": 390, "height": 844}, "mobile")):
            for scheme in ("light", "dark"):
                ctx = b.new_context(viewport=vp, color_scheme=scheme, is_mobile=name == "mobile"); pg = ctx.new_page()
                pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell")
                if not globals().get('loaded'):
                    pg.evaluate("async () => { const m = await fetch('/api/me').then(r => r.json()); await fetch('/api/demo', {method:'POST', headers:{'X-CSRF': m.csrf}}); }"); loaded = True
                pg.reload(); pg.wait_for_selector(".shell")
                pg.wait_for_timeout(1500)
                for r in PAGES:
                    pg.goto(f"{BASE}/#/{r}"); pg.wait_for_timeout(900)
                    pg.screenshot(path=f"{OUT}/demo-{name}-{scheme}-{r}.png", full_page=name == "mobile" and r in ("today",))
                ctx.close()
        b.close()
finally:
    srv.terminate(); srv.wait(); shutil.rmtree(tmp, ignore_errors=True)
print("screens done")
