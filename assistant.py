"""Assistant: Claude via a server-side proxy (the key never reaches the browser).
- Read-only tools run here; every MUTATING tool call is returned to the browser as a confirm card and applied there (offline-first store), then logged + undoable.
- Privacy: per-module data toggles, health excluded unless enabled, ID/passport/account numbers scrubbed, and a preview of exactly what will be sent.
- Cost: month meter with a hard cap. Models are configurable (Settings); defaults are the current Sonnet / Haiku / Opus.
- LIFE_AI_MOCK=1 swaps in a deterministic fake model so the whole pipeline is testable without a key."""
import os, re, json, time, uuid, hashlib, hmac, logging, base64, threading
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from flask import request, jsonify, Response, stream_with_context, session

# USD per million tokens (input, output). Estimates from Anthropic's published list at build time; editable in Settings (ai_prices).
PRICES = {"claude-sonnet-5-5": [2, 10], "claude-sonnet-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-opus-5-5": [4, 20], "claude-opus-5": [5, 25], "claude-opus-4-8": [5, 25], "claude-fable-5-1": [10, 50], "claude-haiku-4-5": [1, 5], "claude-sonnet-4-6": [3, 15], "gpt-5": [1.25, 10], "gpt-5-mini": [0.25, 2], "gpt-5-nano": [0.05, 0.4]}
EFFORT = {"chat": "medium", "fast": "low", "plan": "high"}
LOW_RISK = {"create_task", "add_note", "add_list_item", "log_mood", "create_reminder"}

# ---------- tool definitions ----------
def T(name, desc, props, req=()):
    return {"name": name, "description": desc, "input_schema": {"type": "object", "properties": props, "required": list(req), "additionalProperties": False}}

S, N = {"type": "string"}, {"type": "number"}
READ_TOOLS = [
    T("search_notes", "Full-text search the user's notes, tasks and list items. Use before answering questions about what they saved or wrote.", {"query": S}, ["query"]),
    T("list_tasks", "List the user's open tasks. Optionally filter by due date range or context.", {"due_before": S, "context": S, "limit": N}),
    T("query_calendar", "Calendar events (native and subscribed feeds) between two dates (YYYY-MM-DD).", {"from": S, "to": S}, ["from", "to"]),
    T("list_items", "Items in the user's lists (restaurants, places to play, things to do, etc.). Filter by list name or text.", {"list": S, "query": S}),
    T("goal_progress", "The user's goals with progress fields (target, current, milestones).", {}),
    T("get_travel", "Countries visited/wanted, trips, and document expiry dates (never document numbers).", {}),
    T("read_health", "Recent daily health summaries and mood. Only available if the user enabled health data for the assistant.", {"days": N}),
    T("wealth_summary", "Read-only net worth, upcoming bills/renewals from the user's wealth app, if connected.", {}),
]
WRITE_TOOLS = [
    T("create_task", "Create a task.", {"title": S, "due": {"type": "string", "description": "YYYY-MM-DD"}, "due_time": {"type": "string", "description": "HH:MM"}, "priority": {"type": "number", "description": "1 urgent..4 low"}, "context": {"type": "string", "enum": ["personal", "work", "work-outside-work", "errands", "home"]}, "notes": S, "project": {"type": "string", "description": "Short project name to group related tasks"}}, ["title"]),
    T("update_task", "Change fields of an existing task.", {"id": S, "title": S, "due": S, "due_time": S, "priority": N, "notes": S}, ["id"]),
    T("complete_task", "Mark a task done.", {"id": S}, ["id"]),
    T("create_reminder", "Create a reminder at a date/time (local time of the user).", {"title": S, "date": S, "time": S, "critical": {"type": "boolean"}}, ["title", "date"]),
    T("create_event", "Create a calendar event.", {"title": S, "date": S, "start": S, "end": S, "location": S}, ["title", "date"]),
    T("add_note", "Save a note.", {"title": S, "body": S, "tags": {"type": "array", "items": S}}, ["body"]),
    T("add_list_item", "Add an item to one of the user's lists (by list name).", {"list": S, "title": S, "notes": S}, ["list", "title"]),
    T("log_mood", "Log mood and energy (1-5).", {"mood": N, "energy": N, "note": S}),
    T("mark_visited", "Mark a country as visited (ISO alpha-2 code like FR).", {"country": S, "start": S, "end": S, "notes": S}, ["country"]),
    T("create_trip", "Create a trip.", {"name": S, "start": S, "end": S, "countries": {"type": "array", "items": S}}, ["name"]),
    T("remember", "Save a durable fact about the user (preference, constraint). Shown on their Memory page; they can delete it.", {"text": S}, ["text"]),
]
TOOL_NAMES = {t["name"] for t in READ_TOOLS}
WRITE_NAMES = {t["name"] for t in WRITE_TOOLS}


# shared post -> list item. kind -> (default list name, list type, first status, record fields the model may fill, preset fields)
_PL, _MD = ("cuisine", "city", "price"), ("creator", "year", "genre", "cast", "language")
SHARE_TYPES = {"restaurant": ("Restaurants", "restaurant", "want to go", _PL, {}), "cafe": ("Cafes", "restaurant", "want to go", _PL, {}),
               "play": ("Places to play", "play", "want to try", ("activity", "area", "price"), {}),
               "movie": ("Movies to watch", "media", "to try", _MD, {"medium": "movie"}), "show": ("Series to watch", "media", "to try", _MD, {"medium": "show"}),
               "book": ("Books to read", "media", "to try", _MD, {"medium": "book"}), "media": ("Watch, read, listen", "media", "to try", ("medium", "creator"), {}),
               "todo": ("Things to do", "todo", "someday", (), {})}
SHARE_PROMPT = ("You file a shared social-media post (caption and page text; it may be a multi-image post, the caption covers all of it) into the user's personal lists. Reply with JSON only: "
                '{"items":[{"type":"restaurant|cafe|play|movie|show|book|media|todo","list":"","title":"name of the place or title","city":"city or area","address":"street address if stated","cuisine":"","price":"$|$$|$$$|$$$$ or empty",'
                '"activity":"sport or activity (play only)","medium":"podcast|music|game (media only)","creator":"director, author or artist","year":"release year (movie/show/book)","genre":"1-3 genres, comma separated","cast":"top 3 actors, comma separated (movie/show)","language":"original language (movie/show), e.g. English, Hindi, Korean","tags":["2-4 short lowercase tags, e.g. outdoor seating, date night, vegan"],"notes":"1-2 lines: what to order or try, why it is worth it"}]}. '
                "cafe = coffee shops, bakeries, patisseries, dessert and ice-cream places; restaurant = every other place to eat or drink (restaurants, burger spots, street food, bars); play = venues for sport or activities; "
                "movie = films; show = TV series; book = books; media = podcasts, music, games; todo = any other place or experience to visit. "
                "price: estimate only if the post or the place is well known; year, genre, cast and creator: only if you are sure, otherwise empty. \"list\": if one of the user's existing lists (given below) clearly fits this item (right kind AND theme), put its exact name, otherwise leave it empty. "
                "Return only real, specific named things. A slide's heading or the post's cover title (\"My top 10 movies so far\", \"Best cafes in Dubai\", \"Places to eat in 2026\"), usernames, hashtags, rankings and counts are NOT items, and neither is anything not clearly a place, film, show or book. \"title\" is just the clean name: no numbering, no notes in brackets. "
                "If the post lists several places or titles, return each (max 20). Use only what the post says; never invent; use empty strings for unknown fields. If it is none of these, return {\"items\":[]}.")
VISA_URL = "https://www.emirates.com/service/visa-requirements"
VISA_PAGE = "https://www.emirates.com/ae/english/before-you-fly/visa-passport-information/visa-passport-information-results/"
def norm_title(t):
    """'The Amélie (2001)' / 'Maisan 15 (Pizza variant)' -> a comparison key: no case, accents, brackets, leading article or punctuation."""
    import unicodedata
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", t).replace("&", " and ")
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return re.sub(r"^(the|a|an) ", "", t)


def same_item(a, b):
    """Is a the same list item as b? Same normalised name, unless something clearly tells them apart: different city (two branches / same name elsewhere), different release year or movie vs series."""
    if not norm_title(a.get("title")) or norm_title(a.get("title")) != norm_title(b.get("title")):
        return False
    ca, cb = set(norm_title(a.get("city")).split()), set(norm_title(b.get("city")).split())
    if ca and cb and not ca & cb:
        return False
    ya, yb = str(a.get("year") or ""), str(b.get("year") or "")
    if ya and yb and ya != yb:
        return False
    ma, mb = a.get("medium"), b.get("medium")
    return not (ma and mb and ma != mb)


def _yn(name, q):
    return {"name": name, "instructions": q, "choices": ["yes", "no"]}


VISA_QUESTIONS = [
    {"name": "verdict", "instructions": "For THIS traveller, going by their PASSPORT alone, what must they do about a visa before entering? visa_free = can enter with no visa or pre-authorisation based on the passport itself (entry that depends on holding ANOTHER country's visa or residence permit does NOT count); on_arrival = the visa is issued at the border; "
     "eta_or_evisa = must apply online first for an e-visa, ETA or travel authorisation; visa_required = must get a visa from an embassy or consulate first; unclear = the text does not say",
     "choices": ["visa_free", "on_arrival", "eta_or_evisa", "visa_required", "unclear"]},
    {"name": "stay", "instructions": "If this traveller can enter without a visa, how long may they stay? Pick the closest; \"not stated\" if it is unclear or they need a visa", "choices": ["up to 14 days", "up to 30 days", "up to 60 days", "up to 90 days", "up to 180 days", "not stated"]},
    _yn("onward", "Does the text require a return or onward ticket?"),
    _yn("form", "Does the text require a digital arrival card or an online pre-arrival registration, besides the visa itself?"),
    _yn("health", "Does the text require a vaccination or health certificate for this traveller?"),
]
VISA_STEPS = {"visa_required": "Apply for a visa at the embassy or consulate before you fly", "eta_or_evisa": "Apply online for the e-visa or authorisation before you fly",
              "on_arrival": "The visa is issued when you arrive", "visa_free": "You can enter without a visa"}   # fixed wording: the model only chooses, it never writes


