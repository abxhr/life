"""Quality gates in a real browser: XSS probes, accessibility (axe-core, WCAG AA) in both themes + 390px, and performance on a big data set.
   .venv/Scripts/python tests/quality.py [--a11y] [--perf] [--xss]   (no flag = all)"""
import os, sys, json, time, subprocess, tempfile, shutil, urllib.request, uuid, statistics
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 5059; BASE = f"http://127.0.0.1:{PORT}"
AXE = os.path.join(ROOT, "tests", "vendor", "axe.min.js")
ROUTES = ["today", "inbox", "tasks", "calendar", "notes", "lists", "goals", "travel", "health", "assistant", "review", "settings", "work", "do", "people", "vault", "admin", "more"]
want = {a for a in sys.argv[1:] if a.startswith("--")} or {"--a11y", "--perf", "--xss"}

POST_JS = """async (arr) => { const m = await fetch('/api/me').then(r => r.json());
  for (let i = 0; i < arr.length; i += 400) await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json','X-CSRF':m.csrf}, body: JSON.stringify({changes: arr.slice(i, i + 400)})}); }"""


def boot():
    tmp = tempfile.mkdtemp()
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT), LIFE_AI_MOCK="1"), cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + "/api/me"); break
        except Exception:
            time.sleep(.3)
    return tmp, srv


def login(pg):
    pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell")


def rec(kind, data):
    return {"id": str(uuid.uuid4()), "kind": kind, "data": data}


def xss(b):
    ctx = b.new_context(viewport={"width": 1200, "height": 800}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: (errs.append("DIALOG " + d.message), d.dismiss()))
    login(pg)
    payloads = ['<img src=x onerror="window.__xss=1">', '<script>window.__xss=2</script>', '"><svg onload="window.__xss=3">', '[click](javascript:window.__xss=4)', '![x](javascript:window.__xss=5)', '`<b onmouseover=window.__xss=6>`', '[[<img src=x onerror=window.__xss=7>]]']
    recs = []
    for p in payloads:
        recs += [rec("note", {"title": p, "body": p + "\n\n- " + p, "type": "plain"}), rec("task", {"title": p, "notes": p, "done": False, "priority": 3, "ctx": "personal"}), rec("inbox", {"text": p}), rec("goal", {"title": p, "why": p, "status": "active"}), rec("person", {"name": p, "details": p}), rec("trip", {"name": p, "start": "2026-12-01", "end": "2026-12-03", "countries": []})]
    pg.evaluate(POST_JS, recs)
    pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(1500)
    for r in ["notes", "tasks", "inbox", "goals", "people", "travel?tab=trips", "today", "calendar", "settings"]:
        pg.goto(f"{BASE}/#/{r}"); pg.wait_for_timeout(700)
    pg.goto(f"{BASE}/#/notes"); pg.wait_for_timeout(500)
    pg.evaluate("document.querySelector('.note-row')?.click()"); pg.wait_for_timeout(500)
    if pg.locator(".seg button:has-text('Read')").count():
        pg.click(".seg button:has-text('Read')"); pg.wait_for_timeout(400)
    flag = pg.evaluate("window.__xss"); bad_attrs = pg.evaluate("document.querySelectorAll('[onerror],[onload],[onmouseover]').length"); js_links = pg.evaluate("document.querySelectorAll('a[href^=javascript]').length")
    assert flag is None, f"XSS executed: {flag}"
    assert bad_attrs == 0 and js_links == 0, (bad_attrs, js_links)
    assert not [e for e in errs if "DIALOG" in e], errs
    ctx.close(); print("xss OK: 7 payloads in notes/tasks/inbox/goals/people/trips, nothing executed, no javascript: links")


