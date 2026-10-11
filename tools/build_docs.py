"""Builds the docs website (docs/*.html) from the page text below. Plain static HTML, no framework.   python tools/build_docs.py"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); DOCS = os.path.join(ROOT, "docs")
NAV = [("index.html", "Home"), ("features.html", "Features"), ("iphone.html", "iPhone"), ("setup.html", "Set up"), ("security.html", "Security")]
LAYOUT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><meta name="description" content="{desc}"><meta name="theme-color" content="#25304b">
<link rel="icon" href="assets/icon.png"><link rel="stylesheet" href="assets/site.css"></head>
<body><header class="top"><div class="in"><a class="brand" href="index.html"><img src="assets/icon.png" alt="">Life</a><nav aria-label="Main">{nav}</nav></div></header>
<main class="wrap">{body}
<footer>Life is a private, single-user app that runs on your own computer. This site was built from the project's own docs and sample data: no real personal data appears in any screenshot.</footer></main></body></html>
"""

def shot(name, cap, kind="phone"):
    return f'<figure><div class="{kind}"><img src="assets/shots/{name}" alt="{cap}" loading="lazy"></div><figcaption>{cap}</figcaption></figure>'

def feature(name, title, text, flip=False, dom="--pen"):
    return f'<section class="feature{" flip" if flip else ""}"><div class="phone"><img src="assets/shots/{name}" alt="{title}" loading="lazy"></div><div><h3>{title}</h3>{text}</div></section>'

PAGES = {}

PAGES["index.html"] = ("Life: your day, quietly", "A private notebook-style life manager: tasks, notes, lists, trips and health, built to live on your iPhone.", f"""
<section class="hero"><div>
<h1>Life</h1><p class="lead">Your day, quietly.</p>
<div class="sticky">One private notebook for tasks, notes, lists, trips, health and everything in between. It lives on <b>your</b> computer and feels at home on your iPhone.</div>
<div class="btnrow"><a class="btn primary" href="setup.html">Get started</a><a class="btn" href="features.html">See what it does</a><a class="btn" href="iphone.html">iPhone guide</a></div>
<p>Save a restaurant from an Instagram post, and it lands in the right list with its cuisine, area and price. Ask what you need for a country, and it tells you in one line, based on <i>your</i> passport and the visas you hold. Open it with Face ID.</p>
</div><div class="phone taped">{'<img src="assets/shots/phone-today.png" alt="The Today page on an iPhone">'}</div></section>

<h2>What's inside</h2>
<div class="grid">
<div class="card taped"><h3><span class="dot"></span>Today &amp; capture</h3><p>One calm page for the day, and a capture box that understands "dinner friday 8pm #family !high". Swipe a task to finish it.</p></div>
<div class="card taped"><h3><span class="dot" style="--c:var(--lists)"></span>Lists that file themselves</h3><p>Share an Instagram post, a web page or a screenshot. Places, films and series are read, filed, de-duplicated and filled in (cuisine, area, price, genre, language, IMDb).</p></div>
<div class="card taped"><h3><span class="dot" style="--c:var(--travel)"></span>Travel that knows you</h3><p>"Entry for you" on every country page, where you can go with your passport and visas, change alerts, and a smart pre-trip checklist.</p></div>
<div class="card taped"><h3><span class="dot"></span>Built for the iPhone</h3><p>Installable app, Face ID unlock, push notifications, swipe and pull-to-refresh, a Share Sheet Shortcut, an iPhone Calendar feed and a Siri "my day".</p></div>
<div class="card taped"><h3><span class="dot" style="--c:var(--notes)"></span>Notes, goals, calendar</h3><p>Markdown notes with backlinks, goals with a required "why", habits with forgiving streaks, a calendar with feeds.</p></div>
<div class="card taped"><h3><span class="dot" style="--c:var(--health)"></span>Health &amp; assistant</h3><p>Garmin summaries and mood, plus an assistant that acts only through confirm cards you approve.</p></div>
</div>

<h2>Made for the phone in your pocket</h2>
<div class="shots">
{shot("phone-capture.png", "Capture anything in a few seconds")}
{shot("phone-restaurants.png", "Restaurants: name, cuisine, area, cost")}
{shot("phone-movies.png", "Films and series with genre, language and IMDb")}
{shot("phone-entry-card.png", "Visa and entry rules, for you")}
</div>

<h2>Private by design</h2>
<ul>
<li>It runs on <b>your</b> computer; your data lives in one SQLite file you can export, back up and delete. No accounts, no analytics, no third-party scripts or fonts.</li>
<li>Keys you add (OpenAI, Telegram, Gmail, Garmin) are stored <b>encrypted</b> and never sent back to the browser.</li>
<li>Open it with <b>Face ID</b>; a stolen cookie alone is not enough.</li>
<li>AI is used sparingly and cheaply: the cheapest model for most jobs, OpenAI's Decisions API where a multiple-choice answer is enough. A typical share costs a fraction of a cent (a long carousel, about a cent).</li>
</ul>
<p><a href="security.html">Read the security notes →</a></p>
""")