def visa_text(j):
    """Plain text of the destination's rules from the service's JSON (sections > subsections > paragraphs of HTML)."""
    import html as H
    out = []
    for res in j.get("results") or []:
        if not res.get("isDestination"):
            continue
        for sec in res.get("sectionInformation") or []:
            for sub in sec.get("subsectionInformation") or []:
                for p in sub.get("documentParagraph") or []:
                    t = H.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", p.get("paragraphText") or ""))).strip()
                    if t:
                        out.append(f"[{sec.get('sectionName')} / {sub.get('subsectionName')}] {t}")
    return "\n".join(out)[:7000]


def visa_exemptions(j):
    """Paragraphs of the destination's '3rd Country Visa' and '3rd Country Residents' exemption sections (entry on the strength of another country's visa / residence permit)."""
    import html as H
    out = {"visa": [], "resident": []}
    for res in j.get("results") or []:
        if not res.get("isDestination"):
            continue
        for sec in res.get("sectionInformation") or []:
            for sub in sec.get("subsectionInformation") or []:
                n = (sub.get("subsectionName") or "").lower()
                k = "visa" if "3rd country visa" in n else "resident" if "3rd country resident" in n else ""
                for p in sub.get("documentParagraph") or [] if k else []:
                    t = H.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", " ", p.get("paragraphText") or ""))).strip()
                    if t and len(out[k]) < 8:
                        out[k].append(t)
    return out


def _pick(name, q, statements):
    """Multiple choice: which numbered statement applies? (the model picks a number; we then quote that statement verbatim)"""
    nums = "\n".join(f"{i + 1}) {t[:400]}" for i, t in enumerate(statements))
    return {"name": name, "instructions": f"{q}\n{nums}\nAnswer with the number of the statement that applies, or none.", "choices": ["none"] + [str(i + 1) for i in range(len(statements))]}


_names = {}


def country_name(a2):
    """'in' -> 'India' (from the same list the Travel map uses); falls back to the code."""
    if not _names:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "vendor", "world-meta.json"), encoding="utf8") as f:
                _names.update({m[0].lower(): m[1] for m in json.load(f).values()})
        except Exception:
            _names["_"] = ""
    return _names.get(a2.lower(), a2.upper())


def country_code_list():
    """All ISO-2 codes the Travel map knows, lowercase."""
    country_name("us")   # loads the list
    return sorted(k for k in _names if len(k) == 2)


def visa_fallback(text):
    """No AI available: show the airline's own first sentences instead of nothing."""
    first = lambda tag: next((re.split(r"(?<=[.!?])\s", l.split("] ", 1)[1], maxsplit=1)[0] for l in text.split("\n") if l.startswith(tag) and "] " in l), "")
    return {"verdict": "unclear", "headline": first("[Visa Requirements") or "No published rules found for this route.", "steps": [], "passport": first("[Travel Document Validity"), "watch": ""}


# ---------- fill in the details of list items: movies/series (genre, language, year) and places (cuisine, area, cost, map pin) ----------
ENRICH_KINDS = {"restaurant": ("cuisine", "city", "price"), "media": ("genre", "language", "year", "medium")}
ENRICH_PROMPT = ("You fill in missing details for items in a personal list. Input: a JSON list of items (n, kind, title, list name, known fields, notes). "
                 'Reply with JSON only: {"items":[{"n":0,"cuisine":"","city":"","price":"","genre":"","language":"","year":"","medium":""}]}. '
                 'kind "restaurant" = a place to eat or drink: cuisine = its short type (Burgers, Italian, Coffee, Bakery, Dessert, ...), city = neighbourhood and city (e.g. "Jumeirah, Dubai"), '
                 "price = $, $$, $$$ or $$$$ for the typical cost per person: ALWAYS give your best estimate from the kind of place (street food or a basic cafe $, casual dining $$, upscale $$$, fine dining $$$$). "
                 'kind "media" = a film, series or book: genre = 1-3 genres comma separated, language = original language, year = release year, medium = movie, show or book. '
                 'Everything except price: fill ONLY what you are confident about for this exact item (the notes and list name are hints), otherwise leave ""; never guess a location. '
                 'Films and series from the last couple of years may be unknown to you: then leave their fields empty.')
COMPLETE = None   # set by register()
VISA_WATCH = None   # set by register(): the daily entry-rule re-check: the cheap one-shot model call


def osm_place(title, city, home):
    """Look a place up on OpenStreetMap (Nominatim, free, no key; 1 request/second policy). Returns {"city","lat","lon","cuisine"} for a confident name match, else {}."""
    import requests
    p = {"q": f"{title}, {city}" if city else title, "format": "jsonv2", "addressdetails": 1, "namedetails": 1, "extratags": 1, "limit": 3}
    if home:
        p["viewbox"] = f"{home[1] - 1.5},{home[0] + 1.5},{home[1] + 1.5},{home[0] - 1.5}"   # a preference for results near home, not a limit
    try:
        rows = requests.get("https://nominatim.openstreetmap.org/search", params=p, headers={"User-Agent": "Life-personal-app/1.0"}, timeout=8).json()
    except Exception:
        return {}
    words = [w for w in re.findall(r"\w+", title.lower()) if len(w) >= 4] or re.findall(r"\w+", title.lower())
    for r in rows if isinstance(rows, list) else []:
        names = " ".join([r.get("display_name", "")] + list((r.get("namedetails") or {}).values())).lower()
        if not words or not any(w in names for w in words):
            continue
        a = r.get("address") or {}
        area = a.get("suburb") or a.get("neighbourhood") or a.get("quarter") or a.get("city_district") or ""
        town = a.get("city") or a.get("town") or a.get("state") or ""
        cuisine = ((r.get("extratags") or {}).get("cuisine") or "").split(";")[0].replace("_", " ").strip().title()
        return {"city": ", ".join(x for x in (area, town) if x), "lat": float(r["lat"]), "lon": float(r["lon"]), "cuisine": cuisine}
    return {}


# ---------- IMDb ratings: IMDb's own free ratings dataset (personal use), matched by IMDb id (which Wikidata knows for each film / series) ----------
IMDB_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"   # ~7 MB, refreshed daily by IMDb; downloaded only when you press the button in Settings


def run_bg(fn, *args):
    """Background work (enrichment, downloads) lives in one place so tests can switch it off."""
    threading.Thread(target=fn, args=args, daemon=True).start()


def imdb_db_path():
    return os.path.join(os.environ.get("LIFE_DATA", "data"), "imdb.db")


def imdb_available():
    return os.path.exists(imdb_db_path())


def imdb_import(gz_path):
    """title.ratings.tsv.gz (tconst, averageRating, numVotes) -> a small local SQLite index. Returns the number of rows kept."""
    import gzip, sqlite3
    tmp = imdb_db_path() + ".new"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.execute("CREATE TABLE r(t TEXT PRIMARY KEY, rating REAL, votes INTEGER) WITHOUT ROWID")
    rows = []
    with gzip.open(gz_path, "rt", encoding="utf8") as f:
        next(f, None)   # header
        for line in f:
            t, r, v = line.rstrip("\n").split("\t")[:3]
            if t.startswith("tt") and v.isdigit() and int(v) >= 25:
                rows.append((t, float(r), int(v)))
            if len(rows) >= 50000:
                db.executemany("INSERT OR REPLACE INTO r VALUES(?,?,?)", rows); rows = []
    db.executemany("INSERT OR REPLACE INTO r VALUES(?,?,?)", rows)
    n = db.execute("SELECT COUNT(*) FROM r").fetchone()[0]
    db.commit(); db.close()
    os.replace(tmp, imdb_db_path())
    return n


def imdb_rating(tconst):
    """'7.8' for an IMDb id, or '' (no dataset yet, or too few votes)."""
    if not tconst or not imdb_available():
        return ""
    import sqlite3
    try:
        db = sqlite3.connect(imdb_db_path())
        row = db.execute("SELECT rating FROM r WHERE t=?", (tconst,)).fetchone()
        db.close()
    except Exception:
        return ""
    return f"{row[0]:.1f}" if row else ""


def imdb_download():
    """Fetch IMDb's ratings file (size-capped), index it. Returns rows kept."""
    import requests, tempfile
    with tempfile.NamedTemporaryFile(suffix=".gz", delete=False) as f:
        path = f.name
        with requests.get(IMDB_URL, stream=True, timeout=60, headers={"User-Agent": "Life-personal-app/1.0"}) as r:
            r.raise_for_status()
            size = 0
            for chunk in r.iter_content(1 << 16):
                size += len(chunk)
                if size > 60_000_000:
                    raise RuntimeError("file larger than expected")
                f.write(chunk)
    try:
        return imdb_import(path)
    finally:
        os.unlink(path)


