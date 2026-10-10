# Talking to the wealth app (read-only, optional)

Life never reads the wealth database. It calls a tiny JSON endpoint you add to the wealth app, protected by a bearer token. If it isn't configured or can't be reached, Life silently hides those cards.

**Life side:** Settings → set `wealth_url` (e.g. `http://127.0.0.1:5000`) and `wealth_token` (same token as below). Turn on "Wealth app summary" in Assistant → Privacy if you want the assistant to see it.

**Wealth side:** add to the Flask app (adjust the field names to your data):

```python
@app.get("/api/life/summary")
def life_summary():
    if request.headers.get("Authorization") != "Bearer " + os.environ["LIFE_API_TOKEN"]:
        abort(401)
    return jsonify(
        net_worth=current_net_worth(),            # number, in `currency`
        currency="AED",
        goals=[{"name": g.name, "current": g.current, "target": g.target, "deadline": g.deadline} for g in goals()],
        upcoming=[{"name": b.name, "amount": b.amount, "due": b.due.isoformat(), "kind": "bill"}   # bills, renewals, card dues, subscriptions
                  for b in upcoming_bills(days=45)],
        budget={"month_spent": ..., "month_budget": ...},
    )

# optional: quick-add from Life ("spent 45 AED on lunch")
@app.post("/api/life/expense")
def life_expense():
    if request.headers.get("Authorization") != "Bearer " + os.environ["LIFE_API_TOKEN"]:
        abort(401)
    j = request.get_json()
    add_expense(amount=j["amount"], currency=j.get("currency"), note=j.get("note"), category=j.get("category"))
    return jsonify(ok=True)
```

What Life does with it:
* **Today / Review:** upcoming bills & renewals, a spend highlight.
* **Goals:** a goal can be *Live: Net worth (wealth app)* with a target; Life shows pace and a projected date. A daily `wealth_snapshot` is stored so the **year in review** can draw a net-worth line.
* **Life admin → Subscriptions:** read-only list of upcoming renewals (no duplicate entry).
* **Quick-add:** command palette → "Log an expense". If your wealth app lacks the endpoint you'll get a clear message instead of a silent failure.

Not exercised against your real wealth app (I can't see it); the Life side is covered by unit tests of the failure paths (unconfigured / unreachable → hidden).
