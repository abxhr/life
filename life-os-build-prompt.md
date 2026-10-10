# BUILD PROMPT — "Life", my personal life-management app

> Paste everything below the line into a new chat. Fill in the `[FILL IN]` blanks in section 1 first (2 minutes). Everything else is written so the builder can start without further questions.

---

You are going to design and build **Life**: a private, single-user, all-in-one app that runs my daily life the way my existing wealth app runs my money. I'm the only user. It has to feel like it was made for exactly one person, me, so it should be opinionated, fast, calm and beautiful. It is not a generic productivity template.

Read this whole brief before writing code. Then do what section 14 says (a short batch of questions, then build in the phases of section 13). Don't ask me anything that has a stated default here.

---

## 1. About me (facts you should treat as given)

- Name / what the app calls me: `[FILL IN]`
- Lives in: `[FILL IN, e.g. Dubai, UAE]`. Timezone: `[FILL IN, e.g. Asia/Dubai]`. Home currency: `[FILL IN]`. I also think in USD and INR.
- Passport(s) / nationality: `[FILL IN]`. Residence status: `[FILL IN, e.g. UAE resident visa, expiry date]`.
- Phone: `[iPhone / Android]`. Home PC: `[Windows / Mac]`. **Work PC: `[Windows, locked-down corporate]` and it cannot reach anything outside the company network** (see section 8, this is the hardest constraint).
- Wearable: **Garmin** `[model]`.
- Work: `[role, company type, rough working hours, work week days]`.
- Things I already use: Gmail (IMAP app-password works for me; Google Cloud OAuth setup was painful, avoid it), Google Calendar `[yes/no]`, Telegram `[yes/no]`.
- I already built a **wealth tracker** (Flask + SQLite + vanilla JS, ApexCharts, installable PWA, left sidebar, password login, automated syncs via IMAP/IBKR/etc.). Life should feel like its sibling (section 11) and should be able to talk to it (section 9).

## 2. What Life is for

One place that answers, at any moment:

1. **What's today?** Schedule, tasks, reminders, what's due, what I should be doing now.
2. **What's on my mind?** Capture anything in under 3 seconds (notes, todos, ideas, links), from any device, and sort it later.
3. **How am I doing?** Mood, energy, sleep, activity, habits, goals, and what connects to what.
4. **Where am I going?** Life goals, trips, bucket lists, places I want to eat/see/play, visas and documents that make those possible.
5. **What should I do with this time?** When I'm bored, tired, free for two hours or have a weekend, it suggests something good from *my own* lists, not generic internet advice.
6. **Work, without the work network.** I can get work to-dos out of my head and into Life even though the work PC is isolated.

Success test: I open it every morning because it tells me something useful in five seconds, and I trust it enough to dump everything into it.

## 3. Hard requirements (non-negotiable)

1. **Private & single-user.** My data is passport/visa numbers, health data, mood, notes. Treat it as sensitive. No third-party analytics, no tracking scripts, no data sent anywhere except the specific integrations below.
2. **Works on phone, home PC, and (in a limited form) work PC.** Phone is the primary capture device; PC is the primary planning device.
3. **Installable PWA** with offline support: I can open it, read everything, and add things with no connection; changes sync when back online (see section 7).
4. **Fast.** Any screen under 200ms on local data. Capture is instant (optimistic UI).
5. **Own your data.** One-click full export (JSON + Markdown for notes) and automatic nightly local backup of the database with 14-day rotation. Everything importable back.
6. **Fail gracefully.** Every integration (Garmin, calendar, Gmail, AI) can break without taking the app down. Each shows "last synced / why it failed / retry" in a Data health panel, never a blank screen or stack trace.
7. **No browser `alert/confirm/prompt`.** In-app dialogs only (I had this exact bug in the wealth app).
8. **Accessible and honest UI.** Keyboard first on desktop, large touch targets on mobile, WCAG AA contrast in both themes, `prefers-reduced-motion` respected.

## 4. Architecture (recommended defaults, justify any deviation briefly)

- **Separate app and separate database from my wealth app.** Reasons: fault isolation, and the work-PC surface must never be able to reach financial data. They share the design language and talk through a small read-only API (section 9).
- **Stack to match my existing app** so I can maintain it: Python 3 + Flask, SQLite (WAL mode), vanilla JS front end (modular files, not one 2000-line file this time: `app.js` shell plus one module per feature), ApexCharts for charts, service worker, `manifest.json`. No heavy front-end framework unless you can make a strong case. Add a tiny test suite (pytest for backend, a Playwright smoke test that visits every page and fails on console errors).
- **Local-first sync model.** Every record has `id` (UUID), `updated_at`, `deleted_at` (soft delete). The client keeps a local copy (IndexedDB) and a write queue; the server is the source of truth; conflicts resolve last-write-wins per field, with notes keeping a version history so nothing is silently lost.
- **How I reach it from my phone, safely:** default recommendation is **Tailscale** (private network, no public exposure, free for personal use; use `tailscale serve` for HTTPS so the PWA, service worker and push work). The server runs on my always-on home PC or a small machine. Provide an alternative recipe for a cheap VPS behind a reverse proxy with HTTPS if I'd rather not keep a PC on. Give me exact step-by-step setup docs for both. Never recommend exposing the Flask dev server to the public internet.
- **Auth:** password login at minimum (PBKDF2, rate-limited, session cookies `HttpOnly`/`SameSite=Lax`/`Secure` when HTTPS). Add **passkey / WebAuthn** as an optional upgrade so the phone uses Face ID / fingerprint. Separate low-privilege **capture tokens** for the work-PC page and Telegram bot (can only add inbox items, can read nothing).
- **Secrets** (API keys, Garmin tokens, app passwords) live in a `.env`/settings store, never in git, never in the front end. Provide `.env.example`.
- **Sensitive fields** (passport/visa/ID numbers, health records) are encrypted at rest (e.g. Fernet with a key from env) and masked in the UI by default (show last 4, tap to reveal). Store scans of documents in an encrypted folder, not in the DB blob.
- **Background jobs:** a small scheduler thread (as in my wealth app) for syncs, reminder dispatch, nightly backup, daily snapshot, weekly digest generation.
- One command to run (`run.bat` / `run.sh`) and an optional install-as-background-service script for Windows (I already do this with the wealth app).

