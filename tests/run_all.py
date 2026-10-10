"""Everything, in order. Exit code 0 only if every gate passes.   .venv/Scripts/python tests/run_all.py [--fast]"""
import glob, os, subprocess, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
py = sys.executable; fast = "--fast" in sys.argv; env = dict(os.environ, PYTHONIOENCODING="utf8", PYTHONUTF8="1")
steps = [("JS syntax (every module)", None)]
steps += [("node unit tests", ["node", "tests/test_nlp.mjs"]), ("", ["node", "tests/test_suggest.mjs"]), ("", ["node", "tests/test_travel.mjs"]), ("", ["node", "tests/test_insights.mjs"]), ("", ["node", "tests/test_notion.mjs"]),
          ("pytest (backend, security, assistant, reminders, share, push, garmin)", [py, "-m", "pytest", "tests", "-q"])]
if not fast:
    steps += [("smoke: every page x 2 viewports x 2 themes, zero console errors", [py, "tests/smoke.py"]), ("flows: capture, tasks, notes, lists, travel, health, assistant, review, extras", [py, "tests/flows.py"]), ("work page: offline, zero network requests", [py, "tests/workpage.py"]), ("offline-first: shell with no network, outbox, sync on reconnect", [py, "tests/offline.py"]), ("quality: XSS, accessibility, performance", [py, "tests/quality.py"])]
fail = []; t0 = time.time()
for label, cmd in steps:
    if label: print(f"\n== {label}", flush=True)
    if cmd is None:
        bad = []
        for f in glob.glob(os.path.join(ROOT, "static", "js", "**", "*.js"), recursive=True) + [os.path.join(ROOT, "sw.js")]:
            if "vendor" in f: continue
            r = subprocess.run(["node", "--check", f], capture_output=True, text=True, cwd=ROOT)
            if r.returncode: bad.append((f, r.stderr.strip().splitlines()[0:3]))
        print("  ok" if not bad else "  FAIL " + str(bad)); fail += [b[0] for b in bad]; continue
    r = subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-4:]; print("  " + "\n  ".join(tail))
    if r.returncode: fail.append(" ".join(cmd[-2:]))
print(f"\n{'ALL GREEN' if not fail else 'FAILED: ' + ', '.join(fail)}  ({time.time() - t0:.0f}s)"); sys.exit(1 if fail else 0)