PAGES["features.html"] = ("Features · Life", "Everything Life does, with screenshots.", f"""
<h1>Features</h1><p>Screenshots show made-up sample data.</p>
{feature("phone-today.png", "Today, one calm page", "<p>A single sentence about the day, what is due, what is next, a mood check-in, habits and a body strip. Nothing shouts. Late things are <i>slipped</i>, not a wall of red.</p><p>On a phone you can <b>swipe a task right to finish it</b>, left to delete it (with Undo), and <b>pull down to refresh</b>.</p>")}
{feature("phone-capture.png", "Capture in seconds", "<p>Type, dictate or <b>paste</b>. Dates, <code>#tags</code>, <code>@places</code> and <code>!priority</code> are understood as you type. Paste an Instagram link or caption and tap <b>To lists</b> to file it straight away.</p><p>The Capture sheet is a bottom sheet you can drag down to close.</p>", flip=True)}
{feature("phone-restaurants.png", "Lists that stay calm", "<p>Each row shows only what you need. Restaurants and cafes: <b>cuisine · area · cost</b>. Films and series: <b>genre · language · ★ IMDb</b>. Everything else is one tap away in the item.</p><ul><li>Finished items are <b>hidden, never deleted</b>; a dropdown brings them back.</li><li><b>Something is only ever added once</b>, however you add it (Instagram, quick-add, form, CSV). Different spellings, accents, &ldquo;The&rdquo; and bracketed notes are ignored.</li><li>Select several (long-press) to mark done, move or delete. <b>Find duplicates</b> merges them.</li><li>Swipe a row to finish or remove it.</li></ul>")}
{feature("phone-place-detail.png", "Open a place or film", "<p>Every item has quick links: <b>Apple Maps, Google Maps, Call, the original Instagram post</b>; for films, the <b>trailer, where to watch and IMDb</b>. You can <b>move it to another list</b> from here.</p>", flip=True)}
{feature("phone-movies.png", "Filled in for you", "<p>When you add a film or series, Life looks it up: genre, language and year come from Wikidata (it knows recent releases), and the <b>IMDb rating</b> comes from IMDb's free ratings file, matched by IMDb ID. For places, cuisine and a cost estimate come from a cheap AI call, and the area from the post itself or OpenStreetMap when it can be found. Anything uncertain is left blank, never invented.</p><p><b>Surprise me</b> picks something with filters (cuisine, price, genre, language).</p>")}
<h2>Share anything into Life</h2>
<p>An iPhone Shortcut puts <b>Save to Life</b> in the Share Sheet. Share an Instagram post (caption <i>and every slide</i> are read, so lists like "My top 10 films" work), a blog post, a link, or a screenshot.</p>
<ul><li>Restaurants go to <b>Restaurants</b>, bakeries and coffee places to <b>Cafes</b>, films to <b>Movies to watch</b>, series to <b>Series to watch</b>, and you can add your own lists.</li><li>Headings like "Top 10 movies so far" are not mistaken for titles.</li><li>Not recognised? It goes to your Inbox, so nothing is lost.</li></ul>
{feature("phone-iphone-setup.png", "Set it up in one screen", "<p>Settings → <b>Use it on your iPhone</b> creates the token, shows exactly what to paste into the Shortcut, and has a <b>Test</b> button.</p>")}
<h2>Travel that knows your situation</h2>
{feature("phone-entry-card.png", "Entry for you", "<p>Every country page tells you what <b>you</b> need, from your passport, where you live and the <b>visas you already hold</b>, using the airline's entry-rule data. It says <i>why</i>: &ldquo;you hold your US visa&rdquo;, with the airline's own condition quoted (for example &ldquo;the visa must be multiple-entry and used once&rdquo;).</p><p>It is condensed by choosing from fixed answers (no free-text guessing), so wording never drifts from the source.</p>")}
{feature("phone-where-can-i-go.png", "Where can I go?", "<p>One tap checks every country in the background and sorts them: <b>no visa needed</b> (or you hold what they accept), <b>apply online first</b>, <b>visa on arrival</b>, <b>embassy visa</b>. A daily re-check <b>alerts you if the rules change</b> for a country you plan to visit.</p><p>The pre-trip checklist turns this into to-dos, with an apply-by date.</p>", flip=True)}
<h2>On the desktop too</h2>
<div class="shots" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))">
{shot("desktop-today.png", "Today", "desk")}{shot("desktop-movies.png", "Films with genre, language and IMDb", "desk")}{shot("desktop-where-can-i-go.png", "Where can I go?", "desk")}{shot("desktop-calendar.png", "Calendar", "desk")}
</div>
<h2>Phone notifications, Face ID and your Calendar</h2>
<div class="shots">{shot("phone-faceid-settings.png", "Set up Face ID")}{shot("phone-lock-screen.png", "The lock screen")}{shot("phone-calendar.png", "Calendar")}{shot("phone-today-dark.png", "Dark mode")}</div>
<ul>
<li><b>Notifications</b> reach the phone as real push (installed app) and/or Telegram: reminders, the morning brief, trips and flights, passport/visa expiry, birthdays, entry-rule changes, and problems. Per-category switches, quiet hours respected, urgent flights always come through. Tapping one opens the right page.</li>
<li><b>Face ID</b>: "Only open Life with Face ID". Lock when you leave the app, or after 1, 5 or 15 minutes. The password then works only from the computer Life runs on.</li>
<li><b>Calendar feed</b>: your tasks, events, reminders, trips, birthdays and passport/visa expiries in the iPhone Calendar app (titles and dates only).</li>
<li><b>Siri / Shortcuts</b>: "Hey Siri, what's my day?" reads your day aloud.</li>
</ul>
<h2>Also in the box</h2>
<div class="shots">{shot("phone-tasks.png", "Tasks")}{shot("phone-notes.png", "Notes")}{shot("phone-health.png", "Health")}{shot("phone-lists.png", "Lists")}</div>
<ul><li><b>Garmin</b> (health): sign in <b>once</b>; Life keeps a login token, not your password, so no repeated security-code emails.</li><li><b>Assistant</b>: asks before it changes anything (confirm cards), everything logged and undoable.</li><li><b>Review</b>: weekly, monthly and a year-in-review poster. <b>Backups</b>: nightly, plus download one to the Files app.</li></ul>
""")