## 5. Information architecture

Left sidebar on desktop; compact top bar plus bottom tab bar (5 slots + "More") on mobile. A persistent floating **Capture** button on mobile (bottom-right above the tab bar) and `Ctrl/Cmd+K` command palette and `C` hotkey on desktop. Global search across everything.

Primary sections:

1. **Today** (home)
2. **Inbox** (unsorted capture)
3. **Tasks** (personal, with Work as a separate context)
4. **Calendar** (schedule + reminders + time blocking)
5. **Notes**
6. **Lists**
7. **Goals** (with habits)
8. **Travel** (map, trips, visas, documents)
9. **Health** (Garmin, mood)
10. **Assistant** (AI)
11. **Review** (weekly/monthly/yearly)
12. Settings, Data health, Export/backup

Keep it to these; deeper features live inside them.

## 6. Features in detail

### 6.1 Today (the home screen: the "one memorable element" is a single calm sentence + the next thing)
Top to bottom:
- **Greeting + a one-line "briefing"** written by the AI from real data: e.g. "Thursday. 3 meetings, first at 10:00. Passport renewal reminder is due. You slept 5h50, so go easy: pick one big thing." Regenerates once in the morning, cached, with a "refresh" action. If AI is unavailable, fall back to a rule-based line.
- **Now / Next**: the current calendar block or the next one, plus the single most important task ("the one thing").
- **Time-aware timeline** of today: events, reminders, time-blocked tasks, as a vertical day strip.
- **Due & overdue** (tasks, reminders, bills from the wealth app, document expiries).
- **Mood check-in** (a 5-second inline control, once per day; more on this in 6.9).
- **Habits** for today as tap-to-complete chips with streaks.
- **Health strip**: last night's sleep, body battery/readiness, steps so far, last activity (if Garmin synced).
- **"What should I do?"** card (see 6.12).
- **Motivation** line (see 6.11), small and quiet.
- Evening mode (after a configurable time) swaps the layout to a **shutdown review**: what got done, what rolls over, tomorrow's top 3, one gratitude line.

### 6.2 Inbox & quick capture
- Capture sheet: one text box, auto-focused. Type anything. Smart parsing as I type, with the parsed result shown as removable chips *before* saving: `tomorrow 3pm`, `every monday`, `#work`, `@home`, `!high`, `in 2 weeks`, `+Japan trip`. Natural-language dates are mandatory.
- Voice input (browser speech API where available) and **share-target** so I can share a link/text from my phone's share sheet into Life (PWA `share_target`).
- Paste a URL: fetch title/description, save as a link note.
- Everything lands in **Inbox**. Inbox view = triage mode: one card at a time, swipe/keys to turn it into a task, note, list item, reminder, goal, or delete; the AI proposes a destination and I confirm with one tap.
- Capture also works via the **Telegram bot** and the **work capture page** (sections 8 and 9).

