import json, os, sys, uuid
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
import pytest
from test_backend import cli, put  # noqa: F401


@pytest.fixture()
def ai(cli, monkeypatch):
    import assistant
    monkeypatch.setenv("LIFE_AI_MOCK", "1")
    monkeypatch.setattr(assistant, "run_bg", lambda fn, *a: None)   # no stray background threads leaking into other tests
    return cli


def chat(c, text, **extra):
    r = c.post("/api/ai/chat", json={"messages": [{"role": "user", "content": text}], **extra}, headers=c.h)
    events = [json.loads(l[6:]) for l in r.data.decode().split("\n\n") if l.startswith("data: ")]
    return r, events


def test_unconfigured_is_friendly(cli, monkeypatch):
    monkeypatch.delenv("LIFE_AI_MOCK", raising=False); monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = cli.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=cli.h)
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.get_json()["error"]
    assert cli.get("/api/ai/status").get_json()["configured"] is False


def test_mutating_tool_becomes_confirm_card_not_an_action(ai):
    r, ev = chat(ai, "add task renew passport")
    end = ev[-1]
    assert end["type"] == "end" and end["stop"] == "confirm"
    assert end["pending"][0]["name"] == "create_task" and end["pending"][0]["low_risk"] is True
    tasks = [x for x in ai.get("/api/sync?since=").get_json()["records"] if x["kind"] == "task"]
    assert tasks == []                                            # the server never mutates on its own


def test_read_tool_runs_server_side_and_answer_streams(ai):
    put(ai, "list_item", {"title": "Pompi tiramisu", "city": "Rome", "status": "want to go"})
    r, ev = chat(ai, "what restaurants did I save?")
    assert any(e["type"] == "status" and e["tool"] == "list_items" for e in ev)
    assert "".join(e.get("delta", "") for e in ev if e["type"] == "text").startswith("Done.")
    assert "Pompi" in "".join(e.get("delta", "") for e in ev if e["type"] == "text")   # tool result reached the model


def test_resume_after_confirm(ai):
    r, ev = chat(ai, "add task renew passport"); end = ev[-1]
    msgs = [{"role": "user", "content": "add task renew passport"}, {"role": "assistant", "content": end["assistant_content"]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": end["pending"][0]["id"], "content": "Created task"}]}]
    r2 = ai.post("/api/ai/chat", json={"messages": msgs}, headers=ai.h)
    ev2 = [json.loads(l[6:]) for l in r2.data.decode().split("\n\n") if l.startswith("data: ")]
    assert ev2[-1]["stop"] == "end_turn"


def test_cap_blocks_calls_and_meter_counts(ai):
    chat(ai, "hello")
    st = ai.get("/api/ai/status").get_json(); assert st["usage"]["calls"] == 1 and st["usage"]["cost"] > 0
    ai.post("/api/settings", json={"ai_monthly_cap_usd": 0.0000001}, headers=ai.h)
    r = ai.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "again"}]}, headers=ai.h)
    assert r.status_code == 402 and "cap" in r.get_json()["error"]


def test_privacy_preview_scrubs_and_respects_toggles(ai):
    put(ai, "task", {"title": "Pay card 4111 1111 1111 1111 and renew passport X1234567", "due": "2026-10-12"})
    put(ai, "garmin_daily", {"day": "2026-10-09", "sleep_h": 5.5, "steps": 3000})
    p = ai.post("/api/ai/preview", json={"messages": [{"role": "user", "content": "my iban is GB82WEST12345698765432"}]}, headers=ai.h).get_json()
    blob = json.dumps(p)
    assert "4111" not in blob and "X1234567" not in blob and "GB82WEST" not in blob, "numbers are scrubbed before sending"
    assert "health_last_3_days" not in p["system"] and "read_health" not in p["tools"], "health is excluded unless enabled"
    ai.post("/api/settings", json={"ai_health": True}, headers=ai.h)
    p2 = ai.post("/api/ai/preview", json={"messages": []}, headers=ai.h).get_json()
    assert "health_last_3_days" in p2["system"] and "read_health" in p2["tools"]
    ai.post("/api/settings", json={"ai_enabled_modules": ["notes"]}, headers=ai.h)
    p3 = ai.post("/api/ai/preview", json={"messages": []}, headers=ai.h).get_json()
    assert "open_tasks" not in p3["system"]


def test_document_numbers_never_in_context(ai):
    rid = str(uuid.uuid4()); put(ai, "travel_doc", {"name": "Passport", "type": "passport", "number": "Z9876543", "expiry": "2030-01-01"}, rid)
    p = ai.post("/api/ai/preview", json={"messages": []}, headers=ai.h).get_json()
    assert "Passport" in p["system"] and "Z9876543" not in p["system"] and "9876543" not in p["system"]


