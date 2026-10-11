import os, sys, uuid
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli, put  # noqa: F401


def test_calendar_feed_and_siri_brief_are_private_and_only_titles_and_dates(cli):
    import app
    today = __import__("datetime").date.today().isoformat()
    put(cli, "task", {"title": "Pay rent", "due": today, "due_time": "09:30", "done": False, "notes": "SECRET-NOTE"})
    put(cli, "task", {"title": "Done thing", "due": today, "done": True})
    put(cli, "event", {"title": "Padel", "date": today, "start": "18:00", "end": "19:00", "allday": False})
    put(cli, "trip", {"name": "Tokyo", "start": "2027-03-01", "end": "2027-03-08"})
    put(cli, "travel_doc", {"type": "visa", "name": "US visa", "nationality": "US", "expiry": "2035-06-01", "number": "enc:XXXX"})
    put(cli, "person", {"name": "Sam", "birthday": "1990-05-04"})
    anon = app.app.test_client()
    assert anon.get("/feed/nope/life.ics").status_code == 404                                    # no token set yet / wrong token
    info = cli.post("/api/feed/rotate", json={}, headers=cli.h).get_json(); assert info["on"] and info["webcal"].startswith("webcal://")
    path = info["ics"].split("localhost")[-1]
    ics = anon.get(path); assert ics.status_code == 200 and ics.mimetype == "text/calendar"
    t = ics.data.decode()
    assert "SUMMARY:☐ Pay rent" in t and "SUMMARY:Padel" in t and "SUMMARY:✈ Tokyo" in t and "SUMMARY:⏳ US visa expires" in t and "RRULE:FREQ=YEARLY" in t and "TRIGGER:-P90D" in t
    assert "Done thing" not in t and "SECRET-NOTE" not in t and "enc:XXXX" not in t               # finished tasks and private fields are never in the feed
    assert t.startswith("BEGIN:VCALENDAR\r\n") and t.rstrip().endswith("END:VCALENDAR") and all(len(l.encode()) <= 75 for l in t.split("\r\n"))
    txt = anon.get(info["today"].split("localhost")[-1]).data.decode(); assert "Pay rent" in txt and "Padel" in txt and txt.startswith("Good ")
    old = path
    cli.post("/api/feed/rotate", json={}, headers=cli.h); assert anon.get(old).status_code == 404   # rotating cuts the old link off
