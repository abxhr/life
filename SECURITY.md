# Security notes & threat model

**Assets:** passport/visa/ID numbers, health and mood data, notes, scans, your to-dos, and API keys/tokens (OpenAI, Anthropic, Telegram, Gmail app password, Garmin).
**You:** one user. **Attackers considered:** someone on your network or the internet probing the server; a malicious page/email/note trying to run script in your session; a leaked backup; a stolen phone; a curious work network; prompt injection via content the assistant reads.

## What's in place (and tested — `tests/test_security.py`, `tests/quality.py --xss`)
* **Auth on every route.** A test walks the Flask URL map and calls every route anonymously; everything except a short, documented allow-list returns 401. Public on purpose: the app shell, service worker, manifest, `/api/me` (auth state), `/api/login`, `/api/capture` (write-only token), `/api/ping`, the Telegram webhook (secret path + chat-id check), `/s/<token>` share links, static assets.
* **CSRF** on every mutating route (per-session token in `X-CSRF`; tested on every POST/PUT/DELETE). Session cookie `HttpOnly`, `SameSite=Lax`, `Secure` when `LIFE_HTTPS=1`.
* **Passwords:** PBKDF2-SHA256, 600k iterations, per-password salt, versioned format (older 310k hashes verify and are upgraded at the next sign-in); login rate-limited (8 / 5 min / IP).
* **Face ID (WebAuthn passkeys):** `passkeys.py`, verified with `cryptography` only. The server checks the challenge it issued, the origin, the app-identity hash, the user-verification flag, the ECDSA P-256 signature and the sign counter. With "Only open Life with Face ID" on, every API call also needs a recent unlock (`locked` → 401) and the password only works from the computer itself. Tested with a fake authenticator that also tries wrong origin, wrong app, missing Face ID flag, a foreign key and a replay (`tests/test_passkeys.py`) and in a real browser (`tests/flows_faceid.py`).
* **Private feed links:** the calendar and "my day" feeds use a separate read-only 192-bit token (constant-time compare, rate-limited, titles and dates only, resettable). The share Shortcut uses a write-only token, rate-limited.
* **Headers:** CSP (`script-src 'self'`, `base-uri`, `form-action`, `object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options`, `nosniff`, Permissions-Policy, COOP, HSTS over HTTPS.
* **Repo hygiene:** a test scans every project file for key- or token-shaped strings; `.env`, `data/` and key files are git-ignored.
* **XSS:** the UI builds DOM nodes (`textContent`), never `innerHTML`, and the Markdown renderer only emits whitelisted elements (links limited to `http(s):` and own files). A strict **CSP** (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`) is a second layer; 7 XSS payloads × 6 record types are tested to confirm nothing executes. Share pages are server-rendered with escaping.
* **Input validation:** record ids/kinds are pattern-checked, all SQL is parameterised, FTS terms are quoted (so `OR`/`NEAR` are plain words), uploads are type-checked (images/PDF/text), size-capped (25 MB) and **encrypted at rest**, imports only accept a Life export.
* **SSRF:** link-title fetching resolves the host and refuses non-public addresses, including through redirects.
* **Secrets:** only in `.env` / `data/` (git-ignored); keys entered in Settings are stored encrypted (Fernet) and never sent back to the browser (shown as “set”); error messages stored for Data health are redacted (bot tokens, API keys).
* **Capture endpoint:** bearer token (hashed at rest), write-only, rate-limited, de-duplicated, revocable.
* **Assistant safety:** it never mutates data itself — mutating tool calls come back as confirm cards and are applied in your browser; everything is logged and undoable; tool results and user content are treated as data; per-module visibility; strips ID/card numbers; monthly cap.
* **Static files:** only `static/`, `index.html`, `sw.js`, `manifest.json` are served; `data/`, `.env`, source files and `.git` return 404 (tested).
* **Server:** `waitress` (not Flask's dev server) by default; binds to `127.0.0.1`.
* **Dependencies pinned** in `requirements.txt`. Review and upgrade deliberately, then run `tests/run_all.py`.

## Known limits / your responsibilities
* **Disk encryption** for the PC/VPS (the database is a plain SQLite file except the encrypted columns).
* **Back up `data/fernet.key`** separately from the database backups (losing it means losing encrypted fields; leaking it with the DB defeats the encryption).
* **Single password.** Use a long one. Passkeys (Face ID) are available: turn on "Only open Life with Face ID". Without it, anyone who gets a logged-in phone gets Life; use the phone lock.
* **Reach it privately** (Tailscale) or behind HTTPS (SETUP-PHONE.md). Don't expose the dev server.
* **Third-party unofficial Garmin library** receives your Garmin credentials once, at the one-time sign-in (stored encrypted); after that Life keeps only a login token and never signs in with the password again from the background. Same trust as the library's authors; keep it updated or use file import.
* **Work page token (Tier 2)** is embedded in the HTML file you put on the work PC. It is write-only, but treat the file as semi-sensitive and revoke the token if the file leaks.
* **Prompt injection:** the assistant reads notes/emails you saved; a hostile note could *ask* it to do something, but any action still needs your confirm tap (or you've enabled auto-approve for low-risk actions — turn that off if you worry about it).
* The service worker caches the app shell (not API responses). Documents you choose to "Save offline" are stored in the browser cache on that device.
