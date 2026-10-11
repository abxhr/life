"""Playwright: Settings has passport + residence pickers; a country page shows the "Entry for you" card (server response stubbed); no setup -> friendly nudge.
Run:  .venv/Scripts/python tests/flows_visa.py"""
import os, sys, subprocess, time, tempfile, urllib.request, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5069; BASE = f"http://127.0.0.1:{PORT}"
CARD = {"verdict": "visa_required", "headline": "Get a US visa before you fly", "steps": ["Apply for a B1/B2 visa", "Book an embassy interview"], "passport": "Valid for your whole stay", "watch": "",
        "source": "https://example.com/rules", "checked": "2026-10-12", "nationality": "in", "residency": "ae"}


def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: urllib.request.urlopen(BASE + "/api/me"); break
            except Exception: time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch()
            for n, w in enumerate((1100, 390)):
                pg = b.new_page(viewport={"width": w, "height": 900}); errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell", timeout=8000)
                if n == 0:   # the server keeps its settings between the two screen sizes, so set up once
                    # 1) not set up yet: real server answers "setup" -> nudge to Settings
                    pg.goto(f"{BASE}/#/travel/c/US"); pg.wait_for_selector("text=Entry for you"); pg.wait_for_selector("text=Pick your passport country"); assert pg.is_visible("a:has-text('Settings')")
                    # 2) Settings pickers save
                    pg.goto(f"{BASE}/#/settings"); pg.wait_for_selector("select:has(option:text-is('India'))")
                    sels = pg.query_selector_all("select:has(option:text-is('India'))"); assert len(sels) >= 2, "passport + residence pickers"
                    sels[0].select_option("in"); pg.wait_for_timeout(300); sels[1].select_option("ae"); pg.wait_for_timeout(500)
                    s = pg.evaluate("fetch('/api/settings').then(r => r.json())"); assert s["nationality"] == "in" and s["residency"] == "ae", s
                # 3) the card (response stubbed so the test never touches the network)
                pg.route("**/api/visa*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(CARD)))
                pg.goto(f"{BASE}/#/travel/c/US"); pg.wait_for_selector("text=Visa needed"); assert pg.is_visible("text=Get a US visa before you fly") and pg.is_visible("li:has-text('Book an embassy interview')")
                ALL = {"nationality": "in", "residency": "ae", "total": 4, "running": False, "done": 4, "failed": 0, "cards": {"th": {"verdict": "visa_free", "reason": "India passport holders don't need a visa here"}, "al": {"verdict": "visa_free", "reason": "you hold your US visa"}, "us": {"verdict": "held"}, "jp": {"verdict": "visa_required"}}}
                pg.route("**/api/visa/all", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(ALL)))
                pg.goto(f"{BASE}/#/travel"); pg.wait_for_selector("button:has-text('Where can I go?')"); pg.click("button:has-text('Where can I go?')")        # the "where can I go" explorer
                pg.wait_for_selector("summary:has-text('No visa needed, or you hold what they accept')"); assert "3" in pg.inner_text("summary:has-text('No visa needed')")
                assert pg.is_visible("a.chip:has-text('Albania')") and pg.is_visible("a.chip:has-text('Thailand')") and "Visa from an embassy" in pg.inner_text("main")
                over = pg.evaluate("document.documentElement.scrollWidth > innerWidth + 2"); assert not over, "card must not widen the page"
                assert not errs, errs
                pg.close()
            b.close()
        print("visa flow OK")
    finally:
        srv.terminate()


main()