PAGES["iphone.html"] = ("iPhone guide · Life", "Install Life on your iPhone and set up notifications, Face ID, sharing, Calendar and Siri.", f"""
<h1>iPhone guide</h1>
<p>Life is a web app, so on iPhone you <b>install it from Safari</b>. Everything below also lives in <b>Settings → Use it on your iPhone</b>, with the exact values to copy.</p>
<div class="note"><p><b>You need</b> Life reachable over HTTPS from your phone, for example with Tailscale (see <a href="setup.html">Set up</a>). iOS only allows notifications and Face ID for HTTPS sites.</p></div>
<h2>1 · Install it</h2>
<ol class="steps"><li>Open your Life address in <b>Safari</b> and sign in.</li><li>Tap <b>Share → Add to Home Screen</b>, then open Life from the new icon. It runs full screen, with its own launch screen.</li></ol>
<h2>2 · Notifications</h2>
<ol class="steps"><li>In the installed app: <b>Settings → Phone notifications → Turn on for this device</b>, and allow notifications.</li><li>Tap <b>Send a test</b>. Choose what to hear about (reminders, morning brief, trips, expiries, problems).</li></ol>
<h2>3 · Face ID</h2>
<ol class="steps"><li><b>Settings → Face ID → Set up Face ID on this device</b>. The key stays in your iPhone's Keychain.</li><li>Switch on <b>Only open Life with Face ID</b> and pick when it locks again.</li></ol>
<div class="note"><p>Keep a way back in: once Face ID is required, the password works only from the computer Life runs on.</p></div>
<h2>4 · Share into Life (Instagram, links, screenshots)</h2>
<ol class="steps">
<li><b>Settings → Use it on your iPhone → Set up the "Save to Life" Shortcut</b>. It creates a token and shows the values.</li>
<li>In the <b>Shortcuts</b> app: <b>+</b> → name it <i>Save to Life</i> → ⓘ → <b>Show in Share Sheet</b> (URLs, Text, Images).</li>
<li>Add <b>Get Contents of URL</b>: URL as shown, method <b>POST</b>, header <code>Authorization</code> = the value shown, Request Body <b>Form</b>: <code>text</code> = Shortcut Input (and <code>images</code> = Shortcut Input to share screenshots).</li>
<li>Add <b>Get Dictionary Value</b> (key <code>message</code>) then <b>Show Notification</b>.</li>
<li>In Instagram: paper plane → <b>Share to…</b> → <b>Save to Life</b>. Tap <b>Test this token</b> in Life if anything is off.</li></ol>
<p class="note good"><b>Tip:</b> if Instagram hides a caption, Life still reads the slides. If nothing can be read it goes to your Inbox.</p>
<h2>5 · Calendar</h2>
<p><b>Settings → Use it on your iPhone → Create my calendar link → Subscribe in Calendar</b>. Tasks with dates, events, reminders, trips, birthdays and passport/visa expiries appear and stay up to date. <b>Reset link</b> cuts off an old link.</p>
<h2>6 · Siri: "what's my day?"</h2>
<ol class="steps"><li>Shortcuts → <b>+</b> → <b>Get Contents of URL</b> (the link under step 5 in Settings) → <b>Speak Text</b>.</li><li>Name it <i>What's my day</i> and say it to Siri, or add it as a Lock Screen or Home Screen widget.</li></ol>
<h2>What iOS does not allow</h2>
<p>A web app cannot have native Home Screen widgets or appear in Siri without a Shortcut. The Calendar feed and the Shortcuts above are the closest equivalents.</p>
""")

