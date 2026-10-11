"""Screenshots for the docs. Starts a throwaway copy of Life on a temporary data folder, fills it with MADE-UP sample data (never real data), and saves PNGs to docs/assets/shots.
Run from the project folder:   .venv/Scripts/python tools/make_screenshots.py"""
import os, sys, subprocess, time, tempfile, urllib.request, json, uuid
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets", "shots"); os.makedirs(OUT, exist_ok=True)
PORT = 5081; BASE = f"http://localhost:{PORT}"
PW = "sample-password-for-screenshots"
D = lambda n: (date.today() + timedelta(days=n)).isoformat()

CARD_AL = {"verdict": "visa_free", "headline": "You can enter without a visa", "reason": "you hold your US visa (10 years, expires 2035)", "steps": ["Have a return or onward ticket"], "passport": "Travel documents must be valid for at least 3 months upon arrival.", "watch": "",
           "routes": [{"why": "you hold your US visa (10 years, expires 2035)", "condition": "Passengers can enter with a multiple entry visa issued by the USA, if they have already used the visa to enter the country of issue at least once for a maximum of 90 days."}],
           "source": "https://www.emirates.com/", "checked": D(0), "nationality": "in", "residency": "ae"}
GROUPS = {"visa_free": "al ge mx rs th ma id lk ke jo qa om bh kw sg my".split(), "held": "us jp sa".split(), "eta_or_evisa": "tr kh vn eg tz ug".split(), "on_arrival": "mv mu np".split(), "visa_required": "gb fr de it es ca au br ru".split()}
ALL = {"nationality": "in", "residency": "ae", "total": 56, "running": False, "done": 56, "failed": 0, "cards": {cc: {"verdict": v, "reason": "sample"} for v, ccs in GROUPS.items() for cc in ccs}}


