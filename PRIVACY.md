# Privacy — what leaves your machine, and when

Life has **no analytics, no tracking scripts, no CDN requests, no third-party fonts or map data for the world map**. The only things that ever leave the server are below, and each only happens if *you* set it up or use it.

| What | Where it goes | When | What is sent |
|---|---|---|---|
| **Claude (Anthropic API)** | api.anthropic.com | only when you chat, use "Assist" on a note, or turn on the morning briefing / triage | The question plus a snapshot of the modules you allowed (Assistant → Privacy & style). **Health & mood: off by default.** Passport/ID/card/IBAN-looking numbers are stripped first; document numbers are never in the snapshot. "Preview what's sent" shows the exact system prompt. Anthropic's own retention terms apply. |
| **Telegram** | api.telegram.org | reminders, `/agenda`, capture replies | Reminder titles and agenda text |
| **Gmail (IMAP)** | imap.gmail.com | every ~6 h if configured | Read-only: the `Travel` and `Life` labels. Nothing is written back |
| **Garmin** | Garmin Connect | every ~4 h if configured | Your login (from `.env`), read-only metrics. Only daily summaries are stored |
| **Calendar feeds** | the secret `.ics` URLs you add | every ~20 min | Nothing about you (a plain GET) |
| **Weather** | api.open-meteo.com | Today nudges, packing "weather check" | Approximate coordinates (your home or the trip's country centre) |
| **Exchange rates** | api.frankfurter.app | trip budgets in other currencies | A currency code |
| **Map tiles** | tile.openstreetmap.org | only when you open a map with a street map (lists map, city pins, day map) | The tile coordinates your browser requests (OSM sees your IP). The **world map** is local. |
| **Link titles** | the site you pasted | when you capture a URL | A plain GET from your server (private addresses are refused) |
| **Web push** | your browser vendor's push service | reminders | Title text, encrypted to your device |
| **Wealth app** | the URL you set | summaries, optional expense quick-add | Read-only summary pulled in; an expense line if you use quick-add |

## At rest
* Passport/visa/ID numbers, health record values and notes, and **all uploaded scans** are encrypted with a key in `data/fernet.key` (or `LIFE_FERNET_KEY`). The UI masks numbers (last 4) and reveals for 10 seconds on tap; each reveal is audit-logged.
* The **emergency card** is encrypted in your browser with your PIN. The server only stores ciphertext and cannot recover it.
* Other records (tasks, notes, lists, mood…) are stored as ordinary rows in `data/life.db`. Anyone with the file can read them: use disk encryption (BitLocker) on the PC.
* Offline copies live in your browser's IndexedDB on each device. If you edit an encrypted field while offline, the plain value sits in that device's outbox until it syncs. Lock your phone.

## Capture tokens
Write-only and scoped: a token can add inbox items and nothing else. Revoke any time. Every use is counted.

## Deleting
Deleting in the app is a soft delete (so sync works and undo works). **Export → inspect → delete `data/life.db`** removes everything. Exports keep encrypted fields encrypted.