def imdb_refresh_items(raw_db, upsert):
    """Put the current rating on every film/series that has an IMDb id. Returns how many changed."""
    if not imdb_available():
        return 0
    c = raw_db(); n = 0
    try:
        for r in c.execute("SELECT id,data FROM records WHERE kind='list_item' AND deleted_at IS NULL").fetchall():
            d = json.loads(r["data"]); new = imdb_rating(d.get("imdb_id"))
            if new and new != d.get("imdb"):
                upsert(c, {"id": r["id"], "kind": "list_item", "data": {"imdb": new}}); n += 1
        c.commit()
    finally:
        c.close()
    return n


def wikidata_media(title):
    """Genre, original language and release year of a film / series / book from Wikidata (free, no key; knows 2026 releases the model has never seen). {} if not found."""
    import requests
    def get(**params):
        for _ in range(2):
            try:
                r = requests.get("https://www.wikidata.org/w/api.php", params={**params, "format": "json"}, headers={"User-Agent": "Life-personal-app/1.0"}, timeout=10)
                if r.ok:
                    return r.json()
            except Exception:
                pass
            time.sleep(1.5)
        return {}
    found = [x for x in get(action="wbsearchentities", search=title, language="en", type="item", limit=6).get("search", []) if re.search(r"film|movie|series|television|novel|book|anime", x.get("description", ""), re.I)]
    if not found:
        return {}
    hit = next((x for x in found if x.get("label", "").lower() == title.lower()), found[0])
    claims = (get(action="wbgetentities", ids=hit["id"], props="claims").get("entities", {}).get(hit["id"], {}) or {}).get("claims", {})
    ids = lambda pr: [x["mainsnak"]["datavalue"]["value"]["id"] for x in claims.get(pr, []) if x.get("mainsnak", {}).get("datavalue")]
    year = next((x["mainsnak"]["datavalue"]["value"]["time"][1:5] for x in claims.get("P577", []) if x.get("mainsnak", {}).get("datavalue")), "")
    imdb_id = next((x["mainsnak"]["datavalue"]["value"] for x in claims.get("P345", []) if x.get("mainsnak", {}).get("datavalue")), "")
    want = ids("P136")[:4] + ids("P364")[:2]
    labels = {}
    if want:
        ents = get(action="wbgetentities", ids="|".join(want), props="labels", languages="en").get("entities", {})
        labels = {k: v["labels"]["en"]["value"] for k, v in ents.items() if "en" in v.get("labels", {})}
    tidy = lambda g: re.sub(r"\s*(film|television series|television program|fiction|novel|anime)$", "", g, flags=re.I).strip().capitalize()
    genres = list(dict.fromkeys(tidy(labels[i]) for i in ids("P136") if i in labels and tidy(labels[i])))[:3]
    desc = hit.get("description", "").lower()
    return {"genre": ", ".join(genres), "language": ", ".join(labels[i] for i in ids("P364")[:2] if i in labels), "year": year,
            "medium": "show" if re.search(r"series|television", desc) else "book" if re.search(r"novel|book", desc) else "movie", "imdb_id": imdb_id if re.fullmatch(r"tt\d+", imdb_id) else ""}


def post_places(url, names, complete):
    """For places saved from an Instagram post: re-read that post (caption + slides) for each place's area, cuisine and price. {name: {...}}"""
    from integrations import fetch_meta, fetch_slides
    try:
        meta = fetch_meta(url, 2000, "facebookexternalhit/1.1"); text = f"{meta['title']}\n{meta['desc']}".strip()
    except Exception:
        text = ""
    try:
        slides = fetch_slides(url)
    except Exception:
        slides = []
    if not text and not slides:
        return {}
    ask = ("These places were saved from this Instagram post: " + json.dumps(names, ensure_ascii=False) + ". For each place give, as stated or shown in the post: "
           '"city" (neighbourhood and city, from addresses or location text, e.g. "Jumeirah, Dubai"), "cuisine" (short type), "price" ($ to $$$$: from prices shown, else estimate from the kind of place). '
           'Reply with JSON only: {"places":[{"name":"","city":"","cuisine":"","price":""}]}. Leave "city" empty if the post does not say where it is.')
    content = [{"type": "text", "text": text or "(no caption)"}] + [{"type": "image", "source": {"type": "base64", "media_type": mt, "data": base64.b64encode(b).decode()}} for mt, b in slides]
    try:
        out = complete("fast", ask, content, 4000)
        return {str(x.get("name", "")).lower(): x for x in json.loads(re.search(r"\{.*\}", out or "{}", re.S).group(0)).get("places") or []}
    except Exception as e:
        logging.warning("enrich: post read failed - %s %s", type(e).__name__, str(e)[:120])
        return {}


def enrich_ids(raw_db, upsert, settings, ids=None, limit=10, force=False):
    """Fill the blanks of list items. ids=None: scan for items that lack details (skipping ones tried in the last 14 days); returns how many were updated."""
    if COMPLETE is None:
        return 0
    c = raw_db(); done = 0
    try:
        lists = {r["id"]: json.loads(r["data"]) for r in c.execute("SELECT id,data FROM records WHERE kind='list' AND deleted_at IS NULL")}
        recent = (datetime.now() - timedelta(days=14)).isoformat()
        cand = []
        for r in c.execute("SELECT id,data FROM records WHERE kind='list_item' AND deleted_at IS NULL ORDER BY created_at DESC"):
            if ids is not None and r["id"] not in ids:
                continue
            d = json.loads(r["data"]); lt = (lists.get(d.get("list")) or {}).get("type")
            kind = {"restaurant": "restaurant", "media": "media"}.get(lt)
            if not kind or not d.get("title"):
                continue
            missing = [f for f in ENRICH_KINDS[kind] + (("imdb",) if kind == "media" and imdb_available() else ()) if not d.get(f)] + (["pin"] if kind == "restaurant" and d.get("lat") is None else [])
            if not missing or (ids is None and not force and (d.get("enriched") or "") > recent):
                continue
            cand.append((r["id"], d, kind, lists[d["list"]].get("name") or ""))
            if len(cand) >= limit:
                break
        if not cand:
            return 0
        payload = [{"n": n, "kind": k, "title": d["title"], "list": ln, "known": {f: d.get(f) for f in ENRICH_KINDS[k] if d.get(f)}, "notes": (d.get("notes") or "")[:200]} for n, (_, d, k, ln) in enumerate(cand)]
        ai = {}
        try:
            out = COMPLETE("fast", ENRICH_PROMPT, json.dumps(payload, ensure_ascii=False), 4000)
            ai = {int(x["n"]): x for x in json.loads(re.search(r"\{.*\}", out or "{}", re.S).group(0)).get("items") or [] if str(x.get("n", "")).isdigit()}
        except Exception as e:
            logging.warning("enrich: AI step failed - %s %s", type(e).__name__, str(e)[:120])
        s = settings(); home = (s.get("home_lat"), s.get("home_lon")) if s.get("home_lat") is not None else None
        clean = lambda v, n=80: str(v or "").strip()[:n]
        posts = {}   # places saved from an Instagram post: one re-read of the post per post (it often names several)
        for rid, d, kind, _ in cand:
            m = re.search(r"Post: (https://\S+)", d.get("notes") or "")
            if kind == "restaurant" and m and (not d.get("city") or d.get("city").lower() in ("dubai", "abu dhabi") or not d.get("price")):
                posts.setdefault(m.group(1), []).append(d["title"])
        from_post = {}
        for url, names in posts.items():
            from_post[url] = post_places(url, names, COMPLETE)
        for n, (rid, d, kind, _) in enumerate(cand):
            a = ai.get(n, {}); patch = {"enriched": datetime.now().isoformat()}
            if kind == "restaurant":
                m = re.search(r"Post: (https://\S+)", d.get("notes") or ""); pp = (from_post.get(m.group(1)) or {}).get(d["title"].lower(), {}) if m else {}
                osm = {}
                if d.get("lat") is None:
                    osm = osm_place(d["title"], d.get("city") or "", home); time.sleep(1.1)   # OpenStreetMap asks for at most one request a second
                if osm:
                    patch.update(lat=osm["lat"], lon=osm["lon"])
                area = clean(pp.get("city"), 60) or osm.get("city") or clean(a.get("city"), 60)
                if area and (not d.get("city") or (d["city"].lower() in ("dubai", "abu dhabi") and "," in area and area.lower().endswith(d["city"].lower()))):
                    patch["city"] = area   # a bare "Dubai" gets upgraded to "Jumeirah, Dubai"; anything more specific you typed stays
                if not d.get("cuisine"):
                    cu = clean(pp.get("cuisine"), 40) or osm.get("cuisine") or clean(a.get("cuisine"), 40)
                    if cu: patch["cuisine"] = cu
                if not d.get("price"):
                    pr = clean(pp.get("price")) if clean(pp.get("price")) in ("$", "$$", "$$$", "$$$$") else clean(a.get("price"))
                    if pr in ("$", "$$", "$$$", "$$$$"): patch["price"] = pr
            else:
                wd = {}
                if not (d.get("genre") and d.get("language") and d.get("year")):
                    wd = wikidata_media(d["title"]); time.sleep(0.4)
                for f in ("genre", "language", "year"):
                    v = wd.get(f) or (clean(a.get(f), 60) if f != "year" or re.fullmatch(r"\d{4}", clean(a.get(f))) else "")
                    if not d.get(f) and v: patch[f] = v
                if wd.get("imdb_id") and not d.get("imdb_id"):
                    patch["imdb_id"] = wd["imdb_id"]
                rating = imdb_rating(wd.get("imdb_id") or d.get("imdb_id"))
                if rating and not d.get("imdb"):
                    patch["imdb"] = rating
                md = wd.get("medium") if wd.get("genre") else clean(a.get("medium")).lower()
                if not d.get("medium") and md in ("movie", "show", "book"): patch["medium"] = md
            upsert(c, {"id": rid, "kind": "list_item", "data": patch}); c.commit(); done += 1
    finally:
        c.close()
    return done


