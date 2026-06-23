#!/usr/bin/env python3
"""Build data.js for the WC2026 dashboard from the scraped match JSON files.

Reads every wc2026/matches/*.json plus wc2026/REMAINING_SCHEDULE.json, normalises
play-off placeholder team names, computes group standings, collects the match list
(played + upcoming) and the xG analysis dataset, then writes a single self-contained
data.js (window.WC_DATA = {...}) so the site works by just opening index.html.
"""
import json
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xg_model import team_xg_from_events
from build_match_details import find_png, is_match_file

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATCH_DIR = os.path.join(ROOT, "wc2026", "matches")
SCHEDULE = os.path.join(ROOT, "wc2026", "REMAINING_SCHEDULE.json")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")

# FotMob ships group-stage fixtures with play-off placeholder names. Map them to
# the real qualified nations (see memory: playoff_slot_names).
NAME_MAP = {
    "European Play-Off A": "Bosnia and Herzegovina",
    "European Play-Off B": "Sweden",
    "European Play-Off C": "Turkiye",
    "European Play-Off D": "Czechia",
    "FIFA Play-Off Tournament 2": "Iraq",
}


def norm(name):
    return NAME_MAP.get(name, name)


def build_groups():
    """team -> group letter, from the remaining schedule (covers all 48 teams)."""
    sched = json.load(open(SCHEDULE, encoding="utf-8"))
    team_group = {}
    for m in sched:
        grp = m.get("group", "")
        if len(grp) != 1 or not grp.isalpha():
            continue  # skip knockout placeholder "groups"
        for side in ("home", "away"):
            team_group[norm(m[side])] = grp
    return team_group


def load_matches():
    matches = []
    for f in sorted(glob.glob(os.path.join(MATCH_DIR, "*.json"))):
        if not is_match_file(f):
            continue  # skip scraper WhoScored cache files (match_<id>_cache.json)
        d = json.load(open(f, encoding="utf-8"))
        meta = d.get("wc_metadata", {})
        ms = d.get("match_stats") or {}
        home = norm(d["home"]["name"])
        away = norm(d["away"]["name"])
        hs = d["home"].get("score")
        as_ = d["away"].get("score")
        mid = os.path.basename(f)[:-5]
        # Several files have an empty metadata date; the filename always starts
        # with YYYY_MM_DD, so fall back to that.
        date = meta.get("date", "") or mid[:10].replace("_", "-")

        # xG: prefer the FotMob value; otherwise estimate it from the WhoScored
        # shot events with the same model the PNG renderer uses. This fills the
        # many played matches that were scraped + rendered but had no FotMob xG.
        xg_home, xg_away = ms.get("xg_home"), ms.get("xg_away")
        xg_estimated = False
        if (xg_home is None or xg_away is None) and d.get("events"):
            ch, ca = team_xg_from_events(d)
            if ch is not None:
                xg_home, xg_away, xg_estimated = ch, ca, True

        # Full stat line per game. Each entry is [home, away]; None where absent.
        def pair(key):
            return [ms.get(key + "_home"), ms.get(key + "_away")]
        stats = {
            "xg": [xg_home, xg_away],
            "shots": pair("shots"),
            "sot": [ms.get("shots_on_target_home"), ms.get("shots_on_target_away")],
            "possession": pair("possession"),
            "passes": pair("passes"),
            "pass_acc": [ms.get("pass_accuracy_home") or ms.get("passes_accuracy_home"),
                         ms.get("pass_accuracy_away") or ms.get("passes_accuracy_away")],
            "big_chances": [ms.get("big_chances_created_home"), ms.get("big_chances_created_away")],
            "big_missed": [ms.get("big_chances_missed_home"), ms.get("big_chances_missed_away")],
            "saves": pair("saves"),
            "fouls": pair("fouls"),
            "duels_won": pair("duels_won"),
        }
        has_stats = stats["xg"][0] is not None or stats["shots"][0] is not None

        matches.append({
            "id": mid,
            "date": date,
            "venue": meta.get("venue", ""),
            "stage": meta.get("stage", ""),
            "home": home,
            "away": away,
            "hs": hs,
            "as": as_,
            "played": hs is not None and as_ is not None,
            "has_stats": bool(has_stats),
            "has_events": bool(d.get("events")),
            "xg_home": xg_home,
            "xg_away": xg_away,
            "xg_estimated": xg_estimated,
            "png": find_png(mid),
            "stats": stats,
        })
    return _dedupe(matches)


