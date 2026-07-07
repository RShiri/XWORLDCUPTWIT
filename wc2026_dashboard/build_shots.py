#!/usr/bin/env python3
"""Aggregate every shot in the tournament into shots.js for the dashboard's Team Lab
(the shot map / xG heatmap and the team style fingerprints).

window.WC_SHOTS = [{t,o,h,x,y,xg,g,ot,s,m}]  — one entry per shot:
  t  team name (play-off placeholders normalised)   o  opponent name
  h  True if the team was home                       x,y WhoScored coords (attacking → x=100)
  xg shot xG (same model as the PNGs/match pages)    g  goal?    ot on target?
  s  situation (OpenPlay/Penalty/Corner/…)           m  minute

Own goals are excluded (they sit at the conceding end and would plot a phantom shot),
as are penalty-shootout kicks.
"""
import json
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from xg_model import SHOT_TYPES, shot_xg, is_shootout
from build_match_details import norm, is_match_file

MATCH_DIR = os.path.join(ROOT, "wc2026", "matches")
OUT = os.path.join(HERE, "shots.js")


def main():
    shots = []
    for f in sorted(glob.glob(os.path.join(MATCH_DIR, "*.json"))):
        if not is_match_file(f):
            continue
        d = json.load(open(f, encoding="utf-8"))
        if d["home"].get("score") is None or d["away"].get("score") is None:
            continue
        if not d.get("events"):
            continue
        home, away = norm(d["home"].get("name", "")), norm(d["away"].get("name", ""))
        sides = {d["home"].get("teamId"): ("home", home, away),
                 d["away"].get("teamId"): ("away", away, home)}
        for ev in d.get("events", []):
            t = ev.get("type", {})
            tn = t.get("displayName") if isinstance(t, dict) else ""
            if tn not in SHOT_TYPES or is_shootout(ev) or ev.get("isOwnGoal"):
                continue
            info = sides.get(ev.get("teamId"))
            if not info:
                continue
            side, team, opp = info
            xg, meta = shot_xg(ev, d)
            shots.append({
                "t": team, "o": opp, "h": side == "home",
                "x": round(ev.get("x", 0), 1), "y": round(ev.get("y", 0), 1),
                "xg": round(xg, 3), "g": tn == "Goal", "ot": tn in ("Goal", "SavedShot"),
                "s": meta["situation"], "m": ev.get("minute", 0),
            })
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.WC_SHOTS = ")
        json.dump(shots, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print(f"Wrote {OUT} — {len(shots)} shots")


if __name__ == "__main__":
    main()
