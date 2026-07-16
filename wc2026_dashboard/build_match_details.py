#!/usr/bin/env python3
"""Build per-match detail files for the interactive match dashboard.

For every match that has WhoScored events, extract the full shot list (with the
same xG model as the PNG renderer), every pass with its end coordinates, the goal
timeline and the line-ups. Each match is written to matches_detail/<id>.js as

    window.MATCH_DETAIL = {...}

so match.html can load one game via a plain <script> tag (works on file:// too).

Usage:
    py wc2026_dashboard/build_match_details.py            # build all
    (the renderer hook calls build_one(match_data) for the game it just rendered)
"""
import json
import glob
import os
import sys
import urllib.parse
from html import escape as _hesc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)

from xg_model import (SHOT_TYPES, shot_xg, player_full_name, ascii_name, is_shootout)

MATCH_DIR = os.path.join(ROOT, "wc2026", "matches")
OUT_DIR = os.path.join(HERE, "matches_detail")
SHARE_DIR = os.path.join(HERE, "share")
# Absolute site base for OG/Twitter tags (crawlers need absolute URLs). Override for a fork.
SITE_BASE = os.environ.get("WC_SITE_BASE", "https://rshiri.github.io/XWORLDCUPTWIT")

NAME_MAP = {
    "European Play-Off A": "Bosnia and Herzegovina",
    "European Play-Off B": "Sweden",
    "European Play-Off C": "Turkiye",
    "European Play-Off D": "Czechia",
    "FIFA Play-Off Tournament 2": "Iraq",
}


import re as _re
_MATCH_NAME_RE = _re.compile(r"^\d{4}_\d{2}_\d{2}_.+_vs_.+$")


def is_match_file(path):
    """True for real match JSONs (YYYY_MM_DD_Home_vs_Away.json), excluding the
    scraper's WhoScored cache files (match_<id>_cache.json) that share the folder."""
    return bool(_MATCH_NAME_RE.match(os.path.basename(path)[:-5]))


def norm(name):
    return NAME_MAP.get(name, name)


def _team_color(name):
    try:
        from wc2026.team_colors import get_team_colors
        c = get_team_colors(name, fallback_home=True)
        return c.get("primary", "#4ea1ff")
    except Exception:
        return "#4ea1ff"


def _assist_playerid(goal_ev, scorer_pid, by_team_eid):
    """The playerId credited with the assist for `goal_ev`, or None if unassisted.

    Follows the goal's `RelatedEventId` qualifier to the setup event within the SAME
    team's eventId space; credits that event's player when it's a teammate other than
    the scorer (solo goals point back at the scorer's own carry → no assist)."""
    rel_id = next((q.get("value") for q in goal_ev.get("qualifiers", [])
                   if q.get("type", {}).get("displayName") == "RelatedEventId"), None)
    if rel_id is None:
        return None
    try:
        rel = by_team_eid.get(goal_ev.get("teamId"), {}).get(int(rel_id))
    except (TypeError, ValueError):
        return None
    aid = rel.get("playerId") if rel else None
    return aid if (aid is not None and aid != scorer_pid) else None