def main():
    tmp = tempfile.mkdtemp(); env = dict(os.environ, LIFE_DATA=tmp, LIFE_PORT=str(PORT), LIFE_AI_MOCK="1")
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/me"); break
            except Exception: time.sleep(.3)
        with sync_playwright() as p:
            b = p.chromium.launch()
            def ctx(w, h, mobile, scheme="light"): return b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=mobile, has_touch=mobile, color_scheme=scheme)
            c = ctx(390, 844, True); pg = c.new_page()
            pg.goto(BASE); pg.wait_for_selector("input[type=password]"); pg.fill("input[type=password]", PW); pg.keyboard.press("Enter"); pg.wait_for_selector(".shell", timeout=10000)
            api = lambda path, body: pg.evaluate("async ([p, b]) => { const m = await (await fetch('/api/me')).json(); const r = await fetch(p, {method: 'POST', headers: {'X-CSRF': m.csrf, 'Content-Type': 'application/json'}, body: JSON.stringify(b)}); return r.status; }", [path, body])
            api("/api/demo", {}); pg.wait_for_timeout(1200)
            api("/api/settings", {"name": "Sam", "nationality": "in", "residency": "ae"})
            def put(kind, data, rid=None):
                ts = "2026-01-01T00:00:00.000Z"; api("/api/sync", {"changes": [{"id": rid or str(uuid.uuid4()), "kind": kind, "data": data, "updated_at": ts, "created_at": ts}]})
            rest, cafe, mov, ser = (str(uuid.uuid4()) for _ in range(4))
            put("list", {"name": "Restaurants", "type": "restaurant"}, rest); put("list", {"name": "Cafes", "type": "restaurant"}, cafe); put("list", {"name": "Movies to watch", "type": "media"}, mov); put("list", {"name": "Series to watch", "type": "media"}, ser)
            for n, (t, cu, ci, pr, st) in enumerate([("Ocean Grill", "Japanese", "Jumeirah, Dubai", "$$$", "want to go"), ("Taco Libre", "Mexican", "Al Quoz, Dubai", "$", "want to go"), ("Brick Oven Pizza", "Italian", "DIFC, Dubai", "$$", "want to go"), ("Smoke & Co", "BBQ", "Marina, Dubai", "$$", "want to go"), ("Noodle House", "Chinese", "Deira, Dubai", "$", "been, loved")]):
                put("list_item", {"list": rest, "title": t, "status": st, "order": n, "cuisine": cu, "city": ci, "price": pr, "notes": "Post: https://www.instagram.com/p/sample/", "phone": "04 000 0000", "tags": ["date night"]})
            for n, (t, cu, ci, pr) in enumerate([("Sunrise Cafe", "Coffee", "Jumeirah, Dubai", "$$"), ("Flour & Honey", "Bakery", "City Walk, Dubai", "$$")]):
                put("list_item", {"list": cafe, "title": t, "status": "want to go", "order": n, "cuisine": cu, "city": ci, "price": pr})
            for n, (t, g, la, im, yr, md) in enumerate([("Past Lives", "Drama, Romance", "English, Korean", "7.8", "2023", "movie"), ("Minari", "Drama", "English", "7.4", "2020", "movie"), ("Amelie", "Comedy, Romance", "French", "8.3", "2001", "movie"), ("Parasite", "Thriller, Drama", "Korean", "8.5", "2019", "movie"),
                                                         ("The Holdovers", "Comedy, Drama", "English", "7.9", "2023", "movie"), ("Spirited Away", "Animation, Fantasy", "Japanese", "8.6", "2001", "movie"), ("Perfect Days", "Drama", "Japanese", "7.9", "2023", "movie")]):
                put("list_item", {"list": mov, "title": t, "status": "to try", "order": n, "genre": g, "language": la, "imdb": im, "imdb_id": "tt0000001", "year": yr, "medium": md})
            for n, (t, g, la, im) in enumerate([("Severance", "Thriller, Sci-fi", "English", "8.7"), ("Shogun", "Drama, History", "English, Japanese", "8.7"), ("Dark", "Sci-fi, Mystery", "German", "8.7")]):
                put("list_item", {"list": ser, "title": t, "status": "to try", "order": n, "genre": g, "language": la, "imdb": im, "medium": "show"})
            for t, due, tm, pr in [("Renew gym membership", D(0), "09:30", 1), ("Book dentist", D(0), None, 2), ("Send the invoice", D(0), None, 3), ("Plan the weekend trip", D(1), None, 3), ("Call Mum", D(0), "19:00", 3)]:
                put("task", {"title": t, "due": due, "due_time": tm, "priority": pr, "ctx": "personal", "done": False, "tags": [], "subtasks": []})
            put("event", {"title": "Padel with Jo", "date": D(0), "start": "18:00", "end": "19:00", "allday": False, "ctx": "personal"}); put("event", {"title": "Team sync", "date": D(0), "start": "11:00", "end": "11:30", "allday": False, "ctx": "work"})
            put("trip", {"name": "Lisbon", "start": D(60), "end": D(66), "countries": ["PT"], "status": "planned", "currency": "AED"})
            for nm, cc in [("US visa (10 years, expires 2035)", "US"), ("Japan tourist visa (5 years)", "JP"), ("Saudi e-visa (2 years)", "SA")]:
                put("travel_doc", {"type": "visa", "name": nm, "nationality": cc, "expiry": ""})
            pg.reload(); pg.wait_for_selector(".shell"); pg.wait_for_timeout(1500)
            shot = lambda page, name: page.screenshot(path=os.path.join(OUT, name))
            go = lambda page, h, wait=".view": (page.goto(f"{BASE}/#/{h}"), page.wait_for_selector(wait), page.wait_for_timeout(700))
            pg.route("**/api/visa?to=al", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(CARD_AL)))
            pg.route("**/api/visa/all", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(ALL)))

            go(pg, "today"); shot(pg, "phone-today.png")
            pg.click(".tabbar .mid"); pg.wait_for_selector(".dialog input.cap-input"); pg.fill(".dialog input.cap-input", "Dinner at Ocean Grill friday 8pm"); pg.wait_for_timeout(500); shot(pg, "phone-capture.png"); pg.keyboard.press("Escape")
            go(pg, "tasks"); shot(pg, "phone-tasks.png")
            go(pg, "lists", ".card"); shot(pg, "phone-lists.png")
            go(pg, f"lists/{rest}", ".item"); shot(pg, "phone-restaurants.png")
            pg.click(".item:has-text('Ocean Grill') .t"); pg.wait_for_selector(".dialog a:has-text('Apple Maps')"); pg.wait_for_timeout(400); shot(pg, "phone-place-detail.png"); pg.keyboard.press("Escape")
            go(pg, f"lists/{mov}", ".item"); shot(pg, "phone-movies.png")
            go(pg, "travel/c/AL", ".view"); pg.wait_for_selector("text=Why:"); pg.evaluate("[...document.querySelectorAll('section.card')].find(s => s.textContent.includes('Entry for you')).scrollIntoView()"); pg.evaluate("window.scrollBy(0, -80)"); pg.wait_for_timeout(300); shot(pg, "phone-entry-card.png")
            go(pg, "travel", ".view"); pg.click("button:has-text('Where can I go?')"); pg.wait_for_selector("summary:has-text('No visa needed')"); pg.wait_for_timeout(500); shot(pg, "phone-where-can-i-go.png")
            go(pg, "settings", ".setsec"); pg.click("summary:has-text('Use it on your iPhone')"); pg.wait_for_timeout(500); pg.evaluate("[...document.querySelectorAll('summary')].find(s => s.textContent.includes('Use it on your iPhone')).scrollIntoView()"); pg.evaluate("window.scrollBy(0, -80)"); pg.wait_for_timeout(400); shot(pg, "phone-iphone-setup.png")
            go(pg, "calendar", ".view"); shot(pg, "phone-calendar.png")
            go(pg, "notes", ".view"); shot(pg, "phone-notes.png")
            go(pg, "health", ".view"); shot(pg, "phone-health.png")
            c.close()

            d = ctx(390, 844, True, "dark"); pgd = d.new_page(); pgd.goto(BASE); pgd.wait_for_selector("input[type=password]"); pgd.fill("input[type=password]", PW); pgd.keyboard.press("Enter"); pgd.wait_for_selector(".shell"); pgd.wait_for_timeout(1200)
            pgd.goto(f"{BASE}/#/today"); pgd.wait_for_timeout(900); shot(pgd, "phone-today-dark.png"); d.close()

            w = ctx(1360, 860, False); pgw = w.new_page(); pgw.goto(BASE); pgw.wait_for_selector("input[type=password]"); pgw.fill("input[type=password]", PW); pgw.keyboard.press("Enter"); pgw.wait_for_selector(".shell"); pgw.wait_for_timeout(1200)
            pgw.route("**/api/visa/all", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(ALL)))
            for h_, name in [("today", "desktop-today.png"), (f"lists/{mov}", "desktop-movies.png"), ("tasks", "desktop-tasks.png"), ("calendar", "desktop-calendar.png")]:
                pgw.goto(f"{BASE}/#/{h_}"); pgw.wait_for_selector(".view"); pgw.wait_for_timeout(900); shot(pgw, name)
            pgw.goto(f"{BASE}/#/travel"); pgw.wait_for_selector("button:has-text('Where can I go?')"); pgw.click("button:has-text('Where can I go?')"); pgw.wait_for_selector("summary:has-text('No visa needed')"); pgw.wait_for_timeout(500); shot(pgw, "desktop-where-can-i-go.png"); w.close()

            f = ctx(390, 844, True); pgf = f.new_page(); cdp = f.new_cdp_session(pgf); cdp.send("WebAuthn.enable")
            cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {"protocol": "ctap2", "transport": "internal", "hasResidentKey": True, "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})
            pgf.goto(BASE); pgf.wait_for_selector("input[type=password]"); pgf.fill("input[type=password]", PW); pgf.keyboard.press("Enter"); pgf.wait_for_selector(".shell")
            pgf.goto(f"{BASE}/#/settings"); pgf.wait_for_selector("summary:has-text('Face ID')"); pgf.click("summary:has-text('Face ID')"); pgf.click("button:has-text('Set up Face ID on this device')"); pgf.wait_for_selector(".dialog input"); pgf.fill(".dialog input", "My iPhone"); pgf.click(".dialog .btn.primary"); pgf.wait_for_selector("text=My iPhone")
            pgf.check("text=Only open Life with Face ID"); pgf.wait_for_timeout(500); pgf.evaluate("[...document.querySelectorAll('summary')].find(s => s.textContent.includes('Face ID')).scrollIntoView()"); pgf.wait_for_timeout(300); shot(pgf, "phone-faceid-settings.png")
            pgf.evaluate("fetch('/api/lock', {method: 'POST'})"); pgf.reload(); pgf.wait_for_selector("button:has-text('Unlock with Face ID')"); pgf.wait_for_timeout(300); shot(pgf, "phone-lock-screen.png"); f.close()
            b.close()
        print("shots:", sorted(os.listdir(OUT)))
    finally:
        srv.terminate()


main()
