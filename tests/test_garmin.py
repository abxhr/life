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
