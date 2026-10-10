import json, os, sys, uuid
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
import pytest
from test_backend import cli, put  # noqa: F401


@pytest.fixture()
def ai(cli, monkeypatch):
    monkeypatch.setenv("LIFE_AI_MOCK", "1")
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