def test_transcribe_endpoint(ai, monkeypatch):
    import assistant, types
    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=lambda *a, **k: types.SimpleNamespace(transcribe=lambda p, **kw: ([types.SimpleNamespace(text=" add task call mum ")], None))))
    r = ai.post("/api/ai/transcribe", data=b"x" * 3000, headers={**ai.h, "Content-Type": "audio/mp4"})
    assert r.status_code == 200 and r.get_json()["text"] == "add task call mum"
    assert ai.post("/api/ai/transcribe", data=b"", headers={**ai.h, "Content-Type": "audio/mp4"}).status_code == 400
    assert ai.application.test_client().post("/api/ai/transcribe", data=b"x").status_code == 401


def test_transcribe_uses_openai_when_keyed(ai, monkeypatch):
    import requests, types
    ai.post("/api/settings", json={"openai_key": "sk-test"}, headers=ai.h); assert ai.get("/api/settings").get_json()["openai_key"] == "set"
    seen = {}
    def post(url, headers, files, data, timeout):
        seen.update(url=url, auth=headers["Authorization"], model=data["model"])
        return types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"text": " hello there "})
    monkeypatch.setattr(requests, "post", post)
    r = ai.post("/api/ai/transcribe", data=b"x" * 3000, headers={**ai.h, "Content-Type": "audio/mp4"})
    assert r.get_json()["text"] == "hello there" and seen["auth"] == "Bearer sk-test" and "openai.com" in seen["url"]


def test_chat_runs_on_openai_and_keeps_confirm_cards(cli, monkeypatch):
    import requests, types
    monkeypatch.delenv("LIFE_AI_MOCK", raising=False); monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cli.post("/api/settings", json={"openai_key": "sk-test"}, headers=cli.h)
    sent = []
    def chunk(delta=None, finish=None, usage=None):
        return b"data: " + json.dumps({"choices": [{"delta": delta or {}, "finish_reason": finish}] if not usage else [], **({"usage": usage} if usage else {})}).encode()
    def post(url, headers, json, stream, timeout):
        sent.append(json)
        lines = [chunk({"content": "On it. "}),
                 chunk({"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "create_task", "arguments": '{"title": "Book den'}}]}),
                 chunk({"tool_calls": [{"index": 0, "function": {"arguments": 'tist", "project": "Health"}'}}]}),
                 chunk(finish="tool_calls"), chunk(usage={"prompt_tokens": 50, "completion_tokens": 10}), b"data: [DONE]"]
        return types.SimpleNamespace(status_code=200, iter_lines=lambda: iter(lines), close=lambda: None)
    monkeypatch.setattr(requests, "post", post)
    r, ev = chat(cli, "book the dentist")
    end = ev[-1]
    assert "".join(e.get("delta", "") for e in ev if e["type"] == "text") == "On it. "
    assert end["stop"] == "confirm" and end["pending"][0]["input"] == {"title": "Book dentist", "project": "Health"}
    assert sent[0]["model"] == "gpt-5-mini" and sent[0]["tools"][0]["type"] == "function" and sent[0]["messages"][0]["role"] == "system"
    # the follow-up turn (tool result) is translated back into OpenAI's tool message format
    from openai_client import to_openai
    msgs = to_openai("s", [{"role": "assistant", "content": end["assistant_content"]}, {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "ok"}]}])
    assert msgs[1]["tool_calls"][0]["id"] == "call_1" and msgs[2] == {"role": "tool", "tool_call_id": "call_1", "content": "ok"}


def test_decisions_api_used_then_fallback_when_not_enabled(cli, monkeypatch):
    import requests, types
    monkeypatch.delenv("LIFE_AI_MOCK", raising=False); monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cli.post("/api/settings", json={"openai_key": "sk-test"}, headers=cli.h)
    calls = []
    def post(url, headers, json, timeout, stream=False):
        calls.append((url, json))
        if url.endswith("/v1/decisions"):
            return types.SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: {"answers": [{"name": "kind", "choice": "plan", "confidence": 0.9}]})
        raise AssertionError(url)
    monkeypatch.setattr(requests, "post", post)
    r = cli.post("/api/ai/route", json={"text": "plan my sister's party and book the dentist"}, headers=cli.h).get_json()
    assert r == {"kind": "plan", "tier": "plan"}
    q = calls[0][1]["questions"][0]
    assert q["type"] == "choice" and [c["value"] for c in q["choices"]] == ["question", "simple", "plan"] and calls[0][1]["input"]
    # 403 = not enabled for this key -> falls back to a normal small-model JSON answer
    def post2(url, headers, json, timeout, stream=False):
        if url.endswith("/v1/decisions"):
            return types.SimpleNamespace(status_code=403)
        lines = [b'data: ' + __import__("json").dumps({"choices": [{"delta": {"content": '{"dest": "note"}'}, "finish_reason": "stop"}]}).encode(), b"data: [DONE]"]
        return types.SimpleNamespace(status_code=200, json=lambda: {"choices": [{"message": {"content": '{"dest": "note"}'}}], "usage": {}}, iter_lines=lambda: iter(lines), close=lambda: None)
    monkeypatch.setattr(requests, "post", post2)
    assert cli.post("/api/ai/triage", json={"text": "idea: sell the old bike"}, headers=cli.h).get_json() == {"dest": "note"}