def _match_extras(match_data):
    """Per-playerId goals, assists, cards and sub on/off minutes from events.

    Assists are resolved via each goal's WhoScored `RelatedEventId`, which links the
    goal to the event that created it (the assisting pass). WhoScored numbers eventIds
    PER TEAM, not per match, so the lookup is scoped to the scoring team's events —
    resolving globally collides the home/away id spaces and credits the wrong player.
    The older `IntentionalGoalAssist` qualifier is only set on some assists, so it
    under-counts (e.g. it missed both of Mbappe's assists to Dembele vs Norway)."""
    events = match_data.get("events", [])
    by_team_eid = {}  # teamId -> {eventId: event}, for RelatedEventId assist resolution
    for e in events:
        by_team_eid.setdefault(e.get("teamId"), {})[e.get("eventId")] = e
    goals, assists, yellow, red, on_min, off_min = {}, {}, {}, {}, {}, {}
    end_min = 90
    for e in events:
        if is_shootout(e):
            continue  # shootout kicks aren't goals and must not extend the timeline
        m = e.get("minute") or 0
        if m > end_min:
            end_min = m
        pid = e.get("playerId")
        if pid is None:
            continue
        t = e.get("type", {}).get("displayName", "")
        quals = {q.get("type", {}).get("displayName", "") for q in e.get("qualifiers", [])}
        if t == "Goal" and not (e.get("isOwnGoal") or "OwnGoal" in quals):
            goals[pid] = goals.get(pid, 0) + 1
            aid = _assist_playerid(e, pid, by_team_eid)
            if aid is not None:
                assists[aid] = assists.get(aid, 0) + 1
        if t == "Card":
            if "Red" in quals or "SecondYellow" in quals:
                red[pid] = red.get(pid, 0) + 1
                if "SecondYellow" in quals:
                    yellow[pid] = yellow.get(pid, 0) + 1
            elif "Yellow" in quals:
                yellow[pid] = yellow.get(pid, 0) + 1
        if t == "SubstitutionOn":
            on_min[pid] = m
        elif t == "SubstitutionOff":
            off_min[pid] = m
    return dict(goals=goals, assists=assists, yellow=yellow, red=red,
                on_min=on_min, off_min=off_min, end_min=end_min)


def _player_rating(p):
    rd = (p.get("stats") or {}).get("ratings") or {}
    if not rd:
        return None
    try:
        return round(float(list(rd.values())[-1]), 1)
    except (TypeError, ValueError):
        return None


def _lineup(side, ex):
    starters, subs = [], []
    for p in side.get("players", []):
        pid = p.get("playerId")
        starter = bool(p.get("isFirstEleven"))
        on_m = ex["on_min"].get(pid)
        off_m = ex["off_min"].get(pid)
        # minutes played
        if starter:
            mins = (off_m if off_m is not None else ex["end_min"])
        elif on_m is not None:
            mins = ex["end_min"] - on_m
        else:
            mins = 0
        entry = {
            "num": p.get("shirtNo"),
            "name": ascii_name(p.get("name", "")),
            "pos": p.get("position", ""),
            "motm": bool(p.get("isManOfTheMatch")),
            "rating": _player_rating(p),
            "g": ex["goals"].get(pid, 0),
            "a": ex["assists"].get(pid, 0),
            "yc": ex["yellow"].get(pid, 0),
            "rc": ex["red"].get(pid, 0),
            "on": on_m,
            "off": off_m,
            "mins": max(0, mins),
        }
        (starters if starter else subs).append(entry)
    # only keep subs that actually came on
    subs = [s for s in subs if s["on"] is not None]
    subs.sort(key=lambda s: s["on"])
    return {"starters": starters, "subs": subs}


_SHOOTOUT_OUTCOME = {
    "Goal": "goal",
    "SavedShot": "saved",
    "MissedShots": "missed",
    "ShotOnPost": "post",
}


