"""Playwright: item links, move to another list, multi-select, find duplicates, Surprise me with filters.
Run:  .venv/Scripts/python tests/flows_lists2.py"""
import os, sys, subprocess, time, tempfile, urllib.request, uuid
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5070; BASE = f"http://127.0.0.1:{PORT}"


def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: urllib.request.urlopen(BASE + "/api/me"); break
            except Exception: time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1100, "height": 900}); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell", timeout=8000)
            def put(kind, data, rid=None):
                ts = "2026-01-01T00:00:00.000Z"
                pg.evaluate("""async ([c]) => { const m = await (await fetch('/api/me')).json(); await fetch('/api/sync', {method: 'POST', headers: {'X-CSRF': m.csrf, 'Content-Type': 'application/json'}, body: JSON.stringify({changes: [c]})}); }""", [{"id": rid or str(uuid.uuid4()), "kind": kind, "data": data, "updated_at": ts, "created_at": ts}])
            rest, cafe, mov = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
            put("list", {"name": "Restaurants", "type": "restaurant"}, rest); put("list", {"name": "Cafes", "type": "restaurant"}, cafe); put("list", {"name": "Movies", "type": "media"}, mov)
            for n, (t, cu, pr) in enumerate([("Zuma", "Japanese", "$$$"), ("Pizza Place", "Italian", "$$"), ("Burger Joint", "Burgers", "$"), ("Taco Stand", "Mexican", "$")]):
                put("list_item", {"list": rest, "title": t, "status": "want to go", "order": n, "cuisine": cu, "price": pr, "city": "Dubai", "notes": "Post: https://www.instagram.com/p/abc/"})
            put("list_item", {"list": rest, "title": "Zuma (second copy)", "status": "want to go", "order": 9, "phone": "04 123 4567"})
            put("list_item", {"list": mov, "title": "Past Lives", "status": "to try", "order": 1, "genre": "Drama, Romance", "language": "English, Korean", "imdb": "7.8", "imdb_id": "tt13238346", "year": "2023"})
            put("list_item", {"list": mov, "title": "Minari", "status": "to try", "order": 2, "genre": "Drama", "language": "English", "year": "2020"})
            pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(600)

            pg.goto(f"{BASE}/#/lists/{mov}"); pg.wait_for_selector(".item:has-text('Past Lives')")
            assert "★ 7.8" in pg.inner_text(".item:has-text('Past Lives')")                                  # the rating shows on the row
            pg.click(".item:has-text('Past Lives') .t"); pg.wait_for_selector(".dialog a:has-text('Trailer')")
            hrefs = pg.eval_on_selector_all(".dialog a.btn", "e => e.map(a => a.href)"); assert any("imdb.com/title/tt13238346" in h for h in hrefs) and any("justwatch" in h for h in hrefs), hrefs
            pg.keyboard.press("Escape")

            pg.goto(f"{BASE}/#/lists/{rest}"); pg.wait_for_selector(".item:has-text('Zuma')")
            pg.click(".item:has-text('Pizza Place') .t"); pg.wait_for_selector(".dialog a:has-text('Apple Maps')"); assert pg.is_visible(".dialog a:has-text('The post')")
            pg.select_option(".dialog select[aria-label=List]", cafe); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".toast:has-text('Moved to Cafes')")   # move through the editor
            pg.wait_for_selector(".item:has-text('Pizza Place')", state="detached", timeout=4000)

            pg.click("button:has-text('Select')"); pg.wait_for_selector(".pickbar")                         # multi-select
            pg.click(".item:has-text('Burger Joint') .t"); pg.click(".item:has-text('Taco Stand') .t"); assert "2 selected" in pg.inner_text(".pickbar")
            pg.click(".pickbar button:has-text('Move')"); pg.click(".dialog button:has-text('Cafes')"); pg.wait_for_selector(".toast:has-text('Moved 2 to Cafes')")
            pg.wait_for_selector(".pickbar", state="detached")

            pg.click("summary:has-text('Sort')") if pg.query_selector("summary:has-text('Sort')") else None
            pg.click(".actmenu summary"); pg.click("button:has-text('Find duplicates')"); pg.wait_for_selector(".dialog:has-text('duplicate')")   # "Zuma" vs "Zuma (second copy)"
            pg.click(".dialog button:has-text('Merge')"); pg.wait_for_selector(".toast:has-text('Merged into')"); pg.keyboard.press("Escape")
            pg.wait_for_selector(".item:has-text('second copy')", state="detached", timeout=4000)
            z = pg.evaluate("fetch('/api/sync?since=').then(r => r.json()).then(j => j.records.filter(r => r.kind === 'list_item' && r.data.title === 'Zuma').map(r => r.data.phone))"); pg.wait_for_timeout(1500)
            z = pg.evaluate("fetch('/api/sync?since=').then(r => r.json()).then(j => j.records.filter(r => r.kind === 'list_item' && r.data.title === 'Zuma').map(r => r.data.phone))"); assert z == ["04 123 4567"], z   # blanks were filled from the copy

            pg.goto(f"{BASE}/#/lists/{mov}"); pg.wait_for_selector(".item:has-text('Minari')")
            pg.click("button:has-text('Surprise me')"); pg.wait_for_selector(".dialog .chip:text-is('Korean')"); pg.click(".dialog .chip:text-is('Korean')")   # filter by language
            pg.wait_for_selector(".dialog .hero-line:has-text('Past Lives')"); assert not pg.query_selector(".dialog .hero-line:has-text('Minari')")
            assert not errs, errs
            b.close()
        print("lists extras flow OK")
    finally:
        srv.terminate()


main()
