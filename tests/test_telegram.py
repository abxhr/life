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
    cli.post("/api/settings", json={"telegram_chat_id": "42", "name": "Sam"}, headers=cli.h)
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
    assert any("in your inbox" in t for t in sent) and any("Pay rent" in t and "Good morning Sam" in t for t in sent), sent
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


def test_notify_respects_categories_quiet_hours_and_channels(cli, monkeypatch):
    import app, integrations, push
    sent = {"push": [], "tg": []}
    monkeypatch.setattr(push, "send_all", lambda raw_db, d, title, body="", tag=None, url=None: (sent["push"].append((title, url)) or (1, "")))
    monkeypatch.setattr(integrations, "telegram_send", lambda s, text: (sent["tg"].append(text) or (True, "")))
    n = lambda **kw: integrations.notify(app.raw_db, app.settings, app.set_state, "Hi", "body", "/#/travel", category="travel", kv_get=app.kv_get, kv_set=app.kv_set, **kw)
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "00:00"}, headers=cli.h)                      # equal = no quiet hours
    r = n(); assert r["sent"] and sent["push"] == [("Hi", "/#/travel")] and sent["tg"] == ["Hi\nbody"]                  # both channels by default, tap opens the right page
    cli.post("/api/settings", json={"notify": {"channels": "push", "categories": {"travel": False}}}, headers=cli.h)
    assert n()["why"] == "category off" and len(sent["push"]) == 1                                                      # switched off in Settings
    cli.post("/api/settings", json={"notify": {"channels": "push", "categories": {}}}, headers=cli.h)
    n(); assert len(sent["push"]) == 2 and len(sent["tg"]) == 1                                                         # push only: no Telegram
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "23:59"}, headers=cli.h)                       # (almost) always quiet
    assert n()["why"] == "held for quiet hours" and len(sent["push"]) == 2 and len(app.kv_get("notify_queue")) == 1
    assert integrations.notify(app.raw_db, app.settings, app.set_state, "Flight", "", "/#/travel", category="travel", critical=True)["sent"]   # urgent ones always come through
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "00:00"}, headers=cli.h)
    integrations.drain_notify_queue(app.raw_db, app.settings, app.set_state, app.kv_get, app.kv_set)
    assert app.kv_get("notify_queue") == [] and any(t == "Hi" for t, _ in sent["push"][2:])                             # held ones are delivered once quiet hours end