def _shootout(match_data, side_of):
    """Per-kick penalty-shootout list (empty for games without a shootout).

    Each kick carries the goal-mouth landing spot (GoalMouthY/Z qualifiers) so the
    dashboard can plot where every penalty was placed inside the goal frame and which
    were scored / saved / missed. The opposing keeper is linked to saved kicks via the
    WhoScored OppositeRelatedEvent qualifier on the Save/PenaltyFaced event."""
    events = match_data.get("events", [])
    sh_events = [e for e in events if is_shootout(e)]
    if not sh_events:
        return []
    # eventId of the shooter -> keeper who faced (and saved) it
    keeper_by_shot = {}
    for e in sh_events:
        t = e.get("type", {}).get("displayName", "")
        if t not in ("Save", "PenaltyFaced") or e.get("playerId") is None:
            continue
        for q in e.get("qualifiers", []):
            if q.get("type", {}).get("displayName") == "OppositeRelatedEvent":
                keeper_by_shot[str(q.get("value"))] = player_full_name(match_data, e.get("playerId"))
    pens, order = [], 0
    for e in sh_events:
        t = e.get("type", {}).get("displayName", "")
        if t not in _SHOOTOUT_OUTCOME:
            continue
        side = side_of.get(e.get("teamId"))
        if side is None:
            continue
        gy = gz = None
        for q in e.get("qualifiers", []):
            dn = q.get("type", {}).get("displayName")
            try:
                if dn == "GoalMouthY":
                    gy = round(float(q.get("value")), 1)
                elif dn == "GoalMouthZ":
                    gz = round(float(q.get("value")), 1)
            except (TypeError, ValueError):
                pass
        order += 1
        pens.append({
            "team": side,
            "order": order,
            "player": player_full_name(match_data, e.get("playerId")),
            "outcome": _SHOOTOUT_OUTCOME[t],
            "gy": gy,
            "gz": gz,
            "keeper": keeper_by_shot.get(str(e.get("eventId"))),
        })
    return pens


def find_png(match_id):
    """Relative path (from the dashboard folder) to the rendered infographic, or None.

    Always emits the published WorldCup2026 path (where the deploy copies the PNG),
    even when the file currently only exists in the git-ignored wc2026/output. A
    fresh auto-deploy regenerates data.js *before* the PNG reaches WorldCup2026,
    so returning the output/ path here would 404 the Infographic link on the live
    site. The PNG is checked in both places only to decide whether the match has a
    render at all."""
    published = os.path.join("WorldCup2026", match_id + ".png")
    for rel in (published, os.path.join("wc2026", "output", match_id + ".png")):
        if os.path.exists(os.path.join(ROOT, rel)):
            return "../" + published.replace("\\", "/")
    return None


def find_png_dark(match_id):
    """Same as find_png but for the dark-mode variant (<id>_dark.png)."""
    return find_png(match_id + "_dark")


# Event types that mark the scoring team winning the ball just before a goal — used to
# give a turnover / defensive-error goal (one with no passing build-up) a visible origin
# on the All Goals Map. Opponent giveaways are stored in the opponent's frame, so their
# coords get mirrored 180° into the scorer's attacking frame.
_WON_OPP = {"Error": "error", "Dispossessed": "dispossession"}          # opponent gave it away
_WON_OWN = {"Interception": "interception", "BallRecovery": "loose ball",  # scoring team won it
            "Tackle": "tackle"}


def _ball_won_origin(events, goal_idx, scorer_tid, match_data):
    """Where the scoring team won possession in the ~12s before this goal. Returns
    {x, y, kind, by} in the scorer's attacking frame (opponent coords mirrored 180°),
    picking the ball-win closest to the goal, or None if there is no clear turnover.
    Lets match.js draw an origin node for goals that have no same-team build-up chain."""
    g = events[goal_idx]
    t0 = (g.get("minute") or 0) * 60 + (g.get("second") or 0)
    for k in range(goal_idx - 1, -1, -1):
        e = events[k]
        tk = (e.get("minute") or 0) * 60 + (e.get("second") or 0)
        if t0 - tk > 12:
            break
        tn = e.get("type", {})
        tn = tn.get("displayName") if isinstance(tn, dict) else ""
        etid = e.get("teamId")
        kind = mirror = None
        if etid is not None and etid != scorer_tid and tn in _WON_OPP:
            kind, mirror = _WON_OPP[tn], True
        elif etid == scorer_tid and tn in _WON_OWN:
            if tn == "Tackle" and e.get("outcomeType", {}).get("displayName") != "Successful":
                continue
            kind, mirror = _WON_OWN[tn], False
        if kind:
            x, y = ev_x, ev_y = e.get("x", 0), e.get("y", 0)
            if mirror:
                x, y = 100 - ev_x, 100 - ev_y
            return {"x": round(x, 1), "y": round(y, 1), "kind": kind,
                    "by": player_full_name(match_data, e.get("playerId"))}
    return None


