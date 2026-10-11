# Telegram setup (reminders + capture + daily agenda)

Telegram is the most reliable way to reach you when the app is closed, and the default channel for **critical** reminders.

1. In Telegram, message **@BotFather** → `/newbot` → pick a name → copy the **token**.
2. Life → **Settings → Reminders & Telegram** → paste it into **Telegram bot token** (stored encrypted; no restart needed). *(Alternative: `TELEGRAM_BOT_TOKEN` in `.env`.)*
3. Find **your chat id**: send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser — look for `"chat":{"id":123456789`.
4. Life → **Settings → Reminders & Telegram** → paste the chat id → **Send test notification**.

## What it does
* **Reminders** are sent to Telegram (per-task choice: everywhere / Telegram only / push only / in-app only). Quiet hours (Settings) hold back non-critical ones; **critical** ones break through and **re-notify every 10 minutes until you press OK/Done** in the app.
* **Capture:** message the bot any text → it appears in your Inbox and the bot answers "✓ in your inbox". Life polls Telegram itself every 30 seconds, so **no public URL or webhook is required**. Only *your* chat id is accepted; messages from anyone else are ignored.
* **`/agenda`** replies with today's calendar and due/slipped tasks.
* **Daily agenda** (opt-in): Settings → "Send me today's agenda on Telegram each morning" + time.

## Privacy
Messages travel via Telegram's servers (that's inherent to using Telegram). Reminders contain only the reminder title. Don't put confidential work information in reminders you send there.