### 6.3 Tasks (personal + work)
- Fields: title, notes, due date/time, scheduled date (when I'll do it, distinct from due), duration estimate, priority, context (`personal` / `work` / `work-outside-work` / `errands` / `home`), project, tags, subtasks, recurrence (daily/weekly/monthly/custom, "after completion" variant), reminder(s), location (optional), linked goal/trip/note.
- Views: **Today**, **Upcoming**, **Anytime**, **Someday/Maybe**, **By project**, **By context**, **Done log**. Board view for projects.
- **Work contexts matter:** I want separate "Work" and "Work stuff to do outside work" (things I need to prepare, read, learn, or send when I'm not at the office). Work tasks have a visible work/personal switch in the header so I can hide one while in the other mode. Work mode is a first-class toggle that also filters Today, Calendar and search.
- Planning aids: drag a task onto a time slot in the calendar to time-block it; "plan my day" (AI suggests an order using estimates, energy and deadlines, I accept or tweak); overdue tasks get a gentle "reschedule / drop / do it now" triage, never a wall of red.
- Recurrence and reminders must be rock solid and tested (DST, month-ends, timezone travel).

### 6.4 Calendar, schedules & reminders
- Day / week / month / agenda views. Create events and time blocks natively.
- **Read-only import of my calendars via ICS subscription URLs** (secret iCal address from Google Calendar; works without OAuth). Support several feeds with colour and a work/personal tag. Refresh every 15–30 min. Optional later: Google Calendar API write-back, only if easy.
- Reminders are first-class: one-off, recurring, **location-free** to keep it simple, snooze (10 min / 1 h / tomorrow morning / pick), and escalating nags for the ones I mark critical (re-notify until acknowledged).
- Delivery channels, configurable per reminder: **web push** (PWA; note that iOS requires installing to Home Screen), **Telegram bot message** (the most reliable fallback; default for "critical"), email digest, and in-app. Include a "test notification" button in Settings and show per-channel health.
- **Daily agenda** push at a time I choose; **quiet hours** respected (except critical).
- Auto-reminders generated from data elsewhere: document/visa/passport expiries (180/90/30/7 days), birthdays, trip departure (T-7, T-1, T-3h), bills due (from wealth app), warranty ends, vaccination due, "haven't called Mum in 3 weeks".
- Time-blocking and a **focus timer** (Pomodoro-style, optional) that logs focused minutes per task/project.

### 6.5 Notes
- Fast, calm, Markdown-based editor with a clean rendered view. Title optional. Pin, archive, tags, folders, **backlinks** (`[[wiki links]]`), checklists, attach images/PDFs, code blocks, tables.
- Note types/templates: plain, meeting note, daily journal, trip note, book/movie note, decision log, ideas.
- **Daily note** auto-created each day (date-titled) for a quick journal; prompts optional (gratitude, one win, one lesson).
- Full-text search that's instant (SQLite FTS5) and also searches attachments' filenames.
- Version history per note (last 20 versions).
- AI actions on a note (summarise, extract tasks, clean up, turn into a list, translate), always showing the result for approval before saving.
- A **Work notes** space (tagged `work`) that is hidden when work mode is off.

### 6.6 Lists (flexible, beautiful, and a big deal for me)
A list is a typed collection with custom fields per list type. Provide these built-in list types, and let me create my own types:

- **Things to do** (life to-do's that aren't tasks: "learn to swim", "fix the bike") with effort/cost/energy tags.
- **Things to eat / dishes to try / foods I love**
- **Restaurants (must-go)**: name, cuisine, city/area, price tier, who with, occasion, source (who recommended), status (`want to go` / `been, loved` / `been, meh`), my rating, notes, photos, map link, **"book it"** shortcut (opens maps/phone), and **"nearby right now"** sort when I allow location.
- **Countries to go (bucket list)**: tied to the Travel module (section 6.8); a country marked "want" appears on the world map.
- **Places to play** (sports courts, activity spots, game venues, parks, anything fun I want to try or return to; I'll define the sports/activities I care about in Settings, default list: padel, football, tennis, badminton, bowling, karting, hiking, beach, board games): fields: sport/activity, venue, area, price, best time, who I go with, rating, booking link.
- **Movies & shows, books, podcasts, music, games to try**
- **Gift ideas** (per person), **shopping/wishlist** (with price, link, and "buy when it drops below X"), **grocery** (a shared-feel quick list with aisle/category grouping), **packing templates**, **learning/skills**, **ideas**.
- Each list supports: grid / table / map / board views, filters, sort, random pick ("surprise me"), share as a clean text/Markdown, drag-reorder, and "done" with a date and a note ("went to X on 12 Mar, loved the tiramisu").
- Items can be dragged/linked into a trip, goal or calendar event.
- A restaurants/places list should show a **map view** (Leaflet + OpenStreetMap tiles, no API key) with pins.

### 6.7 Goals & habits
- **Life areas ("wheel of life")**: health, career, money, relationships, family, learning, fun/adventure, home, spirituality/peace `[editable]`. I rate each 1–10 monthly; the wheel is shown over time so I can see what I'm neglecting.
- **Goals**: title, why it matters (required, shown later as motivation), area, deadline, measurable target (numeric or checklist), progress, milestones, linked tasks/habits/notes, status (active/paused/achieved/dropped), and a **quarterly focus** (max 3 active "big goals", the UI gently resists more).
- **OKR-ish layer** (optional toggle): objective → key results with progress.
- **Money goals pull live numbers from my wealth app** (e.g. "Net worth AED X by Dec 2027") with a projected-date estimate. Health goals pull from Garmin (e.g. "run 100 km this month", "average 7.5 h sleep").
- **Habits**: daily/weekly/n-times-per-week, tap to complete from Today, streaks that forgive one miss ("streak shield"), heatmap per habit, best-day-of-week insights. Link habits to goals so progress is visible.
- **Wins log**: a running list of things I achieved, auto-fed by completed goals/milestones/PRs, and manually addable. It powers the motivation features.
- **Vision & values page**: my own words: who I'm becoming, my values, my "why," my 5-year picture, a few personal rules. Editable, shown in rotation on Today (6.11).

### 6.8 Travel (a whole module, treat it as a product)
**a) Map of the world**: an interactive world map (offline-capable SVG/TopoJSON, no API key) coloured by status: **been**, **lived**, **want to go**, **planned**, with tap to open a country page. Counters: countries visited, % of world, continents, UN-recognised count, total days abroad, total distance flown (computed from trips), places by year. A "scratch map" feel is nice. Also city-level pins (Leaflet) for cities visited and wishlist cities.

**b) Country page**: status, **when I went** (multiple visits), what I did, favourite things, photos, spend, notes, rating, who I went with, what I'd do next time; "want to go" fields: why, best season, rough budget, visa difficulty for my passport(s), flight time from home, things to do/eat (linking to list items).

**c) Trips**: planned, upcoming, past. A trip has dates, destinations (multi-city), travellers, purpose, budget, status, and tabs:
- **Itinerary** (day-by-day timeline, drag to reorder, map per day)
- **Bookings** (flights, hotels, trains, car, activities, insurance) with confirmation numbers, times, terminals, check-in links; **auto-import from Gmail** by parsing confirmation emails (I already have IMAP set up in the wealth app: reuse that approach with a dedicated label/folder like "Travel"), always showing a review step before saving
- **Documents** (tickets, e-visas, insurance, hotel vouchers) stored offline on the phone for airport use
- **Packing list** (templates by trip type and weather; reusable; tick off; weather-aware suggestions)
- **Budget & spend** (planned vs actual, multi-currency with live FX; optionally push the totals to the wealth app as a "travel" category)
- **Pre-trip checklist** auto-built from the destination: passport validity, visa, vaccinations, insurance, currency/card setup, eSIM, power adapter, offline maps, airport transfers
- **Trip journal** and photos; after the trip, a **trip recap** page (days, distance, spend, highlights) that updates the world-map stats
- **Calendar sync**: trip appears as a banner/events in Calendar, and countdown on Today.