# Event types that count as the OPPONENT having the ball — used to find the true start of
# a goal's build-up (the moment the scoring team won it back), as opposed to a fixed
# lookback clock. Excludes non-touch admin events (Foul, Card, Offside*, CornerAwarded,
# substitutions, period markers) so a foul won mid-move (advantage played) doesn't cut the
# build-up short.
_TOUCH_TYPES = {"Pass", "BallTouch", "TakeOn", "Tackle", "Interception", "BallRecovery",
                 "Clearance", "Aerial", "KeeperPickup", "Save", "Claim", "Punch",
                 "KeeperSweeper", "Dispossessed", "Challenge", "ShieldBallOpp", "BlockedPass",
                 "Error"}
# Duel-type events where BOTH sides get an event but only the winner actually has the ball —
# an "Unsuccessful" Aerial/Challenge/Tackle from the opponent means THEY lost the contest (the
# scoring team kept/won the ball), so it must not count as an opponent touch. Without this, a
# defender's losing header duel on the very cross that gets scored looks like a touch a moment
# before the goal and wipes out the entire delivery/build-up.
_DUEL_TYPES = {"Aerial", "Challenge", "Tackle"}
# Ambiguous 50/50-loose-ball types only — a half-clearance or stray touch that stays in a
# crowded area. Deliberately EXCLUDES Save, Interception, Tackle, and Dispossessed: those
# are decisive defensive actions (the opponent actually won or stopped the ball), and a
# quick regain right after one of them is normal, not a sign the touch wasn't real — a
# keeper Save followed by the scoring team netting the rebound a moment later is the
# definition of a rebound goal, and must stay a hard build-up boundary or every rebound
# would wrongly chain back into whatever preceded the original shot.
_LOOSE_BALL_TYPES = {"Clearance", "BallTouch"}
_BUILDUP_CAP = 120  # seconds; sane ceiling on how far back a reconstructed build-up can reach
_REGAIN_GAP = 2.0  # seconds; how quickly the scoring team must win a loose ball back for an
                    # opponent touch to be treated as noise rather than a real turnover


def _regained_quickly(events, k, scorer_tid, p0, goal_idx):
    """True if the scoring team touches the ball again within _REGAIN_GAP seconds after
    events[k] — i.e. events[k] was a contested loose ball (a block, half-clearance, or
    stray touch in a goalmouth scramble) that never actually left the danger area, not a
    clean turnover. Without this, a defender's half-clearance that bounces straight back
    counts as a fresh opponent possession and chops a live scramble off the build-up, even
    though the ball never settled with them. The goal event itself never counts as a
    "regain" — a touch immediately (≤2s) before the shot is a deflection/block the shot
    came off, not noise, and must stay a hard boundary the same as a keeper's Save (a
    rebound goal, just via BallTouch/Clearance instead of Save). Only counts real touch
    events (_TOUCH_TYPES) — a CornerAwarded sharing the scorer's team ID right after a
    clearance means the ball went out for a corner (a genuine dead-ball stoppage), not
    that they already have it back."""
    tk = (events[k].get("minute") or 0) * 60 + (events[k].get("second") or 0)
    for j in range(k + 1, min(k + 6, len(events))):
        e2 = events[j]
        pj = e2.get("period", {})
        pj = pj.get("value") if isinstance(pj, dict) else pj
        if pj != p0:
            break
        tj = (e2.get("minute") or 0) * 60 + (e2.get("second") or 0)
        if tj - tk > _REGAIN_GAP:
            break
        tn2 = e2.get("type", {})
        tn2 = tn2.get("displayName") if isinstance(tn2, dict) else ""
        if j != goal_idx and e2.get("teamId") == scorer_tid and tn2 in _TOUCH_TYPES:
            return True
    return False


