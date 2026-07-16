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
from build_match_details import find_png, find_png_dark, is_match_file
from editions import resolve_stage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATCH_DIR = os.path.join(ROOT, "wc2026", "matches")
SCHEDULE = os.path.join(ROOT, "wc2026", "REMAINING_SCHEDULE.json")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")

EDITION = 2026
_CFG = None  # editions.py config for the active edition (None = 2026 defaults)


def set_edition(year):
    """Point this builder at one edition. 2026 = today's paths/behavior, unchanged.
    Historical editions read history/wc<year>/matches and write editions/<year>/data.js."""
    global EDITION, _CFG, MATCH_DIR, OUT
    from editions import edition as _edition
    _CFG = _edition(year)
    EDITION = int(year)
    MATCH_DIR = _CFG["match_dir"]
    if EDITION == 2026:
        OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")
    else:
        OUT = os.path.join(_CFG["out_dir"], "data.js")
    return _CFG

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


# data.js stat key -> canonical match_stats key (scraper now stores nested
# {home,away} under these canonical names; older files used flat `<key>_home`).
_STAT_KEYS = {
    "xg": "xg", "shots": "shots", "sot": "shots_on_target",
    "possession": "possession", "passes": "passes_total",
    "pass_acc": "passes_accuracy", "big_chances": "big_chances_created",
    "big_missed": "big_chances_missed", "saves": "saves", "fouls": "fouls",
    "duels_won": "duels_won", "corners": "corners",
}


def _pair(ms, canonical):
    """[home, away] for a canonical stat, accepting nested {home,away} or flat key_home."""
    v = ms.get(canonical)
    if isinstance(v, dict):
        return [v.get("home"), v.get("away")]
    return [ms.get(canonical + "_home"), ms.get(canonical + "_away")]


def _stat_line(ms):
    """Full [home, away] stat line keyed by the data.js stat names."""
    line = {dst: _pair(ms, canon) for dst, canon in _STAT_KEYS.items()}
    # legacy alias: some old files only have pass_accuracy spelled differently
    if line["pass_acc"] == [None, None]:
        line["pass_acc"] = _pair(ms, "pass_accuracy")
    return line


def build_groups():
    """team -> group letter. 2026: from the remaining schedule (covers all 48 teams).
    Historical editions: from the official draw in editions.py (the raws only carry a
    generic "Group Stage" stage string, and no schedule file exists for history)."""
    if EDITION != 2026 and _CFG and _CFG.get("group_teams"):
        return {norm(team): letter
                for letter, teams in _CFG["group_teams"].items()
                for team in teams}
    sched = json.load(open(SCHEDULE, encoding="utf-8"))
    team_group = {}
    for m in sched:
        grp = m.get("group", "")
        if len(grp) != 1 or not grp.isalpha():
            continue  # skip knockout placeholder "groups"
        for side in ("home", "away"):
            team_group[norm(m[side])] = grp
    return team_group


