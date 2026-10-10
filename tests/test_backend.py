import os, sys, json, uuid, tempfile, importlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
import pytest

@pytest.fixture()
def cli(monkeypatch):
    d = tempfile.mkdtemp(); monkeypatch.setenv("LIFE_DATA", d)
    for m in ("app", "integrations", "workcapture"): sys.modules.pop(m, None)
    import app; app.init_db()
    c = app.app.test_client()
    r = c.post("/api/login", json={"password": "hunter2hunter2"}); assert r.status_code == 200
    c.csrf = r.get_json()["csrf"]; c.h = {"X-CSRF": c.csrf}
    return c

def put(c, kind, data, rid=None, ts="2026-01-01T00:00:00.000Z"):
    return c.post("/api/sync", json={"changes": [{"id": rid or str(uuid.uuid4()), "kind": kind, "data": data, "updated_at": ts, "created_at": ts}]}, headers=c.h)

def test_auth_and_csrf(cli):
    import app
    anon = app.app.test_client()
    assert anon.get("/api/sync").status_code == 401
    assert cli.post("/api/sync", json={"changes": []}).status_code == 403  # missing CSRF
    assert cli.post("/api/sync", json={"changes": []}, headers=cli.h).status_code == 200
    assert anon.post("/api/login", json={"password": "nope"}).status_code == 401

def test_field_level_lww(cli):
    rid = str(uuid.uuid4())
    put(cli, "task", {"title": "A", "due": "2026-02-01", "_t": {"title": "2026-01-02T00:00:00.000Z", "due": "2026-01-02T00:00:00.000Z"}}, rid)
    # older edit to `title` loses, newer edit to `due` wins; both in one batch from an offline device
    put(cli, "task", {"title": "OLD", "due": "2026-03-01", "_t": {"title": "2026-01-01T00:00:00.000Z", "due": "2026-01-03T00:00:00.000Z"}}, rid, "2026-01-03T00:00:00.000Z")
    rec = [r for r in cli.get("/api/sync?since=").get_json()["records"] if r["id"] == rid][0]["data"]
    assert rec["title"] == "A" and rec["due"] == "2026-03-01"
    assert cli.get("/api/sync-log").get_json()  # conflict was logged

def test_delete_does_not_beat_newer_edit(cli):
    rid = str(uuid.uuid4()); put(cli, "task", {"title": "x"}, rid, "2026-01-05T00:00:00.000Z")
    cli.post("/api/sync", json={"changes": [{"id": rid, "kind": "task", "data": {}, "updated_at": "2026-01-04T00:00:00.000Z", "deleted_at": "2026-01-04T00:00:00.000Z"}]}, headers=cli.h)
    rec = [r for r in cli.get("/api/sync?since=").get_json()["records"] if r["id"] == rid][0]
    assert rec["deleted_at"] is None

def test_note_versions_capped(cli):
    rid = str(uuid.uuid4())
    for i in range(25): put(cli, "note", {"title": "n", "body": f"v{i}", "_t": {"body": f"2026-01-{i+1:02d}T00:00:00.000Z"}}, rid, f"2026-01-{i+1:02d}T00:00:00.000Z")
    vs = [r for r in cli.get("/api/sync?since=").get_json()["records"] if r["kind"] == "note_version"]
    assert 0 < len(vs) <= 20

def test_sensitive_fields_encrypted_and_masked(cli):
    import app
    rid = str(uuid.uuid4()); put(cli, "travel_doc", {"name": "Passport", "number": "X1234567"}, rid)
    row = app.raw_db().execute("SELECT data FROM records WHERE id=?", (rid,)).fetchone()
    assert "X1234567" not in row["data"]
    out = [r for r in cli.get("/api/sync?since=").get_json()["records"] if r["id"] == rid][0]["data"]
    assert out["number"].endswith("4567") and "X123" not in out["number"]
    assert cli.get(f"/api/reveal/{rid}/number").get_json()["value"] == "X1234567"
    put(cli, "travel_doc", dict(out, name="Passport 2"), rid, "2026-02-01T00:00:00.000Z")  # saving masked value must not clobber ciphertext
    assert cli.get(f"/api/reveal/{rid}/number").get_json()["value"] == "X1234567"

