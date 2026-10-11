"""Playwright: finished items are hidden (not deleted) in Restaurants/Media lists, can be shown again, and ticking a box doesn't open the item.
Run:  .venv/Scripts/python tests/flows_lists.py"""
import os, sys, subprocess, time, tempfile, urllib.request, uuid
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5068; BASE = f"http://127.0.0.1:{PORT}"


def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: urllib.request.urlopen(BASE + "/api/me"); break
            except Exception: time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1100, "height": 800})
            pg.goto(BASE); pg.wait_for_selector("input[type=password]")
            pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell", timeout=8000)
            lid = str(uuid.uuid4())
            def put(kind, data, rid=None):
                ts = "2026-01-01T00:00:00.000Z"
                return pg.evaluate("""async ([c]) => { const m = await (await fetch('/api/me')).json(); const r = await fetch('/api/sync', {method: 'POST', headers: {'X-CSRF': m.csrf, 'Content-Type': 'application/json'}, body: JSON.stringify({changes: [c]})}); return r.status; }""", [{"id": rid or str(uuid.uuid4()), "kind": kind, "data": data, "updated_at": ts, "created_at": ts}])
            put("list", {"name": "Movies to watch", "type": "media"}, lid)
            put("list_item", {"list": lid, "title": "Minari", "status": "to try", "order": 2})
            put("list_item", {"list": lid, "title": "Amelie", "status": "finished", "order": 3})
            rid = str(uuid.uuid4())
            put("list", {"name": "Restaurants", "type": "restaurant"}, rid)
            put("list_item", {"list": rid, "title": "Zuma", "status": "want to go", "order": 1, "cuisine": "Japanese", "city": "DIFC, Dubai", "price": "$$$", "with": "Sam", "occasion": "Birthday", "source": "Instagram", "phone": "04 123", "rating": 4, "tags": ["date night"], "notes": "Get the black cod", "enriched": "2026-10-12T00:00:00", "lat": 25.2, "lon": 55.3})
            put("list_item", {"list": lid, "title": "Past Lives", "status": "to try", "order": 1, "genre": "Drama", "language": "English", "creator": "Celine Song", "year": "2023", "cast": "Greta Lee"})
            pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(600)
            pg.goto(f"{BASE}/#/lists/{rid}"); pg.wait_for_selector(".item")
            row = pg.inner_text(".item")                                                         # a row is the name plus a short line, not every field
            assert "Zuma" in row and "Japanese" in row and "DIFC, Dubai" in row and "$$$" in row, row
            for hidden in ("Sam", "Birthday", "Instagram", "04 123", "date night", "black cod"):
                assert hidden not in row, (hidden, row)
            pg.click(".item .t"); pg.wait_for_selector(".scrim .dialog"); dlg = pg.inner_text(".dialog")   # ...and the details are in the item itself
            assert "Who with" in dlg or pg.input_value(".dialog input[value='Sam']") == "Sam"; pg.keyboard.press("Escape")
            pg.goto(f"{BASE}/#/lists/{lid}"); pg.wait_for_selector(".item")
            mrow = pg.inner_text(".item:has-text('Past Lives')")
            assert "Drama" in mrow and "English" in mrow and "Celine Song" not in mrow and "2023" not in mrow and "Greta" not in mrow, mrow   # movies: name, genre, language
            rows = lambda: pg.eval_on_selector_all(".item .t", "e => e.map(x => x.textContent)")
            assert rows() == ["Past Lives", "Minari"], rows()                                    # finished one is tucked away
            assert pg.is_visible("text=Show 1 done")
            pg.click("text=Show 1 done"); pg.wait_for_timeout(300)
            assert sorted(rows()) == ["Amelie", "Minari", "Past Lives"], rows()                  # still there, not deleted
            pg.select_option("select[aria-label=Status]", "active") if pg.query_selector("select[aria-label=Status]") else None
            pg.wait_for_timeout(300); assert "Amelie" not in rows()
            pg.check(".item:has-text('Past Lives') input.chk"); pg.wait_for_timeout(500)
            assert not pg.query_selector(".scrim .dialog"), "ticking the box must not open the item"
            assert rows() == ["Minari"], rows()                                                  # ticked -> done -> hidden
            pg.click(".item .t"); pg.wait_for_selector(".scrim .dialog"); pg.keyboard.press("Escape")   # tapping the item itself still opens it
            b.close()
        print("lists flow OK")
    finally:
        srv.terminate()


main()