**d) Visas & travel documents (high-value, build carefully):**
- Document vault: **passport(s), national IDs, residence visa/permit, Emirates ID (or equivalent), driving licence(s), travel insurance, vaccination certificates, frequent-flyer numbers, loyalty programmes, e-visas, ETIAS/ESTA/eTA authorisations**. For each: type, number (encrypted, masked), issue/expiry dates, issuing authority, entries allowed, duration of stay, scan/photo (encrypted storage), notes.
- **Expiry radar**: timeline of all expiries with reminders at 180/90/30/7 days; flags a passport that will have <6 months validity at a planned trip's date.
- **Visa requirement helper**: for any destination country and each of my passports, show a status (visa-free / visa on arrival / e-visa / visa required / unknown), allowed stay, and a link to the **official government source**. Important: visa rules change, so do **not** ship hard-coded rules as truth. Either (a) let me record the rule myself when I research it, showing "last verified on <date>" and flagging stale entries (> 6 months), or (b) pull from a documented dataset with a stated source and date, with a clear "verify with the embassy/official site before booking" notice. Never present guesses as fact.
- **Schengen 90/180-day calculator** from my logged entries/exits, with remaining days and the date a new window opens; same for other counted-stay regimes (UK 6 months, etc.) as configurable rules.
- **Visa applications tracker**: applied date, reference, status, appointment dates, documents checklist, fees, expected processing time, reminders to follow up.
- **"Where can I go?"**: given a date range, budget, flight-time limit and passport, suggest countries from my bucket list that are visa-easy right now, plus best season, and show how many leave days I'd need (links to my work calendar and leave balance below).
- **Leave balance** tracker (annual leave, public holidays for my country, carry-over) that suggests "bridge" opportunities to turn few leave days into long trips.

### 6.9 Health (Garmin overview + how I feel)
Keep this light: *overall picture, not a fitness lab.*
- **Garmin sync, read-only, daily (plus on-demand refresh):** steps, resting heart rate, sleep duration and score, stress, body battery, HRV status, weight if logged, VO2 max, training status/readiness if available, and a list of recent activities (type, date, distance, duration, avg HR, calories). Be honest in the docs about how: **Garmin's official Health API is only for approved business partners**, so for a personal app use the community `garminconnect` Python library (it logs in with my Garmin credentials/tokens, supports MFA, caches tokens). It is unofficial and can break, so wrap it in the "fail gracefully" pattern, store only derived daily summaries (not raw credentials in plain text), and provide a **fallback of manual import** (Garmin Connect CSV export or `.fit`/`.tcx` file upload, parsed locally) so the module still works if the library breaks. Sync every ~3–6 h; show "last synced".
- **Health overview page**: today's strip (steps, sleep, readiness), 7/30/90-day trends as sparklines, a clean recent-activities list, weekly totals (active minutes, distance), and simple streaks. No clutter: five numbers and three charts max above the fold.
- **Mood & energy check-in**: a one-tap 1–5 mood, 1–5 energy, optional emotion tags (calm, anxious, motivated, tired, grateful, stressed, bored, social, lonely...), optional one-line note; up to 3 prompts a day if I enable them (morning/afternoon/evening). History as a calm timeline/heatmap.
- **Insights that earn their keep**: correlate mood/energy with sleep, steps, workouts, caffeine/alcohol tags, spending, weather, work load, and weekday. Present as plain sentences ("On days after <6.5 h sleep your mood averages 2.8 vs 3.9"), with sample size and a "this is a pattern, not a diagnosis" note; require a minimum n before showing anything.
- **Manual logs** (quick, optional): water, caffeine, alcohol, weight, medications/supplements, symptoms, pain, cycle/health notes `[toggle]`.
- **Health admin**: appointments, vaccination due dates, prescription refills, insurance details, doctor contacts, blood-test results (just values + dates + file attachments, with simple trend charts).
- Privacy: health data is the most sensitive; encrypt at rest, exclude from AI context unless I explicitly enable it per feature, and show exactly what is sent when I do.

