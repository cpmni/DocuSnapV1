"""soak_cdp.py PORT WINDOW_TITLE JS_EXPR  — evaluate JS in the dev app's page titled like WINDOW_TITLE (DevTools), print the value.
   soak_cdp.py PORT --list                 — list page targets."""
import json, os, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\tools\video_tutorials")
import scanfinder_video_runner as R

port = int(sys.argv[1])
cdp = R.CDP(port)
if sys.argv[2] == "--list":
    for t in cdp.targets():
        print(json.dumps({"title": t.get("title"), "url": t.get("url")}))
    sys.exit(0)
window, expr = sys.argv[2], sys.argv[3]
t = cdp.find_target(window)
if not t:
    print("NO TARGET; open pages:", [x.get("title") for x in cdp.targets()]); sys.exit(2)
print(json.dumps(cdp.evaluate(t, expr)))
