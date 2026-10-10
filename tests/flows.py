"""Interactive flows (desktop + mobile): tasks, inbox triage, calendar views, notes, lists incl. map. Zero console errors required."""
import os, sys, subprocess, time, tempfile, shutil, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 5057; BASE = f"http://127.0.0.1:{PORT}"
SHOTS = "--shots" in sys.argv; OUT = os.path.join(ROOT, "tests", "shots")

def run(pg, mobile):
    def go(r): pg.goto(f"{BASE}/#/{r}"); pg.wait_for_timeout(450)
    # tasks
    go("tasks"); pg.fill("input[aria-label='Add a task']", "send deck to finance tomorrow 2pm @work !high"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    pg.fill("input[aria-label='Add a task']", "water plants every 3 days"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    pg.click(".seg button:has-text('Upcoming')"); pg.wait_for_selector(".item .t:has-text('Send deck')")
    pg.click(".seg button:has-text('Today')"); pg.wait_for_selector(".item .t:has-text('Water plants')")
    pg.check(".item:has-text('Water plants') input.chk"); pg.wait_for_selector(".toast:has-text('next one')")
    pg.click(".item:has-text('Water plants') .grow"); pg.wait_for_selector(".dialog input[aria-label=Title]"); pg.keyboard.press("Escape")
    # inbox triage
    pg.evaluate("document.querySelector('.cap-box input, .tabbar .mid').click()"); pg.fill(".dialog input.cap-input", "think about gift for Sam"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    go("inbox"); pg.wait_for_selector(".card.taped"); 
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-inbox.png")
    pg.click(".card.taped button:has-text('Note')"); pg.wait_for_timeout(300)
    # calendar: event + all four views
    go("calendar"); pg.click(".page-head .btn.primary"); pg.fill(".dialog input[placeholder=Event]", "Padel with Omar"); pg.click(".dialog .btn.primary"); pg.wait_for_timeout(300)
    for v in ("Day", "Week", "Month", "Agenda"): pg.click(f".seg button:has-text('{v}')"); pg.wait_for_timeout(300)
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-agenda.png")
    pg.click(".seg button:has-text('Week')"); pg.wait_for_timeout(300)
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-week.png")
    # notes
    go("notes/new"); pg.wait_for_selector("textarea.note-body"); pg.fill("textarea.note-body", "# Rome\n- [ ] book Colosseum\n\nSee [[Padel plans]]\n\n| a | b |\n|---|---|\n| 1 | 2 |"); pg.fill("input.note-title", "Rome trip"); pg.wait_for_timeout(900)
    pg.click(".seg button:has-text('Read')"); pg.wait_for_selector(".note-prev h2:has-text('Rome')"); pg.wait_for_selector(".note-prev table")
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-note.png")
    # lists: restaurant list, item, map
    go("lists"); pg.click("text=Start a list"); pg.click(".dialog .btn.primary:has-text('Create')"); pg.wait_for_selector("input[aria-label='Quick add']")
    pg.fill("input[aria-label='Quick add']", "Pompi tiramisu"); pg.keyboard.press("Enter"); pg.wait_for_selector(".item .t:has-text('Pompi')")
    pg.click(".item:has-text('Pompi') .grow"); pg.fill(".dialog input[placeholder^='lat']", "41.9, 12.5"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_timeout(300)
    pg.click(".seg button:has-text('Map')"); pg.wait_for_selector(".leaflet-container"); pg.wait_for_timeout(500)
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-list-map.png")
    pg.click(".seg button:has-text('Board')"); pg.wait_for_selector("h3:has-text('want to go')")
    pg.click("button:has-text('Surprise me')"); pg.wait_for_selector(".dialog:has-text('How about')"); pg.keyboard.press("Escape")
    # goals, habits, wheel, do
    go("goals"); pg.click("button:has-text('New goal')"); pg.fill(".dialog input[placeholder^='What do you want']", "Run 100 km"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".toast:has-text('why')")
    pg.fill(".dialog textarea", "Because I feel better when I move"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".card.goal h3:has-text('Run 100 km')")
    pg.click(".seg button:has-text('Habits')"); pg.click("button:has-text('New habit')"); pg.fill(".dialog input[placeholder^='e.g.']", "Read 20 minutes"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector("h3:has-text('Read 20 minutes')")
    pg.click(".seg button:has-text('Life wheel')"); pg.wait_for_selector("svg.radar"); pg.click(".seg button:has-text('Wins')"); pg.click(".seg button:has-text('Vision')"); pg.wait_for_selector("h3:has-text('My why')")
    go("today"); pg.click(".chip:has-text('Read 20 minutes')"); pg.wait_for_selector(".toast:has-text('Read 20 minutes')")
    go("do"); pg.wait_for_selector(".card .btn:has-text('Start')")
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-do.png")
    # work mode toggle
    pg.click(f"{'.topbar' if mobile else '.spine'} .mode-sw button[data-m=work]"); go("tasks"); pg.click(".seg button:has-text('Upcoming')"); pg.wait_for_selector(".item .t:has-text('Send deck')")

def main():
    errs = []
    if SHOTS: os.makedirs(OUT, exist_ok=True)
    for mobile in (False, True):
        tmp = tempfile.mkdtemp(); srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT)), cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(40):
                try: urllib.request.urlopen(BASE + "/api/me"); break
                except Exception: time.sleep(.3)
            with sync_playwright() as p:
                b = p.chromium.launch()
                ctx = b.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1360, "height": 860}, is_mobile=mobile, has_touch=mobile)
                ctx.grant_permissions([]); pg = ctx.new_page()
                pg.on("console", lambda m: m.type == "error" and "tile.openstreetmap" not in m.text and "ERR_" not in m.text and errs.append(f"console: {m.text}")); pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
                pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", "correct horse battery"); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell")
                try: run(pg, mobile)
                except Exception as e:
                    pg.screenshot(path=os.path.join(ROOT, "tests", "fail.png")); errs.append(f"flow ({'mobile' if mobile else 'desktop'}): {str(e)[:400]}"); 
                ctx.close()
                b.close()
        finally: srv.terminate(); srv.wait(); shutil.rmtree(tmp, ignore_errors=True)
    if errs: print("FAIL"); [print(" ", e) for e in dict.fromkeys(errs)]; sys.exit(1)
    print("flows OK (desktop + mobile)")
if __name__ == "__main__": main()
