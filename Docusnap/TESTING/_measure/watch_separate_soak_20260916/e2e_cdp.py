"""e2e_cdp.py PORT URL_SUBSTRING JS_EXPR — evaluate JS in the dev app's page whose URL contains URL_SUBSTRING (DevTools).
   e2e_cdp.py PORT --list — list page targets (title + url). Uses the video runner's CDP class (its venv Python).
   Exit 2 when no target matches (the caller polls)."""
import json, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\tools\video_tutorials")
import scanfinder_video_runner as R

port = int(sys.argv[1]); cdp = R.CDP(port)
try:
    targets = cdp.targets()
except Exception as e:
    print("NO CDP:", e); sys.exit(3)
if sys.argv[2] == "--list":
    for t in targets: print(json.dumps({"title": t.get("title"), "url": t.get("url")}))
    sys.exit(0)
sub, expr = sys.argv[2], sys.argv[3]
t = next((x for x in targets if sub in str(x.get("url") or "")), None)
if not t:
    print("NO TARGET; open pages:", [x.get("url") for x in targets]); sys.exit(2)
print(json.dumps(cdp.evaluate(t, expr)))