### 6.10 Assistant (AI built into everything)
- **Chat page** plus a **context-aware assistant sheet** (opens from anywhere with `Ctrl/Cmd+J` or a button) that knows which screen/item I'm on.
- Use the **Anthropic API** (Claude) via a server-side proxy so the key never reaches the browser. Model name must be configurable in Settings/env (do not hard-code a model); default to the latest capable Sonnet-class model, with a cheaper fast model for classification/parsing and a stronger one for planning/weekly review. Streaming responses. Respect rate limits and show friendly errors. Add a monthly **usage/cost meter** and a hard cap I can set.
- **Tool use (it must be able to act, not just chat):** create/update/complete tasks, create reminders and events, add notes, add items to lists, log mood, mark places as visited, create trips, query the calendar, search notes, read health summaries (only if enabled), fetch goal progress, query the wealth app summary (read-only). Every mutating action shows a **confirm card** ("Create task 'Renew passport' due 3 Nov: Confirm / Edit / Cancel"), with an optional "auto-approve low-risk actions" setting. Everything the assistant did is logged and undoable.
- **Grounding:** answers must come from my data where relevant ("what restaurants have I saved in Rome?", "when does my UAE visa expire?", "what did I do last Friday?"). Cite which items it used, link to them, and never invent personal data. When it doesn't know, it says so.
- **Proactive jobs** (opt-in, each toggled separately): morning briefing, evening shutdown prompt, weekly review draft, "you've got a 3-hour gap and low energy: here's a suggestion", trip prep nudges, gentle accountability on goals I flagged, and "noticed you've said 'stressed' 4 times this week: want to talk about it or plan a lighter week?".
- **Persona/tone setting:** warm and direct, not preachy or cheesy; I can choose a style (coach / friend / no-nonsense) and what topics it should push on. It must not give medical, legal, financial or visa advice as authoritative: it flags uncertainty and points to official sources.
- **Memory:** a visible, editable "What the assistant knows about me" page (preferences, dietary notes, favourite cuisines, values, constraints). Nothing hidden. I can delete any memory.
- **Privacy controls:** a per-module toggle for what data the assistant may see, and a "preview exactly what will be sent" view for any request. Strip passport/ID numbers and financial account numbers before sending, always.
- Quick-capture parsing and triage suggestions should use the AI but have a **non-AI fallback** (regex/date parser) so capture never fails offline or when out of credit.

### 6.11 Motivation (useful, not cringe)
- A rotating line on Today drawn from, in order of priority: **my own words** (vision, values, why-statements, notes-to-self written in good moments), **my own wins** ("3 weeks ago you finished X"), progress facts ("you're 62% to your goal and ahead of pace"), then a short curated quote library `[editable, ~200 quotes, categories: discipline, calm, courage, curiosity, perspective]`.
- **Notes to future me**: write a message to be delivered on a chosen date or when my mood has been low for 3 days.
- **Streaks and momentum** shown positively; "bad days" mode that reduces the app to one thing when I've been low (fewer prompts, easier tasks, a gentle line).
- **Weekly "what went well"** surfaced in the review.
- **Anti-guilt design:** never shame missed days; always show a path back ("one small thing today").
- Optional morning ritual: breathing/focus minute, intention for the day (one sentence), and the one task.