def a11y(b):
    out = {}
    seed = [rec("task", {"title": "Send deck", "due": "2026-10-12", "priority": 2, "done": False, "ctx": "work"}), rec("goal", {"title": "Run 100 km", "why": "Feel good", "status": "active", "quarterly": True}), rec("habit", {"name": "Read 20 min", "freq": "daily"}), rec("note", {"title": "Rome", "body": "tiramisu", "type": "plain"}), rec("list", {"name": "Rome", "type": "restaurant"}), rec("person", {"name": "Mum", "keep_weeks": 2})]
    for vp, name in (({"width": 1280, "height": 800}, "desktop"), ({"width": 390, "height": 844}, "mobile")):
        for scheme in ("light", "dark"):
            ctx = b.new_context(viewport=vp, color_scheme=scheme, is_mobile=name == "mobile", bypass_csp=True, reduced_motion="reduce"); pg = ctx.new_page(); login(pg)
            pg.evaluate(POST_JS, [dict(s, id=str(uuid.uuid4())) for s in seed]); pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(1200)
            for r in ROUTES:
                pg.goto(f"{BASE}/#/{r}"); pg.wait_for_timeout(600); pg.add_script_tag(path=AXE)
                res = pg.evaluate("async () => await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa']}, resultTypes: ['violations']})")
                for v in res["violations"]:
                    if v["impact"] in ("serious", "critical"):
                        out.setdefault(f"{v['id']}: {v['help']}", {}).setdefault(f"{name}/{scheme}/{r}", [n["target"][0] if n.get("target") else "" for n in v["nodes"][:2]])
            ctx.close()
    if out:
        print("A11Y VIOLATIONS (serious/critical):")
        for k, v in out.items():
            print(" ", k, "->", len(v), "page(s)")
            for where, t in list(v.items())[:4]:
                print("     ", where, t)
        sys.exit(1)
    print("a11y OK: no serious/critical WCAG A/AA violations on %d pages x desktop+mobile x light+dark" % len(ROUTES))


def perf(b):
    ctx = b.new_context(viewport={"width": 1280, "height": 800}); pg = ctx.new_page(); login(pg)
    lid = str(uuid.uuid4())
    recs = [rec("task", {"title": f"Task number {j} with a reasonably long title to measure layout", "due": None if j % 3 else "2026-10-%02d" % (10 + j % 20), "priority": 1 + j % 4, "ctx": "work" if j % 5 == 0 else "personal", "tags": ["t%d" % (j % 7)], "done": False}) for j in range(2500)]
    recs += [rec("note", {"title": f"Note {j}", "body": "Lorem ipsum dolor sit amet " * 20, "tags": ["n%d" % (j % 9)], "type": "plain"}) for j in range(1200)]
    recs += [{"id": lid, "kind": "list", "data": {"name": "Big list", "type": "restaurant"}}] + [rec("list_item", {"list": lid, "title": f"Place {j}", "status": "want to go", "city": "Rome", "cuisine": "Italian", "order": j}) for j in range(900)]
    pg.evaluate(POST_JS, recs); pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(3500)       # the client pulls it all down (as it would on a new device)
    measure = """async (hash) => { const page = document.querySelector('.page'); const t0 = performance.now(); location.hash = hash;
      await new Promise(res => { const mo = new MutationObserver(() => { if (page.querySelector('.view')) { mo.disconnect(); res(); } }); mo.observe(page, {childList: true}); setTimeout(res, 5000); });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; }"""
    results = {}
    pg.evaluate("location.hash = '#/tasks'"); pg.wait_for_timeout(500); pg.click(".seg button:has-text('Anytime')")
    for name, h in (("today", "today"), ("tasks (anytime)", "tasks"), ("notes", "notes"), ("lists", "lists"), ("big list (900)", f"lists/{lid}"), ("calendar", "calendar"), ("goals", "goals"), ("health", "health"), ("travel map", "travel")):
        ts = []
        for _ in range(3):
            pg.evaluate("location.hash = '#/settings'"); pg.wait_for_timeout(350); ts.append(pg.evaluate(measure, "#/" + h))
        results[name] = statistics.median(ts)
    n = pg.evaluate("document.querySelectorAll('.item').length")
    print("perf with 2500 tasks, 1200 notes, 900 list items (median of 3, ms):")
    for k, v in results.items():
        print(f"  {k:18s} {v:6.0f}")
    ctx.close()
    slow = {k: round(v) for k, v in results.items() if v > 200}
    if slow:
        print("SLOWER THAN 200 ms:", slow); sys.exit(1)
    print("perf OK: every main view under 200 ms on a large local data set")


if __name__ == "__main__":
    tmp, srv = boot()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            if "--xss" in want: xss(b)
            if "--a11y" in want: a11y(b)
            if "--perf" in want: perf(b)
            b.close()
    finally:
        srv.terminate(); srv.wait(); shutil.rmtree(tmp, ignore_errors=True)
