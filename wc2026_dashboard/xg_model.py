"""Shot extraction + xG/xA scoring, routed through the shared xg_core models.

The models live in <repo root>/xg_core — a vendored copy of XLALIGA's xg_core
(the canonical one; retrain there and re-copy). v2 calibrated xG artifact +
pass-level xA artifact, scored in pure python (stdlib); lightgbm upgrades the
scorers to the full blends silently — both paths are calibrated.

Public surface unchanged (estimate_xg, shot_xg, team_xg_from_events, ...) plus
player_xa_from_events for the pass-level xA. renderer._estimate_xg routes
through the same scorer, so the site and the PNGs still agree.
"""
import math
import os
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from xg_core_v3 import XGScorer, XAScorer   # v3: 23-feature xG + retrained pass-level xA

_LEAGUE = "WorldCup"         # per-league calibration shift inside the artifacts
_XG = XGScorer()
_XA = XAScorer()

# The v3 xG uses each shot's assisting pass, so it must be scored per MATCH, not per
# isolated shot. We compute the whole match's {eventId: xG} once via iter_match_xg and
# cache it (keyed by matchId), so shot_xg(ev, match_data) is a cheap lookup. Penalties,
# own goals and shootout kicks are handled inside iter_match_xg.
_XG_MAP = {"key": None, "map": {}}


def _match_xg_map(match_data):
    key = match_data.get("matchId")
    if key is None:
        key = id(match_data.get("events"))
    if _XG_MAP["key"] != key:
        _XG_MAP["key"] = key
        _XG_MAP["map"] = dict(_XG.iter_match_xg(match_data, league=_LEAGUE))
    return _XG_MAP["map"]

SCALE_Y = 0.80
SHOT_TYPES = {"MissedShots", "SavedShot", "ShotOnPost", "BlockedShot", "Goal"}


def is_shootout(ev):
    """True for penalty-SHOOTOUT events (WhoScored period 5 / "PenaltyShootout").

    A shootout decides a drawn knockout tie but its kicks are NOT match shots: they
    must be excluded from xG, shot counts, shot maps, the goals timeline and player
    stats, or a 1-1 tie balloons to ~6 xG and ~9 "goals". The match score stays the
    post-extra-time result; the shootout is reported separately as a penalty score.
    Extra-time shots (periods 3/4) ARE real and stay in."""
    p = ev.get("period", {})
    if isinstance(p, dict):
        return p.get("value") == 5 or "Shoot" in (p.get("displayName") or "")
    return "Shoot" in str(p or "")


def ws_to_sb_x(ws_x):
    if ws_x <= 50:
        return ws_x * (60.0 / 50.0)
    elif ws_x <= 89:
        return 60.0 + (ws_x - 50) * (48.0 / 39.0)
    else:
        return 108.0 + (ws_x - 89) * (12.0 / 11.0)


def estimate_xg(x_sb, y_sb, is_penalty, is_big_chance, body_part,
                situation="Open Play", assisted=False):
    """Calibrated xG via the shared xg_core v2 artifact. Penalties are the
    artifact's empirical constant. Coords in StatsBomb metres."""
    return _XG.estimate_xg(x_sb, y_sb, is_penalty, is_big_chance, body_part,
                           situation, assisted=assisted, league=_LEAGUE)


def player_xa_from_events(match_data):
    """playerId -> summed xA (expected assists), from the pass-level xA model.

    xA(pass) = calibrated P(this successful pass becomes a goal assist), summed
    over every successful pass — a killer ball the striker wastes still earns
    credit, and no shot is required. League-wide xA is calibrated to match
    actual assists."""
    return _XA.player_xa_from_events(match_data, league=_LEAGUE)


def ascii_name(name):
    return unicodedata.normalize("NFKD", name or "").encode("ASCII", "ignore").decode("ASCII").strip()


def player_full_name(match_data, player_id):
    for side in ("home", "away"):
        for p in match_data.get(side, {}).get("players", []):
            if p.get("playerId") == player_id:
                return ascii_name(p.get("name", str(player_id)))
    return str(player_id) if player_id is not None else "—"


def extract_qualifiers(ev):
    qual_list = ev.get("qualifiers", [])
    quals = {q.get("type", {}).get("displayName", "") for q in qual_list}
    body = ("Right Foot" if "RightFoot" in quals else
            "Left Foot" if "LeftFoot" in quals else
            "Header" if "Head" in quals else "Unknown")
    situation = ("Penalty" if "Penalty" in quals else
                 "Free Kick" if "DirectFreekick" in quals else
                 "Fast Break" if "FastBreak" in quals else
                 "Set Piece" if "SetPiece" in quals else
                 "Corner" if "FromCorner" in quals else "Open Play")
    if any(z in quals for z in ("SmallBoxCentre", "SmallBoxLeft", "SmallBoxRight",
                                "DeepBoxCentre", "DeepBoxLeft", "DeepBoxRight")):
        zone = "6-Yard Box"
    elif any(z in quals for z in ("BoxCentre", "BoxLeft", "BoxRight")):
        zone = "Inside Box"
    elif any(z in quals for z in ("OutOfBoxCentre", "OutOfBoxLeft", "OutOfBoxRight")):
        zone = "Outside Box"
    else:
        zone = "Unknown"
    big_chance = "BigChance" in quals
    return body, situation, zone, big_chance, quals


def shot_xg(ev, match_data=None):
    """Return (xg, meta) for a single shot event.

    Pass the whole ``match_data`` to get the calibrated v3 (23-feature) value —
    it's looked up from the per-match map, which needs the shot's assisting pass.
    Without ``match_data`` it falls back to the scalar path (assist-context
    features zeroed); kept for backward compatibility so no caller can crash."""
    body, situation, zone, big_chance, quals = extract_qualifiers(ev)
    is_penalty = situation == "Penalty"
    meta = dict(body=body, situation=situation, zone=zone,
                big_chance=big_chance, penalty=is_penalty)
    if match_data is not None:
        xg = _match_xg_map(match_data).get(ev.get("eventId"))
        if xg is not None:
            return xg, meta
    x_sb = ws_to_sb_x(ev.get("x", 0))
    y_sb = 80 - ev.get("y", 0) * SCALE_Y
    if is_penalty:
        x_sb, y_sb = 108.0, 40.0
    xg = estimate_xg(x_sb, y_sb, is_penalty, big_chance, body, situation,
                     assisted=ev.get("relatedPlayerId") is not None)
    return xg, meta


def team_xg_from_events(match_data):
    """Sum shot xG per side from WhoScored events. Returns (home_xg, away_xg) or
    (None, None) when there are no shot events to work with."""
    events = match_data.get("events") or []
    home_id = match_data.get("home", {}).get("teamId")
    away_id = match_data.get("away", {}).get("teamId")
    totals = {home_id: 0.0, away_id: 0.0}
    n = 0
    for ev in events:
        tname = ev.get("type", {})
        if not isinstance(tname, dict) or tname.get("displayName") not in SHOT_TYPES:
            continue
        if is_shootout(ev):
            continue  # penalty-shootout kicks are not match shots
        tid = ev.get("teamId")
        if tid not in totals:
            continue
        xg, _ = shot_xg(ev, match_data)
        totals[tid] += xg
        n += 1
    if n == 0:
        return None, None
    return round(totals[home_id], 2), round(totals[away_id], 2)
