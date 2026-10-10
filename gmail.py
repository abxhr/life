"""Gmail via IMAP + app password (no OAuth). Reads the `Travel` label (booking proposals, always reviewed by you)
and the `Life` label (email-in to-dos, only from addresses you allow). Parsing is heuristic: it proposes, you confirm."""
import imaplib, email, re, os, hashlib, uuid, html as H
from email.header import decode_header
from datetime import datetime, timedelta

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
KINDS = [("flight", r"flight|boarding pass|e-?ticket|itinerary|airlines?|airways|\bPNR\b"), ("hotel", r"hotel|reservation|check-?in|booking\.com|airbnb|stay at"), ("train", r"\btrain\b|rail|eurostar|amtrak"), ("car", r"car rental|pick-?up|hertz|avis|sixt"), ("activity", r"tickets?|tour|excursion|admission")]


def _dec(v):
    out = ""
    for part, enc in decode_header(v or ""):
        out += part.decode(enc or "utf8", "ignore") if isinstance(part, bytes) else part
    return out


def _text(msg):
    for p in msg.walk():
        if p.get_content_type() == "text/plain":
            return p.get_payload(decode=True).decode(p.get_content_charset() or "utf8", "ignore")
    for p in msg.walk():
        if p.get_content_type() == "text/html":
            return re.sub(r"<[^>]+>", " ", H.unescape(p.get_payload(decode=True).decode(p.get_content_charset() or "utf8", "ignore")))
    return ""


def parse_date(t):
    m = re.search(r"\b(20\d\d)-(\d\d)-(\d\d)\b", t)
    if m:
        return m.group(0)
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b", t, re.I)
    if m:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()[:3]]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b", t, re.I)
    if m:
        return f"{m.group(3)}-{MONTHS[m.group(1).lower()[:3]]:02d}-{int(m.group(2)):02d}"
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(20\d\d)\b", t)  # day/month (UAE/EU order)
    if m and int(m.group(2)) <= 12:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def parse_booking(subject, sender, body):
    text = f"{subject}\n{body}"
    kind = next((k for k, pat in KINDS if re.search(pat, text, re.I)), None)
    if not kind:
        return None
    conf_rx = r"(?i:confirmation|booking|reservation|reference|PNR|record locator|ref)(?i:\s*(?:no\.?|number|code|#))?\s*[:#\-]?\s*([A-Z0-9]{5,8})\b"
    conf = re.search(conf_rx, body) or re.search(conf_rx, subject)   # body first: subjects often say "confirmation - EK318" (a flight number)
    return {"title": re.sub(r"^(re|fwd?):\s*", "", subject, flags=re.I).strip()[:120], "conf": conf.group(1) if conf else None, "start": parse_date(text), "type": kind, "snippet": re.sub(r"\s+", " ", body)[:160], "from": sender}


def _connect(user, pw):
    m = imaplib.IMAP4_SSL("imap.gmail.com")
    m.login(user, pw)
    return m


def fetch_label(user, pw, label, days=60, limit=40):
    m = _connect(user, pw)
    try:
        if m.select(f'"{label}"', readonly=True)[0] != "OK":
            raise RuntimeError(f"Gmail label '{label}' not found (create it and add a filter)")
        since = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
        _, ids = m.search(None, f'(SINCE "{since}")')
        out = []
        for i in ids[0].split()[-limit:]:
            _, d = m.fetch(i, "(RFC822)")
            msg = email.message_from_bytes(d[0][1])
            out.append({"mid": msg.get("Message-ID", i.decode()), "subject": _dec(msg.get("Subject")), "from": email.utils.parseaddr(msg.get("From", ""))[1].lower(), "body": _text(msg)[:6000]})
        return out
    finally:
        try:
            m.logout()
        except Exception:
            pass


def sync(upsert, raw_db, set_state, settings, now_iso):
    user, pw = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not pw:
        set_state("gmail", False, "", "not configured (GMAIL_USER / GMAIL_APP_PASSWORD in .env)")
        return {"travel": 0, "inbox": 0}
    c = raw_db()
    try:
        n_t = n_i = 0
        for m in fetch_label(user, pw, "Travel"):
            p = parse_booking(m["subject"], m["from"], m["body"])
            rid = str(uuid.uuid5(uuid.NAMESPACE_URL, "gmail:" + m["mid"]))
            if p and not c.execute("SELECT 1 FROM records WHERE id=?", (rid,)).fetchone():
                upsert(c, {"id": rid, "kind": "booking_proposal", "data": p}); n_t += 1
        allowed = {a.lower() for a in settings().get("email_in_allowed", [])}
        if allowed:
            try:
                for m in fetch_label(user, pw, "Life"):
                    rid = str(uuid.uuid5(uuid.NAMESPACE_URL, "gmail-life:" + m["mid"]))
                    if m["from"] in allowed and not c.execute("SELECT 1 FROM records WHERE id=?", (rid,)).fetchone():
                        text = (m["subject"] or m["body"].strip().splitlines()[0])[:500]
                        upsert(c, {"id": rid, "kind": "inbox", "data": {"text": text, "source": "email"}}); n_i += 1
            except RuntimeError:
                pass  # no Life label: that's fine
        c.commit()
        set_state("gmail", True, "", f"{n_t} booking proposal(s), {n_i} to-do(s)")
        return {"travel": n_t, "inbox": n_i}
    except Exception as e:
        set_state("gmail", False, str(e)[:200])
        return {"error": str(e)[:200]}
    finally:
        c.close()
