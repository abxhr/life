"""Playwright with real touch events: swipe a task (right = done, left = delete + undo), swipe a list item, drag a sheet down to close it, pull down to refresh.
Run:  .venv/Scripts/python tests/flows_touch.py"""
import os, sys, subprocess, time, tempfile, urllib.request, uuid
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5065; BASE = f"http://127.0.0.1:{PORT}"


def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: urllib.request.urlopen(BASE + "/api/me"); break
            except Exception: time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e))); cdp = ctx.new_cdp_session(pg)
            pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell", timeout=8000)

            def touch(x0, y0, x1, y1, steps=8):
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
                for i in range(1, steps + 1):
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

            def put(kind, data, rid=None):
                ts = "2026-01-01T00:00:00.000Z"
                pg.evaluate("""async ([c]) => { const m = await (await fetch('/api/me')).json(); await fetch('/api/sync', {method: 'POST', headers: {'X-CSRF': m.csrf, 'Content-Type': 'application/json'}, body: JSON.stringify({changes: [c]})}); }""", [{"id": rid or str(uuid.uuid4()), "kind": kind, "data": data, "updated_at": ts, "created_at": ts}])
            today = time.strftime("%Y-%m-%d")
            put("task", {"title": "Swipe me right", "due": today, "priority": 3, "ctx": "personal", "done": False, "tags": [], "subtasks": []})
            put("task", {"title": "Swipe me left", "due": today, "priority": 3, "ctx": "personal", "done": False, "tags": [], "subtasks": []})
            lid = str(uuid.uuid4()); put("list", {"name": "Eat", "type": "restaurant"}, lid); put("list_item", {"list": lid, "title": "Zuma", "status": "want to go", "order": 1})
            pg.reload(); pg.wait_for_selector(".shell"); pg.goto(f"{BASE}/#/tasks"); pg.wait_for_selector(".item:has-text('Swipe me right')"); pg.wait_for_timeout(500)

            def center(sel):
                r = pg.eval_on_selector(sel, "e => { const r = e.getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; }"); return r
            x, y, w = center(".item:has-text('Swipe me right')"); touch(x + w / 2 - 60, y, x + w / 2 + 120, y)                  # swipe right = done
            pg.wait_for_selector(".toast:has-text('Done')", timeout=4000); pg.wait_for_timeout(1800)   # the app syncs a moment later
            done = pg.evaluate("fetch('/api/sync?since=').then(r => r.json()).then(j => j.records.filter(r => r.kind === 'task' && r.data.title === 'Swipe me right')[0].data.done)"); assert done is True, done
            pg.wait_for_timeout(600)
            x, y, w = center(".item:has-text('Swipe me left')"); touch(x + w / 2 + 60, y, x + w / 2 - 120, y)             # swipe left = delete, with Undo
            pg.wait_for_selector(".toast:has-text('Deleted')", timeout=3000)
            pg.wait_for_selector(".item:has-text('Swipe me left')", state="detached", timeout=4000)                      # it really left the list
            pg.click(".toast:has-text('Deleted') button:has-text('Undo')"); pg.wait_for_selector(".item:has-text('Swipe me left')", timeout=4000)   # Undo brings it back
            pg.wait_for_timeout(2000); assert pg.evaluate("fetch('/api/sync?since=').then(r => r.json()).then(j => j.records.filter(r => r.kind === 'task' && r.data.title === 'Swipe me left')[0].deleted_at)") is None, "the restore reached the server"
            pg.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")
            x, y, w = center(".item:has-text('Swipe me left')"); touch(x + 100, y + 0, x + 100, y + 120)             # a vertical drag must NOT trigger anything
            pg.wait_for_timeout(1500)   # long enough for the sync round trip: the undone item must still be there
            assert pg.query_selector(".item:has-text('Swipe me left')") and not pg.query_selector(".toast:has-text('Deleted')")

            pg.goto(f"{BASE}/#/lists/{lid}"); pg.wait_for_selector(".item:has-text('Zuma')"); pg.wait_for_timeout(400)
            x, y, w = center(".item:has-text('Zuma')"); touch(x + w / 2 + 60, y, x + w / 2 - 120, y); pg.wait_for_selector(".toast:has-text('Removed')", timeout=3000)   # list item: left = delete

            pg.goto(f"{BASE}/#/today"); pg.wait_for_timeout(500); pg.click(".tabbar .mid"); pg.wait_for_selector(".dialog .sheet-handle")      # the sheet has a grab handle...
            hx, hy, hw = center(".dialog .sheet-handle"); touch(hx + hw / 2, hy, hx + hw / 2, hy + 300); pg.wait_for_timeout(500)
            assert not pg.query_selector(".scrim"), "pulling the sheet down closes it"

            pg.goto(f"{BASE}/#/today"); pg.wait_for_timeout(500); touch(195, 120, 195, 330, 12)                       # pull down from the top = sync now
            pg.wait_for_selector(".toast:has-text('Up to date')", timeout=5000)
            assert not errs, errs
            b.close()
        print("touch flow OK")
    finally:
        srv.terminate()


main()
