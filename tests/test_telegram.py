import os, sys, uuid, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli, put  # noqa: F401


class Resp:
    def __init__(self, j): self._j = j; self.ok = True; self.text = ""
    def raise_for_status(self): pass
    def json(self): return self._j


def test_inbound_only_from_my_chat_dedupes_and_agenda(cli, monkeypatch):
    import app, integrations
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:TESTTOKENTESTTOKENTESTTOKEN")
    cli.post("/api/settings", json={"telegram_chat_id": "42", "name": "Abshar"}, headers=cli.h)
    updates = [{"update_id": 10, "message": {"chat": {"id": 42}, "text": "book dentist"}},
               {"update_id": 11, "message": {"chat": {"id": 999}, "text": "intruder message"}},       # someone else's chat
               {"update_id": 12, "message": {"chat": {"id": 42}, "text": "/agenda"}}]
    sent = []
    monkeypatch.setattr(integrations.requests, "get", lambda url, **kw: Resp({"result": updates}))
    monkeypatch.setattr(integrations.requests, "post", lambda url, json=None, **kw: (sent.append(json["text"]) or Resp({})))
    put(cli, "task", {"title": "Pay rent", "due": "2000-01-01", "done": False})                      # long overdue -> shows as slipped
    integrations.telegram_poll(app.raw_db, app.set_state, app.kv_get, app.kv_set, app.settings, app.now_iso, app.upsert)
    inbox = [r["data"]["text"] for r in cli.get("/api/sync?since=").get_json()["records"] if r["kind"] == "inbox"]
    assert inbox == ["book dentist"], "only my chat is accepted"
    assert any("in your inbox" in t for t in sent) and any("Pay rent" in t and "Good morning Abshar" in t for t in sent), sent
    assert app.kv_get("tg_offset") == 13
    n = len(inbox)
    integrations.telegram_poll(app.raw_db, app.set_state, app.kv_get, app.kv_set, app.settings, app.now_iso, app.upsert)   # same updates replayed
    assert len([r for r in cli.get("/api/sync?since=").get_json()["records"] if r["kind"] == "inbox"]) == n, "replayed update does not duplicate"


def test_daily_agenda_is_opt_in_and_once_a_day(cli, monkeypatch):
    import app, integrations
    sent = []; monkeypatch.setattr(integrations, "telegram_send", lambda s, t: (sent.append(t) or (True, "")))
    integrations.daily_agenda(app.raw_db, app.set_state, app.kv_get, app.kv_set, app.settings); assert sent == []     # off by default
    cli.post("/api/settings", json={"agenda_push": True, "agenda_time": "00:00", "agenda_workdays_only": False}, headers=cli.h)
    integrations.daily_agenda(app.raw_db, app.set_state, app.kv_get, app.kv_set, app.settings); integrations.daily_agenda(app.raw_db, app.set_state, app.kv_get, app.kv_set, app.settings)
    assert len(sent) == 1 and "Good morning" in sent[0]
