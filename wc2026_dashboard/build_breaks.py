"""Build breaks.js — the cooling-break analysis data for the Breaks tab.

All the math lives in tools/cooling_break_analysis.py::export_breaks (the same
module behind COOLING_BREAK_ANALYSIS.md), so the dashboard and the CLI report
can never disagree. This builder only adds team colors and serialises.

window.WC_BREAKS = {
  meta: { generated, windows: [300, 420, 600],
          base: { "420": {mu, sd, n, ctrl: {dom, sub, n}}, ... } },  // group-stage-frozen
  matches: [{
    id, d, st,                 // matches/<id>.json basename, date, stage code (G/R32/...)
    h, a, hc, ac, hs, as,      // names, primary colors, final score
    ht, end,                   // last H1 / H2 event minute (HT line, x-axis max)
    goals: [{m, s, og, pen}],  // s = credited side (own goals flipped)
    series: { "420": [[min, D], ...], ... },   // rolling momentum diff (home - away)
    breaks: [{ n, s, e, dur, conf, gh, ga,     // minutes, dead seconds, >=150s flag,
               w: { "420": { sh,               //   score at break; |shift| per window
                             m: [mh0, ma0, mh1, ma1],       // per-side index pre/post
                             pace: {pas, tou, fte, ppda} }  // [pre, post] rates / raw counts
                    } }]       // a window block is null when clipped by the half boundary
  }] }
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

from cooling_break_analysis import export_breaks

OUT = os.path.join(HERE, "breaks.js")


def _team_color(name):
    try:
        from wc2026.team_colors import get_team_colors
        c = get_team_colors(name, fallback_home=True)
        return c.get("primary", "#4ea1ff")
    except Exception:
        return "#4ea1ff"


def main():
    data = export_breaks(ROOT)
    for m in data["matches"]:
        m["hc"] = _team_color(m["h"])
        m["ac"] = _team_color(m["a"])
    data["meta"]["generated"] = time.strftime("%Y-%m-%d %H:%M")
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.WC_BREAKS = ")
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    nb = sum(len(m["breaks"]) for m in data["matches"])
    print(f"Wrote {OUT} — {len(data['matches'])} matches, {nb} breaks")


if __name__ == "__main__":
    main()
