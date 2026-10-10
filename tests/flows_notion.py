"""Notion-style features, end to end: favourites, trash/restore, duplicate, links, icon & cover, rich blocks, formulas + summary + group-by + CSV round trip, automations, buttons."""
import os, tempfile


def run(pg, mobile, go, SHOTS, OUT):
    # --- favourites (pin a page) ---
    go("tasks"); pg.fill("input[aria-label='Add a task']", "buy flowers #errand"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    pg.click("button[aria-label='Pin to favourites']"); pg.wait_for_selector(".toast:has-text('Pinned')")
    if not mobile:
        pg.wait_for_selector("#quick .q:has-text('Tasks')")
    # --- rich page: toggle + callout + divider, icon & cover, duplicate, links, trash ---
    go("notes/new"); pg.wait_for_selector("input.note-title"); pg.click(".seg button:has-text('Write')"); pg.wait_for_selector("textarea.note-body"); pg.fill("input.note-title", "Rich page")
    pg.fill("textarea.note-body", "::: toggle More\nhidden bit\n:::\n\n> [!tip] Heads up\n> bring a charger\n\n---"); pg.wait_for_timeout(800)
    pg.click(".seg button:has-text('Read')"); pg.wait_for_selector(".note-prev details.toggle summary"); pg.wait_for_selector(".note-prev .callout.tip"); pg.click(".seg button:has-text('Write')")
    pg.click("button[aria-label='Icon and cover']"); pg.click(".emoji >> nth=2"); pg.click(".swatch >> nth=1"); pg.click(".dialog .btn.primary:has-text('Save')")
    pg.wait_for_selector(".notes-ed .cover"); pg.wait_for_selector(".notes-ed .pg-icon")
    if SHOTS: pg.screenshot(path=f"{OUT}/{'m' if mobile else 'd'}-richnote.png")
    pg.click("button[aria-label='Duplicate note']"); pg.wait_for_timeout(700); assert pg.input_value("input.note-title") == "Rich page (copy)"
    pg.click(".links-panel button:has-text('link')"); pg.fill(".dialog input[aria-label='Search to link']", "buy flowers"); pg.click(".dialog .res button >> nth=0")
    pg.wait_for_selector(".links-panel .chip:has-text('buy flowers')")
    pg.click("button[aria-label='Delete']"); pg.click(".dialog .btn.danger"); pg.wait_for_timeout(500)
    go("trash"); pg.wait_for_selector(".item:has-text('Rich page (copy)')"); pg.click(".item:has-text('Rich page (copy)') button:has-text('Restore')"); pg.wait_for_timeout(400)
    assert pg.locator(".item:has-text('Rich page (copy)')").count() == 0, "restored items leave the trash"
    # --- duplicate a task ---
    go("tasks"); pg.click(".seg button:has-text('Anytime')"); pg.click(".item:has-text('buy flowers') .grow"); pg.click(".dialog button:has-text('Duplicate')"); pg.wait_for_selector(".item .t:has-text('buy flowers (copy)')")
    # --- lists: custom type with a formula, summary, group by, CSV round trip ---
    go("lists"); pg.click("button:has-text('New list')"); pg.click(".dialog button:has-text('Make my own type')"); pg.fill(".dialog input[placeholder^='Type name']", "Gear")
    pg.fill(".dialog textarea", "Price (number)\nQty (number)\nTotal (formula: price * qty)\nKind (select: tech, clothes)"); pg.click(".dialog .btn.primary:has-text('Create')"); pg.wait_for_selector("input[aria-label='Quick add']")
    for nm, pr, q, k in (("Charger", 20, 2, "tech"), ("Jacket", 100, 1, "clothes")):
        pg.fill("input[aria-label='Quick add']", nm); pg.keyboard.press("Enter"); pg.wait_for_selector(f".item .t:has-text('{nm}')"); pg.wait_for_timeout(500); pg.click(f".item:has-text('{nm}') .grow")
        pg.wait_for_selector(".dialog input[type=number] >> nth=0"); pg.fill(".dialog input[type=number] >> nth=0", str(pr)); pg.fill(".dialog input[type=number] >> nth=1", str(q))
        pg.select_option(".dialog select", k); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_selector(f".item:has-text('{nm}') .meta:has-text('{k}')")
    pg.wait_for_selector(".sumbar:has-text('140')")                                            # 20*2 + 100*1, via the formula column
    pg.select_option("select[aria-label='Group by']", index=2); pg.wait_for_selector(".gh h3:has-text('tech')")
    pg.click(".gh:has-text('tech')"); pg.wait_for_timeout(300); assert pg.locator(".item .t:has-text('Charger')").count() == 0, "folded group hides its rows"
    with pg.expect_download() as dl:
        pg.click("button:has-text('CSV')")
    csvp = os.path.join(tempfile.gettempdir(), "gear-export.csv"); dl.value.save_as(csvp); txt = open(csvp, encoding="utf-8-sig").read()
    assert "Charger" in txt and "Total" in txt and "40" in txt, txt
    open(csvp, "w", encoding="utf-8").write("Name,Price,Qty,Kind\nTent,200,1,tech\nSocks,5,4,clothes\n")
    with pg.expect_file_chooser() as fc:
        pg.click("button[title='Import rows from a CSV file']")
    fc.value.set_files(csvp); pg.click(".dialog .btn.primary:has-text('Import')"); pg.wait_for_timeout(500)
    pg.click(".gh:has-text('tech')"); pg.wait_for_selector(".item .t:has-text('Tent')")
    # --- buttons + automations ---
    go("settings"); pg.select_option("select[aria-label='Add from template']", index=3); pg.wait_for_selector(".toast:has-text('Added')")      # "follow up in 3 days after a task in a project is done"
    pg.click("button:has-text('New button')"); pg.fill(".dialog input[placeholder='Call mum']", "Call mum"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_timeout(300)
    go("today"); pg.wait_for_selector("button:has-text('Call mum')"); pg.click("button:has-text('Call mum')"); pg.wait_for_selector(".toast:has-text('Added')")
    go("tasks"); pg.fill("input[aria-label='Add a task']", "send passport copy +Japan-trip"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    pg.click(".seg button:has-text('Projects')"); pg.select_option("select[aria-label='Group by']", "priority"); pg.wait_for_selector(".gh h3")
    pg.check(".item:has-text('send passport copy') input.chk"); pg.wait_for_timeout(600)
    pg.click(".seg button:has-text('Anytime')"); pg.click(".seg button:has-text('Upcoming')"); pg.wait_for_selector(".item .t:has-text('Follow up on Send passport copy')")   # the automation fired (due in 3 days)
    # --- near-a-place reminder is saved with the task ---
    pg.click(".seg button:has-text('Upcoming')"); pg.click(".item:has-text('Follow up on') .grow"); pg.fill("input[aria-label='Remind me near']", "25.2048, 55.2708"); pg.click(".dialog .btn.primary:has-text('Save')"); pg.wait_for_timeout(300)
    pg.click(".item:has-text('Follow up on') .grow"); assert pg.input_value("input[aria-label='Remind me near']").startswith("25.2048"); pg.keyboard.press("Escape")
