import os, sys, uuid
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli, put  # noqa: F401


def test_purge_only_removes_things_already_in_the_trash(cli):
    live, gone = str(uuid.uuid4()), str(uuid.uuid4())
    put(cli, "task", {"title": "keep me"}, live); put(cli, "task", {"title": "binned"}, gone)
    cli.post("/api/sync", json={"changes": [{"id": gone, "kind": "task", "data": {}, "updated_at": "2099-01-01T00:00:00.000Z", "deleted_at": "2099-01-01T00:00:00.000Z"}]}, headers=cli.h)
    r = cli.post("/api/trash/purge", json={"ids": [live, gone, "not-an-id"]}, headers=cli.h).get_json()
    assert r["purged"] == 1, "a live record can never be purged, even if its id is sent"
    ids = {x["id"] for x in cli.get("/api/sync?since=").get_json()["records"]}
    assert live in ids and gone not in ids
    assert cli.post("/api/trash/purge", json={"ids": [live]}, headers={}).status_code == 403    # CSRF still required