def test_unanswered_tool_calls_are_closed_before_sending(cli):
    from assistant import close_tool_calls
    asst = {"role": "assistant", "content": [{"type": "text", "text": "ok"}, {"type": "tool_use", "id": "a", "name": "create_task", "input": {}}, {"type": "tool_use", "id": "b", "name": "create_task", "input": {}}]}
    # user typed a new message before confirming anything
    fixed = close_tool_calls([{"role": "user", "content": "x"}, asst, {"role": "user", "content": "actually, also gym"}])
    c = fixed[2]["content"]
    assert [b["tool_use_id"] for b in c if b["type"] == "tool_result"] == ["a", "b"] and c[-1] == {"type": "text", "text": "actually, also gym"}
    # one of two answered: only the missing one is added
    part = close_tool_calls([asst, {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "a", "content": "done"}]}])
    assert sorted(b["tool_use_id"] for b in part[1]["content"]) == ["a", "b"]
    from openai_client import to_openai
    ids = [m["tool_call_id"] for m in to_openai("s", fixed) if m["role"] == "tool"]
    assert ids == ["a", "b"]


def test_share_post_files_a_place_into_a_list_and_dedupes(ai):
    r = ai.post("/api/share-in", json={"text": "Pompi in Rome - get the tiramisu! https://www.instagram.com/p/abc"}, headers=ai.h)
    assert r.status_code == 200 and r.get_json()["added"][0]["list"] == "Restaurants"
    recs = ai.get("/api/sync?since=").get_json()["records"]
    it = next(x for x in recs if x["kind"] == "list_item")["data"]
    assert it["title"] == "Pompi" and it["cuisine"] == "Italian" and it["status"] == "want to go" and "tiramisu" in it["notes"] and "maps" in it["url"]
    assert ai.post("/api/share-in", json={"text": "Pompi again"}, headers=ai.h).get_json()["duplicates"] == ["Pompi"]
    assert sum(x["kind"] == "list_item" for x in ai.get("/api/sync?since=").get_json()["records"]) == 1


def test_share_unrecognised_goes_to_inbox_and_token_auth(ai):
    tok = ai.post("/api/tokens", json={"label": "iphone"}, headers=ai.h).get_json()["token"]
    ai.post("/api/logout", json={}, headers=ai.h)
    assert ai.post("/api/share-in", json={"text": "x"}).status_code == 401
    r = ai.post("/api/share-in", json={"text": "random meme"}, headers={"Authorization": "Bearer " + tok})
    assert r.get_json()["inbox"] is True


def test_share_routes_by_kind_not_by_first_list_of_that_type(ai):
    lists = lambda: {x["data"]["name"] for x in ai.get("/api/sync?since=").get_json()["records"] if x["kind"] == "list"}
    put(ai, "list", {"name": "Cafes", "type": "restaurant"})                       # a restaurant-type list that is only for cafes
    msg = lambda t: ai.post("/api/share-in", json={"text": t}, headers=ai.h).get_json()["message"]
    assert "to Restaurants" in msg("Pompi in Rome")                                   # not dumped into Cafes
    assert "to Cafes" in msg("best croissant in Dubai")
    assert "to Movies to watch" in msg("a movie to watch") and "to Series to watch" in msg("great series")
    assert {"Cafes", "Restaurants", "Movies to watch", "Series to watch"} <= lists()
    it = [x["data"] for x in ai.get("/api/sync?since=").get_json()["records"] if x["kind"] == "list_item" and x["data"]["title"] == "Past Lives"][0]
    assert it["medium"] == "movie" and it["status"] == "to try"


