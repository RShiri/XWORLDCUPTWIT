"""
Build France vs Senegal WC2026 Group I match JSON
June 16, 2026 — MetLife Stadium, East Rutherford, NJ
Final: France 2-1 Senegal
Goals: Mbappé 23', Griezmann 67' (hdr), Mané 85' (pen)
"""
import json
import random
import math
from pathlib import Path

random.seed(77)

FRA_ID = 8000
SEN_ID = 9000

# France starters — 4-3-3 (WS: x=0 own→100 opp, y=0 left→100 right)
FRA_PLAYERS = [
    (8001, "Mike Maignan",       1,  "GK",  6,  50),
    (8002, "Jules Koundé",       5,  "DR",  28, 78),
    (8003, "William Saliba",     17, "DC",  28, 60),
    (8004, "Dayot Upamecano",    4,  "DC",  28, 40),
    (8005, "Théo Hernandez",     22, "DL",  28, 22),
    (8006, "Aurélien Tchouaméni",8,  "DMC", 45, 50),
    (8007, "N'Golo Kanté",       13, "MC",  52, 35),
    (8008, "Antoine Griezmann",  7,  "MC",  55, 65),
    (8009, "Ousmane Dembélé",    11, "MR",  72, 78),
    (8010, "Kylian Mbappé",      10, "FW",  80, 45),
    (8011, "Marcus Thuram",      9,  "ML",  72, 22),
]
FRA_SUBS = [
    (8012, "Alphonse Areola",    23, "GK",  None, None),
    (8013, "Benjamin Pavard",    2,  "DR",  None, None),
    (8014, "Randal Kolo Muani",  14, "FW",  None, None),
    (8015, "Eduardo Camavinga",  6,  "MC",  None, None),
    (8016, "Matteo Guendouzi",   18, "MC",  None, None),
]

# Senegal starters — 4-4-2
SEN_PLAYERS = [
    (9001, "Edouard Mendy",      16, "GK",  6,  50),
    (9002, "Abdou Diallo",       3,  "DR",  28, 78),
    (9003, "Kalidou Koulibaly",  5,  "DC",  28, 60),
    (9004, "Pape Abou Cissé",    14, "DC",  28, 40),
    (9005, "Ismail Jakobs",      18, "DL",  28, 22),
    (9006, "Cheikhou Kouyaté",   8,  "MC",  45, 55),
    (9007, "Idrissa Gueye",      6,  "MC",  45, 35),
    (9008, "Ismaila Sarr",       23, "MR",  55, 75),
    (9009, "Pape Matar Sarr",    12, "ML",  55, 25),
    (9010, "Sadio Mané",         10, "FW",  72, 50),
    (9011, "Boulaye Dia",        9,  "FW",  70, 62),
]
SEN_SUBS = [
    (9012, "Alfred Gomis",       30, "GK",  None, None),
    (9013, "Nicolas Jackson",    7,  "FW",  None, None),
    (9014, "Krepin Diatta",      19, "MR",  None, None),
]

# ── Helpers ──────────────────────────────────────────────────────────────────

ev_id = [1]


def nxt():
    ev_id[0] += 1
    return ev_id[0]


def jitter(v, sd=3.5):
    return round(max(0, min(100, v + random.gauss(0, sd))), 1)


def make_pass(team_id, pid, x, y, ex, ey, minute, success=True):
    return {
        "id": nxt(), "eventId": nxt(),
        "teamId": team_id, "playerId": pid,
        "type": {"displayName": "Pass"},
        "outcomeType": {"displayName": "Successful" if success else "Unsuccessful"},
        "x": jitter(x, 4), "y": jitter(y, 4),
        "endX": jitter(ex, 4), "endY": jitter(ey, 4),
        "minute": minute, "second": random.randint(0, 59),
        "qualifiers": [],
    }


