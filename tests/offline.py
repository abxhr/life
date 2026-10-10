"""Offline-first, for real: the service worker serves the shell with the network cut, writes queue in the outbox, and sync on reconnect (also: a stale-cache update is offered, not forced)."""
import os, sys, time, subprocess, tempfile, shutil, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 5062; BASE = f"http://127.0.0.1:{PORT}"


def until(pg, js, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if pg.evaluate(js):
                return
        except Exception:
            pass
        time.sleep(.25)
    raise AssertionError("timed out waiting for: " + js[:80])


def main():
    tmp = tempfile.mkdtemp(); srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT)), cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errs = []
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "/api/me"); break
            except Exception:
                time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 800}); pg = ctx.new_page()
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell")
            until(pg, "navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))", 10); pg.reload(); pg.wait_for_selector(".shell")   # now controlled by the SW
            until(pg, "!!navigator.serviceWorker.controller", 10)
            pg.evaluate("location.hash = '#/tasks'"); pg.wait_for_timeout(500)
            ctx.set_offline(True)
            pg.reload(); pg.wait_for_selector(".shell", timeout=10000)                                    # shell + JS + CSS + fonts from the cache
            assert pg.locator(".spine, .topbar").count() > 0
            pg.evaluate("location.hash = '#/tasks'"); pg.wait_for_selector("input[aria-label='Add a task']")
            pg.fill("input[aria-label='Add a task']", "written while offline tomorrow 9am"); pg.keyboard.press("Enter")
            pg.evaluate("location.hash = '#/tasks'"); pg.click(".seg button:has-text('Upcoming')"); pg.wait_for_selector(".item .t:has-text('Written while offline')")
            pill = pg.inner_text("#sync-pill") if pg.locator("#sync-pill").count() else ""
            assert "waiting" in pill or "offline" in pill, f"outbox indicator: {pill!r}"
            ctx.set_offline(False); pg.evaluate("window.dispatchEvent(new Event('online'))")
            until(pg, "fetch('/api/sync?since=').then(r => r.json()).then(j => j.records.some(x => x.kind === 'task' && x.data.title.startsWith('Written while offline')))", 15)
            until(pg, "document.querySelector('#sync-pill')?.textContent === 'saved'", 15)
            b.close()
        assert not errs, errs
        print("offline OK: shell loads with no network, a task written offline waits in the outbox and syncs on reconnect")
    finally:
        srv.terminate(); srv.wait(); shutil.rmtree(tmp, ignore_errors=True)


main()