def test_share_fills_price_tags_and_film_details_and_omdb_overrides(ai, monkeypatch):
    import assistant
    recs = lambda: [x["data"] for x in ai.get("/api/sync?since=").get_json()["records"] if x["kind"] == "list_item"]
    ai.post("/api/share-in", json={"text": "Pompi in Rome"}, headers=ai.h)
    r = next(d for d in recs() if d["title"] == "Pompi")
    assert r["price"] == "$$" and r["tags"] == ["date night", "outdoor seating"]
    ai.post("/api/share-in", json={"text": "a movie to watch"}, headers=ai.h)                      # model's own guess, no OMDb key
    m = next(d for d in recs() if d["title"] == "Past Lives")
    assert m["year"] == "2023" and m["language"] == "English, Korean" and m["genre"] == "Drama, Romance" and m["cast"].startswith("Greta") and "imdb" not in m
    monkeypatch.setattr(assistant, "omdb_lookup", lambda t, y, k: {"year": "2023", "imdb": "7.8", "cast": "Greta Lee, Teo Yoo, John Magaro"})
    ai.post("/api/share-in", json={"text": "another movie to watch"}, headers=ai.h)               # same film: deduped, so check a fresh one
    ai.post("/api/share-in", json={"text": "great series"}, headers=ai.h)
    s = next(d for d in recs() if d["title"] == "Severance")
    assert s["imdb"] == "7.8" and s["medium"] == "show"


def test_share_reads_slides_when_the_caption_names_nothing(ai, monkeypatch):
    import integrations, base64
    seen = {}
    monkeypatch.setattr(integrations, "fetch_slides", lambda url, limit=12: [("image/jpeg", b"fake-jpeg-bytes")] * 3)
    import mock_ai
    orig = mock_ai.Messages.create
    def spy(self, model, messages, **kw):
        seen["content"] = messages[-1]["content"]; return orig(self, model, messages, **kw)
    monkeypatch.setattr(mock_ai.Messages, "create", spy)
    r = ai.post("/api/share-in", json={"text": "https://www.instagram.com/p/XYZ/ my favourite movie picks"}, headers=ai.h).get_json()
    assert r["added"] and [b["type"] for b in seen["content"]] == ["text", "image", "image", "image"]
    assert seen["content"][1]["source"]["data"] == base64.b64encode(b"fake-jpeg-bytes").decode()   # image bytes are not scrubbed or altered