PAGES["setup.html"] = ("Set up · Life", "Run Life on your computer, reach it from your phone, add integrations, back up your data.", f"""
<h1>Set up</h1>
<h2>Run it</h2>
<p><b>Windows:</b> double-click <code>run.bat</code>. First run creates a virtual environment, installs the requirements and starts the server on <code>http://127.0.0.1:5055</code>. Open it and choose a password (8+ characters). <b>Mac/Linux:</b> <code>./run.sh</code>.</p>
<p>To keep it running in the background, use a service wrapper such as NSSM: program <code>.venv\\Scripts\\python.exe</code>, arguments <code>app.py</code>, start directory = the project folder.</p>
<h2>Reach it from your phone</h2>
<p>Recommended: <b>Tailscale</b> on the computer and the phone, then <code>tailscale serve --bg 5055</code> gives you a private HTTPS address only your devices can reach. Add <code>LIFE_HTTPS=1</code> to <code>.env</code> so cookies are marked Secure. Never use <code>tailscale funnel</code> (that is public). A small VPS behind Caddy also works; the full steps are in <code>SETUP-PHONE.md</code>.</p>
<h2>Add integrations in Settings</h2>
<p>Everything is optional and fails softly into <b>Settings → Data health</b>. Keys you type in Settings are stored <b>encrypted</b> and applied immediately (no restart). A value in <code>.env</code> still works as a fallback.</p>
<table><tr><th>Integration</th><th>What for</th><th>Where</th></tr>
<tr><td>OpenAI key</td><td>Assistant, voice, share/enrichment (cheap models), Decisions API for entry rules</td><td>Settings → Voice &amp; assistant</td></tr>
<tr><td>Anthropic key</td><td>Optional alternative for the assistant</td><td>same</td></tr>
<tr><td>Telegram bot</td><td>Reminders, inbox capture, morning brief</td><td>Settings → Reminders &amp; Telegram</td></tr>
<tr><td>Gmail app password</td><td>Email a to-do to yourself; booking proposals</td><td>Settings → Email-in</td></tr>
<tr><td>Garmin</td><td>Sleep, steps, heart rate. One sign-in, tokens kept</td><td>Settings → Garmin, then Health → Sync now</td></tr>
<tr><td>IMDb ratings</td><td>★ on films and series (free dataset, ~7 MB, downloaded only when you press the button)</td><td>Settings → Film &amp; series ratings</td></tr>
<tr><td>OMDb key</td><td>Optional extra film details</td><td>Settings → Voice &amp; assistant</td></tr></table>
<p>Set your <b>passport country</b> and <b>where you live</b> in <b>Settings → You</b> for the entry rules. Add the visas you hold in <b>Travel → Documents</b> (type "Visa").</p>
<h2>Your data</h2>
<ul><li>One SQLite file, <code>data/life.db</code>. Settings → Your data: <b>Export everything</b> (JSON + Markdown), <b>Download a backup</b> (to the Files app on iPhone), <b>Backup with key</b>.</li><li>A nightly backup keeps 14 days in <code>data/backups</code>.</li><li><b>Back up <code>data/fernet.key</code> too.</b> It encrypts passport numbers, health values, scans and the keys you entered. Lose it and those are unrecoverable, by design.</li></ul>
<h2>Run the tests</h2>
<pre><code>.venv\\Scripts\\python tests\\run_all.py          # everything (about 6 minutes)
.venv\\Scripts\\python tests\\run_all.py --fast   # syntax, unit and backend tests (about 30 s)</code></pre>
<p>They cover the backend, security rules, every page at desktop and phone size, Face ID with a virtual authenticator, touch gestures, offline mode and sync. A test also scans the repo for anything key-shaped.</p>
""")