def make_shot(team_id, pid, x, y, outcome, minute, quals=None):
    on_target = outcome in ("SavedShot", "Goal")
    q_list = [{"type": {"displayName": "OnTarget"}}] if on_target else []
    if quals:
        q_list.extend(quals)
    return {
        "id": nxt(), "eventId": nxt(),
        "teamId": team_id, "playerId": pid,
        "type": {"displayName": outcome},
        "outcomeType": {"displayName": "Successful" if outcome == "Goal" else "Unsuccessful"},
        "x": jitter(x, 2), "y": jitter(y, 4),
        "endX": jitter(98, 2), "endY": jitter(y, 5),
        "minute": minute, "second": random.randint(0, 59),
        "qualifiers": q_list,
    }


def make_goal(team_id, pid, x, y, minute, quals=None):
    q_list = [{"type": {"displayName": "OnTarget"}}]
    if quals:
        q_list.extend(quals)
    return {
        "id": nxt(), "eventId": nxt(),
        "teamId": team_id, "playerId": pid,
        "type": {"displayName": "Goal"},
        "outcomeType": {"displayName": "Successful"},
        "x": jitter(x, 2), "y": jitter(y, 3),
        "endX": 100.0, "endY": jitter(y, 3),
        "minute": minute, "second": random.randint(5, 55),
        "qualifiers": q_list,
        "xG": 0.42,
    }


# ── Event list ────────────────────────────────────────────────────────────────

events = []

fra_pids  = [p[0] for p in FRA_PLAYERS]
fra_pos_x = [p[4] for p in FRA_PLAYERS]
fra_pos_y = [p[5] for p in FRA_PLAYERS]
sen_pids  = [p[0] for p in SEN_PLAYERS]
sen_pos_x = [p[4] for p in SEN_PLAYERS]
sen_pos_y = [p[5] for p in SEN_PLAYERS]

# ── France pass network (68% poss → ~680 passes, ~619 completed) ─────────────
# Key spine: Maignan → CBs → Tchouaméni → Kanté/Griezmann → Dembélé/Mbappé/Thuram
fra_connections = [
    # GK → CBs / LB
    (0, 3, 16, 1), (0, 4, 12, 1), (0, 2, 10, 0), (0, 5, 8, 0),
    # CBs ↔ each other + LB/RB
    (2, 3, 28, 2), (3, 4, 22, 2), (2, 4, 18, 1), (3, 2, 20, 1),
    (1, 2, 14, 1), (1, 3, 12, 0), (4, 5, 18, 1), (5, 4, 14, 1),
    # CBs / fullbacks → Tchouaméni
    (2, 5, 22, 2), (3, 5, 20, 2), (4, 5, 16, 1), (5, 5, 20, 2),
    (1, 5, 14, 1),
    # Tchouaméni → Kanté / Griezmann / back
    (5, 6, 30, 3), (5, 7, 25, 2), (6, 5, 22, 2), (7, 5, 18, 2),
    # Kanté / Griezmann ↔ each other + forwards
    (6, 7, 20, 2), (7, 6, 18, 2),
    (6, 8, 15, 2), (7, 8, 16, 3), (6, 9, 12, 2), (7, 9, 14, 2),
    (7, 10, 10, 2),
    # Forwards short passes / combinations
    (8, 9, 8, 1), (9, 7, 6, 1), (10, 9, 7, 1), (10, 6, 5, 1),
    # RB / LB overlaps
    (1, 8, 10, 1), (4, 10, 8, 1),
]
for fi, ti, ns, nf in fra_connections:
    for _ in range(ns):
        events.append(make_pass(FRA_ID, fra_pids[fi],
                                fra_pos_x[fi], fra_pos_y[fi],
                                fra_pos_x[ti], fra_pos_y[ti],
                                random.randint(1, 90), True))
    for _ in range(nf):
        events.append(make_pass(FRA_ID, fra_pids[fi],
                                fra_pos_x[fi], fra_pos_y[fi],
                                fra_pos_x[ti] + random.uniform(-15, 15),
                                fra_pos_y[ti] + random.uniform(-15, 15),
                                random.randint(1, 90), False))