def compute_fair_play(team_group):
    """team -> FIFA fair-play points (negative), group-stage matches only. The 2018
    group tiebreak (Japan over Senegal): yellow −1, second-yellow red −3, straight
    red −4, yellow then straight red −5, summed per player per match."""
    fp = {}
    for f in sorted(glob.glob(os.path.join(MATCH_DIR, "*.json"))):
        if not is_match_file(f):
            continue
        d = json.load(open(f, encoding="utf-8"))
        home, away = norm(d["home"]["name"]), norm(d["away"]["name"])
        gh, ga = team_group.get(home), team_group.get(away)
        if gh is None or gh != ga:
            continue  # knockout / unknown — the tiebreak only counts group games
        side_of = {d["home"].get("teamId"): home, d["away"].get("teamId"): away}
        cards = {}  # (team, playerId) -> {"y": yellows, "sy": bool, "r": straight red}
        for e in d.get("events", []):
            t = e.get("type", {})
            if (t.get("displayName") if isinstance(t, dict) else "") != "Card":
                continue
            team, pid = side_of.get(e.get("teamId")), e.get("playerId")
            if team is None or pid is None:
                continue
            quals = {q.get("type", {}).get("displayName", "") for q in e.get("qualifiers", [])}
            c = cards.setdefault((team, pid), {"y": 0, "sy": False, "r": False})
            if "SecondYellow" in quals:
                c["sy"] = True
            elif "Red" in quals:
                c["r"] = True
            elif "Yellow" in quals:
                c["y"] += 1
        for (team, _pid), c in cards.items():
            if c["sy"]:
                pts = -3
            elif c["r"]:
                pts = -5 if c["y"] else -4
            else:
                pts = -c["y"]
            fp[team] = fp.get(team, 0) + pts
    return fp


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
        hpen = d["home"].get("penalty_score")
        apen = d["away"].get("penalty_score")
        mid = os.path.basename(f)[:-5]
        # Several files have an empty metadata date; the filename always starts
        # with YYYY_MM_DD, so fall back to that.
        date = meta.get("date", "") or mid[:10].replace("_", "-")

        # Combined stat line (match_stats keeps the larger value per stat).
        stats = _stat_line(ms)
        # xG policy (multi-source average, per DATA_SOURCES.md): the canonical team xG is
        # the AVERAGE of our logistic model and FotMob's xG when both exist; otherwise
        # whichever single source we have. Each component is also stored (model_xg_*,
        # fot_xg_*) so the match page can show the breakdown. `xg_source` records which.
        fot_xg_home, fot_xg_away = stats["xg"][0], stats["xg"][1]
        model_xg_home = model_xg_away = None
        if d.get("events"):
            ch, ca = team_xg_from_events(d)
            if ch is not None:
                model_xg_home, model_xg_away = ch, ca

        def _avg_xg(model_v, fot_v):
            if model_v is not None and fot_v is not None:
                return round((model_v + fot_v) / 2.0, 2)
            return model_v if model_v is not None else fot_v

        xg_home = _avg_xg(model_xg_home, fot_xg_home)
        xg_away = _avg_xg(model_xg_away, fot_xg_away)
        xg_source = ("avg" if (model_xg_home is not None and fot_xg_home is not None)
                     else "model" if model_xg_home is not None
                     else "fotmob" if fot_xg_home is not None else None)
        if xg_home is not None:
            stats["xg"] = [xg_home, xg_away]

        # Per-source stat lines behind the average, so the site/DB can show or audit
        # each provider's raw numbers ("most should be the same"; xG is FotMob-only).
        stats_by_source = {src: _stat_line(sd) for src, sd in (d.get("stats_by_source") or {}).items()}

        has_stats = stats["xg"][0] is not None or stats["shots"][0] is not None

        matches.append({
            "id": mid,
            "date": date,
            "venue": meta.get("venue", ""),
            "stage": resolve_stage(EDITION, meta.get("stage", ""), date),
            "home": home,
            "away": away,
            "hs": hs,
            "as": as_,
            "hpen": hpen,
            "apen": apen,
            "played": hs is not None and as_ is not None,
            "has_stats": bool(has_stats),
            "has_events": bool(d.get("events")),
            "xg_home": xg_home,
            "xg_away": xg_away,
            "xg_source": xg_source,
            "model_xg_home": model_xg_home,
            "model_xg_away": model_xg_away,
            "fot_xg_home": fot_xg_home,
            "fot_xg_away": fot_xg_away,
            "png": find_png(mid),
            "png_dark": find_png_dark(mid),
            "stats": stats,
            "statsBySource": stats_by_source,
            "sources": d.get("_sources", []),
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


def compute_standings(matches, team_group, fair_play=None):
    groups = {}  # letter -> { team -> stats }
    for m in matches:
        if not m["played"]:
            continue
        h, a = m["home"], m["away"]
        gh, ga = team_group.get(h), team_group.get(a)
        # Only count matches where both teams are in the SAME group AND the match
        # itself is a group-stage fixture — two teams drawn from the same group can
        # meet again in the knockout stage (e.g. a 3rd-place playoff), and without
        # the stage check that rematch was double-counted into the group table.
        if gh is None or gh != ga:
            continue
        stage_l = (m.get("stage") or "").lower()
        if "grp" not in stage_l and "group" not in stage_l:
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
        if fair_play is None:
            rows.sort(key=lambda r: (-r["Pts"], -r["GD"], -r["GF"], r["team"]))
        else:
            # fair-play editions (2018): fewer card points ranks higher after Pts/GD/GF
            for r in rows:
                r["FP"] = fair_play.get(r["team"], 0)
            rows.sort(key=lambda r: (-r["Pts"], -r["GD"], -r["GF"], -r["FP"], r["team"]))
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


def main(edition=2026):
    set_edition(edition)
    team_group = build_groups()
    matches = load_matches()
    fair_play = (compute_fair_play(team_group)
                 if EDITION != 2026 and _CFG and _CFG.get("fair_play_tiebreak") else None)
    standings = compute_standings(matches, team_group, fair_play)
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
    if EDITION != 2026:
        # Historical payloads self-describe (the frontend shim reads the format from
        # the data, not per-year rules). 2026 stays byte-identical (no new keys).
        from editions import format_payload
        data["edition"] = EDITION
        data["format"] = format_payload(EDITION)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// AUTO-GENERATED by build_data.py — do not edit by hand.\n")
        fh.write("window.WC_DATA = ")
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")
    print(f"Wrote {OUT}")
    print(f"  {len(matches)} matches, {len(played)} played, {len(with_xg)} with xG")
    print(f"  {len(standings)} groups, {len(xg_records)} xG team-records")


if __name__ == "__main__":
    import argparse
    from editions import add_edition_arg
    main(add_edition_arg(argparse.ArgumentParser()).parse_args().edition)