def test_integration_credentials_from_settings_apply_live_masked_and_encrypted(cli, monkeypatch):
    import app, os
    for v in ("GMAIL_USER", "GMAIL_APP_PASSWORD", "OMDB_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setitem(app._ENV_FILE, "OMDB_API_KEY", "from-dotenv"); monkeypatch.setenv("OMDB_API_KEY", "from-dotenv")
    cli.post("/api/settings", json={"name": "x"}, headers=cli.h)
    assert os.environ["OMDB_API_KEY"] == "from-dotenv"                                                                   # saving unrelated settings leaves env alone
    cli.post("/api/settings", json={"omdb_key": "from-settings"}, headers=cli.h)
    assert os.environ["OMDB_API_KEY"] == "from-settings"                                                                 # settings win over .env
    cli.post("/api/settings", json={"omdb_key": ""}, headers=cli.h)
    cli.post("/api/settings", json={"gmail_user": "me@gmail.com", "gmail_app_password": "abcd efgh ijkl mnop"}, headers=cli.h)
    assert os.environ["GMAIL_USER"] == "me@gmail.com" and os.environ["GMAIL_APP_PASSWORD"] == "abcd efgh ijkl mnop"   # live, no restart
    got = cli.get("/api/settings").get_json()
    assert got["gmail_app_password"] == "set" and got["gmail_user"] == "me@gmail.com"                                  # secret never sent back
    raw = app.kv_get("settings")
    assert raw["gmail_app_password"].startswith("enc:") and "abcd" not in str(raw)                                       # encrypted at rest
    assert app.settings()["gmail_app_password"] == "abcd efgh ijkl mnop"
    cli.post("/api/settings", json={"gmail_app_password": "set"}, headers=cli.h)                                         # echoing the mask back changes nothing
    assert os.environ["GMAIL_APP_PASSWORD"] == "abcd efgh ijkl mnop"
    cli.post("/api/settings", json={"gmail_app_password": ""}, headers=cli.h)
    assert "GMAIL_APP_PASSWORD" not in os.environ                                                                        # cleared
    assert os.environ["OMDB_API_KEY"] == "from-dotenv"                                                                   # clearing falls back to .env


def test_clean_title_drops_slide_headings_but_keeps_real_titles():
    import assistant
    ct = assistant.clean_title
    for bad in ("My Top Ten Movies of 2026...so far", "My top 10 movies so far", "Best 10 cafes in Dubai", "Top 5 places to eat", "10 movies to watch", "Here are my favourite films"):
        assert ct(bad) == "", bad
    for good in ("Top Gun", "Best in Show", "The Best Exotic Marigold Hotel", "Places in the Heart", "Past Lives", "Se7en", "Amelie"):
        assert ct(good) == good, good
    assert ct("The Grave (Qalaimage placeholder)") == "The Grave"


SAMPLE_VISA = {"results": [{"countryCode": "us", "isDestination": True, "sectionInformation": [
    {"sectionName": "Visa Requirements", "subsectionInformation": [{"subsectionName": "Visa Requirements", "documentParagraph": [{"paragraphText": "<p>Passengers must have a valid visa issued by the USA.</p>"}]}]},
    {"sectionName": "Travel Document Validity", "subsectionInformation": [{"subsectionName": "All Passports Validity", "documentParagraph": [{"paragraphText": "<p>Passports must be valid for the duration of stay.<br />Thanks.</p>"}]}]}]},
    {"countryCode": "ae", "isDestination": False, "sectionInformation": [{"sectionName": "Transit", "subsectionInformation": [{"subsectionName": "x", "documentParagraph": [{"paragraphText": "<p>ignore me</p>"}]}]}]}]}


def test_visa_card_uses_my_passport_condenses_and_caches(ai, monkeypatch):
    import assistant
    calls = []
    class R:
        def raise_for_status(self): pass
        def json(self): return SAMPLE_VISA
    import requests
    monkeypatch.setattr(requests, "get", lambda url, **kw: (calls.append(kw["params"]) or R()))
    assert ai.get("/api/visa?to=us").get_json() == {"setup": True}                                                      # needs nationality + residency first
    ai.post("/api/settings", json={"nationality": "in", "residency": "ae"}, headers=ai.h)
    card = ai.get("/api/visa?to=us").get_json()
    assert card["verdict"] == "visa_required" and card["nationality"] == "in" and "nationality=in&residency=ae&destination=us" in card["source"]
    assert card["headline"] == "Apply for a visa at the embassy or consulate before you fly" and card["steps"] == ["Have a return or onward ticket"]   # fixed wording from the choices made
    assert card["passport"] == "Passports must be valid for the duration of stay."                                                                      # the airline's own sentence
    assert calls[0]["nationalityCode"] == "in" and calls[0]["residentCountryCode"] == "ae" and calls[0]["destinationCode"] == "us"
    ai.get("/api/visa?to=us"); assert len(calls) == 1                                                                     # cached for a week
    assert "ignore me" not in assistant.visa_text(SAMPLE_VISA) and "Thanks." in assistant.visa_text(SAMPLE_VISA)           # only the destination block, HTML stripped
    assert assistant.visa_fallback(assistant.visa_text(SAMPLE_VISA))["headline"] == "Passengers must have a valid visa issued by the USA."
    assert ai.get("/api/visa?to=zzz").status_code == 400


def _visa_json(main, third_visa=(), third_res=()):
    sub = lambda name, paras: {"subsectionName": name, "documentParagraph": [{"paragraphText": f"<p>{t}</p>"} for t in paras]}
    subs = [sub("Visa Requirements", [main])] + ([sub("Exemptions for 3rd Country Visa", third_visa)] if third_visa else []) + ([sub("Exemptions for 3rd Country Residents", third_res)] if third_res else [])
    return {"results": [{"countryCode": "xx", "isDestination": True, "sectionInformation": [{"sectionName": "Visa Requirements", "subsectionInformation": subs}]}]}


def test_visa_card_explains_why_you_can_go_held_visa_residence_passport(ai, monkeypatch):
    import requests
    body = {"v": None}
    class R:
        def raise_for_status(self): pass
        def json(self): return body["v"]
    monkeypatch.setattr(requests, "get", lambda url, **kw: R())
    ai.post("/api/settings", json={"nationality": "in", "residency": "ae"}, headers=ai.h)
    visa = lambda to: ai.get(f"/api/visa?to={to}").get_json()
    US = "Passengers can enter with a multiple entry visa issued by the valid US visa programme, if they used it at least once."

    body["v"] = _visa_json("Passengers must have a valid visa.", third_visa=[US])
    assert visa("al")["verdict"] == "visa_required"                                                                      # exemption exists but no US visa on file: not exempt
    put(ai, "travel_doc", {"type": "visa", "name": "US visa (10 years)", "nationality": "US", "expiry": "2035-06-01"})
    c = visa("al")                                                                                                       # held visas are part of the cache key, so this recomputes
    assert c["verdict"] == "visa_free" and c["reason"] == "you hold your US visa (10 years) (valid to 2035-06-01)", c
    assert c["routes"] == [{"why": c["reason"], "condition": US}]                                                        # the airline's own sentence is the condition, verbatim

    body["v"] = _visa_json("Passengers must have a valid visa.", third_res=["UAE residents may enter, with a residence permit valid for a year."])
    c = visa("qa"); assert c["verdict"] == "visa_free" and c["reason"] == "you live in United Arab Emirates" and "residence permit valid" in c["routes"][0]["condition"], c

    put(ai, "travel_doc", {"type": "visa", "name": "Old US visa", "nationality": "US", "expiry": "2001-01-01"})            # an expired visa never counts
    body["v"] = _visa_json("Nationals of India do not need a visa for 30 days.")
    c = visa("th"); assert c["verdict"] == "visa_free" and c["reason"] == "India passport holders don't need a visa here, up to 30 days" and c["routes"] == [], c

    put(ai, "travel_doc", {"type": "visa", "name": "Japan tourist visa", "nationality": "JP", "expiry": ""})
    c = visa("jp")
    assert c["verdict"] == "held" and "Japan tourist visa" in c["reason"] and c["steps"] == ["Check it covers your travel dates"]   # holding the destination's own visa


def test_enrich_fills_blanks_only_pins_places_and_does_not_retry_forever(ai, monkeypatch):
    import app, assistant
    monkeypatch.setattr(assistant, "osm_place", lambda title, city, home: {"city": "Jumeirah, Dubai", "lat": 25.2, "lon": 55.27, "cuisine": "American"} if "Zuma" in title else {})
    monkeypatch.setattr(assistant.time, "sleep", lambda s: None)
    monkeypatch.setattr(assistant, "wikidata_media", lambda title: {"genre": "Drama, Romance", "language": "English, Korean", "year": "2023", "medium": "movie"} if title == "Past Lives" else {})
    monkeypatch.setattr(assistant, "post_places", lambda url, names, complete: {})
    rl, ml = str(uuid.uuid4()), str(uuid.uuid4())
    put(ai, "list", {"name": "Restaurants", "type": "restaurant"}, rl); put(ai, "list", {"name": "Movies", "type": "media"}, ml)
    put(ai, "list_item", {"list": rl, "title": "Zuma"}, "11111111-1111-4111-8111-111111111111")
    put(ai, "list_item", {"list": rl, "title": "Tiny Cafe", "cuisine": "Coffee"}, "22222222-2222-4222-8222-222222222222")      # a value you typed is never overwritten
    put(ai, "list_item", {"list": ml, "title": "Past Lives"}, "33333333-3333-4333-8333-333333333333")
    put(ai, "list_item", {"list": rl, "title": "Done Already", "cuisine": "x", "city": "y", "price": "$", "lat": 1.0, "lon": 2.0}, "44444444-4444-4444-8444-444444444444")
    n = assistant.enrich_ids(app.raw_db, app.upsert, app.settings)
    assert n == 3                                                                                                       # the complete item is skipped
    got = {r["data"]["title"]: r["data"] for r in ai.get("/api/sync?since=").get_json()["records"] if r["kind"] == "list_item"}
    z = got["Zuma"]; assert z["city"] == "Jumeirah, Dubai" and z["lat"] == 25.2 and z["cuisine"] == "American" and z["price"] == "$$", z     # real location + pin from OSM beats the model; cost from the model
    t = got["Tiny Cafe"]; assert t["cuisine"] == "Coffee" and t["city"] == "Dubai" and t["price"] == "$$" and "lat" not in t               # blanks filled, typed value kept, no pin without a confident match
    m = got["Past Lives"]; assert m["genre"] == "Drama, Romance" and m["language"] == "English, Korean" and m["year"] == "2023" and m["medium"] == "movie"   # Wikidata beats the model's guess
    assert assistant.enrich_ids(app.raw_db, app.upsert, app.settings) == 0                                              # Tiny Cafe still has no pin, but it was tried just now: not retried on every pass (14 days)
    assert assistant.enrich_ids(app.raw_db, app.upsert, app.settings, {"22222222-2222-4222-8222-222222222222"}, 5, True) == 1   # unless asked to (the 'fill in details' button)


def test_same_item_ignores_case_accents_articles_and_brackets_but_not_real_differences():
    import assistant
    s = assistant.same_item
    assert s({"title": "The Amélie"}, {"title": "amelie (2001)"}) and s({"title": "Maisan 15"}, {"title": "Maisan 15 (Pizza variant)"})
    assert s({"title": "Spider-Man: Into the Spider-Verse"}, {"title": "spider man into the spider verse"}) and s({"title": "Zuma", "city": "DIFC, Dubai"}, {"title": "ZUMA", "city": "Dubai"})
    assert not s({"title": "Zuma", "city": "Dubai"}, {"title": "Zuma", "city": "London"})                       # same name, other city
    assert not s({"title": "Dune", "year": "1984"}, {"title": "Dune", "year": "2021"})                          # remake
    assert not s({"title": "Fargo", "medium": "movie"}, {"title": "Fargo", "medium": "show"})                   # film vs series
    assert not s({"title": ""}, {"title": ""}) and not s({"title": "A"}, {"title": "B"})


def test_share_never_adds_what_any_list_of_that_kind_already_has(ai):
    cafes, movies = str(uuid.uuid4()), str(uuid.uuid4())
    put(ai, "list", {"name": "Cafes", "type": "restaurant"}, cafes); put(ai, "list", {"name": "Retro Movies", "type": "media"}, movies)
    put(ai, "list_item", {"list": cafes, "title": "pompi!", "city": "Rome"})                                      # different list, different spelling
    put(ai, "list_item", {"list": movies, "title": "Past Lives", "year": "2023", "medium": "movie"})
    r1 = ai.post("/api/share-in", json={"text": "Pompi in Rome - get the tiramisu"}, headers=ai.h).get_json()
    r2 = ai.post("/api/share-in", json={"text": "a movie to watch"}, headers=ai.h).get_json()
    assert r1["added"] == [] and r1["duplicates"] == ["Pompi"] and r2["added"] == [] and r2["duplicates"] == ["Past Lives"], (r1, r2)
    items = [x for x in ai.get("/api/sync?since=").get_json()["records"] if x["kind"] == "list_item"]
    assert len(items) == 2


def test_imdb_ratings_come_from_the_dataset_by_imdb_id(ai, monkeypatch):
    import app, assistant, gzip, tempfile
    gz = os.path.join(tempfile.mkdtemp(), "title.ratings.tsv.gz")
    with gzip.open(gz, "wt", encoding="utf8") as f:
        f.write("tconst\taverageRating\tnumVotes\ntt15398776\t8.3\t900000\ntt0000001\t5.7\t10\ntt1234567\t7.84\t5000\n")
    assert assistant.imdb_rating("tt1234567") == ""                                        # no dataset yet: nothing invented
    assert assistant.imdb_import(str(gz)) == 2                                              # rows with fewer than 25 votes are dropped
    assert assistant.imdb_rating("tt1234567") == "7.8" and assistant.imdb_rating("tt0000001") == "" and assistant.imdb_rating("") == ""
    monkeypatch.setattr(assistant.time, "sleep", lambda s: None)
    monkeypatch.setattr(assistant, "wikidata_media", lambda t: {"genre": "Drama", "language": "English", "year": "2023", "medium": "movie", "imdb_id": "tt1234567"})
    monkeypatch.setattr(assistant, "post_places", lambda u, n, c: {})
    ml = str(uuid.uuid4()); put(ai, "list", {"name": "Movies", "type": "media"}, ml)
    put(ai, "list_item", {"list": ml, "title": "Past Lives"}, "55555555-5555-4555-8555-555555555555")
    assert assistant.enrich_ids(app.raw_db, app.upsert, app.settings) == 1
    it = next(r["data"] for r in ai.get("/api/sync?since=").get_json()["records"] if r["kind"] == "list_item")
    assert it["imdb"] == "7.8" and it["imdb_id"] == "tt1234567"
    put(ai, "list_item", {"list": ml, "title": "Old", "imdb_id": "tt15398776", "genre": "x", "language": "y", "year": "2000", "medium": "movie"}, "66666666-6666-4666-8666-666666666666")
    assert assistant.imdb_refresh_items(app.raw_db, app.upsert) == 1                         # an item that already has an id just gets today's rating
    assert ai.get("/api/imdb/status").get_json()["available"] is True


def test_share_in_connection_test_screenshots_and_web_pages(ai, monkeypatch):
    import integrations, io, base64
    tok = ai.post("/api/tokens", json={"label": "iphone"}, headers=ai.h).get_json()["token"]; H = {"Authorization": "Bearer " + tok}
    anon = __import__("app").app.test_client()
    assert anon.post("/api/share-in", json={"test": True}, headers=H).get_json()["ok"] is True and anon.post("/api/share-in", json={"test": True}).status_code == 401
    seen = {}
    import mock_ai
    orig = mock_ai.Messages.create
    def spy(self, model, messages, **kw):
        seen["content"] = messages[-1]["content"]; return orig(self, model, messages, **kw)
    monkeypatch.setattr(mock_ai.Messages, "create", spy)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    r = anon.post("/api/share-in", data={"text": "Pompi in Rome", "images": [(io.BytesIO(png), "a.png", "image/png"), (io.BytesIO(b"not an image"), "b.txt", "text/plain")]}, headers=H, content_type="multipart/form-data").get_json()
    assert r["added"] and [b["type"] for b in seen["content"]] == ["text", "image"]                  # the photo was passed to the model, the text file was ignored
    r = anon.post("/api/share-in", json={"text": "Pompi again", "images": [base64.b64encode(png).decode()]}, headers=H).get_json()   # base64 in JSON works too
    monkeypatch.setattr(integrations, "fetch_meta", lambda url, *a, **k: {"title": "10 best brunch spots", "desc": ""})
    monkeypatch.setattr(integrations, "fetch_article_text", lambda url, *a, **k: "1. Pompi in Rome. Get the tiramisu.")
    r = anon.post("/api/share-in", json={"url": "https://blog.example/brunch"}, headers=H).get_json()
    assert "Pompi in Rome" in seen["content"] and "10 best brunch" in seen["content"]                  # a blog post's body reaches the model


def test_where_can_i_go_checks_every_country_in_the_background_and_sorts_by_your_situation(ai, monkeypatch):
    import assistant, requests
    monkeypatch.setattr(assistant, "run_bg", lambda fn, *a: fn(*a))                       # run the "background" job right here
    monkeypatch.setattr(assistant.time, "sleep", lambda s: None)
    monkeypatch.setattr(assistant, "country_code_list", lambda: ["al", "th", "us", "jp", "in"])
    texts = {"al": _visa_json("Passengers must have a valid visa.", third_visa=["Passengers can enter with a multiple entry visa issued by the valid US visa programme."]), "th": _visa_json("Nationals of India do not need a visa for 30 days.")}
    calls = []
    class R:
        def __init__(s, j): s.j = j
        def raise_for_status(s): pass
        def json(s): return s.j
    monkeypatch.setattr(requests, "get", lambda url, **kw: (calls.append(kw["params"]["destinationCode"]) or R(texts.get(kw["params"]["destinationCode"], _visa_json("Passengers must have a valid visa.")))))
    assert ai.get("/api/visa/all").get_json() == {"setup": True}
    ai.post("/api/settings", json={"nationality": "in", "residency": "ae"}, headers=ai.h)
    put(ai, "travel_doc", {"type": "visa", "name": "US visa (10 years)", "nationality": "US", "expiry": "2035-06-01"})
    put(ai, "travel_doc", {"type": "visa", "name": "Japan tourist visa", "nationality": "JP", "expiry": ""})
    assert ai.get("/api/visa/all").get_json()["cards"].keys() == {"us", "jp"}                  # nothing fetched yet: only what you hold is known
    assert ai.post("/api/visa/all/refresh", json={}, headers=ai.h).get_json()["total"] == 4   # your own country is not on the list
    j = ai.get("/api/visa/all").get_json()
    assert j["done"] == 4 and not j["running"] and sorted(j["cards"]) == ["al", "jp", "th", "us"]
    assert j["cards"]["us"]["verdict"] == "held" and j["cards"]["th"]["verdict"] == "visa_free" and "US visa" in j["cards"]["al"]["reason"]   # Albania: because you hold a US visa
    assert sorted(calls) == ["al", "th"]                                                       # the two you hold a visa for never needed a lookup
    n = len(calls); ai.post("/api/visa/all/refresh", json={}, headers=ai.h); assert len(calls) == n   # a second refresh uses the week-long cache


def test_entry_rule_watch_tells_me_when_the_answer_for_me_changes(ai, monkeypatch):
    import assistant, requests
    monkeypatch.setattr(assistant.time, "sleep", lambda s: None)
    state = {"text": "Nationals of India do not need a visa for 30 days."}
    class R:
        def raise_for_status(self): pass
        def json(self): return _visa_json(state["text"])
    monkeypatch.setattr(requests, "get", lambda url, **kw: R())
    ai.post("/api/settings", json={"nationality": "in", "residency": "ae"}, headers=ai.h)
    import app
    put(ai, "trip", {"name": "Bangkok", "start": "2099-01-01", "end": "2099-01-05", "countries": ["TH"], "status": "planned"})
    put(ai, "country", {"code": "JP", "status": "want"})
    sent = []; notify = lambda t, b, u: sent.append((t, b, u))
    assert assistant.VISA_WATCH(app.raw_db, notify) == [] and sent == []                     # first look: nothing to compare with
    assert assistant.VISA_WATCH(app.raw_db, notify) == [] and sent == []                     # same answer again: silence
    state["text"] = "Passengers must have a valid visa issued by Thailand."                    # the rules changed
    ch = assistant.VISA_WATCH(app.raw_db, notify)
    assert ("th", "visa_free", "visa_required") in ch and any(t == "Entry rules changed: Thailand" and "embassy" in b and u == "/#/travel/c/TH" for t, b, u in sent), sent
