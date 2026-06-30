#!/usr/bin/env python3
"""Aggregate per-player statistics across every played match into players.js.

Combines both data sources the pipeline scrapes: WhoScored player stat streams
(passes, shots, tackles, ratings, …) and the event feed (goals, assists, cards,
minutes). Writes window.WC_PLAYERS for the dashboard's Players tab, and exposes
aggregate()/per_match_rows() for the database exporter.
"""
import json
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from build_match_details import norm, _match_extras, _player_rating, is_match_file
from xg_model import ascii_name, SHOT_TYPES, shot_xg, is_shootout

MATCH_DIR = os.path.join(ROOT, "wc2026", "matches")
OUT = os.path.join(HERE, "players.js")

# WhoScored per-minute stat dicts are incremental → sum the values.
SUM_STATS = {
    "shotsTotal": "shots", "shotsOnTarget": "sot", "passesTotal": "passes",
    "passesAccurate": "passAcc", "passesKey": "keyPasses", "touches": "touches",
    "tacklesTotal": "tackles", "interceptions": "interceptions", "aerialsWon": "aerials",
    "dribblesWon": "dribbles", "foulsCommited": "fouls", "clearances": "clearances",
    "dispossessed": "dispossessed", "totalSaves": "saves",
}


def _sum_stat(stats, key):
    d = stats.get(key) or {}
    try:
        return sum(float(v) for v in d.values())
    except (TypeError, ValueError):
        return 0.0


def _new_player(pid, name, team, pos):
    rec = dict(pid=pid, name=name, team=team, pos=pos,
               mp=0, starts=0, mins=0, g=0, a=0, yc=0, rc=0,
               rating_sum=0.0, rating_n=0, rating_best=0.0, xg=0.0,
               progPasses=0, xa=0.0, xgaOn=0.0, gConcOn=0)
    for v in SUM_STATS.values():
        rec[v] = 0.0
    return rec


def _player_shot_xg(match_data):
    """playerId -> summed shot xG for the match."""
    out = {}
    for ev in match_data.get("events", []):
        t = ev.get("type", {})
        if not isinstance(t, dict) or t.get("displayName") not in SHOT_TYPES:
            continue
        if is_shootout(ev):
            continue  # exclude penalty-shootout kicks from player xG
        pid = ev.get("playerId")
        if pid is None:
            continue
        xg, _ = shot_xg(ev)
        out[pid] = out.get(pid, 0.0) + xg
    return out


def _player_creation(match_data):
    """playerId -> (progressive-pass count, summed expected assists xA).

    Progressive pass = a SUCCESSFUL pass that advances the ball >=15 WhoScored x-units
    toward the opponent goal — the same `prog` rule the dashboard pass-explorer uses.
    xA (expected assists) credits the player whose KEY pass set up each shot with that
    shot's xG: WhoScored key passes are by definition the pass that leads to a shot, so
    we credit the next shot by the same team that lands within a few events of the key
    pass. Own goals and penalty-shootout kicks are excluded."""
    events = match_data.get("events", [])
    prog, xa, pending = {}, {}, {}  # pending: teamId -> (passerPid, event_index)
    for i, ev in enumerate(events):
        if is_shootout(ev):
            continue
        t = ev.get("type", {})
        tname = t.get("displayName") if isinstance(t, dict) else ""
        tid = ev.get("teamId")
        if tname == "Pass":
            ok = ev.get("outcomeType", {}).get("displayName") == "Successful"
            pid = ev.get("playerId")
            if ok and pid is not None and (ev.get("endX", ev.get("x", 0)) - ev.get("x", 0)) >= 15:
                prog[pid] = prog.get(pid, 0) + 1
            if ok and pid is not None:
                quals = {q.get("type", {}).get("displayName", "") for q in ev.get("qualifiers", [])}
                if "KeyPass" in quals or "IntentionalGoalAssist" in quals:
                    pending[tid] = (pid, i)
        elif tname in SHOT_TYPES and not ev.get("isOwnGoal"):
            kp = pending.get(tid)
            if kp and (i - kp[1]) <= 4 and kp[0] != ev.get("playerId"):
                xg, _ = shot_xg(ev)
                xa[kp[0]] = xa.get(kp[0], 0.0) + xg
            pending.pop(tid, None)
    return prog, xa


def _defense_shotlist(match_data):
    """[(teamId, minute, xg, is_goal, is_own)] for every shot (shootout excluded).

    Used to attribute on-pitch defensive context: for a player on team T, the xG his
    side FACED is the summed xg of the OPPONENT's shots while he was on the pitch, and
    goals conceded are the opponent's goals (plus own goals by T) in that window. Own
    goals carry the conceding team's id and aren't chances, so xg=0 for them."""
    out = []
    for ev in match_data.get("events", []):
        t = ev.get("type", {})
        tn = t.get("displayName") if isinstance(t, dict) else ""
        if tn not in SHOT_TYPES or is_shootout(ev):
            continue
        is_own = bool(ev.get("isOwnGoal"))
        xg = 0.0 if is_own else shot_xg(ev)[0]
        out.append((ev.get("teamId"), ev.get("minute", 0), xg, tn == "Goal", is_own))
    return out


def _iter_played():
    for f in sorted(glob.glob(os.path.join(MATCH_DIR, "*.json"))):
        if not is_match_file(f):
            continue  # skip scraper cache files
        d = json.load(open(f, encoding="utf-8"))
        if d["home"].get("score") is None or d["away"].get("score") is None:
            continue
        if not any((p.get("stats") or {}).get("ratings")
                   for p in d["home"].get("players", []) + d["away"].get("players", [])):
            continue  # no per-player stats (FotMob-only games)
        yield os.path.basename(f)[:-5], d