### 6.12 "What should I do?" (decision helper)
A card on Today and a full screen. Inputs (all optional, pre-filled from context): time available, energy (1–5, default from today's check-in/sleep), mood, where I am (home / out / work / travelling), company (solo / partner / friends / family), budget, weather, time of day.
It then ranks suggestions from **my own data**: overdue or high-priority tasks that fit the time, a goal's next small step, a habit not done yet, an item from "things to do", a restaurant or activity on my lists that fits the context, a trip-planning micro-step, someone I haven't contacted in a while, a reading/learning item, rest/recovery when readiness is low. Show 3 options with a one-line reason each, a **"surprise me"** button, a **"not this"** feedback button (it learns), and one-tap to schedule or start. Weekend mode proposes a mini-plan for Saturday/Sunday.

### 6.13 Review & reflection
- **Weekly review** (Sunday evening by default): auto-assembled page with what I completed, habits, mood/energy chart, sleep and activity summary, spend highlight from the wealth app, trips/visa dates coming, inbox cleared?, three prompts (what went well / what drained me / what's my one focus next week), then I set next week's top 3. Saved as a note.
- **Monthly**: life wheel rating, goal progress, wins, and a short AI-written summary.
- **Year-in-review** (and a mid-year one): countries visited, distance, activities, best weeks, mood arc, habits, books, restaurants tried, wins, money progress. Beautiful, shareable-to-me as an image/PDF. This is the "memorable" payoff screen.

### 6.14 Other things I'd actually use (include these; ask me to rank them if scope has to be cut)
1. **People** (lightweight, not a corporate CRM): birthdays, anniversaries, how I know them, last contact date, "keep in touch every N weeks", gift ideas, important details (kids' names, allergies, preferences), and nudges.
2. **Documents & warranties vault** beyond travel: insurance policies, car registration, lease, receipts, warranties with expiry reminders, manuals, important phone numbers.
3. **Home & car maintenance**: recurring items (AC service, car service/registration/insurance renewal, filter changes) with last-done dates and costs.
4. **Subscriptions & renewals**: shown read-only from the wealth app (so no duplicate entry); renewal dates appear in Today and Calendar.
5. **Learning**: books/courses/skills with progress, highlights and notes, spaced-repetition mini review for key notes.
6. **Meal ideas & weekly plan** linked to the "things to eat" list and grocery list, plus a "what's for dinner" suggester.
7. **Decision log**: record important decisions with reasoning and expected outcome, then revisit them later to learn.
8. **Someday/maybe** parking lot that is reviewed monthly so ideas don't clutter tasks.
9. **Weather + commute-aware nudges** (open-meteo, no key): rain tonight means moving the padel session; heat advisory means moving the run.
10. **Emergency card** (offline, behind a PIN): blood group, allergies, emergency contacts, insurance numbers, embassy contacts per country I'm in.
11. **Expense quick-add from Life into the wealth app** ("spent 45 AED on lunch") via its API, if the wealth app supports it, otherwise skip.
12. **Digital cleanup & admin**: recurring "life admin" checklists (annual: renew passport/insurance/domain names, review subscriptions, update will/beneficiaries, medical check-up).
13. **Photo/memory prompts**: "on this day" from trip photos and journal.
14. **Focus & distraction guard**: simple "deep work" mode that hides everything except the one task and timer.
15. **Saved links/read-later** with highlights and AI summary, plus reading time.
16. **Voice notes** transcribed locally or via API (optional).
17. **Gratitude and "good things" jar.**
18. **Shared read-only views** (e.g., send a trip itinerary or a restaurant list to a friend as a clean, expiring link) without exposing anything else.

## 7. Offline & sync behaviour (phone and PC)

- The PWA caches the shell and recent data; IndexedDB holds a working copy of tasks, notes, lists, goals, trips, visas/documents (metadata), and the last 90 days of calendar and health summaries.
- Writes made offline go to an outbox and sync with retry/backoff; the UI shows a subtle "N changes waiting" indicator. Conflicts resolve as described in section 4 and are visible in a "Sync log".
- The service worker must update cleanly (I once had a stale-cache bug; show "Update available, tap to refresh" and never leave users on old JS).
- Travel mode: one toggle that pre-downloads the next trip's itinerary, documents, maps tiles for the destination (limited area), and packing list for offline airport use.

## 8. The work PC problem (read carefully: the hardest constraint)

**Facts:** my work PC is on a corporate network and **cannot reach anything outside it**. So the work PC cannot open my home server, a VPS, Telegram, Tailscale, or any public site. It may also be monitored and managed by IT. I want to type work to-dos while at my desk and have them end up in Life.

**Rules to design around:**
- Do **not** try to bypass company network controls, install unapproved software, tunnel, or exfiltrate company data. That could get me in trouble and is out of scope. Design only for things I'm allowed to do and make that explicit in the docs: include a short "check your company's IT/security policy" note and keep what goes into Life limited to *my own to-do reminders*, not confidential company information (a to-do like "send Q3 deck to finance" is fine; pasting client data is not).
- The work PC may not let me install anything. So everything for it must be a **single self-contained local HTML file** (no server, no CDN, no external requests, no install) that I can put on the desktop or in a browser bookmark/`file://` location, or, if allowed, hosted inside the company intranet.

**Build "Work Capture" as a tiered solution, and tell me clearly which tier works on my network after I test:**

1. **Tier 0: Offline Work Capture page (baseline, always works).** One `work-capture.html` file: a fast to-do list with add/edit/complete, quick tags (`#today`, `#waiting`, `#outside-work`), due dates, reminders (visible in the page), notes, and **local persistence** in browser storage (and an optional export-to-file button). It looks like part of Life. Generate it from the app (a download button in Settings → "Work capture"), with a unique capture token and the same visual design.
2. **Tier 1: "Send to phone" without any network: QR hand-off.** The Work Capture page can show my pending items as a **QR code (or a sequence of QR codes) that my phone's Life app scans with its camera**, importing them into the Work context / Inbox. No cable, no network, no files leaving the PC. Also a plain "copy as text" button as an even simpler fallback. Include checksums and de-duplication so repeated scans don't create duplicates. Optionally the phone can show a QR that the work page's webcam scans to send things back (only if the webcam is allowed; skip if not).
3. **Tier 2: Direct sync, only if my network allows it.** If the work network can reach one specific URL (e.g., through the normal web proxy to a domain I own on HTTPS), the Work Capture page can POST new items to a **write-only capture endpoint** with a revocable token (rate-limited; can only add inbox items; can read nothing). Provide a "connection test" button that tells me clearly: *reachable / blocked / needs proxy*. If it fails, the page automatically falls back to Tier 0/1 and keeps everything locally.
4. **Tier 3: Email-in (only if policy allows and only for non-sensitive to-dos).** A dedicated personal address (e.g., a Gmail alias or label I read via IMAP) where I can email a one-liner to-do from a personal device. Note: do **not** recommend emailing from a *work* account to a personal one unless I confirm it's allowed.
5. On my phone and home PC, a **Telegram bot** and the share-sheet give instant capture too (they don't help the work PC, but they cover "I thought of a work to-do while commuting").

**Security of the capture surface:** it must never be able to read my notes, health, travel or wealth data. Capture tokens are write-only, scoped, revocable, and logged. The work page must work with zero external requests.

I'll test which tier works on my network. Document how, and make the app show which tier is active.

## 9. Integrations summary (and how each can fail)

| Integration | How | Notes / fallback |
|---|---|---|
| Garmin | `garminconnect` (unofficial) + manual CSV/FIT import | May break; show status; keep derived data only |
| Calendars | Secret ICS URLs (read-only) | No OAuth needed; refresh 15–30 min |
| Gmail | IMAP + app password (same as wealth app), specific labels: `Travel`, optionally `Life` | Used for travel confirmations and bill dates; always with a review step |
| Wealth app | Read-only JSON endpoints (net worth, goals progress, upcoming bills/renewals/card dues, monthly budget status) behind an API token; optional write for quick-add expense | If unreachable, Life hides those cards silently and shows nothing broken |
| AI | Anthropic API via server | Non-AI fallbacks for parsing and briefings; cost cap |
| Telegram | Bot with a single allowed chat ID | Capture + reminders + daily agenda |
| Push | Web Push (VAPID) | iOS needs Home Screen install; Telegram is the fallback channel |
| Weather | open-meteo | No key |
| Maps | Leaflet + OSM tiles; world map as static TopoJSON | No keys; works offline for the world map |
| FX rates | Same source as wealth app if possible | Cached |

## 10. Data model (starting point; refine as needed, use migrations)

`users/settings`, `inbox_items`, `tasks` (+ `subtasks`, `task_recurrence`), `projects`, `tags`, `events` (+ `calendar_feeds`), `reminders` (+ `reminder_deliveries`), `notes` (+ `note_versions`, `note_links`, FTS table), `lists`, `list_types` (custom field schema as JSON), `list_items`, `goals` (+ `milestones`, `key_results`), `habits` (+ `habit_logs`), `life_areas` (+ `area_ratings`), `wins`, `vision_items`, `mood_logs`, `manual_health_logs`, `garmin_daily`, `garmin_activities`, `health_records`, `countries` (status, notes), `visits`, `cities`, `trips` (+ `trip_days`, `bookings`, `trip_documents`, `packing_items`, `trip_expenses`), `travel_documents` (encrypted fields), `visa_rules` (user-maintained with verified_on + source URL), `visa_applications`, `stay_logs` (entries/exits for 90/180 counts), `people`, `vault_documents`, `maintenance_items`, `assistant_conversations`, `assistant_actions` (audit/undo log), `assistant_memory`, `capture_tokens`, `sync_state` (per integration last_ok/last_error), `backups`, `audit_log`.
Every table: `id` UUID, `created_at`, `updated_at`, `deleted_at`.

## 11. UI / UX direction (this is a make-or-break part; "the perfect UI")

**Concept: "the day, quietly."** Life is the sibling of my wealth app ("the ledger"): same family, different mood. Wealth is a printed ledger; Life is a calm personal journal/planner. Quiet, paper-like surfaces, one memorable element per screen, generous space, hairline rules, almost no chrome. It should feel like a premium physical notebook, not a SaaS dashboard. No glassmorphism, no neon gradients, no glow, no stock illustrations, no emoji as icons (use a consistent line-icon set; you may use emoji only where *I* put them in my own content).

Reuse my wealth app's design system as the base so both feel related. Its tokens are: light bg `#ECEEE9`, panel `#F7F8F5`, ink `#12201A`, accent ultramarine `#2C3FD8` (dark mode: bg `#0F1411`, panel `#161C18`, ink `#E9EFEB`, accent `#8E9BFF`); gain/loss/watch `#0E7C5A`/`#C2352E`/`#B4690E` (dark `#4FD1A0`/`#FF7A70`/`#E8A94A`); **Bricolage Grotesque** for display, **Geist** for everything else; radii hierarchical (controls 7px, panels 10px, dialogs 14px); flat panels with hairlines; accent reserved for primary actions, active nav and the single "you" series in a chart; sentence-case labels; motion only in response to actions plus a single hero reveal on load. For Life, keep these but give it its own identity: use a **warmer paper tone** and a **secondary accent per domain** used only for tiny markers (e.g., travel = teal, health = coral, work = slate, goals = ochre) so I can tell contexts apart at a glance without a rainbow. Light and dark themes (follow system, with a manual toggle); validate contrast in both.

**Layout rules**
- **Desktop:** left sidebar (sections + a persistent capture box at the top + work/personal mode switch at the bottom), main content max ~1100px, optional right "context" rail (e.g., a task's details, note backlinks, the assistant sheet). Command palette (`Ctrl/Cmd+K`) that does navigation, create, search and "ask the assistant". Full keyboard model (list it in a `?` shortcuts sheet): `C` capture, `T` new task, `N` new note, `G then T/N/L/...` go-to, `J/K` move, `E` edit, `X` complete, `1–5` priority, `/` search.
- **Mobile (designed first, not squeezed):** bottom tab bar with 5 slots (Today, Tasks, Capture [centre, prominent], Calendar, More); thumb-reachable actions; pull-to-refresh; swipe actions on rows (complete, snooze, delete) with undo; bottom sheets instead of modals; large 44px+ targets; safe-area insets; no hover-only affordances; forms use the right input types and keyboards; works one-handed.
- **Today** has one clear hierarchy: the calm briefing sentence and the "one thing" are the hero; everything else is quiet and scannable.
- **Travel** gets the most visual love: the world map is the hero element with a satisfying "scratched-off" state, subtle animated draw-in on first load, tasteful photo use, a country page that feels like a passport page (stamp motif used sparingly, not kitschy).
- **Empty states** teach and invite (one sentence + one action), never blank. **Error states** are human. **Loading** uses skeletons, not spinners, and never layout-shifts.
- **Micro-interactions** that earn their place: satisfying task-complete (tiny strike + count-up), streak chip pulse, map country fill, haptic feedback on mobile where available. Everything respects reduced motion.
- **Typography scale and spacing system** defined once as CSS variables (4px base grid); tabular numerals for numbers; a readable 16px minimum for body on mobile.
- **Charts** (ApexCharts or hand-made SVG): one accent series, neutral supporting ones, direct labels, same fonts as the UI, sparklines for trends, no 3D, no pie/donut unless it truly is parts-of-whole with ≤4 slices.
- **Density control:** comfortable / compact setting.
- **Personalisation:** reorder/hide Today widgets; choose which sections appear in the mobile tab bar; set work hours; set accent preference.
- **Copy/voice:** short, human, specific, never corporate ("3 things left" not "You have 3 outstanding items").

Before building screens, produce a short **design spec page inside the repo (`DESIGN.md`)** with tokens, type scale, components, and the do's and don'ts above, and a **component gallery page** (`/_styleguide`) so I can review every component in both themes before the feature screens are built. Use the available design skills (frontend-design, impeccable, ui-ux-pro-max, hallmark, dataviz) if they exist in the environment.

## 12. Quality bar

- **No fake data in production paths.** Seed data only via an explicit "load demo data" button in Settings, clearly labelled, removable in one click.
- **Tests:** unit tests for recurrence, natural-language date parsing, Schengen 90/180 calculation, visa/passport validity checks, sync conflict rules, and the QR hand-off encode/decode. A Playwright run that logs in, visits every page on desktop and a 390px viewport in both themes, opens every modal/sheet, performs capture, and asserts **zero console errors**. Run it before you tell me anything is done.
- **Time handling:** store UTC, display in my timezone, handle DST and travelling (events can be "floating" or "fixed to timezone").
- **Security checklist** before calling it done: auth on every route, CSRF protection on mutating routes, output escaping (no XSS from notes/links), input validation, upload type/size limits, rate-limited login and capture endpoints, no secrets in logs, dependency pinning, and a short threat-model note.
- **Performance:** paginate/virtualise long lists; FTS for search; index the common queries; lazy-load the map and charts.
- **Docs:** `README.md` (run, configure, back up, restore), `SETUP-PHONE.md` (Tailscale + install PWA + push on iOS/Android), `SETUP-WORK-PC.md` (the tiers, how to test each), `SETUP-GARMIN.md`, `SETUP-TELEGRAM.md`, `PRIVACY.md` (what leaves the machine and when).

## 13. Build plan (phases; finish and verify each before the next, and show me screenshots at the end of each)

1. **Foundation:** repo skeleton, DB + migrations, auth, settings, design tokens, app shell (sidebar / mobile bar), component gallery, PWA + service worker + offline shell, backup/export, Data health page, test harness.
2. **Capture & Inbox & Tasks & Reminders:** quick capture with natural-language parsing, inbox triage, tasks (all views, recurrence, work/personal mode), reminders with push + Telegram delivery.
3. **Calendar & Today:** ICS import, native events/time-blocking, the Today screen, evening review mode.
4. **Notes & Lists:** editor, FTS, backlinks, daily note, all list types incl. restaurants/places with map views.
5. **Work Capture (all tiers) + sync hardening:** the offline HTML file, QR hand-off, optional direct sync, connection tester, offline outbox/conflict handling.
6. **Goals, habits, motivation, "What should I do?":** life wheel, goals with live links, habits, wins, vision, decision helper.
7. **Travel:** map, countries, trips, bookings (+ Gmail import), documents vault, visas, stay counter, expiry radar, leave planner.
8. **Health:** Garmin sync + manual import, overview, mood/energy check-ins, insights, health admin.
9. **Assistant:** chat, context sheet, tool use with confirm cards, memory page, proactive jobs, cost cap, privacy preview.
10. **Review & extras:** weekly/monthly/year-in-review, then the section 6.14 extras in the order I rank them.
11. **Hardening:** security pass, accessibility pass, performance pass, full test run, docs, and a "fresh install on a clean machine" walkthrough.

## 14. How to start

1. Ask me **one batch of at most 8 questions** covering only what's truly blocking (e.g., my passport/nationality and the visa data source I prefer, phone type, whether Telegram is OK, which hosting option I'll use, which of the 6.14 extras to prioritise, my work week and hours, and what "play" means to me: sports, venues, games, outings). If I don't answer, use the defaults stated in this brief and tell me what you assumed.
2. Then write `DESIGN.md` and the architecture note (one page), show me the plan, and **start building Phase 1** without waiting for further approval, then continue phase by phase.
3. After each phase: run the tests, run the Playwright smoke test on desktop and mobile in both themes, send me screenshots, list what works and what doesn't, and commit to a git branch with clear messages. Be honest about anything unfinished or untested; do not claim an integration works until you've exercised it (for integrations that need my credentials, say plainly that you could not test live and give me the exact steps to verify).
4. Treat this brief as the spec; where something is ambiguous or you think a different approach is clearly better (especially around the work PC, Garmin and visa data, where the constraints are real), say so briefly and propose the change rather than silently deviating.