def _buildup_window(events, goal_idx, scorer_tid):
    """Seconds to look back from the goal for the scoring team's passing build-up, bounded
    by the last time the opponent actually touched the ball (not a fixed clock) — so a
    patient, unbroken keep-ball move isn't truncated mid-sequence just because it ran past
    an arbitrary lookback window, while a quick turnover doesn't drag in unrelated earlier
    play. Stops at the start of the period (half-time is always a hard boundary) and is
    capped at _BUILDUP_CAP so an exceptionally long spell still renders a bounded diagram."""
    g = events[goal_idx]
    t0 = (g.get("minute") or 0) * 60 + (g.get("second") or 0)
    p0 = g.get("period", {})
    p0 = p0.get("value") if isinstance(p0, dict) else p0
    for k in range(goal_idx - 1, -1, -1):
        e = events[k]
        pk = e.get("period", {})
        pk = pk.get("value") if isinstance(pk, dict) else pk
        if pk != p0:
            break
        tk = (e.get("minute") or 0) * 60 + (e.get("second") or 0)
        if t0 - tk > _BUILDUP_CAP:
            break
        tn = e.get("type", {})
        tn = tn.get("displayName") if isinstance(tn, dict) else ""
        if e.get("teamId") is None or e.get("teamId") == scorer_tid or tn not in _TOUCH_TYPES:
            continue
        if tn in _DUEL_TYPES and e.get("outcomeType", {}).get("displayName") != "Successful":
            continue
        if tn in _LOOSE_BALL_TYPES and _regained_quickly(events, k, scorer_tid, pk, goal_idx):
            continue
        return round(t0 - tk, 1)
    return _BUILDUP_CAP