def aggregate():
    players = {}
    for mid, d in _iter_played():
        ex = _match_extras(d)
        shot_xg_map = _player_shot_xg(d)
        prog_map, xa_map = _player_creation(d)
        shotlist = _defense_shotlist(d)
        team_ids = {s: d[s].get("teamId") for s in ("home", "away")}
        for side in ("home", "away"):
            team = norm(d[side].get("name", ""))
            our_id = team_ids[side]
            opp_id = team_ids["away" if side == "home" else "home"]
            for p in d[side].get("players", []):
                pid = p.get("playerId")
                stats = p.get("stats") or {}
                started = bool(p.get("isFirstEleven"))
                on_m = ex["on_min"].get(pid)
                came_on = on_m is not None
                if not (started or came_on):
                    continue  # unused bench
                rec = players.get(pid)
                if rec is None:
                    rec = players[pid] = _new_player(pid, ascii_name(p.get("name", "")), team, p.get("position", ""))
                # on-pitch window: [start, end] in minutes
                start = 0 if started else on_m
                end = ex["off_min"].get(pid) if ex["off_min"].get(pid) is not None else ex["end_min"]
                rec["mp"] += 1
                if started:
                    rec["starts"] += 1
                rec["mins"] += max(0, end - start)
                # defensive context: opponent xG faced + goals conceded while on the pitch
                for (tid, mn, xg, is_goal, is_own) in shotlist:
                    if mn < start or mn > end:
                        continue
                    if is_own:
                        if tid == our_id:
                            rec["gConcOn"] += 1     # our own goal = conceded
                    elif tid == opp_id:
                        rec["xgaOn"] += xg
                        if is_goal:
                            rec["gConcOn"] += 1
                rec["g"] += ex["goals"].get(pid, 0)
                rec["a"] += ex["assists"].get(pid, 0)
                rec["yc"] += ex["yellow"].get(pid, 0)
                rec["rc"] += ex["red"].get(pid, 0)
                rec["xg"] += shot_xg_map.get(pid, 0.0)
                rec["progPasses"] += prog_map.get(pid, 0)
                rec["xa"] += xa_map.get(pid, 0.0)
                rt = _player_rating(p)
                if rt is not None:
                    rec["rating_sum"] += rt
                    rec["rating_n"] += 1
                    rec["rating_best"] = max(rec["rating_best"], rt)
                for src, dst in SUM_STATS.items():
                    rec[dst] += _sum_stat(stats, src)

    out = []
    for rec in players.values():
        r = dict(rec)
        r["ga"] = r["g"] + r["a"]
        r["rating"] = round(r["rating_sum"] / r["rating_n"], 2) if r["rating_n"] else None
        r["rating_best"] = round(r["rating_best"], 2) if r["rating_best"] else None
        r["pass_pct"] = round(100 * r["passAcc"] / r["passes"]) if r["passes"] else None
        r["xg"] = round(r["xg"], 2)
        r["xg_diff"] = round(r["g"] - r["xg"], 2)
        r["xa"] = round(r["xa"], 2)
        # on-pitch defence: xG faced, per-90, and goals prevented (faced − conceded)
        r["xga"] = round(r["xgaOn"], 2)
        r["xga90"] = round(r["xgaOn"] / r["mins"] * 90, 2) if r["mins"] else None
        r["gPrev"] = round(r["xgaOn"] - r["gConcOn"], 2)
        for v in list(SUM_STATS.values()) + ["mins", "progPasses", "gConcOn"]:
            r[v] = int(round(r[v]))
        r.pop("rating_sum", None)
        r.pop("rating_n", None)
        r.pop("xgaOn", None)
        out.append(r)
    out.sort(key=lambda r: (-r["ga"], -r["g"], -(r["rating"] or 0)))
    return out


def per_match_rows():
    """Yield one flat dict per player per match (for the database export)."""
    for mid, d in _iter_played():
        ex = _match_extras(d)
        shot_xg_map = _player_shot_xg(d)
        date = d.get("wc_metadata", {}).get("date", "") or mid[:10].replace("_", "-")
        for side in ("home", "away"):
            team = norm(d[side].get("name", ""))
            opp = norm(d["away" if side == "home" else "home"].get("name", ""))
            for p in d[side].get("players", []):
                pid = p.get("playerId")
                stats = p.get("stats") or {}
                started = bool(p.get("isFirstEleven"))
                on_m = ex["on_min"].get(pid)
                if not (started or on_m is not None):
                    continue
                mins = (ex["off_min"].get(pid) if ex["off_min"].get(pid) is not None else ex["end_min"]) \
                    if started else max(0, ex["end_min"] - on_m)
                row = dict(match_id=mid, date=date, team=team, opponent=opp,
                           player_id=pid, player=ascii_name(p.get("name", "")),
                           position=p.get("position", ""), started=int(started), minutes=int(mins),
                           goals=ex["goals"].get(pid, 0), assists=ex["assists"].get(pid, 0),
                           yellow=ex["yellow"].get(pid, 0), red=ex["red"].get(pid, 0),
                           rating=_player_rating(p), xg=round(shot_xg_map.get(pid, 0.0), 2))
                for src, dst in SUM_STATS.items():
                    row[dst] = int(round(_sum_stat(stats, src)))
                yield row


def main():
    data = aggregate()
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.WC_PLAYERS = ")
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print(f"Wrote {OUT} — {len(data)} players")


if __name__ == "__main__":
    main()