PAGES["security.html"] = ("Security & privacy · Life", "How Life protects your data and what leaves your computer.", f"""
<h1>Security &amp; privacy</h1>
<p>Life is a single-user app on a computer you control. The design goal: <b>nothing leaves unless you chose it, and what does leave is small and named.</b></p>
<h2>Sign-in</h2>
<ul><li>Password hashed with PBKDF2-HMAC-SHA256, <b>600,000</b> rounds, per-password salt (older hashes upgrade automatically at the next sign-in). Login attempts are rate-limited.</li>
<li><b>Face ID</b> (passkeys / WebAuthn): the server checks the challenge it issued, the origin, the app identity, that the device verified <i>you</i>, and the ECDSA signature. Replays and forged requests are refused (tested).</li>
<li>With "Only open Life with Face ID" on, a session also needs a recent Face ID unlock, and the password stops working from the phone.</li>
<li>Session cookie: HttpOnly, SameSite=Lax, Secure over HTTPS. Every change-making request needs a CSRF token.</li></ul>
<h2>Your secrets</h2>
<ul><li>Keys you enter (OpenAI, Telegram, Gmail, Garmin) are stored <b>encrypted</b> (Fernet) and shown as "set"; they are never sent back to the browser, and are redacted from error messages and the health page.</li>
<li>Passport and ID numbers, health values and file scans are encrypted at rest. Garmin uses saved login tokens, not your password.</li>
<li>The repository contains no keys, tokens or passwords: <code>.env</code>, <code>data/</code> and key files are git-ignored, and a test scans every file for key-shaped strings.</li></ul>
<h2>Private links</h2>
<ul><li>The share Shortcut uses a <b>write-only</b> token: it can add things and read nothing. Calendar and Siri links are separate, read-only, unguessable, show only titles and dates, and can be reset any time. All are rate-limited.</li></ul>
<h2>The web side</h2>
<ul><li>Strict Content-Security-Policy (<code>script-src 'self'</code>), <code>X-Frame-Options: DENY</code>, <code>nosniff</code>, a Permissions-Policy, COOP, and HSTS when served over HTTPS.</li>
<li>No <code>innerHTML</code>: the interface is built from DOM nodes, so note text cannot inject markup. Uploads are type- and size-limited. Fetching a link only reaches public addresses (no internal network).</li>
<li>No analytics, no third-party scripts, fonts or trackers. Map tiles are the only third-party request, and only when you open a map.</li></ul>
<h2>What leaves your computer</h2>
<table><tr><th>When</th><th>Sent to</th><th>What</th></tr>
<tr><td>You share a post / ask the assistant / fill in details</td><td>Your AI provider (OpenAI)</td><td>The caption or slides you shared, or the question, after card and ID-like numbers are scrubbed</td></tr>
<tr><td>Entry rules</td><td>The airline's public visa service, then your AI provider</td><td>Three country codes (passport, residence, destination); then the returned rule text</td></tr>
<tr><td>Film details</td><td>Wikidata (and IMDb's ratings file, only when you press the button)</td><td>A film title</td></tr>
<tr><td>Place location</td><td>OpenStreetMap</td><td>A place name and city</td></tr>
<tr><td>Reminders</td><td>Apple/Google push, Telegram</td><td>The notification text</td></tr></table>
<p>Full details are in <code>PRIVACY.md</code> and <code>SECURITY.md</code> in the repository.</p>
<h2>Honest limits</h2>
<ul><li>Entry rules and costs are helpers, not advice: always confirm with the embassy or official site before you book.</li>
<li>Prices are estimates; areas and map pins are only filled when a post states them or OpenStreetMap knows the place.</li>
<li>Entry rules come from an airline's public visa web service that Life calls <b>unofficially</b> (a handful of requests per country, cached for a week, with polite spacing). It may change or block this at any time, and Life then simply shows nothing rather than guessing.</li>
<li>Instagram can hide captions or change its pages; Life then falls back to reading the slides, and finally to your Inbox.</li>
<li>Garmin's library is unofficial and may break; file import keeps working.</li></ul>
""")

for fn, (title, desc, body) in PAGES.items():
    nav = "".join(f'<a href="{h}"' + (' aria-current="page"' if h == fn else "") + f">{t}</a>" for h, t in NAV)
    open(os.path.join(DOCS, fn), "w", encoding="utf8").write(LAYOUT.format(title=title, desc=desc, nav=nav, body=body))
print("built", ", ".join(PAGES))