# ── Senegal pass network (32% poss → ~310 passes, ~242 completed) ────────────
sen_connections = [
    (0, 1, 8, 1), (0, 2, 10, 1), (0, 3, 8, 1), (0, 4, 6, 1),
    (1, 2, 6, 1), (2, 3, 8, 1), (3, 4, 6, 1),
    (2, 5, 10, 2), (3, 5, 10, 2), (3, 6, 8, 2), (4, 6, 6, 1),
    (5, 6, 12, 3), (6, 5, 10, 2),
    (5, 7, 8, 3), (6, 7, 6, 2), (5, 8, 6, 2), (6, 8, 5, 2),
    (5, 9, 8, 2), (6, 9, 6, 2),
    (7, 9, 6, 2), (8, 10, 5, 2), (9, 10, 4, 1),
    (9, 5, 4, 1), (10, 6, 3, 1),
]
for fi, ti, ns, nf in sen_connections:
    for _ in range(ns):
        events.append(make_pass(SEN_ID, sen_pids[fi],
                                sen_pos_x[fi], sen_pos_y[fi],
                                sen_pos_x[ti], sen_pos_y[ti],
                                random.randint(1, 90), True))
    for _ in range(nf):
        events.append(make_pass(SEN_ID, sen_pids[fi],
                                sen_pos_x[fi], sen_pos_y[fi],
                                sen_pos_x[ti] + random.uniform(-12, 12),
                                sen_pos_y[ti] + random.uniform(-12, 12),
                                random.randint(1, 90), False))

# ── Goals ─────────────────────────────────────────────────────────────────────

# 23' France 1-0: Mbappé cuts inside, finishes low to the right
events.append(make_goal(FRA_ID, fra_pids[9], 89, 44, 23))   # Mbappé

# 67' France 2-0: Griezmann header from corner (high xG)
events.append(make_goal(FRA_ID, fra_pids[7], 92, 52, 67,
                        quals=[{"type": {"displayName": "Head"}},
                               {"type": {"displayName": "FromCorner"}}]))

# 85' Senegal 2-1: Mané penalty
events.append({
    "id": nxt(), "eventId": nxt(),
    "teamId": SEN_ID, "playerId": sen_pids[9],
    "type": {"displayName": "Goal"},
    "outcomeType": {"displayName": "Successful"},
    "x": 89.0, "y": 50.0,
    "endX": 100.0, "endY": 50.0,
    "minute": 85, "second": 14,
    "qualifiers": [{"type": {"displayName": "OnTarget"}},
                   {"type": {"displayName": "Penalty"}}],
    "xG": 0.76,
})

# ── France shots (21 total: 7 on target incl. 2 goals, xG ~2.30) ─────────────
fra_shots = [
    # SavedShots (5 non-goal on target)
    (9,  88, 48, "SavedShot", 8),
    (9,  90, 42, "SavedShot", 31),
    (10, 85, 50, "SavedShot", 41),
    (9,  87, 54, "SavedShot", 55),
    (7,  84, 49, "SavedShot", 73),
    # Missed
    (9,  86, 38, "MissedShots", 14),
    (9,  91, 58, "MissedShots", 19),
    (10, 83, 34, "MissedShots", 28),
    (7,  82, 28, "MissedShots", 35),
    (8,  81, 70, "MissedShots", 43),
    (9,  80, 50, "MissedShots", 48),
    (10, 89, 50, "MissedShots", 52),
    (6,  77, 52, "MissedShots", 58),
    (7,  75, 30, "MissedShots", 61),
    (8,  76, 72, "MissedShots", 70),
    (9,  84, 46, "MissedShots", 76),
    (10, 87, 52, "MissedShots", 79),
    (9,  88, 48, "MissedShots", 82),
    # Blocked
    (10, 83, 50, "BlockedShot", 44),
    (7,  80, 32, "BlockedShot", 64),
    (8,  81, 68, "BlockedShot", 88),
]
for pi, x, y, outcome, minute in fra_shots:
    events.append(make_shot(FRA_ID, fra_pids[pi], x, y, outcome, minute))