def extract(match_data):
    """Build the detail dict for one match (assumes it has events)."""
    home, away = match_data.get("home", {}), match_data.get("away", {})
    hid, aid = home.get("teamId"), away.get("teamId")
    side_of = {hid: "home", aid: "away"}
    ex = _match_extras(match_data)

    # Receiver of each successful pass = the next same-team successful event's player
    # (mirrors the renderer's pass-network method). Keyed by event index.
    events = match_data.get("events", [])
    receiver = {}
    for i, ev in enumerate(events):
        t = ev.get("type", {})
        if not isinstance(t, dict) or t.get("displayName") != "Pass":
            continue
        if ev.get("outcomeType", {}).get("displayName") != "Successful":
            continue
        tid = ev.get("teamId")
        for j in range(i + 1, min(i + 6, len(events))):
            nxt = events[j]
            if nxt.get("teamId") != tid:
                break
            if nxt.get("outcomeType", {}).get("displayName") == "Successful" \
                    and nxt.get("playerId") is not None:
                receiver[i] = player_full_name(match_data, nxt.get("playerId"))
                break

    shots, passes, goals, dribbles, saves = [], [], [], [], []
    max_min = 0
    for _i, ev in enumerate(events):
        tid = ev.get("teamId")
        side = side_of.get(tid)
        if side is None:
            continue
        if is_shootout(ev):
            continue  # penalty shootout — exclude its kicks from shots/goals/maps/timeline
        tname = ev.get("type", {})
        tname = tname.get("displayName") if isinstance(tname, dict) else ""
        minute = ev.get("minute", 0)
        if minute and minute > max_min:
            max_min = minute

        if tname in SHOT_TYPES:
            ev_quals = {q.get("type", {}).get("displayName", "") for q in ev.get("qualifiers", [])}
            is_own_goal = bool(ev.get("isOwnGoal")) or ("OwnGoal" in ev_quals)
            if tname == "Goal" and is_own_goal:
                # Own goal: counts for the OPPONENT (the beneficiary), and is NOT a shot
                # by either side. The raw event sits at the scorer's own-goal end with the
                # conceding team's id, which previously credited the wrong team and drew a
                # cross-pitch line on the All Goals Map. Record a goal-timeline entry for the
                # opponent and skip the shot list so shot maps / xG / All Goals Map stay clean.
                goals.append({
                    "team": "away" if side == "home" else "home",
                    "min": minute,
                    "scorer": player_full_name(match_data, ev.get("playerId")),
                    "assist": None,
                    "pen": False,
                    "own": True,
                    # coords mirrored 180° into the beneficiary's frame so the All Goals
                    # Map plots the own goal at the end they were attacking (not across it)
                    "x": round(100 - ev.get("x", 0), 1),
                    "y": round(100 - ev.get("y", 0), 1),
                })
                continue
            xg, meta = shot_xg(ev, match_data)
            # goal-mouth landing spot (where the shot crossed/was aimed at the goal line):
            # GoalMouthY = across the goal, GoalMouthZ = height. Powers the on-target
            # "where in the goal" map. Absent on some events → null.
            gy = gz = None
            for q in ev.get("qualifiers", []):
                dn = q.get("type", {}).get("displayName")
                try:
                    if dn == "GoalMouthY":
                        gy = round(float(q.get("value")), 1)
                    elif dn == "GoalMouthZ":
                        gz = round(float(q.get("value")), 1)
                except (TypeError, ValueError):
                    pass
            shot_row = {
                "team": side,
                "x": round(ev.get("x", 0), 1),
                "y": round(ev.get("y", 0), 1),
                "min": minute,
                "sec": ev.get("second", 0),
                "player": player_full_name(match_data, ev.get("playerId")),
                "xg": xg,
                "goal": tname == "Goal",
                "onTarget": tname in ("Goal", "SavedShot"),
                "blocked": tname == "BlockedShot",
                "post": tname == "ShotOnPost",
                "body": meta["body"],
                "sit": meta["situation"],
                "big": meta["big_chance"],
                "gy": gy,
                "gz": gz,
            }
            # Give a turnover / defensive-error goal (no passing build-up) a visible origin:
            # where the scoring team won the ball. Skipped for penalties (no run of play).
            if tname == "Goal" and not meta["penalty"]:
                shot_row["buildupWindow"] = _buildup_window(events, _i, tid)
                won = _ball_won_origin(events, _i, tid, match_data)
                if won:
                    shot_row["won"] = won
            shots.append(shot_row)
            if tname == "Goal":
                goals.append({
                    "team": side,
                    "min": minute,
                    "scorer": player_full_name(match_data, ev.get("playerId")),
                    "assist": (player_full_name(match_data, ev.get("relatedPlayerId"))
                               if ev.get("relatedPlayerId") else None),
                    "pen": meta["penalty"],
                    "own": False,
                })
        elif tname == "Pass":
            quals = {q.get("type", {}).get("displayName", "") for q in ev.get("qualifiers", [])}
            ok = ev.get("outcomeType", {}).get("displayName") == "Successful"
            x, y = ev.get("x", 0), ev.get("y", 0)
            ex_, ey_ = ev.get("endX", x), ev.get("endY", y)
            # progressive = meaningful forward advance toward the opponent goal.
            # >=14 (was 15) keeps this in sync with build_players.py's progPasses,
            # calibrated to FotMob's progressive-pass counts.
            prog = (ex_ - x) >= 14
            passes.append({
                "team": side,
                "x": round(x, 1),
                "y": round(y, 1),
                "ex": round(ex_, 1),
                "ey": round(ey_, 1),
                "min": minute,
                "sec": ev.get("second", 0),
                "player": player_full_name(match_data, ev.get("playerId")),
                "recv": receiver.get(_i),
                "ok": ok,
                "key": "KeyPass" in quals,
                "assist": "IntentionalGoalAssist" in quals,
                "cross": "Cross" in quals,
                "through": "Throughball" in quals,
                "prog": prog,
            })

        elif tname == "TakeOn":   # dribble / take-on (point event, success = beat the man)
            dx, dy = ev.get("x", 0), ev.get("y", 0)
            d_entry = {
                "team": side,
                "x": round(dx, 1),
                "y": round(dy, 1),
                "min": minute,
                "sec": ev.get("second", 0),
                "player": player_full_name(match_data, ev.get("playerId")),
                "ok": ev.get("outcomeType", {}).get("displayName") == "Successful",
            }
            # The feed gives no end coordinate for a take-on, so the carry destination is the
            # SAME player's next on-ball event (any type — pass, ball-touch, recovery, …)
            # within ~7s. The dashboard uses ex/ey to draw a direction arrow.
            pid = ev.get("playerId")
            t0 = minute * 60 + (ev.get("second") or 0)
            for nxt in events[_i + 1:]:
                if (nxt.get("minute") or 0) * 60 + (nxt.get("second") or 0) - t0 > 7:
                    break
                if nxt.get("playerId") == pid and nxt.get("x") is not None:
                    nx, ny = nxt.get("x"), nxt.get("y") or 0
                    if abs(nx - dx) > 0.8 or abs(ny - dy) > 0.8:
                        d_entry["ex"], d_entry["ey"] = round(nx, 1), round(ny, 1)
                    break
            dribbles.append(d_entry)

        elif tname == "Save":     # goalkeeper save (point event) — powers the All Goals Map
            saves.append({        # rebound chain's grey keeper-save node
                "team": side,
                "x": round(ev.get("x", 0), 1),
                "y": round(ev.get("y", 0), 1),
                "min": minute,
                "sec": ev.get("second", 0),
                "player": player_full_name(match_data, ev.get("playerId")),
            })

    meta = match_data.get("wc_metadata", {})
    mid_date = meta.get("date", "")
    # FotMob's own team xG (if scraped) — shown on the page alongside our model value.
    ms = match_data.get("match_stats") or {}
    fot_xg = [ms.get("xg_home"), ms.get("xg_away")]

    return {
        "home": {"name": norm(home.get("name", "Home")), "raw": home.get("name", ""),
                 "score": home.get("score"), "pens": home.get("penalty_score"),
                 "color": _team_color(home.get("name", ""))},
        "away": {"name": norm(away.get("name", "Away")), "raw": away.get("name", ""),
                 "score": away.get("score"), "pens": away.get("penalty_score"),
                 "color": _team_color(away.get("name", ""))},
        "date": mid_date,
        "venue": meta.get("venue", ""),
        "stage": meta.get("stage", ""),
        "fotXg": fot_xg,
        "maxMin": max_min,
        "shots": shots,
        "passes": passes,
        "dribbles": dribbles,
        "saves": saves,
        "goals": sorted(goals, key=lambda g: g["min"]),
        "shootout": _shootout(match_data, side_of),
        "lineups": {"home": _lineup(home, ex), "away": _lineup(away, ex)},
    }


