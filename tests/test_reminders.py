import os, sys, uuid, json
from datetime import datetime, timedelta, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli, put  # noqa: F401


def run_tick():
    import app, integrations
    integrations._last.clear(); integrations._last.update({"feeds": 9e12, "gmail": 9e12, "garmin": 9e12, "wealthsnap": 9e12, "auto": 9e12, "tgpoll": 9e12})   # only exercise reminders
    integrations.tick(app.raw_db, app.set_state, app.kv_get, app.kv_set, app.settings, app.now_iso, app.upsert)


def data_of(cli, rid):
    return [r for r in cli.get("/api/sync?since=").get_json()["records"] if r["id"] == rid][0]["data"]


def test_due_reminder_fires_once_then_snooze_refires(cli, monkeypatch):
    import integrations
    sent = []; monkeypatch.setattr(integrations, "telegram_send", lambda s, t: (sent.append(t) or (True, "")))
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "00:00"}, headers=cli.h)      # no quiet hours
    rid = str(uuid.uuid4()); put(cli, "task", {"title": "Send deck", "remind_at": "2026-01-01T00:00:00Z"}, rid)
    run_tick(); run_tick(); assert len(sent) == 1 and "Send deck" in sent[0], "fires once, not every 30 seconds"
    assert data_of(cli, rid)["fired_n"] == 1
    cli.post("/api/sync", json={"changes": [{"id": rid, "kind": "task", "data": {"remind_at": "2026-01-02T00:00:00Z", "last_fired": None, "_t": {"remind_at": "2099-01-01T00:00:00.000Z", "last_fired": "2099-01-01T00:00:00.000Z"}}, "updated_at": "2099-01-01T00:00:00.000Z"}]}, headers=cli.h)  # snooze
    run_tick(); assert len(sent) == 2, "a snoozed reminder fires again"


def test_done_or_acked_never_fire_and_quiet_hours_hold_back_non_critical(cli, monkeypatch):
    import integrations
    sent = []; monkeypatch.setattr(integrations, "telegram_send", lambda s, t: (sent.append(t) or (True, "")))
    put(cli, "task", {"title": "done one", "done": True, "remind_at": "2026-01-01T00:00:00Z"}); put(cli, "reminder", {"title": "acked", "acked": True, "remind_at": "2026-01-01T00:00:00Z"})
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "23:59"}, headers=cli.h)   # (almost) always quiet
    put(cli, "reminder", {"title": "polite", "remind_at": "2026-01-01T00:00:00Z"}); run_tick(); assert sent == []
    put(cli, "reminder", {"title": "urgent", "critical": True, "remind_at": "2026-01-01T00:00:00Z"}); run_tick()
    assert len(sent) == 1 and "urgent" in sent[0] and sent[0].startswith("‼"), "critical breaks quiet hours"


def test_critical_renags_until_acknowledged(cli, monkeypatch):
    import integrations
    sent = []; monkeypatch.setattr(integrations, "telegram_send", lambda s, t: (sent.append(t) or (True, "")))
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "00:00"}, headers=cli.h)
    rid = str(uuid.uuid4()); put(cli, "reminder", {"title": "pay visa fee", "critical": True, "remind_at": "2026-01-01T00:00:00Z"}, rid)
    run_tick(); assert len(sent) == 1
    old = (datetime.now(timezone.utc) - timedelta(minutes=11)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    cli.post("/api/sync", json={"changes": [{"id": rid, "kind": "reminder", "data": {"last_fired": old, "_t": {"last_fired": "2099-01-01T00:00:00.000Z"}}, "updated_at": "2099-01-01T00:00:00.000Z"}]}, headers=cli.h)
    run_tick(); assert len(sent) == 2, "re-notifies after 10 minutes"
    cli.post("/api/sync", json={"changes": [{"id": rid, "kind": "reminder", "data": {"acked": True, "last_fired": old, "_t": {"acked": "2099-01-02T00:00:00.000Z", "last_fired": "2099-01-02T00:00:00.000Z"}}, "updated_at": "2099-01-02T00:00:00.000Z"}]}, headers=cli.h)
    run_tick(); assert len(sent) == 2, "stops once acknowledged"


def test_channel_choice_is_respected(cli, monkeypatch):
    import integrations, push
    tg, pu = [], []; monkeypatch.setattr(integrations, "telegram_send", lambda s, t: (tg.append(t) or (True, ""))); monkeypatch.setattr(push, "send_all", lambda *a, **k: (pu.append(a[2]) or (1, "")))
    cli.post("/api/settings", json={"quiet_from": "00:00", "quiet_to": "00:00"}, headers=cli.h)
    put(cli, "task", {"title": "telegram only", "channels": "telegram", "remind_at": "2026-01-01T00:00:00Z"}); run_tick()
    assert len(tg) == 1 and pu == []
    put(cli, "task", {"title": "in-app only", "channels": "inapp", "remind_at": "2026-01-01T00:00:00Z"}); run_tick()
    assert len(tg) == 1 and pu == [], "in-app-only reminders are left to the open app"
    put(cli, "task", {"title": "everywhere", "remind_at": "2026-01-01T00:00:00Z"}); run_tick()
    assert len(tg) == 2 and pu == ["everywhere"]
