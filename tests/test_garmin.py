import io, os, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from test_backend import cli  # noqa: F401  (fixture)

CSV = b"Activity Type,Date,Title,Distance,Calories,Time,Avg HR\nRunning,2026-10-08,Run,5.2,410,00:28:30,152\n"


def test_garmin_mapping_and_manual_import(cli):
    import garmin
    d = garmin.map_day("2026-10-09", stats={"totalSteps": 8123, "restingHeartRate": 54, "bodyBatteryMostRecentValue": 71, "moderateIntensityMinutes": 20, "vigorousIntensityMinutes": 10},
                       sleep={"dailySleepDTO": {"sleepTimeSeconds": 21000, "sleepScores": {"overall": {"value": 78}}}}, hrv={"hrvSummary": {"lastNightAvg": 48, "status": "BALANCED"}}, body={"totalAverage": {"weight": 78400}})
    assert d["steps"] == 8123 and d["sleep_h"] == 5.83 and d["sleep_score"] == 78 and d["hrv"] == 48 and d["weight"] == 78.4 and d["active_min"] == 30
    assert "vo2max" not in d                                  # missing metrics are simply absent, not errors
    a = garmin.map_activity({"startTimeLocal": "2026-10-08 06:30:00", "activityType": {"typeKey": "running"}, "distance": 5230.5, "duration": 1710, "averageHR": 152, "calories": 410, "activityId": 99})
    assert a["distance_km"] == 5.23 and a["duration_min"] == 28.5 and a["type"] == "running"
    rows = garmin.parse_activities_csv(CSV.decode())
    assert rows[0]["day"] == "2026-10-08" and rows[0]["distance_km"] == 5.2 and rows[0]["duration_min"] == 28.5
    tcx = (b'<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running">'
           b'<Id>2026-10-07T05:00:00Z</Id><Lap><TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters><Calories>300</Calories></Lap></Activity></Activities></TrainingCenterDatabase>')
    assert garmin.parse_tcx(tcx)[0]["distance_km"] == 5.0
    for _ in range(2):
        r = cli.post("/api/garmin/import", data={"file": (io.BytesIO(CSV), "act.csv")}, headers=cli.h, content_type="multipart/form-data")
        assert r.get_json()["imported"] == 1
    acts = [x for x in cli.get("/api/sync?since=").get_json()["records"] if x["kind"] == "garmin_activity"]
    assert len(acts) == 1                                     # re-importing the same file does not duplicate
    assert cli.post("/api/garmin/sync", json={}, headers=cli.h).get_json()["ok"] is False   # unconfigured: fails soft, no crash


class FakeGarmin:
    """Stand-in for garminconnect.Garmin that records every PASSWORD login (each one makes Garmin email a code) and every token save."""
    password_logins, dumps, token_logins, mfa = [], [], [], False
    def __init__(self, email=None, password=None, return_on_mfa=False, **kw):
        self.email, self.password, self.return_on_mfa = email, password, return_on_mfa
        self.client = self
    def login(self, tokenstore=None):
        if self.email:                                           # a password sign-in
            FakeGarmin.password_logins.append(self.email)
            if FakeGarmin.mfa and self.return_on_mfa:
                return ("needs_mfa", {"state": 1})
            return (None, None)
        FakeGarmin.token_logins.append(tokenstore)               # tokens only
        if not os.path.exists(os.path.join(tokenstore, "garmin_tokens.json")):
            raise RuntimeError("no tokens")
        return (None, None)
    def dump(self, path):
        FakeGarmin.dumps.append(path); open(os.path.join(path, "garmin_tokens.json"), "w").write("{}")
    def resume_login(self, state, code):
        if code != "123456": raise RuntimeError("bad code")
    # data calls: empty is fine, the pull code tolerates missing metrics
    def __getattr__(self, name):
        if name.startswith("get_"): return lambda *a, **k: {}
        raise AttributeError(name)


def test_garmin_signs_in_once_then_reuses_tokens_and_never_emails_from_the_scheduler(cli, monkeypatch):
    import sys, types, shutil, garmin
    fake = types.ModuleType("garminconnect"); fake.Garmin = FakeGarmin; monkeypatch.setitem(sys.modules, "garminconnect", fake)
    for k in ("password_logins", "dumps", "token_logins"): getattr(FakeGarmin, k).clear()
    monkeypatch.setenv("GARMIN_EMAIL", "me@x.com"); monkeypatch.setenv("GARMIN_PASSWORD", "pw")
    tokdir = garmin.tokdir_default(); shutil.rmtree(tokdir, ignore_errors=True)
    app_ = __import__("app"); run = lambda **kw: garmin.sync(app_.upsert, app_.raw_db, app_.set_state, app_.now_iso, **kw)

    assert run(days=1)["reason"] == "not connected" and FakeGarmin.password_logins == []          # scheduler, nothing saved yet: does NOT sign in (no email)
    FakeGarmin.mfa = True
    assert run(days=1, interactive=True)["reason"] == "mfa" and len(FakeGarmin.password_logins) == 1   # the button: one password sign-in, Garmin asks for a code
    r = cli.post("/api/garmin/mfa", json={"code": "123456"}, headers=cli.h); assert r.status_code == 200, r.get_json()
    assert FakeGarmin.dumps and garmin.connected(tokdir)                                         # entering the code SAVED the tokens (the bug: it never did)

    FakeGarmin.mfa = False
    for _ in range(5):                                                                           # every later sync, scheduled or manual, reuses the tokens
        assert run(days=1)["ok"] is True
        assert run(days=1, interactive=True)["ok"] is True
    assert len(FakeGarmin.password_logins) == 1, "no further password sign-ins, so no further security-code emails"

    os.remove(os.path.join(tokdir, "garmin_tokens.json"))                                       # tokens lost/expired: the scheduler must not fall back to the password
    assert connected_after_loss(garmin, tokdir) is False
    assert run(days=1)["reason"] == "not connected" and len(FakeGarmin.password_logins) == 1


def connected_after_loss(garmin, tokdir):
    return garmin.connected(tokdir)


def test_garmin_first_sign_in_without_mfa_still_saves_tokens(cli, monkeypatch):
    import sys, types, shutil, garmin
    fake = types.ModuleType("garminconnect"); fake.Garmin = FakeGarmin; monkeypatch.setitem(sys.modules, "garminconnect", fake)
    for k in ("password_logins", "dumps", "token_logins"): getattr(FakeGarmin, k).clear()
    FakeGarmin.mfa = False
    monkeypatch.setenv("GARMIN_EMAIL", "me@x.com"); monkeypatch.setenv("GARMIN_PASSWORD", "pw")
    tokdir = garmin.tokdir_default(); shutil.rmtree(tokdir, ignore_errors=True)
    app_ = __import__("app")
    assert garmin.sync(app_.upsert, app_.raw_db, app_.set_state, app_.now_iso, days=1, interactive=True)["ok"] is True
    assert garmin.connected(tokdir) and len(FakeGarmin.password_logins) == 1                    # return_on_mfa mode returns before saving: we save explicitly
