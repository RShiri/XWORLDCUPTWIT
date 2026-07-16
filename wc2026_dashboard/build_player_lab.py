#!/usr/bin/env python3
"""Build per-team player-event files for the Player Lab (same design as the
XLALIGA dashboard's build_player_lab.py, adapted to the World Cup).

The Player Lab's stat cards / radar / head-to-head bars read season aggregates
that already live in players.js. Only the ACTION MAPS (shots, take-ons, passes,
progressive passes) need per-player event locations. Those would be huge for
1,000+ players at once, so — like match pages load matches_detail/<id>.js on
demand — we write ONE file per nation (player_lab/<slug>.js) that the Player Lab
fetches when that team is picked.

Each file:  window.WC_PLAYERLAB[<Team>] = { "<player>": {shots, dribbles, passes} }
Event arrays are compact and ordered to match app.js `plGraph`:
  shots    [x, y, gy, xg, goal, ontarget, min, opp]
  dribbles [x, y, ex, ey, ok, min, opp]   (ex/ey = carry end; -1 when unknown)
  passes   [x, y, ex, ey, ok, prog, min, opp]  (progressive map = passes with prog=1)
Coords are raw WhoScored 0-100 (same as the match centre).
"""
import glob, json, os, re

import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
DETAIL_DIR = os.path.join(HERE, "matches_detail")
OUT_DIR = os.path.join(HERE, "player_lab")

EDITION = 2026


def set_edition(year):
    """Point this builder at one edition's matches_detail/player_lab dirs
    (2026 = today's paths, unchanged)."""
    global EDITION, DETAIL_DIR, OUT_DIR
    from editions import edition as _edition
    cfg = _edition(year)
    EDITION = int(year)
    if EDITION == 2026:
        DETAIL_DIR = os.path.join(HERE, "matches_detail")
        OUT_DIR = os.path.join(HERE, "player_lab")
    else:
        DETAIL_DIR = os.path.join(cfg["out_dir"], "matches_detail")
        OUT_DIR = os.path.join(cfg["out_dir"], "player_lab")
    return cfg


def slug(team):
    return re.sub(r"[^A-Za-z0-9]+", "_", team).strip("_")


def _read(path):
    m = re.search(r"=\s*(\{.*\})\s*;?\s*$", open(path, encoding="utf-8").read(), re.S)
    return json.loads(m.group(1)) if m else None


def main(edition=2026):
    set_edition(edition)
    os.makedirs(OUT_DIR, exist_ok=True)
    teams = {}   # team name -> {player -> {"shots":[], "dribbles":[], "passes":[]}}

    for f in sorted(glob.glob(os.path.join(DETAIL_DIR, "*.js"))):
        if os.path.basename(f).startswith("_"):
            continue
        d = _read(f)
        if not d:
            continue
        tn = {"home": d["home"]["name"], "away": d["away"]["name"]}
        opp = {"home": d["away"]["name"], "away": d["home"]["name"]}

        def rec(team, player):
            t = teams.setdefault(team, {})
            return t.setdefault(player, {"shots": [], "dribbles": [], "passes": []})

        for s in d.get("shots", []):
            p, side = s.get("player"), s.get("team")
            if not p or side not in tn:
                continue
            gy = s.get("gy")
            rec(tn[side], p)["shots"].append([
                round(s.get("x", 0) or 0, 1), round(s.get("y", 0) or 0, 1),
                round(gy if gy is not None else 50.0, 1),
                round(float(s.get("xg", 0) or 0), 3),
                1 if s.get("goal") else 0, 1 if s.get("onTarget") else 0,
                int(s.get("min", 0) or 0), opp[side],
            ])
        for dr in d.get("dribbles", []):
            p, side = dr.get("player"), dr.get("team")
            if not p or side not in tn:
                continue
            ex, ey = dr.get("ex"), dr.get("ey")
            rec(tn[side], p)["dribbles"].append([
                round(dr.get("x", 0) or 0, 1), round(dr.get("y", 0) or 0, 1),
                round(ex, 1) if ex is not None else -1,
                round(ey, 1) if ey is not None else -1,
                1 if dr.get("ok") else 0, int(dr.get("min", 0) or 0), opp[side],
            ])
        for pa in d.get("passes", []):
            p, side = pa.get("player"), pa.get("team")
            if not p or side not in tn:
                continue
            rec(tn[side], p)["passes"].append([
                round(pa.get("x", 0) or 0, 1), round(pa.get("y", 0) or 0, 1),
                round(pa.get("ex", 0) or 0, 1), round(pa.get("ey", 0) or 0, 1),
                1 if pa.get("ok") else 0, 1 if pa.get("prog") else 0,
                int(pa.get("min", 0) or 0), opp[side],
            ])

    # drop empty players; write one file per team
    idx = {}
    for team, players in teams.items():
        players = {p: v for p, v in players.items()
                   if v["shots"] or v["dribbles"] or v["passes"]}
        if not players:
            continue
        path = os.path.join(OUT_DIR, slug(team) + ".js")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("window.WC_PLAYERLAB = window.WC_PLAYERLAB || {};\n")
            fh.write("window.WC_PLAYERLAB[" + json.dumps(team, ensure_ascii=False) + "] = ")
            json.dump(players, fh, ensure_ascii=False, separators=(",", ":"))
            fh.write(";\n")
        idx[team] = {"slug": slug(team), "players": len(players)}

    with open(os.path.join(OUT_DIR, "_index.js"), "w", encoding="utf-8") as fh:
        fh.write("window.WC_PLAYERLAB_TEAMS = ")
        json.dump(idx, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    tot = sum(v["players"] for v in idx.values())
    print(f"wrote {len(idx)} team files to {OUT_DIR}  ({tot} players total)")


if __name__ == "__main__":
    import argparse
    from editions import add_edition_arg
    main(add_edition_arg(argparse.ArgumentParser()).parse_args().edition)
