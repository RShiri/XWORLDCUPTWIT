"""Pure-python shot extraction + xG model.

Copied verbatim from wc2026/renderer.py (the same model that draws the PNG shot
maps) so the website's xG values match the rendered infographics exactly. Kept
dependency-free (no matplotlib/pandas) so the data builders stay fast.

If the renderer's _estimate_xg / _extract_qualifiers ever change, mirror them here.
"""
import math
import unicodedata

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


# --- Logistic-regression xG model -------------------------------------------
# Fit (pure-python gradient descent, L2) on 1,861 non-shootout WC2026 shots with
# their actual goal/no-goal outcomes. Brier 0.079, log-loss 0.274, and calibrated
# to actual goals (Σ xG = goals scored) — a genuine probability model rather than
# the old hand-tuned geometric heuristic. Coefficients act on the shot location
# (distance to goal centre + angle subtended by the posts, in StatsBomb coords)
# plus binary shot-context flags. Penalties use a fixed empirical conversion.
_XG_INTERCEPT = -2.9528
_XG_COEF = {
    "dist": -0.0179,   # further from goal → lower
    "ang": 1.4460,     # wider view of the goal → higher
    "header": -0.5954,
    "big": 1.7581,     # Opta "big chance" flag — strongest single factor
    "one": 0.1043,     # one-on-one
    "fk": 0.9319,      # direct free kick
    "setp": -0.5847,   # corner / set piece (scramble chances convert worse)
    "fast": 0.8012,    # fast break / counter
}
_PENALTY_XG = 0.76


def _goal_geom(x_sb, y_sb):
    """Distance to the goal centre (120, 40) and the angle subtended by the two
    posts (y = 36 / 44), in StatsBomb pitch coordinates."""
    dist = max(math.hypot(120.0 - x_sb, 40.0 - y_sb), 0.5)
    a = math.hypot(120.0 - x_sb, 36.0 - y_sb)
    b = math.hypot(120.0 - x_sb, 44.0 - y_sb)
    cos_v = (a * a + b * b - 64.0) / (2.0 * a * b) if a * b else 1.0
    return dist, math.acos(max(-1.0, min(1.0, cos_v)))


def estimate_xg(x_sb, y_sb, is_penalty, is_big_chance, body_part,
                is_one_on_one=False, is_free_kick=False, is_set_piece=False,
                is_fast_break=False):
    if is_penalty:
        return _PENALTY_XG
    dist, ang = _goal_geom(x_sb, y_sb)
    z = (_XG_INTERCEPT
         + _XG_COEF["dist"] * dist
         + _XG_COEF["ang"] * ang
         + _XG_COEF["header"] * (1.0 if body_part == "Header" else 0.0)
         + _XG_COEF["big"] * (1.0 if is_big_chance else 0.0)
         + _XG_COEF["one"] * (1.0 if is_one_on_one else 0.0)
         + _XG_COEF["fk"] * (1.0 if is_free_kick else 0.0)
         + _XG_COEF["setp"] * (1.0 if is_set_piece else 0.0)
         + _XG_COEF["fast"] * (1.0 if is_fast_break else 0.0))
    z = max(-35.0, min(35.0, z))
    xg = 1.0 / (1.0 + math.exp(-z))
    return round(min(max(xg, 0.01), 0.99), 3)


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


def shot_xg(ev):
    """Return (xg, meta) for a single shot event using the renderer's model."""
    x_sb = ws_to_sb_x(ev.get("x", 0))
    y_sb = 80 - ev.get("y", 0) * SCALE_Y
    body, situation, zone, big_chance, quals = extract_qualifiers(ev)
    is_penalty = situation == "Penalty"
    if is_penalty:
        x_sb, y_sb = 108.0, 40.0
    xg = estimate_xg(
        x_sb, y_sb, is_penalty, big_chance, body,
        is_one_on_one="OneOnOne" in quals,
        is_free_kick=(situation == "Free Kick"),
        is_set_piece=(situation in ("Corner", "Set Piece")),
        is_fast_break=(situation == "Fast Break"),
    )
    return xg, dict(body=body, situation=situation, zone=zone,
                    big_chance=big_chance, penalty=is_penalty)


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
        xg, _ = shot_xg(ev)
        totals[tid] += xg
        n += 1
    if n == 0:
        return None, None
    return round(totals[home_id], 2), round(totals[away_id], 2)