def test_capture_token_is_write_only_and_dedupes(cli):
    import app
    tok = cli.post("/api/tokens", json={"label": "work"}, headers=cli.h).get_json()["token"]
    anon = app.app.test_client()
    body = {"items": [{"text": "send Q3 deck to finance"}, {"text": "send Q3 deck to finance"}, {"text": "book room"}]}
    assert anon.post("/api/capture", json=body, headers={"Authorization": "Bearer " + tok}).get_json()["added"] == 2
    assert anon.post("/api/capture", json=body, headers={"Authorization": "Bearer " + tok}).get_json()["added"] == 0  # repeat scan
    assert anon.post("/api/capture", json=body, headers={"Authorization": "Bearer bad"}).status_code == 401
    assert anon.get("/api/sync", headers={"Authorization": "Bearer " + tok}).status_code == 401  # reads nothing
    tid = cli.get("/api/tokens").get_json()[0]["id"]; cli.delete(f"/api/tokens/{tid}", headers=cli.h)
    assert anon.post("/api/capture", json={"items": [{"text": "x"}]}, headers={"Authorization": "Bearer " + tok}).status_code == 401

def test_fts_search_and_export_roundtrip(cli):
    put(cli, "note", {"title": "Trip to Rome", "body": "tiramisu at Pompi"})
    assert cli.get("/api/search?q=tirami").get_json()
    z = cli.get("/api/export"); assert z.status_code == 200 and z.data[:2] == b"PK"

def test_ics_parser_dst_and_rrule():
    from zoneinfo import ZoneInfo
    from datetime import datetime, timedelta
    import integrations
    tz = ZoneInfo("Asia/Dubai")
    ics = "BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=Asia/Dubai:20261012T100000\r\nDTEND;TZID=Asia/Dubai:20261012T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\r\nSUMMARY:Standup\r\nEND:VEVENT\r\n"
    ev = integrations.parse_ics(ics, tz, datetime(2026, 10, 1, tzinfo=tz), datetime(2026, 12, 1, tzinfo=tz))
    assert [e["start"] for e in ev] == ["2026-10-12T06:00:00Z", "2026-10-14T06:00:00Z", "2026-10-19T06:00:00Z", "2026-10-21T06:00:00Z"]

def test_work_page_is_self_contained(cli):
    html = cli.get("/api/work/page").data.decode()
    assert "<script src" not in html and "<link " not in html and "@import" not in html
    import re
    assert not re.findall(r'(?:src|href)=["\']https?://', html)      # nothing loaded from outside
    assert "lc_" not in html                                          # offline-only variant has no token
    html2 = cli.get("/api/work/page?endpoint=https://life.example.com").data.decode()
    assert "lc_" in html2 and "life.example.com" in html2
    assert cli.get("/api/work/page?endpoint=javascript:alert(1)").status_code == 400
    assert any(t["label"] == "work-page" for t in cli.get("/api/tokens").get_json())

def test_ping_has_cors_and_no_data(cli):
    import app
    r = app.app.test_client().get("/api/ping")
    assert r.get_json() == {"ok": True} and r.headers["Access-Control-Allow-Origin"] == "*"


def test_gmail_booking_parser():
    import gmail
    p = gmail.parse_booking("Your flight confirmation - EK318", "no-reply@emirates.com", "Booking reference: X7K9QP. Departs 12 Mar 2027 at 09:15 from Dubai Terminal 3")
    assert p["type"] == "flight" and p["conf"] == "X7K9QP" and p["start"] == "2027-03-12"
    h = gmail.parse_booking("Reservation confirmed at Hotel Roma", "x@booking.com", "Confirmation number: 123ABC. Check-in: March 14, 2027")
    assert h["type"] == "hotel" and h["conf"] == "123ABC" and h["start"] == "2027-03-14"
    assert gmail.parse_booking("Weekly newsletter", "n@x.com", "Ten things you should know") is None
    assert gmail.parse_date("on 03/04/2027") == "2027-04-03"   # day/month



def test_wealth_endpoints_fail_soft(cli, monkeypatch):
    j = cli.get("/api/wealth/summary").get_json(); assert j == {"configured": False}          # not set up: hidden, no error
    cli.post("/api/settings", json={"wealth_url": "http://127.0.0.1:9", "wealth_token": "tok-123456"}, headers=cli.h)
    j = cli.get("/api/wealth/summary").get_json(); assert j["configured"] is True and "unreachable" in j["error"]       # unreachable: still 200, no stack trace
    r = cli.post("/api/wealth/expense", json={"amount": 45}, headers=cli.h); assert r.status_code == 502 and "error" in r.get_json()
    assert cli.get("/api/settings").get_json()["wealth_token"] == "set", "the token is never sent back to the browser"