def _dedupe(matches):
    """Drop play-off placeholder duplicates. When the same fixture (same two teams
    after name normalisation) appears more than once — e.g. a real scraped game plus
    a dataless placeholder-named twin — keep the richer record and drop the empty one."""
    def richness(m):
        return (bool(m["has_events"]), bool(m["played"]), bool(m["has_stats"]))
    richest = {}
    for m in matches:
        pair = frozenset((m["home"], m["away"]))
        r = richness(m)
        if pair not in richest or r > richest[pair]:
            richest[pair] = r
    out = []
    for m in matches:
        pair = frozenset((m["home"], m["away"]))
        # drop a record only if it has no events AND a strictly richer twin exists
        if not m["has_events"] and richness(m) < richest[pair]:
            continue
        out.append(m)
    return out


def compute_standings(matches, team_group):
    groups = {}  # letter -> { team -> stats }
    for m in matches:
        if not m["played"]:
            continue
        h, a = m["home"], m["away"]
        gh, ga = team_group.get(h), team_group.get(a)
        # Only count matches where both teams are in the SAME group (group stage).
        if gh is None or gh != ga:
            continue
        grp = groups.setdefault(gh, {})
        for t in (h, a):
            grp.setdefault(t, dict(team=t, P=0, W=0, D=0, L=0, GF=0, GA=0, GD=0, Pts=0))
        hs, as_ = m["hs"], m["as"]
        H, A = grp[h], grp[a]
        H["P"] += 1; A["P"] += 1
        H["GF"] += hs; H["GA"] += as_
        A["GF"] += as_; A["GA"] += hs
        if hs > as_:
            H["W"] += 1; H["Pts"] += 3; A["L"] += 1
        elif hs < as_:
            A["W"] += 1; A["Pts"] += 3; H["L"] += 1
        else:
            H["D"] += 1; A["D"] += 1; H["Pts"] += 1; A["Pts"] += 1

    # Make sure every team in the group appears even with 0 games played.
    for team, grp in team_group.items():
        g = groups.setdefault(grp, {})
        g.setdefault(team, dict(team=team, P=0, W=0, D=0, L=0, GF=0, GA=0, GD=0, Pts=0))

    out = {}
    for letter, teams in groups.items():
        rows = list(teams.values())
        for r in rows:
            r["GD"] = r["GF"] - r["GA"]
        rows.sort(key=lambda r: (-r["Pts"], -r["GD"], -r["GF"], r["team"]))
        out[letter] = rows
    return dict(sorted(out.items()))


def build_xg_records(matches):
    """One record per team per match that has xG, for the analysis section."""
    recs = []
    for m in matches:
        if not m["played"] or m["xg_home"] is None or m["xg_away"] is None:
            continue
        recs.append(dict(team=m["home"], opp=m["away"], gf=m["hs"], ga=m["as"],
                         xgf=round(m["xg_home"], 2), xga=round(m["xg_away"], 2),
                         home=True, date=m["date"]))
        recs.append(dict(team=m["away"], opp=m["home"], gf=m["as"], ga=m["hs"],
                         xgf=round(m["xg_away"], 2), xga=round(m["xg_home"], 2),
                         home=False, date=m["date"]))
    return recs


def main():
    team_group = build_groups()
    matches = load_matches()
    standings = compute_standings(matches, team_group)
    xg_records = build_xg_records(matches)

    played = [m for m in matches if m["played"]]
    with_xg = [m for m in played if m["xg_home"] is not None]

    data = {
        "generated": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
        "counts": {
            "total": len(matches),
            "played": len(played),
            "with_xg": len(with_xg),
            "teams": len(team_group),
            "groups": len(standings),
        },
        "teamGroup": team_group,
        "standings": standings,
        "matches": matches,
        "xgRecords": xg_records,
    }

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// AUTO-GENERATED by build_data.py — do not edit by hand.\n")
        fh.write("window.WC_DATA = ")
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")
    print(f"Wrote {OUT}")
    print(f"  {len(matches)} matches, {len(played)} played, {len(with_xg)} with xG")
    print(f"  {len(standings)} groups, {len(xg_records)} xG team-records")


if __name__ == "__main__":
    main()