HEADING_RE = re.compile(r"\b(?:top|best)\s+(?:\d+|ten|five|three|twenty)\b|\b\d+\s+(?:movies|films|shows|series|places|spots|restaurants|cafes|books|things)\b|\bso far\b|^(?:my|our|your|these|here are|some)\b.*\b(?:movies|films|series|shows|books|places|spots|favou?rites?|picks)\b", re.I)


def clean_title(t):
    """The model sometimes returns a slide heading ('My top 10 movies so far') or leaves an '(... image placeholder)' note in a title. '' = not a real item."""
    t = re.sub(r"\s*[(\[][^)\]]*\b(?:placeholder|image|slide|photo)\b[^)\]]*[)\]]", "", t or "", flags=re.I).strip(" -–—:|")
    return "" if HEADING_RE.search(t) else t


def omdb_lookup(title, year, kind):
    """Real year/genre/cast/director/IMDb rating for a film or series. Optional: needs a free OMDB_API_KEY (omdbapi.com); {} without it."""
    key = os.environ.get("OMDB_API_KEY")
    if not key:
        return {}
    import requests
    try:
        j = requests.get("https://www.omdbapi.com/", params={"apikey": key, "t": title, "type": "series" if kind == "show" else "movie", **({"y": year} if re.fullmatch(r"\d{4}", year or "") else {})}, timeout=6).json()
    except Exception:
        return {}
    if j.get("Response") != "True":
        return {}
    na = lambda v: "" if v in (None, "N/A") else v
    return {k: na(v) for k, v in {"year": (j.get("Year") or "")[:4], "genre": j.get("Genre"), "cast": j.get("Actors"), "language": ", ".join((j.get("Language") or "").split(", ")[:2]), "creator": j.get("Director") if kind == "movie" else j.get("Writer"), "imdb": j.get("imdbRating")}.items() if na(v)}


URL_RE = re.compile(r"https?://[^\s<>\"']+")


def close_tool_calls(msgs):
    """Every tool_use must be answered by a tool_result in the next user turn. Fill in any the user never confirmed
    (they typed a new message first, left the page, or reopened an old chat) so the provider doesn't reject the history."""
    out = []
    for m in msgs:
        prev = out[-1] if out else None
        if m["role"] == "user" and prev and prev["role"] == "assistant" and isinstance(prev["content"], list):
            c = m["content"] if isinstance(m["content"], list) else [{"type": "text", "text": m["content"]}]
            have = {b.get("tool_use_id") for b in c if b.get("type") == "tool_result"}
            miss = [{"type": "tool_result", "tool_use_id": b["id"], "content": "The user did not confirm this action."} for b in prev["content"] if b.get("type") == "tool_use" and b["id"] not in have]
            if miss:
                m = {**m, "content": miss + c}
        out.append(m)
    return out


