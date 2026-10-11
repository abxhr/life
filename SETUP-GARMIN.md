# Garmin setup

**Honest background.** Garmin's official Health API is only for approved business partners. For a personal app Life uses the community library **`garminconnect`**, which logs in with *your* Garmin credentials. It is unofficial: it can break when Garmin changes things. So Life only keeps **derived daily summaries** (steps, sleep, resting HR, HRV, body battery, VO2 max, weight, activities), never your password in the database, and gives you a **file-import fallback** that never breaks.

## Connect
1. Life → **Settings → Garmin** → enter your Garmin email and password (stored encrypted; no restart needed). *(Alternative: `GARMIN_EMAIL` / `GARMIN_PASSWORD` in `.env`; what you enter in Settings wins.)*
2. Health → **Garmin & import → Sync now**.
3. If your account has 2-step verification, Garmin emails/texts a code: the sync reports "Garmin wants a code". Enter it in the same screen → **Send code**. Tokens are cached in `data/garmin-tokens`, so you rarely repeat this.
4. After that Life syncs every ~4 hours. **Settings → Data health → garmin** shows *last synced*, why it failed, and a Retry.

## If it breaks (it may)
Health → Garmin & import → **Import a file**:
* Garmin Connect → Activities → **Export CSV** (all activities), or export one activity as **TCX** or **FIT**.
* Parsed on your server; re-importing the same file never duplicates.
Daily metrics (steps/sleep) aren't in those exports; you'll just see activities until the sync works again. Mood & energy and everything else in Life are unaffected.

## What I could and couldn't verify
Unit-tested: mapping of Garmin's payload shapes into daily summaries (missing metrics tolerated), CSV/TCX parsing, de-duplication, "unconfigured fails soft". **Not tested live** (I don't have your account): the login/MFA flow and real payloads. If a metric shows "–" after a sync, tell me which and I'll adjust the mapping in `garmin.py` (`map_day`).
