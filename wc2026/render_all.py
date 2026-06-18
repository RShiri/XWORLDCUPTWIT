"""Re-render all cached match JSONs."""
import json, sys, traceback, glob, os
sys.path.insert(0, '.')
from wc2026.renderer import render_wc_dashboard, output_filename

# Only process dated match files (skip old match_*_cache.json files)
match_files = sorted(
    f for f in glob.glob('wc2026/matches/*.json')
    if os.path.basename(f).startswith('2026_') and not f.endswith('_cache.json')
)
ok, fail = 0, 0
for f in match_files:
    try:
        with open(f, encoding='utf-8') as fh:
            md = json.load(fh)
        # Skip matches with no score (not yet played / empty placeholder JSONs)
        h_score = md.get("home", {}).get("scores", {}).get("fulltime")
        a_score = md.get("away", {}).get("scores", {}).get("fulltime")
        if h_score is None and a_score is None:
            print(f"SKIP {os.path.basename(f)} — no score yet")
            continue
        out = output_filename(md, 'wc2026/output')
        render_wc_dashboard(md, out)
        print(f"OK  {os.path.basename(out)}")
        ok += 1
    except Exception as e:
        print(f"ERR {f}: {e}")
        traceback.print_exc()
        fail += 1

print(f"\n{ok} rendered, {fail} failed")
