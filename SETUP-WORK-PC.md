# Work PC — getting to-dos out of the office network

**Facts:** the work PC can't reach anything outside the company network, may not allow installs, and may be monitored.

**Ground rules (please read):**
* Check your company's IT/security policy before using any personal tool at work.
* Keep what goes in to **your own to-do reminders** ("send Q3 deck to finance"). Not confidential company information, client data, or documents.
* Nothing here bypasses, tunnels through, or works around company network controls, and nothing needs installing. If a tier is blocked, that's the answer — use the next one.

## The tiers (try in order; the app shows which ones have worked)

Open **Life → More → Work capture** on your phone/home PC. The "Which way works on your network?" list lights up the first time something arrives by each route.

### Tier 0 — the offline page (always works)
1. Work capture → **Download work-capture.html** (leave "server address" blank for offline-only).
2. Get that single file to the work PC in whatever way your policy allows (USB stick, an email attachment to yourself if permitted, your own phone's transfer).
3. Open it in the browser (double-click; `file://`). Add to-dos (`send deck to finance tomorrow 2pm #today`), tick them off. They're stored in that browser, and **Save backup file** exports them.
It makes **zero network requests** (verified by an automated test that blocks all network access and still passes).

### Tier 1 — QR hand-off to your phone (no network, no files leave the PC)
1. On the work page press **Send to phone (QR)**. A QR (or a rotating sequence if you have many items) appears.
2. On your phone: Life → Work capture → **Scan QR** and hold the camera to the screen until it says it's done. (Camera needs HTTPS — your Tailscale address qualifies.)
3. The to-dos land in your **Inbox** as *Work*. Scanning the same codes again adds nothing (checksum + de-dupe). Press "Scanned — mark handed off" on the work page to tick them off there.
Fallback: **Copy as text** on the work page, paste into Life → Work capture → "Add pasted to-dos to inbox".

### Tier 2 — direct sync (only if the network allows one specific HTTPS address)
Needs your Life reachable at a public HTTPS name (e.g. the VPS option in SETUP-PHONE.md) that the company proxy lets you browse to.
1. Work capture → enter the address → **Download** (this embeds a *write-only* token).
2. On the work page: *Direct sync settings → Test connection*. It tells you plainly: **reachable / blocked / needs proxy**. If it fails the page quietly stays on Tier 0/1 and keeps everything locally.
The token can only **add inbox items** — it cannot read a note, task, health, travel or money record. It is rate-limited, revocable (Work capture → Capture tokens → Revoke) and logged.

### Tier 3 — email-in (only if policy allows, only non-sensitive one-liners)
Email a one-line to-do **from a personal device** (not from a work account, unless you've confirmed that's allowed) to your own Gmail. Put a filter that labels those messages **`Life`**, put your sender address(es) in **Settings → Email-in → Allowed senders**, and set `GMAIL_USER` / `GMAIL_APP_PASSWORD` in `.env` (a Gmail *app password*; no OAuth). Life checks the label every few hours; messages from any other sender are ignored. Subject = the to-do.

### Also (not for the work PC, but covers commuting)
Message your **Telegram bot** any text and it lands in the inbox ([SETUP-TELEGRAM.md](SETUP-TELEGRAM.md)); on Android use the share sheet.

## How to test each tier and tell me what worked
| Tier | Test | Success looks like |
|---|---|---|
| 0 | open the file, add a to-do, reload | it's still there |
| 1 | Send to phone → scan | "N to-dos in your inbox"; Work capture shows *QR scan: worked just now* |
| 1b | Copy as text → paste | same, *pasted text: worked* |
| 2 | Test connection | "Reachable — items will sync automatically"; *direct sync: worked* |
| 3 | email yourself a line from your phone | appears in Inbox within a few hours (Settings → Data health → gmail) |