def _match_id_from_file(path):
    return os.path.basename(path)[:-5]


def write_share_card(match_data, match_id):
    """Write share/<id>.html — a crawler-friendly Open-Graph shim that unfurls with the
    match infographic and redirects real visitors to the Match Centre.

    match.html sets its title/OG tags in JS, which social crawlers don't run, so a pasted
    ``match.html?id=…`` link unfurls blank. This static page carries proper og:/twitter:
    tags (image = the published infographic) and bounces humans to ``../match.html?id=…``.
    The Match-Centre "Share" button hands out this URL."""
    h = norm(match_data.get("home", {}).get("name", "Home"))
    a = norm(match_data.get("away", {}).get("name", "Away"))
    hs = match_data.get("home", {}).get("score")
    as_ = match_data.get("away", {}).get("score")
    meta = match_data.get("wc_metadata", {}) or {}
    stage = meta.get("stage") or "Group stage"
    date = meta.get("date") or ""
    score = f"{hs}–{as_}" if hs is not None and as_ is not None else "vs"
    title = f"{h} {score} {a} · World Cup 2026"
    desc = stage + (f" · {date}" if date else "") + \
        " — xG, shot maps, momentum, win probability and the full interactive Match Centre."
    png_rel = find_png(match_id)                       # "../WorldCup2026/<id>.png" or None
    og_image = SITE_BASE + (png_rel[2:] if png_rel else "/WorldCup2026/" + match_id + ".png")
    shim_url = SITE_BASE + "/wc2026_dashboard/share/" + urllib.parse.quote(match_id) + ".html"
    redirect = "../match.html?id=" + urllib.parse.quote(match_id)
    t, d = _hesc(title, quote=True), _hesc(desc, quote=True)
    html = (
        "<!DOCTYPE html>\n<html lang=\"en\"><head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{_hesc(title)}</title>\n<meta name=\"description\" content=\"{d}\">\n"
        f"<link rel=\"canonical\" href=\"{_hesc(shim_url, quote=True)}\">\n"
        "<meta property=\"og:type\" content=\"article\">\n<meta property=\"og:site_name\" content=\"World Cup 2026 Dashboard\">\n"
        f"<meta property=\"og:title\" content=\"{t}\">\n<meta property=\"og:description\" content=\"{d}\">\n"
        f"<meta property=\"og:image\" content=\"{_hesc(og_image, quote=True)}\">\n"
        f"<meta property=\"og:url\" content=\"{_hesc(shim_url, quote=True)}\">\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
        f"<meta name=\"twitter:title\" content=\"{t}\">\n<meta name=\"twitter:description\" content=\"{d}\">\n"
        f"<meta name=\"twitter:image\" content=\"{_hesc(og_image, quote=True)}\">\n"
        f"<meta http-equiv=\"refresh\" content=\"0; url={_hesc(redirect, quote=True)}\">\n"
        f"<script>location.replace({json.dumps(redirect)});</script>\n</head>\n<body>\n"
        f"<p>Redirecting to the {_hesc(h)} vs {_hesc(a)} Match Centre… "
        f"<a href=\"{_hesc(redirect, quote=True)}\">tap here if it doesn't</a>.</p>\n</body></html>\n"
    )
    os.makedirs(SHARE_DIR, exist_ok=True)
    with open(os.path.join(SHARE_DIR, match_id + ".html"), "w", encoding="utf-8") as fh:
        fh.write(html)


