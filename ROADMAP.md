# Life: roadmap (iPhone first)

Status: `[x]` built and tested · `[~]` built; needs a one-time step from you · `[ ]` not done · `[-]` can't be done in a web app (and what replaces it)

## A. iPhone first
- [x] A1 **Use it on your iPhone** guide in Settings: Add to Home Screen steps (a nudge appears only in Safari, not the installed app), the Shortcut token with copy-ready values and a **Test** button, Calendar and Siri links
- [x] A2 Share **screenshots and photos** through the Shortcut (read with vision)
- [x] A3 Share **any web page** (blog "10 best brunch spots", YouTube, TikTok…): the article text is read, not just the preview
- [x] A4 **Paste** button in Capture (one tap reads the clipboard; a link or caption is filed with *To lists*)
- [x] A5 **Swipe** a task or list row: right = done, left = delete (with Undo that really syncs)
- [x] A6 **Pull down to refresh** (sync now)
- [x] A7 Dialogs as **bottom sheets you drag down** to close
- [~] A8 **Calendar feed** for the iPhone Calendar app (tasks, events, reminders, trips, birthdays, passport/visa expiries; titles and dates only). *You:* Settings → Use it on your iPhone → Create my calendar link → Subscribe
- [~] A9 **Siri / Shortcuts**: "what's my day?" as plain text. *You:* build the two-step Shortcut shown in Settings
- [x] A10 iOS polish: no tap flash or text-callout on controls, launch screens for 11 iPhone sizes, status-bar style, install nudge
- [~] A11 **Phone notifications**: one sender for push + Telegram with category switches, quiet hours (held, then delivered), tap opens the right page; morning brief, trips, flights, document expiry, birthdays, entry-rule changes, problems. *You:* turn on for this device (iPhone: installed app)
- [~] A12 **Face ID**: passkeys (WebAuthn); lock after leaving the app or 1 / 5 / 15 min; password only from the computer. *You:* set it up on the iPhone, then switch on "Only open Life with Face ID"
- [-] Native Home Screen widgets and Siri without a Shortcut need a native app. Replaced by A8/A9

## B. Lists, places, films
- [x] B1 **Move an item to another list** (editor and bulk), statuses mapped
- [x] B2 **Select several** (long-press or Select): done / move / delete
- [x] B3 **Surprise me with filters** (cuisine, price, area; genre, language, type)
- [x] B4 Action links: Apple Maps, Google Maps, Call, Trailer, Where to watch, IMDb, the original post
- [x] B5 **Find duplicates** on a list and merge them
- [x] B6 Articles listing several places or titles are split into items
- [x] B7 **Once per list**: the same thing is never added twice (spelling, accents, "The", brackets ignored; different city / year / film-vs-series kept apart), across Instagram, quick-add, the form and CSV
- [x] B8 **Short rows**, details on tap; finished items hidden (not deleted) in Restaurants and Media lists
- [x] B9 **Details filled in** for places (cuisine, area, cost) and films/series (genre, language, year, ★ IMDb), on add and as a background top-up
- [~] B10 **IMDb ratings** from IMDb's free ratings file, matched by IMDb ID. *You:* Settings → Film & series ratings → Download (about 7 MB, only when you press it)

## C. Travel
- [x] C1 **Entry for you** on every country page (passport + residence + visas you hold, with the reason and the airline's own condition)
- [x] C2 **Where can I go?** across every country, sorted by what you need
- [x] C3 **Entry-rule change alerts** for countries you plan to visit (daily re-check, notification when the answer for you changes)
- [x] C4 Trip checklist from the entry rules: "apply online" / "get a visa" to-dos with an apply-by date; visas you hold tick themselves

## D. Reliability, security, upkeep
- [x] D1 Tests: no port clashes, every suite in `run_all`, new features covered, a scan for key-shaped strings
- [x] D2 **Download a backup** from the phone (to the Files app), with or without the encryption key
- [x] D3 Background jobs (list top-up, entry-rule watch, Garmin) report to **Data health**
- [x] D4 Garmin: sign in **once**, then tokens only (no repeated security-code emails)
- [x] D5 Security: PBKDF2 600k with auto-upgrade, tighter headers, rate limits on token endpoints, encrypted settings for keys, documented in SECURITY.md
- [x] D6 Docs: README, docs website (GitHub Pages), SETUP-PHONE, PRIVACY, SECURITY

## Ideas not built (and why)
- Poster thumbnails on rows: would add third-party image requests and visual noise (you asked for calm rows)
- Area and map pins for places that no post or map names: needs a paid places API (a Google Places key would do it)
- Real-time film streaming availability: needs a paid API; "Where to watch" links to JustWatch instead
