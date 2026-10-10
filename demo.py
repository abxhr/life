"""Explicit demo data (Settings -> Load demo data). Everything is tagged demo:true so one click removes it. Never loaded automatically."""
import uuid
from datetime import date, timedelta


def make_demo():
    T = date.today()
    d = lambda n: (T + timedelta(days=n)).isoformat()
    rid = lambda: str(uuid.uuid4())
    out = []
    add = lambda kind, _id=None, **data: (out.append({"id": _id or rid(), "kind": kind, "data": data}), out[-1]["id"])[1]
    cid = lambda a2: 'c0c0c0c0-0000-4000-8000-' + ''.join(format(ord(c), 'x') for c in a2).rjust(12, '0')   # same deterministic ids the app uses
    add("task", title="Send Q3 deck to finance", due=d(0), due_time="14:00", priority=2, ctx="work", done=False, remind="at")
    add("task", title="Renew gym membership", due=d(-2), priority=3, ctx="personal", done=False)
    add("task", title="Book dentist", due=d(3), priority=3, ctx="personal", done=False)
    add("task", title="Read the onboarding doc", due=d(1), priority=3, ctx="work-outside-work", done=False)
    add("task", title="Learn to swim — find a coach", priority=4, ctx="personal", someday=True, done=False)
    add("task", title="Water the plants", due=d(0), priority=4, ctx="home", recur={"freq": "day", "interval": 3}, done=False)
    add("event", title="Padel with Omar", date=d(1), start="19:00", end="20:30", ctx="personal", allday=False)
    add("event", title="Team planning", date=d(0), start="10:00", end="11:00", ctx="work", allday=False)
    add("note", title="Rome ideas", body="# Rome\n- [ ] Book Colosseum tickets\n- Pompi for tiramisu\n\nSee [[Rome trip]]", tags=["travel"], type="plain")
    add("note", title="Decision: standing desk", body="## Decision\nBuy the electric one.\n\n## Why\nBack pain, 8 hours a day.", tags=["decision"], type="decision")
    lid = add("list", name="Rome — must eat", type="restaurant")
    for t, c, r in (("Pompi", "Italian", None), ("Roscioli", "Italian", 5), ("Supplizio", "Street food", None)):
        add("list_item", list=lid, title=t, cuisine=c, city="Rome", status="been, loved" if r else "want to go", rating=r, order=0)
    pid = add("list", name="Places to play", type="play")
    add("list_item", list=pid, title="Padel at Dubai Hills", activity="padel", area="Dubai Hills", status="want to try", order=1)
    add("list_item", list=pid, title="Karting at Autodrome", activity="karting", area="Motor City", status="want to try", order=2)
    gid = add("goal", title="Run 100 km this quarter", why="I feel clearer and calmer when I move.", area="health", status="active", quarterly=True, live=None, target={"type": "numeric", "start": 0, "current": 34, "goal": 100, "unit": "km"}, deadline=d(75), started=d(-30), milestones=[{"id": "m1", "title": "First 10 km week", "done": True}, {"id": "m2", "title": "Run a 10k", "done": False}])
    hid = add("habit", name="Read 20 minutes", freq="daily", goal_id=None)
    for i in (1, 2, 3, 5, 6):
        add("habit_log", habit=hid, day=d(-i))
    add("habit", name="Run", freq="weekly", per_week=3, goal_id=gid)
    for i in range(14):
        add("mood_log", day=d(-i), slot="day", mood=3 + (i % 3 == 0) - (i % 5 == 0), energy=3 + (i % 4 == 0), at=d(-i) + "T09:00:00Z")
    add("win", title="Shipped the Q2 report early", day=d(-9), source="manual")
    add("vision_item", type="why", text="Build a calm life with room for people, movement and adventure.")
    add("country", cid("FR"), code="FR", status="been")
    add("visit", country="FR", start="2025-05-01", end="2025-05-06", what="Paris — museums and long lunches", favourite="Sainte-Chapelle", rating=5)
    add("country", cid("JP"), code="JP", status="want", why="Food, trains, quiet temples", best_months=[2, 3, 10], budget="18000")
    add("trip", name="Rome long weekend", start=d(40), end=d(43), countries=["IT"], status="planned", currency="AED", budget=6000)
    add("person", name="Mum", how="family", birthday="1965-11-20", keep_weeks=1, last_contact=d(-24), details="Calls on Sundays", gifts=["Silk scarf"])
    add("maintenance_item", name="AC service", interval_days=180, last_done=d(-170), cost=250, category="home")
    for i in range(7):
        add("garmin_daily", "9a7a1c00-0000-4000-8000-" + d(-i).replace("-", "").rjust(12, "0"), day=d(-i), sleep_h=round(6.2 + (i % 3) * .6, 2), steps=6500 + i * 450, rhr=54 + i % 3, body_battery=68 - i * 3, active_min=25 + i)
    add("garmin_activity", day=d(-1), type="running", name="Morning run", distance_km=5.2, duration_min=28.5, avg_hr=152, calories=410, gid="demo1")
    return out