def write_detail(match_data, match_id=None):
    """Write matches_detail/<id>.js for one match. Returns the path or None."""
    if not (match_data.get("events")):
        return None
    if match_id is None:
        meta = match_data.get("wc_metadata", {})
        date = (meta.get("date") or "2026_06_01").replace("-", "_")
        h = match_data.get("home", {}).get("name", "Home").replace(" ", "_")
        a = match_data.get("away", {}).get("name", "Away").replace(" ", "_")
        match_id = f"{date}_{h}_vs_{a}"
    os.makedirs(OUT_DIR, exist_ok=True)
    detail = extract(match_data)
    detail["id"] = match_id
    detail["png"] = find_png(match_id)
    detail["png_dark"] = find_png_dark(match_id)
    out = os.path.join(OUT_DIR, match_id + ".js")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("window.MATCH_DETAIL = ")
        json.dump(detail, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    try:
        write_share_card(match_data, match_id)        # non-fatal: a shim failure must not block the detail
    except Exception as exc:  # pragma: no cover
        print(f"  (share card failed for {match_id}: {exc})")
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    built = 0
    index = []
    for f in sorted(glob.glob(os.path.join(MATCH_DIR, "*.json"))):
        if not is_match_file(f):
            continue  # skip scraper cache files
        d = json.load(open(f, encoding="utf-8"))
        if not d.get("events") or d["home"].get("score") is None:
            continue  # only finished games with events get an interactive page
        mid = _match_id_from_file(f)
        write_detail(d, mid)
        index.append(mid)
        built += 1
    # index of which matches have a detail page (used by the main site to link)
    with open(os.path.join(OUT_DIR, "_index.js"), "w", encoding="utf-8") as fh:
        fh.write("window.MATCH_DETAIL_INDEX = ")
        json.dump(index, fh, ensure_ascii=False)
        fh.write(";\n")
    print(f"Wrote {built} match detail files to {OUT_DIR}")


if __name__ == "__main__":
    main()
