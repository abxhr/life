"""Interactive flows (desktop + mobile): tasks, inbox triage, calendar views, notes, lists incl. map. Zero console errors required."""
import os, sys, subprocess, time, tempfile, shutil, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
    # travel: map, country, visit, trip + tabs, vault
    go("travel"); pg.wait_for_selector("svg.world path.ct", timeout=15000); pg.wait_for_timeout(1200)
    pg.fill("input[aria-label='Find a country']", "France"); pg.keyboard.press("Enter"); pg.wait_for_selector("h1:has-text('France')")
    pg.click(".seg button:has-text('Been')"); pg.click("button:has-text('Add visit')"); pg.fill(".dialog textarea", "Eiffel tower and croissants"); pg.fill(".dialog input[type=date] >> nth=0", "2025-05-01"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".passport .item:has-text('croissants')")
    pg.click("button:has-text('Add what I found')"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".chip:has-text('Unknown')")
    go("travel"); pg.wait_for_selector("svg.world path.c-been"); 
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-travel-map.png")
    pg.click(".seg button:has-text('Trips')"); pg.click("button:has-text('Plan a trip') >> nth=0"); pg.fill(".dialog input[placeholder^='e.g. Japan']", "Paris long weekend"); pg.fill(".dialog input[list=cl2]", "France"); pg.keyboard.press("Enter"); pg.wait_for_selector(".dialog .chip:has-text('France')"); pg.fill(".dialog input[type=date] >> nth=0", "2026-11-05"); pg.fill(".dialog input[type=date] >> nth=1", "2026-11-08"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector("h1:has-text('Paris long weekend')")
    for tabname in ("Itinerary", "Bookings", "Documents", "Packing", "Budget", "Before you go", "Journal", "Recap"):
        pg.click(f".seg button:has-text('{tabname}')"); pg.wait_for_timeout(400)
    pg.click(".seg button:has-text('Itinerary')"); pg.fill("input[aria-label^='Add to 2026-11-05']", "10:00 Louvre"); pg.keyboard.press("Enter"); pg.wait_for_selector(".item:has-text('Louvre')")
    pg.click(".seg button:has-text('Before you go')"); pg.wait_for_selector(".item:has-text('Passport')")
    go("vault"); pg.click("button:has-text('Add document') >> nth=0"); pg.fill(".dialog input[data-k=name]", "Test passport"); pg.fill(".dialog input[data-k=number]", "P1234567"); pg.fill(".dialog input[data-k=expiry]", "2030-01-01"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector("article:has-text('Test passport')")
    pg.wait_for_selector("article:has-text('4567')"); 
    for tabname in ("Expiry radar", "Visa applications", "Stay counter", "Leave & bridges"): pg.click(f".seg button:has-text('{tabname}')"); pg.wait_for_timeout(300)
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-vault.png")
    # health
    go("health"); pg.wait_for_selector("h3:has-text('Patterns')"); pg.click(".seg button:has-text('Mood')"); pg.click(".chip[aria-label^='Mood 4']"); pg.wait_for_selector(".chip.on[aria-label^='Mood 4']")
    pg.click(".seg button:has-text('Logs')"); pg.click("button:has-text('Caffeine')"); pg.wait_for_selector(".item:has-text('caffeine')")
    pg.click(".seg button:has-text('Health admin')"); pg.click("section:has-text('Appointments') button:has-text('Add')"); pg.fill(".dialog input >> nth=0", "Dentist"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".item:has-text('Dentist')")
    pg.click(".seg button:has-text('Garmin & import')"); pg.wait_for_selector("h3:has-text('Import a file')")
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-health.png")
    # assistant (mock model): stream, confirm card, apply, log, undo
    go("assistant"); pg.fill("textarea.chat-in", "add task call the bank"); pg.keyboard.press("Enter"); pg.wait_for_selector(".confirm:has-text('Call the bank')")
    pg.click(".confirm button:has-text('Confirm')"); pg.wait_for_selector(".bubble.assistant:has-text('Done.')")
    go("tasks"); pg.click(".seg button:has-text('Anytime')"); pg.wait_for_selector(".item .t:has-text('Call the bank')")
    go("assistant"); pg.click(".seg button:has-text('What it did')"); pg.wait_for_selector(".item:has-text('Created task')"); pg.click(".item:has-text('Created task') button:has-text('Undo')"); pg.wait_for_selector(".toast:has-text('Undone')")
    go("tasks"); pg.click(".seg button:has-text('Anytime')"); pg.wait_for_timeout(500); assert pg.locator(".item .t:has-text('Call the bank')").count() == 0
    pg.keyboard.press("Control+j"); pg.wait_for_selector(".assistant-sheet textarea.chat-in"); pg.fill(".assistant-sheet textarea.chat-in", "hello"); pg.keyboard.press("Enter"); pg.wait_for_selector(".assistant-sheet .bubble.assistant:has-text('You said')")
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-assistant.png")
    pg.keyboard.press("Escape")
    go("assistant"); pg.click(".seg button:has-text('Privacy & style')"); pg.wait_for_selector("h3:has-text('What the assistant can see')"); pg.click(".seg button:has-text('Usage')"); pg.wait_for_selector(".pbar")
    # review: week (save), month, year
    go("review"); pg.wait_for_selector("h3:has-text('The week in numbers')"); pg.fill("textarea >> nth=0", "Shipped the thing"); pg.fill("input[aria-label='Top 1']", "Call the plumber"); pg.click("button:has-text('Save review')"); pg.wait_for_selector(".toast:has-text('Saved to Notes')")
    pg.click(".seg button:has-text('Month')"); pg.wait_for_selector("h3:has-text('Goals')"); pg.click(".seg button:has-text('Year')"); pg.wait_for_selector(".yr-title", timeout=15000)
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-year.png")
    # extras: people, admin hub, focus, share link, emergency card
    go("people"); pg.click("button:has-text('Add person') >> nth=0"); pg.fill(".dialog input >> nth=0", "Mum"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector("article:has-text('Mum')"); pg.click("article:has-text('Mum') button:has-text('We spoke today')")
    go("admin"); pg.click("button:has-text('Add item')"); pg.fill(".dialog input >> nth=0", "AC service"); pg.fill(".dialog input[type=number] >> nth=0", "180"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(".item:has-text('AC service')")
    for tabname in ("Policies & warranties", "Subscriptions", "Decisions", "Someday", "Yearly checklist", "Review cards", "Meals"): pg.click(f".seg button:has-text('{tabname}')"); pg.wait_for_timeout(250)
    pg.click(".seg button:has-text('Emergency card')"); pg.fill("input[placeholder^='Choose a PIN']", "2468"); pg.click("button:has-text('Set up card')"); pg.fill("input[placeholder='Blood group'], .card input >> nth=1", "O+"); 
    pg.click("button:has-text('Save & lock')"); pg.wait_for_selector("input[aria-label=PIN]"); pg.fill("input[aria-label=PIN]", "0000"); pg.keyboard.press("Enter"); pg.wait_for_selector("text=not the PIN")
    pg.fill("input[aria-label=PIN]", "2468"); pg.keyboard.press("Enter"); pg.wait_for_selector(".emerg:has-text('In an emergency')")
    go("lists"); pg.click("a.card >> nth=0"); pg.click("button:has-text('Link')"); pg.click(".dialog button:has-text('Create link')"); pg.wait_for_selector("input[aria-label='Share link']"); pg.keyboard.press("Escape")
    go("today"); pg.keyboard.press("Control+k"); pg.fill(".dialog input", "Focus mode"); pg.wait_for_timeout(400); pg.keyboard.press("Enter"); pg.wait_for_selector(".focus .focus-clock"); pg.click(".focus button:has-text('Start')"); pg.wait_for_timeout(1200); pg.click(".focus .focus-x")
    import flows_notion; flows_notion.run(pg, mobile, go, SHOTS, OUT)
    # work mode toggle
    pg.click(f"{'.topbar' if mobile else '.spine'} .mode-sw button[data-m=work]"); go("tasks"); pg.click(".seg button:has-text('Upcoming')"); pg.wait_for_selector(".item .t:has-text('Send deck')")

def main():
    errs = []
    if SHOTS: os.makedirs(OUT, exist_ok=True)
    for mobile in (False, True):
        tmp = tempfile.mkdtemp(); srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT), LIFE_AI_MOCK='1'), cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
