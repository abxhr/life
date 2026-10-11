# Phone setup — Tailscale (recommended) or a VPS

Goal: open Life on your phone over HTTPS, install it as an app, and get push notifications — **without ever exposing the server to the public internet**.

## Option A — Tailscale on the always-on home PC (free, private)

1. Install [Tailscale](https://tailscale.com/download) on the home PC and on your phone; sign in with the same account on both.
2. Start Life (`run.bat`). It listens on `127.0.0.1:5055` only.
3. On the PC, in a terminal:
   ```bat
   tailscale serve --bg 5055
   ```
   Tailscale gives you an address like `https://your-pc.your-tailnet.ts.net` with a real certificate. Only devices on **your** tailnet can reach it. (Do **not** use `tailscale funnel` — that is public.)
4. In `.env` add `LIFE_HTTPS=1` and restart Life, so cookies are marked `Secure`.
5. On the phone open that address in the browser, set up / enter your password.
6. **Install it**
   * **iPhone (Safari):** Share → *Add to Home Screen*. Push notifications on iOS only work for apps installed this way.
   * **Android (Chrome):** menu → *Install app*.
7. In the app: **Settings → Phone notifications → Turn on for this device → Send a test.** Also set up Telegram ([SETUP-TELEGRAM.md](SETUP-TELEGRAM.md)); it is the most reliable channel and the default for critical reminders.
8. **Face ID:** Settings → **Face ID** → *Set up Face ID on this device*, then switch on *Only open Life with Face ID* (the password then works only from the computer Life runs on).
9. Share-sheet capture: on **Android**, once installed, "Share" a link or text from any app and choose **Life** (it opens the capture sheet; tap **To lists**). iOS does not support web share targets, so on iPhone use the Shortcut below.

> **Shortcut:** Settings → **Use it on your iPhone** does steps 1 and 3 below for you (it creates the token and shows the exact values to paste, with a *Test this token* button). It also creates your **Calendar feed** and the **"what's my day?"** link for Siri.

### iPhone: share an Instagram post, a web page or a screenshot straight into your lists
Share a post (a cafe, restaurant, film, book…) and Life reads the caption **and every slide**, pulls out the name, area, what to order, and files it in the matching list (Restaurants, Cafes, Movies to watch, Series to watch…; created if you don't have them). Several places in one post become several items, and anything already in a list is skipped. Anything it can't recognise lands in your Inbox, so nothing is lost.

1. In Life: **Settings → Use it on your iPhone → Set up the "Save to Life" Shortcut** (a token is made and shown once).
2. iPhone **Shortcuts** app → **+** → name it `Save to Life`. Tap **ⓘ** → turn on **Show in Share Sheet** → *Share Sheet Types*: **URLs**, **Text**, **Images**.
3. Add the action **Get Contents of URL**:
   * URL: `https://your-pc.your-tailnet.ts.net/api/share-in`
   * Show More → Method **POST**, Headers: `Authorization` = `Bearer <your token>`, Request Body **Form**: field `text` (Text) = *Shortcut Input*; and, to share screenshots or photos, field `images` (File) = *Shortcut Input*.
4. Add **Get Dictionary Value** (key `message`) → **Show Notification**.
5. In Instagram tap the paper-plane on a post → **Share to…** (bottom of the sheet) → scroll the row → **Save to Life** (use *Edit Actions* to pin it).

Notes: Instagram only shows captions to link-preview bots and sometimes hides them; if the notification says it went to the Inbox, copy the caption in Instagram, open Life's capture sheet, paste the link and caption together, and tap **To lists**. The caption text is sent to your configured AI provider (numbers like card/phone digits are scrubbed first) and counts toward the monthly AI cap. Text inside photos/videos is not read.

Keep the PC awake (Settings → Power) or run Life as a Windows service (NSSM). Autostart is yours to decide; nothing here changes the PC's security settings for you.

### Optional: biometric login
Passkey/WebAuthn login is a planned upgrade; today the phone stays logged in for 60 days (session cookie, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS) and your phone's own lock screen protects it.

## Option B — a cheap VPS behind HTTPS (if you'd rather not keep a PC on)

On a small Linux VPS (Ubuntu), as a non-root user:

```bash
sudo apt update && sudo apt install -y python3-venv caddy ufw git
git clone <your repo> ~/life && cd ~/life
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env     # set LIFE_HTTPS=1, secrets; chmod 600 .env
```
`/etc/systemd/system/life.service`:
```ini
[Service]
User=YOURUSER
WorkingDirectory=/home/YOURUSER/life
ExecStart=/home/YOURUSER/life/.venv/bin/python app.py
Restart=always
[Install]
WantedBy=multi-user.target
```
`/etc/caddy/Caddyfile` (Caddy fetches and renews the certificate itself):
```
life.yourdomain.com {
    reverse_proxy 127.0.0.1:5055
}
```
```bash
sudo systemctl enable --now life && sudo systemctl reload caddy
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```
Point a DNS A record for `life.yourdomain.com` at the VPS. Life itself stays bound to `127.0.0.1`; only Caddy is public. Use a long password. Back up `data/` (especially `fernet.key`) off the box.

**Never** expose Flask's development server (`LIFE_DEBUG=1`) to the internet. The default `run.bat`/`run.sh` use `waitress`.
