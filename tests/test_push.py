import os, sys, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli  # noqa: F401

SUB = {"endpoint": "https://push.example.com/abc123", "keys": {"p256dh": "BNc" + "A" * 80, "auth": "x" * 22}}


def test_vapid_key_subscribe_send_and_prune(cli, monkeypatch):
    import app, push, pywebpush
    k = cli.get("/api/push/key").get_json()["key"]
    assert len(k) >= 86 and "=" not in k                      # uncompressed P-256 point, base64url
    assert cli.post("/api/push/subscribe", json={"subscription": {"endpoint": "http://insecure", "keys": {}}}, headers=cli.h).status_code == 400
    assert cli.post("/api/push/subscribe", json={"subscription": SUB}, headers=cli.h).get_json()["ok"]
    cli.post("/api/push/subscribe", json={"subscription": SUB}, headers=cli.h)                       # same device twice
    subs = [r for r in cli.get("/api/sync?since=").get_json()["records"] if r["kind"] == "push_sub"]
    assert len(subs) == 1
    sent = []
    monkeypatch.setattr(push, "webpush", lambda **kw: sent.append(kw), raising=False)
    monkeypatch.setattr(pywebpush, "webpush", lambda **kw: sent.append(kw))
    r = cli.post("/api/push/test", headers=cli.h).get_json(); assert r["delivered"] == 1 and json.loads(sent[0]["data"])["title"] == "Life"
    class Gone(pywebpush.WebPushException):
        def __init__(self): self.response = type("R", (), {"status_code": 410})()
    def boom(**kw): raise Gone()
    monkeypatch.setattr(pywebpush, "webpush", boom)
    r = cli.post("/api/push/test", headers=cli.h).get_json(); assert r["delivered"] == 0
    subs = [x for x in cli.get("/api/sync?since=").get_json()["records"] if x["kind"] == "push_sub" and not x["deleted_at"]]
    assert subs == []                                        # a 410 prunes the dead subscription
