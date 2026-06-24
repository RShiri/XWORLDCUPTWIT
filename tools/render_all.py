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
        # Two schema variants: FotMob uses home.scores.fulltime; WhoScored-only uses home.score
        h = md.get("home", {})
        a = md.get("away", {})
        h_score = (h.get("scores") or {}).get("fulltime") if h.get("scores") else h.get("score")
        a_score = (a.get("scores") or {}).get("fulltime") if a.get("scores") else a.get("score")
        h_starters = sum(1 for p in h.get("players", []) if p.get("isFirstEleven"))
        a_starters = sum(1 for p in a.get("players", []) if p.get("isFirstEleven"))
        if (h_score is None and a_score is None) or (h_starters == 0 and a_starters == 0):
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