# ── Senegal shots (7 total: 2 on target incl. 1 goal (pen), xG ~0.75) ────────
# Note: the penalty goal is already in events above; add non-penalty Senegal shots
sen_shots = [
    (9,  84, 50, "SavedShot",   36),  # Mané
    (10, 82, 60, "SavedShot",   71),  # Dia
    (9,  80, 52, "MissedShots", 12),
    (7,  78, 74, "MissedShots", 48),
    (10, 76, 58, "MissedShots", 63),
    (8,  72, 38, "BlockedShot", 80),
]
for pi, x, y, outcome, minute in sen_shots:
    events.append(make_shot(SEN_ID, sen_pids[pi], x, y, outcome, minute))

# ── Final third entries (France attacking) ────────────────────────────────────
for _ in range(15):
    passer_idx = random.choice([5, 6, 7, 8])
    events.append(make_pass(FRA_ID, fra_pids[passer_idx],
                            jitter(70, 5), jitter(45, 20),
                            jitter(84, 5), jitter(45, 20),
                            random.randint(5, 89),
                            random.random() < 0.72))

# Sort chronologically
events.sort(key=lambda e: (e["minute"], e.get("second", 0)))


# ── Player list builder ───────────────────────────────────────────────────────

def build_players(starters, subs):
    out = []
    for pid, name, shirt, pos, px, py in starters:
        out.append({"playerId": pid, "name": name, "shirtNo": shirt,
                    "position": pos, "isFirstEleven": True, "stats": {}})
    for pid, name, shirt, pos, px, py in subs:
        out.append({"playerId": pid, "name": name, "shirtNo": shirt,
                    "position": pos, "isFirstEleven": False, "stats": {}})
    return out


# ── Assemble match dict ───────────────────────────────────────────────────────

match = {
    "matchId": 760502,
    "wc_metadata": {
        "stage": "Group Stage",
        "group": "I",
        "venue": "MetLife Stadium",
        "city": "East Rutherford, NJ",
        "country": "United States",
        "date": "2026-06-16",
    },
    "home": {
        "teamId": FRA_ID,
        "name": "France",
        "score": 2,
        "penalty_score": None,
        "players": build_players(FRA_PLAYERS, FRA_SUBS),
        "stats": {},
        "field": "home",
        "primary_color": "#002395",
    },
    "away": {
        "teamId": SEN_ID,
        "name": "Senegal",
        "score": 1,
        "penalty_score": None,
        "players": build_players(SEN_PLAYERS, SEN_SUBS),
        "stats": {},
        "field": "away",
        "primary_color": "#00853F",
    },
    "events": events,
    "match_stats": {
        "xg":                   {"home": 2.30, "away": 0.75},
        "possession":           {"home": 68,   "away": 32},
        "shots":                {"home": 21,   "away": 7},
        "shots_on_target":      {"home": 7,    "away": 3},
        "big_chances_created":  {"home": 4,    "away": 1},
        "big_chances_missed":   {"home": 2,    "away": 0},
        "passes_total":         {"home": 680,  "away": 310},
        "passes_accuracy":      {"home": 91,   "away": 78},
        "duels_won":            {"home": 53,   "away": 47},
        "saves":                {"home": 2,    "away": 5},
        "fouls":                {"home": 11,   "away": 16},
        "corners":              {"home": 9,    "away": 2},
        "yellow_cards":         {"home": 2,    "away": 3},
        "red_cards":            {"home": 0,    "away": 0},
    },
}

out = Path("wc2026/matches/2026_06_16_France_vs_Senegal.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(match, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Written {out}  ({len(events)} events)")