# ---------- privacy ----------
SCRUBS = [(re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b"), "[iban]"), (re.compile(r"\b(?:\d[ -]?){12,19}\b"), "[card/account]"), (re.compile(r"\b[A-Z]{1,2}\d{6,9}\b"), "[id]"), (re.compile(r"\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b"), "[id]"), (re.compile(r"\b\d{6,}\b"), "[number]")]


def scrub(text):
    for rx, rep in SCRUBS:
        text = rx.sub(rep, text)
    return text


def strip_sensitive(obj):
    """Deep-scrub strings in anything we send out."""
    if isinstance(obj, str):
        return scrub(obj)
    if isinstance(obj, list):
        return [strip_sensitive(x) for x in obj]
    if isinstance(obj, dict):
        return {k: strip_sensitive(v) for k, v in obj.items()}
    return obj


def register(app, login_required, db, raw_db, set_state, kv_get, kv_set, settings, now_iso, upsert, audit):
    def recs(kind, pred=None, limit=500):
        out = []
        for r in db().execute("SELECT id,data,updated_at FROM records WHERE kind=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?", (kind, limit)):
            d = json.loads(r["data"]); d["id"] = r["id"]
            if not pred or pred(d):
                out.append(d)
        return out

    def month_key():
        return "ai_usage:" + datetime.now().strftime("%Y-%m")

    def prices(model):
        p = (settings().get("ai_prices") or {}).get(model) or PRICES.get(model) or [5, 25]
        return p

    def spend(model, usage):
        u = kv_get(month_key(), {"in": 0, "out": 0, "cost": 0.0, "calls": 0})
        i, o = getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0
        cr = getattr(usage, "cache_read_input_tokens", 0) or 0
        p = prices(model)
        u["in"] += i + cr; u["out"] += o; u["calls"] += 1
        u["cost"] = round(u["cost"] + (i * p[0] + o * p[1] + cr * p[0] * 0.1) / 1e6, 5)
        kv_set(month_key(), u)

    def over_cap():
        cap = float(settings().get("ai_monthly_cap_usd") or 0)
        return cap > 0 and kv_get(month_key(), {"cost": 0})["cost"] >= cap

    def openai_key():
        return settings().get("openai_key") or os.environ.get("OPENAI_API_KEY") or ""

    def use_openai():   # one OpenAI key (Settings) powers chat and voice; Claude only if you choose it and have its key
        has_claude = bool(os.environ.get("ANTHROPIC_API_KEY"))
        return bool(openai_key()) and not (settings().get("ai_provider") == "anthropic" and has_claude)

    def configured():
        return bool(os.environ.get("ANTHROPIC_API_KEY")) or bool(openai_key()) or os.environ.get("LIFE_AI_MOCK") == "1"

    def client():
        if os.environ.get("LIFE_AI_MOCK") == "1":
            from mock_ai import MockClient
            return MockClient()
        if use_openai():
            from openai_client import OpenAIClient
            return OpenAIClient(openai_key())
        import anthropic
        return anthropic.Anthropic()   # key from ANTHROPIC_API_KEY (.env), never exposed to the browser

    def model_for(tier):
        s = settings()
        if use_openai() and os.environ.get("LIFE_AI_MOCK") != "1":
            return {"chat": s["oa_model"], "fast": s["oa_fast_model"], "plan": s["oa_strong_model"]}[tier]
        return {"chat": s["ai_model"], "fast": s["ai_fast_model"], "plan": s["ai_strong_model"]}[tier]

    # ---------- context ----------
    def snapshot(modules, health_ok):
        tz = ZoneInfo(settings()["timezone"]); today = datetime.now(tz).date()
        out = {}
        if "tasks" in modules:
            ts = recs("task", lambda d: not d.get("done") and not d.get("someday"))
            ts.sort(key=lambda d: (d.get("due") or "9999", d.get("priority") or 3))
            out["open_tasks"] = [{"id": d["id"], "title": d.get("title"), "due": d.get("due"), "priority": d.get("priority"), "ctx": d.get("ctx")} for d in ts[:25]]
        if "notes" in modules:
            out["recent_notes"] = [{"id": d["id"], "title": d.get("title") or (d.get("body") or "")[:40]} for d in recs("note", None, 15)]
        if "lists" in modules:
            ls = {l["id"]: l for l in recs("list")}
            out["lists"] = [{"name": l.get("name"), "type": l.get("type"), "items": sum(1 for i in recs("list_item", lambda x: x.get("list") == l["id"], 1000))} for l in ls.values()]
        if "goals" in modules:
            out["goals"] = [{"id": g["id"], "title": g.get("title"), "why": g.get("why"), "status": g.get("status"), "deadline": g.get("deadline")} for g in recs("goal", lambda g: g.get("status") == "active")]
        if "travel" in modules:
            out["trips"] = [{"id": t["id"], "name": t.get("name"), "start": t.get("start"), "end": t.get("end")} for t in recs("trip")][:10]
            out["document_expiries"] = [{"name": d.get("name"), "type": d.get("type"), "expiry": d.get("expiry")} for d in recs("travel_doc")]   # never numbers
        if health_ok:
            out["health_last_3_days"] = [{k: d.get(k) for k in ("day", "sleep_h", "steps", "rhr", "body_battery")} for d in sorted(recs("garmin_daily"), key=lambda x: x.get("day", ""), reverse=True)[:3]]
            out["mood_last_3_days"] = [{k: d.get(k) for k in ("day", "mood", "energy")} for d in sorted(recs("mood_log"), key=lambda x: x.get("day", ""), reverse=True)[:6]]
        return out

    def build_system(ctxinfo, modules, health_ok):
        s = settings(); tz = ZoneInfo(s["timezone"]); now = datetime.now(tz)
        persona = {"coach": "Warm but direct, like a good coach: encourage, then name the next step.", "friend": "Warm and direct, like a thoughtful friend. Never preachy or cheesy.", "nonsense": "No-nonsense and brief. No pleasantries."}.get(s.get("persona"), "Warm and direct.")
        mem = [m.get("text") for m in recs("assistant_memory")]
        parts = [f"You are Life's assistant for one person, {s['name']}, inside their private life-management app. {persona}",
                 f"Now: {now.strftime('%A %Y-%m-%d %H:%M')} ({s['timezone']}). Home currency {s['currency']}. Work week: days {s['work_days']} (0=Sun).",
                 "Ground answers in the user's own data (snapshot + tools). When you refer to a saved item, append its reference like [ref:task:ID], [ref:note:ID], [ref:goal:ID] or [ref:trip:ID] so the app can link it. If you don't know, say so; never invent personal data.",
                 "To change anything, call a tool; the user sees a confirm card first. Prefer one tool call per distinct action. Do not claim something was done until the tool result says so.",
                 "You are not a doctor, lawyer, financial adviser or visa authority: flag uncertainty and point to official sources for medical, legal, financial and visa questions.",
                 "The user often talks to you by voice (transcripts can have small mishearings; infer the obvious meaning). When they dump what's on their mind or describe something big, do the work: split it into separate concrete actions and call a tool for EACH one in the same turn (tasks with sensible due dates/priorities, reminders, events, notes for loose thoughts, list items). Break a big goal into 3-8 small next-step tasks that share one short `project` name. Resolve relative dates from Now. Ask a question only if you truly cannot proceed; otherwise act, then summarise in one or two lines what you set up.",
                 "Keep replies short and concrete. Plain text; no tables unless asked."]
        if mem:
            parts.append("What you know about the user (they can edit this):\n- " + "\n- ".join(mem))
        parts.append("Snapshot of their data (may be partial; use tools for detail):\n" + json.dumps(strip_sensitive(snapshot(modules, health_ok)), ensure_ascii=False))
        if ctxinfo:
            parts.append("The user is currently looking at: " + json.dumps(strip_sensitive(ctxinfo), ensure_ascii=False)[:1500])
        return "\n\n".join(parts)

    def tools_for(health_ok, wealth_ok):
        t = [x for x in READ_TOOLS if (x["name"] != "read_health" or health_ok) and (x["name"] != "wealth_summary" or wealth_ok)]
        return t + WRITE_TOOLS

    # ---------- read-tool execution ----------
    def run_read(name, inp, modules, health_ok):
        if name == "search_notes":
            m = " ".join('"' + w + '"*' for w in re.sub(r"[^\w\s]", " ", inp.get("query", "")).split())
            if not m:
                return []
            rows = db().execute("SELECT f.id,f.kind,r.data FROM fts f JOIN records r ON r.id=f.id WHERE fts MATCH ? AND r.deleted_at IS NULL LIMIT 12", (m,)).fetchall()
            return strip_sensitive([{"kind": r["kind"], "id": r["id"], "title": json.loads(r["data"]).get("title") or json.loads(r["data"]).get("name"), "text": (json.loads(r["data"]).get("body") or json.loads(r["data"]).get("notes") or "")[:300]} for r in rows])
        if name == "list_tasks":
            ts = recs("task", lambda d: not d.get("done"))
            if inp.get("due_before"): ts = [d for d in ts if d.get("due") and d["due"] <= inp["due_before"]]
            if inp.get("context"): ts = [d for d in ts if d.get("ctx") == inp["context"]]
            ts.sort(key=lambda d: d.get("due") or "9999")
            return strip_sensitive([{"id": d["id"], "title": d.get("title"), "due": d.get("due"), "time": d.get("due_time"), "priority": d.get("priority"), "ctx": d.get("ctx")} for d in ts[: int(inp.get("limit") or 30)]])
        if name == "query_calendar":
            a, b = inp["from"], inp["to"]
            ev = [{"title": d.get("title"), "date": d.get("date"), "start": d.get("start"), "end": d.get("end")} for d in recs("event", lambda d: a <= (d.get("date") or "") <= b)]
            for r in db().execute("SELECT title,start,end FROM feed_events WHERE substr(start,1,10)>=? AND substr(start,1,10)<=? ORDER BY start LIMIT 60", (a, b)):
                ev.append({"title": r["title"], "start_utc": r["start"], "source": "calendar feed"})
            return strip_sensitive(ev)
        if name == "list_items":
            ls = {l["id"]: l.get("name") for l in recs("list")}
            q = (inp.get("query") or "").lower(); ln = (inp.get("list") or "").lower()
            its = recs("list_item", lambda d: (not ln or ln in (ls.get(d.get("list")) or "").lower()) and (not q or q in json.dumps(d).lower()), 600)
            return strip_sensitive([{"id": d["id"], "list": ls.get(d.get("list")), "title": d.get("title"), "status": d.get("status"), "city": d.get("city") or d.get("area"), "cuisine": d.get("cuisine"), "rating": d.get("rating"), "notes": (d.get("notes") or "")[:120]} for d in its[:40]])
        if name == "goal_progress":
            return strip_sensitive([{"id": g["id"], "title": g.get("title"), "status": g.get("status"), "deadline": g.get("deadline"), "target": g.get("target"), "milestones_done": sum(1 for m in g.get("milestones", []) if m.get("done")), "milestones": len(g.get("milestones", []))} for g in recs("goal")])
        if name == "get_travel":
            return strip_sensitive({"countries": [{"code": c.get("code"), "status": c.get("status")} for c in recs("country")], "visits": [{"country": v.get("country"), "start": v.get("start")} for v in recs("visit")], "trips": [{"id": t["id"], "name": t.get("name"), "start": t.get("start"), "end": t.get("end")} for t in recs("trip")], "documents": [{"name": d.get("name"), "type": d.get("type"), "expiry": d.get("expiry")} for d in recs("travel_doc")]})
        if name == "read_health":
            if not health_ok:
                return {"error": "Health data is not enabled for the assistant."}
            n = int(inp.get("days") or 7); cut = (date.today() - timedelta(days=n)).isoformat()
            return {"daily": [d for d in recs("garmin_daily", lambda d: d.get("day", "") >= cut)], "mood": [d for d in recs("mood_log", lambda d: d.get("day", "") >= cut)]}
        if name == "wealth_summary":
            import requests
            s = settings()
            try:
                r = requests.get(s["wealth_url"].rstrip("/") + "/api/life/summary", headers={"Authorization": "Bearer " + s["wealth_token"]}, timeout=6); r.raise_for_status()
                return strip_sensitive(r.json())
            except Exception:
                return {"error": "wealth app unreachable"}
        return {"error": "unknown tool"}

    # ---------- the conversation endpoint (SSE) ----------
    def sse(obj):
        return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"

    def prepare(body):
        s = settings()
        modules = set(s.get("ai_enabled_modules") or [])
        health_ok = bool(s.get("ai_health"))
        wealth_ok = "wealth" in modules and bool(s.get("wealth_url"))
        tier = body.get("tier") if body.get("tier") in EFFORT else "chat"
        system = build_system(body.get("context"), modules, health_ok)
        tools = tools_for(health_ok, wealth_ok)
        msgs = close_tool_calls(strip_sensitive(body.get("messages") or []))
        return s, modules, health_ok, tier, system, tools, msgs

    @app.get("/api/ai/status")
    @login_required
    def ai_status():
        s = settings(); u = kv_get(month_key(), {"in": 0, "out": 0, "cost": 0.0, "calls": 0})
        return jsonify(configured=configured(), mock=os.environ.get("LIFE_AI_MOCK") == "1", models={t: model_for(t) for t in ("chat", "fast", "plan")}, usage=u, cap=s.get("ai_monthly_cap_usd"), over_cap=over_cap())

    @app.post("/api/ai/preview")
    @login_required
    def ai_preview():
        s, modules, health_ok, tier, system, tools, msgs = prepare(request.get_json() or {})
        return jsonify(model=model_for(tier), system=system, tools=[t["name"] for t in tools], messages=msgs[-6:], chars=len(system) + sum(len(json.dumps(m)) for m in msgs), modules=sorted(modules), health=health_ok)

    @app.post("/api/ai/chat")
    @login_required
    def ai_chat():
        if not configured():
            return jsonify(error="The assistant isn't set up: add an OpenAI key in Settings → Voice & assistant (or ANTHROPIC_API_KEY to .env)."), 400
        body = request.get_json() or {}
        s, modules, health_ok, tier, system, tools, msgs = prepare(body)
        if over_cap():
            return jsonify(error=f"You've reached this month's AI cap (${s.get('ai_monthly_cap_usd')}). Raise it in Settings if you want to continue."), 402
        model = model_for(tier)

        @stream_with_context
        def gen():
            c = client(); messages = list(msgs); done_results = []
            try:
                for _ in range(6):
                    kw = dict(model=model, max_tokens=8000, system=system, messages=messages, tools=tools, output_config={"effort": EFFORT[tier]})
                    with c.messages.stream(**kw) as st:
                        for t in st.text_stream:
                            yield sse({"type": "text", "delta": t})
                        final = st.get_final_message()
                    spend(model, final.usage)
                    if final.stop_reason == "refusal":
                        yield sse({"type": "end", "stop": "refusal", "text": "I can’t help with that one."}); return
                    content = [b.model_dump(mode="json", exclude_none=True) for b in final.content]
                    uses = [b for b in content if b.get("type") == "tool_use"]
                    if final.stop_reason != "tool_use" or not uses:
                        yield sse({"type": "end", "stop": final.stop_reason, "assistant_content": content, "done_results": done_results, "pending": []}); return
                    results, pending = [], []
                    for u in uses:
                        if u["name"] in WRITE_NAMES:
                            pending.append({"id": u["id"], "name": u["name"], "input": u["input"], "low_risk": u["name"] in LOW_RISK})
                        else:
                            yield sse({"type": "status", "tool": u["name"]})
                            try:
                                out = run_read(u["name"], u["input"], modules, health_ok)
                            except Exception as e:
                                out = {"error": str(e)[:100]}
                            results.append({"type": "tool_result", "tool_use_id": u["id"], "content": json.dumps(out, ensure_ascii=False)[:12000]})
                    if pending:   # hand control to the browser: confirm cards. It resumes with all tool_results in one user message.
                        yield sse({"type": "end", "stop": "confirm", "assistant_content": content, "done_results": results, "pending": pending}); return
                    messages = messages + [{"role": "assistant", "content": content}, {"role": "user", "content": results}]
                yield sse({"type": "end", "stop": "loop_limit", "pending": []})
            except Exception as e:
                name = type(e).__name__
                msg = "Rate limited — try again in a minute." if "RateLimit" in name else "The AI service is unreachable right now." if "Connection" in name else "Something went wrong talking to the AI: " + str(e)[:120]
                set_state("ai", False, msg)
                yield sse({"type": "error", "error": msg})
            else:
                set_state("ai", True, "", f"{model}")
        return Response(gen(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ---------- voice: speech-to-text on this PC (browser SpeechRecognition is unreliable in home-screen web apps) ----------
    stt = {"model": None}

    def transcribe_audio(path):
        key = settings().get("openai_key") or os.environ.get("OPENAI_API_KEY")
        if key:   # hosted, fast, accurate; the audio leaves this PC. Without a key we fall back to the local model below.
            import requests
            with open(path, "rb") as f:
                r = requests.post("https://api.openai.com/v1/audio/transcriptions", headers={"Authorization": "Bearer " + key}, files={"file": (os.path.basename(path), f)}, data={"model": os.environ.get("LIFE_STT_MODEL", "gpt-4o-mini-transcribe")}, timeout=60)
            r.raise_for_status()
            return (r.json().get("text") or "").strip()
        if stt["model"] is None:
            from faster_whisper import WhisperModel   # first use downloads the model once (~0.5 GB for "small")
            stt["model"] = WhisperModel(os.environ.get("LIFE_WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
        for vad in (True, False):   # VAD trims silence but can swallow quiet phone audio, so retry without it
            segs, _ = stt["model"].transcribe(path, beam_size=1, vad_filter=vad)   # language auto-detected
            text = " ".join(x.text.strip() for x in segs).strip()
            if text:
                return text
        return ""

    @app.post("/api/ai/transcribe")
    @login_required
    def ai_transcribe():
        blob = request.get_data()
        if not blob or len(blob) > 12_000_000:
            return jsonify(error="No audio, or too long (keep it under a few minutes)."), 400
        ext = ".mp4" if "mp4" in request.mimetype else ".ogg" if "ogg" in request.mimetype else ".webm"
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(blob); path = f.name
        try:
            return jsonify(text=transcribe_audio(path))
        except ImportError:   # local fallback only
            return jsonify(error="Voice isn't installed on the server: run  pip install faster-whisper  and restart Life."), 501
        except Exception as e:
            return jsonify(error="Couldn't transcribe that: " + str(e)[:100]), 502
        finally:
            os.unlink(path)

    # ---------- one-shot helpers (fast / strong models) ----------
    def complete(tier, system, user, max_tokens=1200):
        if not configured() or over_cap():
            return None
        c = client(); model = model_for(tier)
        r = c.messages.create(model=model, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": strip_sensitive(user) if isinstance(user, str) else [{**b, "text": scrub(b["text"])} if b["type"] == "text" else b for b in user]}], output_config={"effort": EFFORT[tier]})
        spend(model, r.usage)
        return "".join(b.text for b in r.content if b.type == "text").strip()

    globals()["COMPLETE"] = complete   # the module-level enrichment helpers use the same cheap call

    @app.post("/api/ai/briefing")
    @login_required
    def ai_briefing():
        facts = (request.get_json() or {}).get("facts", {})
        try:
            t = complete("fast", "Write ONE or TWO short sentences that brief the user on their day from these facts. Warm, specific, no cheer-leading, no emoji. Mention the first meeting time and anything due if present; if sleep was short, suggest going easy and picking one big thing. Output only the sentences.", json.dumps(facts))
            return jsonify(text=t)
        except Exception as e:
            return jsonify(text=None, error=str(e)[:100])

    # ---------- decisions: OpenAI's Decisions API picks one of YOUR answers (fast, ~$0.10/M tokens). Falls back to a small model if not enabled on this key. ----------
    dec = {"on": True}

    def decide(text, questions):
        """questions: [{"name", "instructions", "choices": [str]}] -> {name: chosen value}; {} if nothing could answer."""
        if use_openai() and dec["on"] and os.environ.get("LIFE_AI_MOCK") != "1":
            import requests
            try:
                body = {"model": os.environ.get("LIFE_DECISIONS_MODEL", "gpt-6-luna"), "input": strip_sensitive(text), "questions": [{"type": "choice", "name": q["name"], "instructions": q["instructions"], "choices": [{"value": c} for c in q["choices"]]} for q in questions]}
                r = requests.post("https://api.openai.com/v1/decisions", headers={"Authorization": "Bearer " + openai_key()}, json=body, timeout=15)
                if r.status_code in (403, 404):
                    dec["on"] = False   # ponytail: not enabled for this key; stops retrying until restart
                else:
                    r.raise_for_status()
                    out = {}
                    for q, a in zip(questions, r.json()["answers"]):
                        v = a.get("choice"); v = v.get("value") if isinstance(v, dict) else v
                        if v in q["choices"]:
                            out[q["name"]] = v
                    if out:
                        return out
            except Exception:
                pass
        try:
            spec = "; ".join(f'"{q["name"]}": {q["instructions"]} One of {q["choices"]}' for q in questions)
            t = complete("fast", "Answer each question by picking exactly one allowed value. Reply with JSON only, e.g. {\"name\": \"value\"}. Questions: " + spec, text, 800)
            j = json.loads(re.search(r"\{.*\}", t or "{}", re.S).group(0))
            return {q["name"]: j[q["name"]] for q in questions if j.get(q["name"]) in q["choices"]}
        except Exception:
            return {}

    @app.post("/api/ai/route")
    @login_required
    def ai_route():
        """Pick the model tier for a spoken/typed message: only big multi-part plans need the strong model."""
        text = (request.get_json() or {}).get("text", "")
        k = decide(text, [{"name": "kind", "instructions": "What is the user asking their life-management assistant? question = asking about their data or for advice; simple = one or two small things to do; plan = a brain dump with several things, or a big goal to break down", "choices": ["question", "simple", "plan"]}]).get("kind")
        return jsonify(kind=k, tier="plan" if k == "plan" else "chat")

    @app.post("/api/ai/triage")
    @login_required
    def ai_triage():
        text = (request.get_json() or {}).get("text", "")
        return jsonify(dest=decide(text, [{"name": "dest", "instructions": "Where does this inbox item belong? task = something to do; note = information or an idea to keep; list_item = a place, restaurant, film, product or gift to remember; reminder = needs a time-based nudge; goal = a big long-term aim", "choices": ["task", "note", "list_item", "reminder", "goal"]}]).get("dest"))

    # ---------- share a post (Instagram etc.) -> the right list. Session (capture sheet) or write-only capture token (iOS Shortcut). ----------
    def share_authed():
        if session.get("ok"):
            return True if hmac.compare_digest(request.headers.get("X-CSRF", ""), session.get("csrf", "x")) else None   # None = logged in but no CSRF
        import app as core
        if not core.rate_ok("share:" + (request.remote_addr or ""), 60, 60):   # a leaked token can't be used to run up AI cost or be guessed quickly
            return False
        row = db().execute("SELECT id FROM capture_tokens WHERE hash=? AND revoked_at IS NULL", (hashlib.sha256(request.headers.get("Authorization", "")[7:].encode()).hexdigest(),)).fetchone()
        if row:
            db().execute("UPDATE capture_tokens SET last_used=?, uses=uses+1 WHERE id=?", (now_iso(), row["id"]))
            db().commit()   # release the write lock now: the AI step records its cost on another connection
        return bool(row)

    @app.post("/api/share-in")
    def share_post():
        ok = share_authed()
        if not ok:
            return (jsonify(error="csrf"), 403) if ok is None else (jsonify(error="auth"), 401)
        j = (request.get_json(silent=True) if request.is_json else None) or request.form.to_dict() or {}
        if j.get("test"):   # "is the Shortcut wired up right?": no AI, nothing saved
            return jsonify(ok=True, message="Connected: Life is reachable and this token works.")
        text = str(j.get("text") or "")[:6000].strip()
        m = URL_RE.search(str(j.get("url") or "") or text)
        url = m.group(0).rstrip(".,)") if m else ""
        page = ""
        if url:
            try:   # Instagram/TikTok only show their caption tags to link-preview bots
                from integrations import fetch_meta, fetch_article_text, IG_POST
                meta = fetch_meta(url, 2000, "facebookexternalhit/1.1")
                page = f"{meta['title']}\n{meta['desc']}".strip()
                if not IG_POST.match(url):   # a blog / article / video page: read the body too ("10 best brunch spots in Dubai")
                    page += "\n" + fetch_article_text(url)
            except Exception as e:
                logging.warning("share-in: couldn't read %s - %s", url, type(e).__name__ + " " + str(e)[:120])
        slides = []
        for f in request.files.getlist("images") + request.files.getlist("image"):   # screenshots / photos sent straight from the phone
            raw = f.read(5_000_001)
            if f.mimetype in ("image/jpeg", "image/png", "image/webp", "image/gif") and len(raw) <= 5_000_000 and len(slides) < 6:
                slides.append((f.mimetype, raw))
        for b64 in (j.get("images") if isinstance(j.get("images"), list) else [])[:6]:   # or base64 in JSON
            try:
                raw = base64.b64decode(str(b64).split(",")[-1], validate=False)
                if 0 < len(raw) <= 5_000_000 and len(slides) < 6:
                    slides.append(("image/png" if raw[:4] == b"\x89PNG" else "image/jpeg", raw))
            except Exception:
                pass
        if url:   # carousel posts often name the places/titles only on the slides, so the model gets to see them too
            try:
                from integrations import fetch_slides
                slides = (slides + fetch_slides(url))[:12]
            except Exception as e:
                logging.warning("share-in: no slides for %s - %s", url, type(e).__name__ + " " + str(e)[:120])
        items, body = [], f"{text}\n{page}".strip()
        if body or slides:
            out = ""
            try:
                names = ", ".join(f'"{l.get("name")}" ({l.get("type")})' for l in recs("list")) or "none"
                prompt = SHARE_PROMPT + " The user's existing lists: " + names
                content = body or "(no caption)"
                if slides:
                    prompt += " The attached images are the slides/photos of the post: read the text on them (names, addresses, prices); several slides often form one list."
                    content = [{"type": "text", "text": content}] + [{"type": "image", "source": {"type": "base64", "media_type": mt, "data": base64.b64encode(b).decode()}} for mt, b in slides]
                out = complete("fast", prompt, content, 4000)
                items = json.loads(re.search(r"\{.*\}", out or "{}", re.S).group(0)).get("items") or []
            except Exception as e:
                logging.warning("share-in: AI step failed - %s %s | model said: %s", type(e).__name__, str(e)[:160], repr(out)[:200])
        c = db(); added, dupes, new_ids, have = [], [], [], {}
        lists = recs("list")
        for it in items[:20]:
            ty, title = it.get("type"), clean_title(str(it.get("title") or "").strip()[:120])
            if ty not in SHARE_TYPES or not title:
                continue
            if title == title.lower():   # slides are often styled in lowercase
                title = re.sub(r"(?<![\w'’])[a-z]", lambda m: m.group().upper(), title)
            lname, ltype, status, fields, preset = SHARE_TYPES[ty]
            want = str(it.get("list") or "").strip().casefold()   # the model's pick must be a real list of a compatible type; never "any list of this type"
            lst = next((l for l in lists if want and (l.get("name") or "").casefold() == want and l.get("type") == ltype), None) or next((l for l in lists if (l.get("name") or "").casefold() == lname.casefold()), None)
            if not lst:
                lst = {"id": str(uuid.uuid4()), "name": lname, "type": ltype}; lists.append(lst)
                upsert(c, {"id": lst["id"], "kind": "list", "data": {"name": lname, "type": ltype}})
            if ltype not in have:   # every item already in a list of this kind (Restaurants + Cafes, Movies + Series...), loaded once per request
                ids_ = {l["id"] for l in lists if l.get("type") == ltype}
                have[ltype] = recs("list_item", lambda d: d.get("list") in ids_, 3000)
            cand = {"title": title, "city": it.get("city"), "year": it.get("year"), "medium": preset.get("medium") or (str(it.get("medium") or "").lower() or None)}
            if any(same_item(cand, d) for d in have[ltype]):
                dupes.append(title); continue
            rid = str(uuid.uuid4())
            addr = str(it.get("address") or "").strip()
            notes = [str(it.get("notes") or "").strip(), "Address: " + addr if addr else "", "Post: " + url if url else ""]
            d = {"list": lst["id"], "title": title, "status": status, "order": int(time.time() * 1000), "notes": "\n".join(x for x in notes if x)}
            if ty in ("movie", "show"):   # real data beats the model's memory
                it = {**it, **omdb_lookup(title, str(it.get("year") or ""), ty)}
            d.update({k: str(it[k]).strip()[:80] for k in fields + (("imdb",) if ty in ("movie", "show") else ()) if it.get(k)}); d.update(preset)
            tags = [str(x).strip().lower()[:30] for x in (it.get("tags") or []) if str(x).strip()][:4] if isinstance(it.get("tags"), list) else []
            if tags:
                d["tags"] = tags
            if ltype in ("restaurant", "play"):   # tap-to-open maps link in the item's link field
                from urllib.parse import quote_plus
                d["url"] = "https://www.google.com/maps/search/?api=1&query=" + quote_plus(f"{title} {addr or it.get('city') or ''}".strip())
            if ltype in ("restaurant", "media") and url:   # "Who recommended": Instagram
                d["source"] = re.sub(r"^www\.", "", url.split("/")[2]).split(".")[0].capitalize()
            upsert(c, {"id": rid, "kind": "list_item", "data": d}); have[ltype].append({**d, "city": d.get("city")})   # the same post may name a place twice
            added.append({"title": title, "list": lst["name"]}); new_ids.append(rid)
        if not added and not dupes and (url or text):   # nothing recognised (or AI off): keep it, don't lose the share
            upsert(c, {"id": str(uuid.uuid4()), "kind": "inbox", "data": {"text": (page.split("\n")[0] or text or url)[:200], "link": url, "desc": (text or page)[:600], "source": "share"}})
            c.commit()
            return jsonify(ok=True, added=[], inbox=True, message="Couldn't find a place or title in that, so it's in your Inbox.")
        c.commit()
        if new_ids:   # fill in cuisine / area / cost / genre / language in the background, so sharing stays instant
            run_bg(enrich_ids, raw_db, upsert, settings, set(new_ids), 25, True)
        msg = "Added " + ", ".join(f"“{a['title']}” to {a['list']}" for a in added) if added else "Already in your lists: " + ", ".join(dupes)
        return jsonify(ok=True, added=added, duplicates=dupes, message=msg)

    imdb_job = {"running": False, "error": "", "rows": 0}

    @app.get("/api/imdb/status")
    @login_required
    def imdb_status():
        p_ = imdb_db_path()
        return jsonify(available=imdb_available(), updated=datetime.fromtimestamp(os.path.getmtime(p_)).date().isoformat() if imdb_available() else "", running=imdb_job["running"], error=imdb_job["error"], rows=imdb_job["rows"])

    @app.post("/api/imdb/update")
    @login_required
    def imdb_update():
        """Download IMDb's free ratings file and put the ratings on your films and series. Only runs when asked."""
        if imdb_job["running"]:
            return jsonify(running=True)
        def job():
            imdb_job.update(running=True, error="")
            try:
                imdb_job["rows"] = imdb_download()
                imdb_refresh_items(raw_db, upsert)
                enrich_ids(raw_db, upsert, settings, None, 60, True)   # the ones with no IMDb id yet: look them up
            except Exception as e:
                imdb_job["error"] = f"{type(e).__name__}: {str(e)[:100]}"; logging.warning("imdb: %s", imdb_job["error"])
            finally:
                imdb_job["running"] = False
        run_bg(job)
        return jsonify(started=True)

    @app.post("/api/lists/enrich")
    @login_required
    def lists_enrich():
        """Queue 'fill in the missing details' for some items (ids) or, with no ids, for everything that lacks them. Results arrive through normal sync."""
        ids = (request.get_json(silent=True) or {}).get("ids")
        ids = {str(x) for x in ids[:40]} if isinstance(ids, list) else None
        run_bg(enrich_ids, raw_db, upsert, settings, ids, 40, True)
        return jsonify(queued=True)

    # ---------- entry rules for MY passport + residency, condensed to "what should I do" (data: Emirates' public visa service) ----------
    def held_visas(today):
        """Visas you already hold (Documents, type "visa") that are still valid."""
        return [{"cc": d["nationality"].lower(), "name": d.get("name") or "visa", "expiry": d.get("expiry") or ""} for d in recs("travel_doc", lambda d: d.get("type") == "visa" and re.fullmatch(r"[A-Za-z]{2}", d.get("nationality") or "") and (not d.get("expiry") or d["expiry"] >= today))]

    def visa_key(nat, res, to, held):
        return f"visa:{nat}:{res}:{to}:" + ",".join(sorted({h["cc"] for h in held if h["cc"] not in (nat, to)}))

    def visa_build(nat, res, to, held, today, fresh=False):
        """-> (card, error). Cached for a week per passport, residence, destination and the visas you hold."""
        own = next((h for h in held if h["cc"] == to), None)
        if own:   # a held visa for the destination itself settles it
            return {"verdict": "held", "headline": "You already hold a visa for this country", "reason": f"you hold {own['name']}" + (f", valid to {own['expiry']}" if own["expiry"] else ""), "routes": [],
                    "steps": [] if own["expiry"] else ["Check it covers your travel dates"], "passport": "", "watch": "", "source": VISA_PAGE, "checked": today, "nationality": nat, "residency": res}, None
        others = list({h["cc"]: h for h in held if h["cc"] not in (nat, to)}.values())
        key = visa_key(nat, res, to, held); hit = kv_get(key)
        if hit and not fresh and time.time() - hit["at"] < hit.get("ttl", 7 * 86400):
            return hit["card"], None
        try:
            import requests
            r = requests.get(VISA_URL, params={"destinationCode": to, "nationalityCode": nat, "residentCountryCode": res, "type": "visa", "transitCountry": "", "countriesVisited": ""},
                             headers={"User-Agent": "Mozilla/5.0 Life", "Accept": "application/json", "Referer": VISA_PAGE}, timeout=15)
            r.raise_for_status()
            data = r.json(); text = visa_text(data)
        except Exception as e:
            logging.warning("visa: %s %s", type(e).__name__, str(e)[:120])
            return (hit["card"], None) if hit else (None, "Couldn't reach the entry-rules service right now.")
        card, ai = visa_fallback(text), False   # headline + passport line are the airline's own sentences, quoted
        card.update(routes=[])
        if text:
            ex = visa_exemptions(data)   # "Exemptions for 3rd Country Visa / Residents": entry on the strength of ANOTHER country's visa or residence permit
            qs = list(VISA_QUESTIONS)
            if ex["resident"]:
                qs.append(_pick("resident", f"Someone who lives in {country_name(res)} (holding a residence permit from there). Which statement lets them enter without a visa?", ex["resident"]))
            if ex["visa"]:
                for h in others:
                    qs.append(_pick("held_" + h["cc"], f"Someone holding a valid {country_name(h['cc'])} visa. Which statement lets them enter without a visa of this country?", ex["visa"]))
            ans = decide(f"A traveller with a {country_name(nat)} passport who lives in {country_name(res)}, going to {country_name(to)}.\n\n{text}", qs)
            v = ans.get("verdict")
            if v:
                steps = [t for q, t in (("onward", "Have a return or onward ticket"), ("form", "Fill in the digital arrival form"), ("health", "Check the vaccination and health rules")) if ans.get(q) == "yes"]
                def pick(q, pool):   # the airline's own statement the model chose, or ""
                    a = ans.get(q, "")
                    return pool[int(a) - 1] if a.isdigit() and 0 < int(a) <= len(pool) else ""
                routes = [{"why": f"you hold your {h['name']}" + (f" (valid to {h['expiry']})" if h["expiry"] else ""), "condition": c} for h in others if (c := pick("held_" + h["cc"], ex["visa"]))]
                if (c := pick("resident", ex["resident"])):
                    routes.append({"why": f"you live in {country_name(res)}", "condition": c})
                reason = ""
                if v == "visa_free":   # on the passport alone
                    stay = ans.get("stay") if ans.get("stay", "").startswith("up to") else ""
                    reason = f"{country_name(nat)} passport holders don't need a visa here" + (f", {stay}" if stay else ""); routes = []
                elif routes:
                    v, reason = "visa_free", routes[0]["why"]
                    g = {}
                    for r_ in routes:   # several visas of yours can sit under the same airline statement: say it once
                        g.setdefault(r_["condition"], []).append(r_["why"])
                    routes = [{"why": ws[0] + "".join(" or " + w.replace("you hold your ", "your ") for w in ws[1:]), "condition": c} for c, ws in g.items()]
                card.update(verdict=v, headline=VISA_STEPS.get(v, card["headline"]), reason=reason, routes=routes, steps=steps); ai = True   # the airline's first sentence can contradict an exemption further down, so the headline follows the verdict
        card.update(source=f"{VISA_PAGE}?widgetheader=visa&nationality={nat}&residency={res}&destination={to}", checked=now_iso()[:10], nationality=nat, residency=res)
        kv_set(key, {"at": time.time(), "ttl": 7 * 86400 if ai else 3600, "card": card})   # if nothing could answer, only keep the plain extract for an hour
        return card, None

    @app.get("/api/visa")
    @login_required
    def visa_card():
        s = settings()
        nat, res, to = (s.get("nationality") or "").lower(), (s.get("residency") or "").lower(), (request.args.get("to") or "").lower()
        if not re.fullmatch(r"[a-z]{2}", to):
            return jsonify(error="bad country"), 400
        if not (nat and res):
            return jsonify(setup=True)   # not an error: just "tell me your passport first" (a 4xx would put noise in the browser console)
        today = datetime.now(ZoneInfo(s["timezone"])).date().isoformat()
        card, err = visa_build(nat, res, to, held_visas(today), today)
        return jsonify(card) if card else (jsonify(error=err), 502)

    visa_job = {"running": False, "done": 0, "total": 0, "failed": 0}
    VERDICT_WORDS = {"visa_free": "no visa needed", "eta_or_evisa": "you now need to apply online first", "on_arrival": "visa on arrival", "visa_required": "you now need a visa from an embassy", "held": "you hold a visa", "unclear": "check the details"}

    def visa_watch(raw_db_, notify_fn, limit=8):
        """Re-check the countries you plan to visit (upcoming trips + your wishlist) against fresh airline data; tell me when the answer for ME changed. Returns the changes."""
        s = settings(); nat, res = (s.get("nationality") or "").lower(), (s.get("residency") or "").lower()
        if not (nat and res):
            return []
        today = datetime.now(ZoneInfo(s["timezone"])).date().isoformat(); c = raw_db_(); codes, held = [], []
        try:
            for r in c.execute("SELECT kind,data FROM records WHERE kind IN ('trip','country','travel_doc') AND deleted_at IS NULL"):
                d = json.loads(r["data"])
                if r["kind"] == "trip" and d.get("status") != "done" and (d.get("end") or d.get("start") or "9") >= today:
                    codes += [x.lower() for x in d.get("countries") or []]
                elif r["kind"] == "country" and d.get("status") == "want" and d.get("code"):
                    codes.append(d["code"].lower())
                elif r["kind"] == "travel_doc" and d.get("type") == "visa" and re.fullmatch(r"[A-Za-z]{2}", d.get("nationality") or "") and (not d.get("expiry") or d["expiry"] >= today):
                    held.append({"cc": d["nationality"].lower(), "name": d.get("name") or "visa", "expiry": d.get("expiry") or ""})
        finally:
            c.close()
        changes = []
        for cc in sorted({x for x in codes if re.fullmatch(r"[a-z]{2}", x) and x != nat})[:limit]:
            old = (kv_get(visa_key(nat, res, cc, held)) or {}).get("card")
            card, err = visa_build(nat, res, cc, held, today, fresh=True); time.sleep(0.8)
            if card and old and card["verdict"] != old["verdict"]:
                changes.append((cc, old["verdict"], card["verdict"]))
                notify_fn(f"Entry rules changed: {country_name(cc)}", f"For you it is now: {VERDICT_WORDS.get(card['verdict'], card['verdict'])} (before: {VERDICT_WORDS.get(old['verdict'], old['verdict'])}).", f"/#/travel/c/{cc.upper()}")
        return changes

    globals()["VISA_WATCH"] = visa_watch

    def visa_codes(nat):
        return [c for c in (country_code_list()) if c != nat]

    @app.get("/api/visa/all")
    @login_required
    def visa_all():
        """Every country sorted by what YOU need (from cached answers; refresh fills them in)."""
        s = settings(); nat, res = (s.get("nationality") or "").lower(), (s.get("residency") or "").lower()
        if not (nat and res):
            return jsonify(setup=True)
        today = datetime.now(ZoneInfo(s["timezone"])).date().isoformat(); held = held_visas(today); cards = {}
        for cc in visa_codes(nat):
            own = next((h for h in held if h["cc"] == cc), None)
            hit = None if own else kv_get(visa_key(nat, res, cc, held))
            c = {"verdict": "held", "reason": f"you hold {own['name']}"} if own else (hit or {}).get("card")
            if c:
                cards[cc] = {k: c.get(k) for k in ("verdict", "headline", "reason")}
        return jsonify(nationality=nat, residency=res, cards=cards, total=len(visa_codes(nat)), running=visa_job["running"], done=visa_job["done"], failed=visa_job["failed"])

    @app.post("/api/visa/all/refresh")
    @login_required
    def visa_all_refresh():
        """Check every country in the background (about a second each, cached for a week)."""
        s = settings(); nat, res = (s.get("nationality") or "").lower(), (s.get("residency") or "").lower()
        if not (nat and res):
            return jsonify(setup=True)
        if visa_job["running"]:
            return jsonify(running=True)
        today = datetime.now(ZoneInfo(s["timezone"])).date().isoformat(); held = held_visas(today); codes = visa_codes(nat)
        force = bool((request.get_json(silent=True) or {}).get("force"))
        def job():
            visa_job.update(running=True, done=0, failed=0, total=len(codes))
            try:
                for cc in codes:
                    t0 = time.time(); card, err = visa_build(nat, res, cc, held, today, fresh=force)
                    visa_job["done"] += 1; visa_job["failed"] += 0 if card else 1
                    if time.time() - t0 > 0.3:   # it really called the service (not a cached answer): be polite
                        time.sleep(0.8)
            finally:
                visa_job["running"] = False
        run_bg(job)
        return jsonify(started=True, total=len(codes))

    NOTE_ACTIONS = {"summarise": "Summarise this note in 3-5 bullet points.", "tasks": "Extract concrete action items as a Markdown checklist (- [ ] ...). Only what is actually in the note.", "cleanup": "Clean up the writing: fix typos and structure, keep the author's voice and all facts. Return the full revised note.", "list": "Turn the content into a clean Markdown bullet list.", "translate": "Translate to English (or to Arabic if it is already English). Return only the translation."}

    @app.post("/api/ai/note-action")
    @login_required
    def ai_note_action():
        j = request.get_json() or {}
        if j.get("action") not in NOTE_ACTIONS:
            return jsonify(error="unknown action"), 400
        try:
            t = complete("chat", NOTE_ACTIONS[j["action"]] + " Output only the result; the user reviews it before anything is saved.", j.get("text", ""), 3000)
            return jsonify(text=t) if t else (jsonify(error="The assistant isn't available (not configured or at its cap)."), 400)
        except Exception as e:
            return jsonify(error="AI error: " + str(e)[:100]), 502

    @app.post("/api/ai/weekly")
    @login_required
    def ai_weekly():
        facts = (request.get_json() or {}).get("facts", {})
        try:
            t = complete("plan", "Draft a short weekly review in Markdown for the user from these facts: '## What went well' (2-3 bullets), '## What drained you' (1-2 bullets, only if the data hints at it), '## Next week' (3 suggested priorities). Be specific, honest, kind; no filler.", json.dumps(facts), 1500)
            return jsonify(text=t)
        except Exception as e:
            return jsonify(text=None, error=str(e)[:100])
