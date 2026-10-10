# Life — your day, quietly

A private, single-user life manager that looks and feels like a notebook: ruled paper, a red margin line, a spiral-bound spine, handwritten type (Gaegu, self-hosted). One place for *today*, *what's on my mind*, *how I'm doing*, *where I'm going*, *what to do with this time*, and *work to-dos from a locked-down PC*.

Flask + SQLite (WAL) + vanilla JS. Installable PWA, offline-first (IndexedDB + outbox), no framework, no analytics, no third-party requests (fonts, maps' world shapes, charts and QR code libraries are all vendored).

## Run it (Windows)

```bat
run.bat
```
First run creates `.venv`, installs `requirements.txt`, and starts the server on <http://127.0.0.1:5055>. Open it and choose a password (8+ characters). `run.sh` does the same on Mac/Linux.

Optional: copy `.env.example` to `.env` and fill in only what you use (Telegram, Anthropic, Gmail, Garmin). Everything works without any of them; each integration fails soft into **Settings → Data health**.

Run it as a background Windows service the way you do the wealth app (NSSM): program `…\.venv\Scripts\python.exe`, arguments `app.py`, start directory = this folder.

Reach it from your phone: **[SETUP-PHONE.md](SETUP-PHONE.md)** (Tailscale + HTTPS, or a VPS).

## What's in it

| Page | What it does |
|---|---|
| **Today** | One calm sentence + "the one thing" sticky note, now/next, today's page, due & slipped (never a wall of red), mood check-in, habits, body strip, "what should I do?", trip countdown, on-this-day, evening shutdown mode |
| **Inbox** | Capture anything in <3 s (`C`, or the red button). Natural-language chips (`tomorrow 3pm`, `every monday`, `#tag @ctx !high +Project`), URL → link note, dictation, share-target. Triage one card at a time |
| **Tasks** | Today / Upcoming / Anytime / Someday / Projects(+board) / Contexts / Done; recurrence incl. "after completion"; reminders (push, Telegram, in-app, snooze, critical re-nag); Work ⟷ Personal mode filters everything |
| **Calendar** | Day/week/month/agenda; ICS feeds (read-only, no OAuth); native events; drag a task onto the grid to time-block |
| **Notes** | Markdown, backlinks `[[like this]]`, daily note, templates, FTS5 search, 20 versions, attachments, "Assist" (summarise, extract tasks, clean up…) with approval |
| **Lists** | Restaurants, places to play, things to do/eat, media, gifts, wishlist, grocery, packing, read-later + your own types; list/grid/table/board/**map**; "surprise me"; share as Markdown or expiring link |
| **Goals** | Goals with a required *why* (max 3 big), live links to wealth/Garmin numbers with pace, habits with forgiving streaks + heatmaps, life wheel, wins, vision & values, notes to future you, **What should I do?** |
| **Travel** | Scratch-style world map, country "passport" pages, trips (itinerary, bookings, offline documents, packing, budget in any currency, pre-trip checklist, journal, recap), visa notes you record and date, Schengen 90/180 calculator, documents vault (encrypted numbers), expiry radar, leave & bridge days, "where can I go?" |
| **Health** | Garmin summaries (or CSV/TCX/FIT import), trends, mood & energy, quick logs, plain-sentence patterns (with sample sizes), appointments / vaccines / prescriptions / blood-test trends |
| **Assistant** | Claude via a server-side proxy. Reads your data (per-module toggles; health off by default), acts only through **confirm cards**, everything logged and undoable, visible memory, "preview exactly what's sent", monthly cost cap |
| **Review** | Weekly (auto-assembled, saved as a note), monthly, and the **year in review** poster (print to PDF) |
| **More** | People, Life admin (maintenance, warranties, subscriptions, decisions, someday, yearly checklist, **emergency card** encrypted with your PIN, review cards, meals), Work capture |

Keyboard: `C` capture · `T` task · `N` note · `/` or `Ctrl+K` palette · `Ctrl+J` assistant sheet · `G` then `D/T/N/L/C/I/G/H/V/R/S` go-to · `J/K` move, `X` done, `E` edit, `1–4` priority · `?` list.

## Your data

* One SQLite file: `data/life.db`. **Settings → Your data → Export everything** gives a zip (JSON + Markdown notes); **Import** restores it. Encrypted fields stay encrypted in exports.
* Nightly backup to `data/backups/life-YYYYMMDD.db`, 14 days kept.
* **Back up `data/fernet.key` too** (it encrypts passport/ID numbers, health values, file scans). Lose it and those fields are unrecoverable by design.
* Restore a backup: stop the server, copy the chosen `life-….db` over `data/life.db`, start again.
* "Load demo data" (Settings) is explicit and removable in one click. No fake data anywhere else.

## Tests (run before trusting a change)

```bat
.venv\Scripts\python tests\run_all.py          :: everything (~4 min)
.venv\Scripts\python tests\run_all.py --fast   :: syntax + unit + pytest only (~15 s)
```
Covers: natural-language dates, recurrence (month-ends, DST), Schengen 90/180, passport validity, leave bridges, QR hand-off round-trip, sync conflict rules, encryption/masking, security checklist (auth + CSRF on every route, XSS payloads, SSRF, uploads, rate limits, no secrets in errors), reminders (once, snooze, quiet hours, critical re-nag), Telegram inbound, Garmin mapping/import, assistant pipeline (mock model), share links, a Playwright run through every page at desktop and 390 px in both themes with zero console errors, axe-core WCAG AA, and speed on a 2,500-task / 1,200-note data set (every view well under 200 ms).

## Honest status: what has and hasn't been exercised live

Verified by automated tests against real code paths: everything above.
**Not exercised against the live service** (needs your credentials, so I could not): Garmin login/MFA/sync (`garminconnect` is unofficial and may break — file import is the fallback), Gmail IMAP, Telegram delivery, Anthropic API calls (tested with a deterministic mock model; the real streaming/tool loop follows the SDK docs but please try a chat), web push delivery to a real device, the wealth-app endpoints (contract in [WEALTH-API.md](WEALTH-API.md)). Each has exact verification steps in its setup doc and a status line in Settings → Data health.

Docs: [SETUP-PHONE](SETUP-PHONE.md) · [SETUP-WORK-PC](SETUP-WORK-PC.md) · [SETUP-GARMIN](SETUP-GARMIN.md) · [SETUP-TELEGRAM](SETUP-TELEGRAM.md) · [PRIVACY](PRIVACY.md) · [SECURITY](SECURITY.md) · [WEALTH-API](WEALTH-API.md) · [DESIGN](DESIGN.md) · component gallery at `/_styleguide`.
