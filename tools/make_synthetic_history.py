#!/usr/bin/env python3
"""Generate a tiny SYNTHETIC historical-edition dataset for developing/testing the
edition-aware builders without the real scraped raws (which arrive as GitHub
Release assets — see ROADMAP.md Phase A).

    py tools/make_synthetic_history.py 2022            # 4 fake matches -> history/wc2022/matches
    py tools/make_synthetic_history.py 2022 --clean    # delete the synthetic files and exit
                                                       # (do this before a REAL backfill so
                                                       # --pack can never zip synthetic files)

Writes 3 group games + 1 Round-of-16 tie in the exact 2026 match-JSON schema
(events / lineups / match_stats / stats_by_source), using real team names from the
edition's official draw in editions.py so groups resolve. Every file carries
``"_synthetic": true`` so a real backfill can never be confused with these, and
--clean removes ONLY files with that marker. Deterministic (fixed seed): reruns
produce byte-identical files. history/ is git-ignored — nothing here is committed.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "wc2026_dashboard"))

from editions import edition  # noqa: E402

FIRST = ["Alex", "Ben", "Carl", "Dan", "Eli", "Fred", "Gus", "Hal", "Ivan", "Jon",
         "Kai", "Leo", "Max", "Ned", "Oscar", "Pete"]
POSITIONS = ["GK", "DR", "DC", "DC", "DL", "MC", "MC", "MR", "ML", "FW", "FW"]


def _players(rng, team, team_id):
    """11 starters + 3 bench in the WhoScored player-list shape."""
    players = []
    for i in range(14):
        pid = team_id * 100 + i
        players.append({
            "playerId": pid,
            "name": f"{FIRST[i]} {team.split()[0]}",
            "shirtNo": i + 1,
            "position": POSITIONS[i] if i < 11 else "Sub",
            "isFirstEleven": i < 11,
            "isManOfTheMatch": False,
            "stats": {"ratings": {"89": round(rng.uniform(5.8, 8.6), 2)}},
        })
    return players


def _qual(name, value=None):
    q = {"type": {"displayName": name}}
    if value is not None:
        q["value"] = value
    return q


def _events(rng, home_id, away_id, score):
    """A minimal but representative event stream: passes (key/cross/through/prog),
    take-ons, shots of every type, goals incl. one penalty, cards incl. a second
    yellow (exercises the 2018 fair-play tiebreak), keeper saves and subs."""
    evs, eid = [], [1000, 2000]  # per-team event-id spaces, like WhoScored

    def ev(tid, minute, second, typ, pid_off, **kw):
        i = 0 if tid == home_id else 1
        eid[i] += 1
        e = {"eventId": eid[i], "teamId": tid, "minute": minute, "second": second,
             "period": {"value": 1 if minute < 46 else 2},
             "type": {"displayName": typ},
             "outcomeType": {"displayName": kw.pop("outcome", "Successful")},
             "playerId": tid * 100 + pid_off,
             "x": kw.pop("x", round(rng.uniform(20, 80), 1)),
             "y": kw.pop("y", round(rng.uniform(10, 90), 1)),
             "qualifiers": kw.pop("qualifiers", [])}
        e.update(kw)
        evs.append(e)
        return e

    goals_left = {home_id: score[0], away_id: score[1]}
    minute = 3
    for half in (0, 1):
        for _ in range(22):
            tid = home_id if rng.random() < 0.5 else away_id
            opp = away_id if tid == home_id else home_id
            x, y = round(rng.uniform(25, 75), 1), round(rng.uniform(10, 90), 1)
            quals = []
            if rng.random() < 0.2:
                quals.append(_qual("KeyPass"))
            if rng.random() < 0.15:
                quals.append(_qual("Cross"))
            if rng.random() < 0.1:
                quals.append(_qual("Throughball"))
            ev(tid, minute, rng.randrange(50), "Pass", rng.randrange(1, 11),
               x=x, y=y, endX=min(99.0, x + rng.uniform(-5, 25)),
               endY=round(rng.uniform(10, 90), 1), qualifiers=quals,
               outcome="Successful" if rng.random() < 0.85 else "Unsuccessful")
            if rng.random() < 0.25:
                ev(tid, minute, rng.randrange(50), "TakeOn", rng.randrange(6, 11),
                   outcome="Successful" if rng.random() < 0.55 else "Unsuccessful")
            if rng.random() < 0.45:  # a shot
                sx, sy = round(rng.uniform(78, 97), 1), round(rng.uniform(30, 70), 1)
                shooter = rng.randrange(6, 11)
                if goals_left[tid] > 0 and rng.random() < 0.35:
                    pen = rng.random() < 0.15
                    q = [_qual("RightFoot"), _qual("BigChance"),
                         _qual("GoalMouthY", round(rng.uniform(46, 54), 1)),
                         _qual("GoalMouthZ", round(rng.uniform(2, 30), 1))]
                    if pen:
                        q.append(_qual("Penalty"))
                    ev(tid, minute, rng.randrange(50), "Goal", shooter,
                       x=97.0 if pen else sx, y=50.0 if pen else sy, qualifiers=q)
                    goals_left[tid] -= 1
                else:
                    typ = rng.choice(["SavedShot", "MissedShots", "BlockedShot", "ShotOnPost"])
                    q = [_qual("LeftFoot" if rng.random() < 0.4 else "RightFoot")]
                    if typ == "SavedShot":
                        q += [_qual("GoalMouthY", round(rng.uniform(45, 55), 1)),
                              _qual("GoalMouthZ", round(rng.uniform(1, 35), 1))]
                    ev(tid, minute, rng.randrange(50), typ, shooter, x=sx, y=sy, qualifiers=q)
                    if typ == "SavedShot":
                        ev(opp, minute, rng.randrange(50), "Save", 0, x=3.0, y=50.0)
            minute += 1
        if half == 0:
            minute = 46
    # leftover scripted goals (ensures the scoreline is always reachable)
    for tid, left in goals_left.items():
        for k in range(left):
            ev(tid, 88 - k, 10, "Goal", 9,
               x=92.0, y=48.0,
               qualifiers=[_qual("RightFoot"),
                           _qual("GoalMouthY", 50.0), _qual("GoalMouthZ", 10.0)])
    # cards: a yellow each side + one second yellow (fair-play tiebreak material)
    ev(home_id, 33, 0, "Card", 5, qualifiers=[_qual("Yellow")])
    ev(away_id, 41, 0, "Card", 6, qualifiers=[_qual("Yellow")])
    ev(away_id, 77, 0, "Card", 6, qualifiers=[_qual("SecondYellow")])
    # one sub per side
    for tid in (home_id, away_id):
        ev(tid, 63, 0, "SubstitutionOff", 10)
        ev(tid, 63, 5, "SubstitutionOn", 11)
    evs.sort(key=lambda e: (e["minute"], e["second"]))
    return evs


def _match_stats(rng, score):
    def pair(canon, lo, hi, integer=True):
        a, b = rng.uniform(lo, hi), rng.uniform(lo, hi)
        if integer:
            a, b = int(a), int(b)
        else:
            a, b = round(a, 2), round(b, 2)
        return {canon: {"home": a, "away": b}}

    ms = {}
    for canon, lo, hi, integer in (
            ("shots", 8, 20, True), ("shots_on_target", 2, 9, True),
            ("possession", 35, 65, True), ("passes_total", 300, 650, True),
            ("passes_accuracy", 70, 92, True), ("big_chances_created", 0, 5, True),
            ("big_chances_missed", 0, 4, True), ("saves", 1, 7, True),
            ("fouls", 6, 18, True), ("duels_won", 30, 70, True),
            ("corners", 1, 11, True), ("xg", 0.4, 2.8, False)):
        ms.update(pair(canon, lo, hi, integer))
    return ms


def make_match(rng, year, date, home, away, home_id, away_id, score, stage):
    return {
        "matchId": 90000 + home_id + away_id,
        "_synthetic": True,
        "wc_metadata": {
            "stage": stage, "venue": f"Synthetic Arena {home_id}", "city": "",
            "country": "Testland", "date": date,
            "competition": f"FIFA World Cup {year}",
        },
        "home": {"teamId": home_id, "name": home, "score": score[0],
                 "penalty_score": None, "players": _players(rng, home, home_id)},
        "away": {"teamId": away_id, "name": away, "score": score[1],
                 "penalty_score": None, "players": _players(rng, away, away_id)},
        "events": _events(rng, home_id, away_id, score),
        "match_stats": _match_stats(rng, score),
        "stats_by_source": {"fotmob": _match_stats(rng, score)},
        "_sources": ["fotmob", "whoscored"],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Write synthetic historical raws for builder dev")
    ap.add_argument("year", type=int, choices=(2018, 2022))
    ap.add_argument("--clean", action="store_true",
                    help="delete previously generated synthetic files and exit")
    args = ap.parse_args()

    ed = edition(args.year)
    mdir = ed["match_dir"]
    os.makedirs(mdir, exist_ok=True)

    if args.clean:
        removed = 0
        for f in os.listdir(mdir):
            p = os.path.join(mdir, f)
            try:
                if f.endswith(".json") and json.load(open(p, encoding="utf-8")).get("_synthetic"):
                    os.remove(p)
                    removed += 1
            except Exception:
                pass
        print(f"Removed {removed} synthetic files from {mdir}")
        return 0

    rng = random.Random(20260716)
    g = ed["group_teams"]
    a1, a2, a3, a4 = g["A"]
    b1, b2 = g["B"][0], g["B"][1]
    y0 = ed["date_range"][0][:4]
    fixtures = [
        (f"{y0}-06-14", a1, a2, 101, 102, (2, 1), "Group Stage"),
        (f"{y0}-06-14", a3, a4, 103, 104, (0, 0), "Group Stage"),
        (f"{y0}-06-18", a1, a3, 101, 103, (1, 1), "Group Stage"),
        (f"{y0}-06-30", a1, b2, 101, 106, (3, 1), "1/8-finals"),
    ]
    for date, h, a, hid, aid, score, stage in fixtures:
        m = make_match(rng, args.year, date, h, a, hid, aid, score, stage)
        name = f"{date.replace('-', '_')}_{h.replace(' ', '_')}_vs_{a.replace(' ', '_')}.json"
        with open(os.path.join(mdir, name), "w", encoding="utf-8") as fh:
            json.dump(m, fh, ensure_ascii=False, indent=1)
        print(f"wrote {name}  ({h} {score[0]}-{score[1]} {a}, {stage})")
    print(f"\nSynthetic {args.year} raws in {mdir} — build with:")
    print(f"  py wc2026_dashboard/build_site.py --edition {args.year}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
