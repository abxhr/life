import os, sys, uuid, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli, put  # noqa: F401


def test_share_list_and_trip_are_read_only_escaped_and_expire(cli):
    import app
    lid = str(uuid.uuid4()); put(cli, "list", {"name": "Rome <must> eat", "type": "restaurant"}, lid)
    put(cli, "list_item", {"list": lid, "title": "Pompi <script>alert(1)</script>", "city": "Rome", "notes": "tiramisu"})
    tid = str(uuid.uuid4()); put(cli, "trip", {"name": "Paris", "start": "2026-11-05", "end": "2026-11-08"}, tid)
    put(cli, "booking", {"trip": tid, "type": "flight", "title": "EK073 DXB-CDG", "conf": "SECRET1", "start": "2026-11-05", "start_time": "09:15", "cost": 4200})
    put(cli, "trip_item", {"trip": tid, "date": "2026-11-05", "title": "Louvre @48.86,2.33", "order": 1})
    anon = app.app.test_client()
    u = cli.post("/api/share", json={"kind": "list", "id": lid, "days": 3}, headers=cli.h).get_json()["url"]
    html = anon.get(u).data.decode()
    assert "Pompi" in html and "<script>" not in html and "&lt;script&gt;" in html and "Rome &lt;must&gt;" in html
    assert anon.get("/api/sync").status_code == 401, "a share link opens exactly one page, nothing else"
    t = anon.get(cli.post("/api/share", json={"kind": "trip", "id": tid}, headers=cli.h).get_json()["url"]).data.decode()
    assert "EK073" in t and "Louvre" in t and "SECRET1" not in t and "4200" not in t and "48.86" not in t
    assert anon.get("/s/not-a-token").status_code == 404
    # expiry
    for r in app.raw_db().execute("SELECT id,data FROM records WHERE kind='share'").fetchall():
        d = json.loads(r["data"]); d["expires"] = "2020-01-01T00:00:00Z"
        c = app.raw_db(); c.execute("UPDATE records SET data=? WHERE id=?", (json.dumps(d), r["id"])); c.commit()
    assert anon.get(u).status_code == 410
    assert cli.post("/api/share", json={"kind": "note", "id": lid}, headers=cli.h).status_code == 400   # only lists and trips can be shared
