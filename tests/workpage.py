"""Opens the generated work-capture.html from disk (file://), proves it works with every network request blocked, and renders QR codes."""
import os, sys, tempfile, subprocess, time, urllib.request, shutil, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT="5058")
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: urllib.request.urlopen("http://127.0.0.1:5058/api/me"); break
            except Exception: time.sleep(.3)
        import http.cookiejar
        cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        r = op.open(urllib.request.Request("http://127.0.0.1:5058/api/login", json.dumps({"password": "correct horse battery"}).encode(), {"Content-Type": "application/json"}))
        page = op.open("http://127.0.0.1:5058/api/work/page").read().decode(); path = os.path.join(tmp, "work-capture.html"); open(path, "w", encoding="utf8").write(page)
        reqs, errs = [], []
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1100, "height": 800})
            pg.on("request", lambda q: not q.url.startswith(("file:", "data:", "blob:")) and reqs.append(q.url)); pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
            pg.goto("file:///" + path.replace("\\", "/")); pg.wait_for_selector("#add")
            for t in ("send deck to finance tomorrow 2pm #today", "book room #waiting", "read the policy"):
                pg.fill("#add", t); pg.keyboard.press("Enter")
            pg.wait_for_selector(".item .t:has-text('Book room')"); assert pg.locator(".item").count() == 3
            pg.click(".item:has-text('Book room') input.chk"); pg.click("[data-f=done]"); assert pg.locator(".item").count() == 1
            pg.reload(); pg.wait_for_selector("#add"); pg.click("[data-f=open]"); assert pg.locator(".item").count() == 2, "persists across reload"
            pg.click("#qr"); pg.wait_for_selector("#qrimg svg"); pg.screenshot(path=os.path.join(ROOT, "tests", "shots", "workpage-qr.png")); pg.click("#qrclose")
            assert "Tier 1" in pg.inner_text("#tiers")
            b.close()
        assert not reqs, f"network requests were made: {reqs}"; assert not errs, errs
        print("work page OK: offline, persistent, QR renders, zero network requests")
    finally: srv.terminate(); srv.wait(); shutil.rmtree(tmp, ignore_errors=True)
main()
