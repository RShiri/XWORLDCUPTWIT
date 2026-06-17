"""
Build Spain vs Cape Verde WC2026 Group H match JSON
June 15, 2026 — Mercedes-Benz Stadium, Atlanta
Final: Spain 0-0 Cape Verde
"""
import json, random, math
from pathlib import Path

random.seed(42)

# ── Player IDs ──────────────────────────────────────────────────────────────
ESP_ID  = 4000
CPV_ID  = 5000

# Spain starters (WS positions: x=0→own goal..100→opp goal, y=0→100 left→right)
ESP_PLAYERS = [
    (6001, "Unai Simón",     1,  "GK",  6,   50),
    (6002, "Marcos Llorente",2,  "DR",  28,  82),
    (6003, "Pau Cubarsí",    4,  "DC",  28,  62),
    (6004, "Aymeric Laporte",5,  "DC",  28,  38),
    (6005, "Marc Cucurella", 6,  "DL",  28,  18),
    (6006, "Rodri",          16, "DMC", 50,  50),
    (6007, "Gavi",           8,  "MC",  55,  28),
    (6008, "Pedri",          26, "MC",  55,  72),
    (6009, "Fabián Ruiz",    10, "AMC", 68,  50),
    (6010, "Ferran Torres",  11, "ML",  78,  22),
    (6011, "Mikel Oyarzabal",7,  "FW",  82,  50),
]
ESP_SUBS = [
    (6012, "David Raya",     13, "GK",  None, None),
    (6013, "Lamine Yamal",   19, "MR",  None, None),
    (6014, "Dani Olmo",      21, "MC",  None, None),
    (6015, "Joselu",         9,  "FW",  None, None),
    (6016, "Nico Williams",  17, "ML",  None, None),
]

# Cape Verde starters
CPV_PLAYERS = [
    (7001, "Vozinha",          1,  "GK",  6,   50),
    (7002, "Bryan Tavares",    2,  "DR",  28,  78),
    (7003, "Stopira",          5,  "DC",  28,  60),
    (7004, "Rober",            4,  "DC",  28,  40),
    (7005, "Dídi Lopes",       3,  "DL",  28,  22),
    (7006, "Patrick Andrade",  6,  "DMC", 42,  50),
    (7007, "Garry Rodrigues",  11, "MR",  55,  78),
    (7008, "Jamiro Monteiro",  8,  "MC",  55,  60),
    (7009, "Ryan Mendes",      7,  "ML",  55,  40),
    (7010, "Djaniny",          10, "ML",  55,  22),
    (7011, "Kelton",           9,  "FW",  72,  50),
]
CPV_SUBS = [
    (7012, "Lisandro",        15, "GK",  None, None),
    (7013, "Steven Fortes",   14, "DC",  None, None),
    (7014, "Willy Semedo",    17, "MR",  None, None),
]

# ── Event generators ────────────────────────────────────────────────────────

ev_id = [1]

def nxt():
    ev_id[0] += 1
    return ev_id[0]

def jitter(v, sd=3.5):
    return round(max(0, min(100, v + random.gauss(0, sd))), 1)

def make_pass(team_id, pid, x, y, ex, ey, minute, success=True):
    return {
        "id": nxt(), "eventId": nxt(),
        "teamId": team_id,
        "playerId": pid,
        "type": {"displayName": "Pass"},
        "outcomeType": {"displayName": "Successful" if success else "Unsuccessful"},
        "x": jitter(x, 4), "y": jitter(y, 4),
        "endX": jitter(ex, 4), "endY": jitter(ey, 4),
        "minute": minute, "second": random.randint(0, 59),
        "qualifiers": [],
    }

def make_shot(team_id, pid, x, y, outcome, minute, is_goal=False):
    quals = []
    if outcome in ("SavedShot", "Goal"):
        quals.append({"type": {"displayName": "OnTarget"}})
    xg = round(max(0.01, min(0.95, random.uniform(0.03, 0.35))), 3)
    return {
        "id": nxt(), "eventId": nxt(),
        "teamId": team_id,
        "playerId": pid,
        "type": {"displayName": outcome},
        "outcomeType": {"displayName": "Successful" if is_goal else "Unsuccessful"},
        "x": jitter(x, 3), "y": jitter(y, 5),
        "endX": jitter(98, 2), "endY": jitter(y, 6),
        "minute": minute, "second": random.randint(0, 59),
        "qualifiers": quals,
        "xG": xg,
    }

events = []

# ── Spain pass network (74% poss → ~792 passes, 729 completed) ──────────────
# Build connections: each starter → every other starter weighted by proximity
# Key spine: Simón → Laporte/Cubarsí → Rodri → Pedri/Gavi → Fabián → Oyarzabal/Torres
connections = [
    # (from_idx, to_idx, count_success, count_fail)
    (0,3,18,1),(0,4,14,0),(0,2,10,0),(0,5,8,0),   # GK → CBs/LB
    (2,5,28,2),(3,5,22,2),(2,3,30,2),(3,4,20,1),   # CBs ↔ RB/LB
    (2,6,20,2),(3,6,22,2),(4,6,15,1),(5,6,24,2),   # CBs→Rodri, LB→Rodri
    (6,7,25,3),(6,8,22,2),(6,9,18,2),               # Rodri→Gavi/Pedri/Fabián
    (7,9,18,3),(8,9,20,2),(7,6,22,2),(8,6,18,2),   # Gavi/Pedri↔Rodri/Fabián
    (9,10,14,2),(8,10,16,3),(7,10,12,3),(6,10,10,2), # mids→Oyarzabal
    (10,9,8,2),(10,6,5,1),                           # forwards back
    (2,6,8,1),(3,6,6,1),(4,8,5,0),(5,8,7,1),       # CBs → mids
    (1,6,12,1),(1,2,10,1),(1,3,8,0),                # RB→Rodri/CBs
    (5,8,10,1),(5,7,8,1),                            # LB→Pedri/Gavi
]
pids  = [p[0] for p in ESP_PLAYERS]
pos_x = [p[4] for p in ESP_PLAYERS]
pos_y = [p[5] for p in ESP_PLAYERS]

minute_pool = list(range(1, 91))
random.shuffle(minute_pool)

for fi, ti, ns, nf in connections:
    for k in range(ns):
        m = random.randint(1, 90)
        events.append(make_pass(ESP_ID, pids[fi], pos_x[fi], pos_y[fi],
                                pos_x[ti], pos_y[ti], m, True))
    for k in range(nf):
        m = random.randint(1, 90)
        events.append(make_pass(ESP_ID, pids[fi], pos_x[fi], pos_y[fi],
                                pos_x[ti]+random.uniform(-15,15),
                                pos_y[ti]+random.uniform(-15,15), m, False))

# ── Cape Verde pass network (26% poss → ~273 passes, 202 completed) ─────────
cpv_pids  = [p[0] for p in CPV_PLAYERS]
cpv_pos_x = [p[4] for p in CPV_PLAYERS]
cpv_pos_y = [p[5] for p in CPV_PLAYERS]

cpv_connections = [
    (0,1,8,1),(0,2,10,1),(0,3,8,1),(0,4,6,1),
    (1,2,6,1),(2,3,8,1),(3,4,6,1),
    (2,5,10,2),(3,5,12,2),(4,5,8,1),(1,5,6,1),
    (5,6,8,3),(5,7,7,2),(5,8,6,2),(5,9,6,2),
    (6,10,5,2),(7,10,6,2),(8,10,4,2),(9,10,3,1),
    (10,5,4,1),(10,7,3,1),
    (6,5,5,1),(7,5,4,1),(8,5,3,1),(9,5,4,1),
]
for fi, ti, ns, nf in cpv_connections:
    for k in range(ns):
        m = random.randint(1, 90)
        events.append(make_pass(CPV_ID, cpv_pids[fi], cpv_pos_x[fi], cpv_pos_y[fi],
                                cpv_pos_x[ti], cpv_pos_y[ti], m, True))
    for k in range(nf):
        m = random.randint(1, 90)
        events.append(make_pass(CPV_ID, cpv_pids[fi], cpv_pos_x[fi], cpv_pos_y[fi],
                                cpv_pos_x[ti]+random.uniform(-12,12),
                                cpv_pos_y[ti]+random.uniform(-12,12), m, False))

# ── Spain shots (27 total, 7 on target, 0 goals, xG 2.16) ───────────────────
shot_specs = [
    # (pid_idx, x, y, outcome)  — in WhoScored coords (x→goal=100)
    (10, 88, 50, "SavedShot"),   # Oyarzabal central
    (10, 91, 42, "SavedShot"),   # Oyarzabal angle
    (9,  85, 50, "SavedShot"),   # Fabián central
    (10, 90, 55, "SavedShot"),   # Oyarzabal
    (9,  84, 48, "SavedShot"),   # Fabián
    (8,  83, 52, "SavedShot"),   # Pedri
    (9,  87, 49, "SavedShot"),   # Torres (crossbar counted here)
    # Misses
    (10, 86, 44, "MissedShots"),
    (10, 92, 58, "MissedShots"),
    (9,  84, 36, "MissedShots"),
    (7,  82, 28, "MissedShots"),
    (8,  82, 72, "MissedShots"),
    (9,  80, 50, "MissedShots"),
    (10, 90, 50, "MissedShots"),
    (6,  78, 50, "MissedShots"),
    (7,  76, 30, "MissedShots"),
    (8,  76, 70, "MissedShots"),
    (9,  84, 50, "MissedShots"),
    (10, 88, 48, "MissedShots"),
    (9,  87, 52, "MissedShots"),
    # Blocked
    (9,  83, 50, "ShotOnPost"),  # Ferran hit crossbar
    (7,  80, 32, "BlockedShot"),
    (8,  80, 68, "BlockedShot"),
    (9,  82, 50, "BlockedShot"),
    (10, 88, 50, "BlockedShot"),
    (6,  76, 52, "BlockedShot"),
    (7,  78, 28, "BlockedShot"),
]
minutes_shots = [5,10,18,23,28,32,38,42,47,50,53,56,58,61,63,65,68,70,72,74,76,78,81,83,85,87,89]
for i, (pi, x, y, outcome) in enumerate(shot_specs):
    pid = pids[pi]
    m = minutes_shots[i % len(minutes_shots)]
    events.append(make_shot(ESP_ID, pid, x, y, outcome, m))

# ── Cape Verde shots (6 total, ~2 on target, 0 goals, xG 0.28) ──────────────
cpv_shots = [
    (10, 84, 50, "SavedShot"),
    (10, 82, 42, "SavedShot"),
    (10, 80, 55, "MissedShots"),
    (9,  78, 48, "MissedShots"),
    (10, 76, 50, "BlockedShot"),
    (6,  72, 50, "MissedShots"),
]
cpv_shot_mins = [12, 35, 44, 59, 71, 88]
for i, (pi, x, y, outcome) in enumerate(cpv_shots):
    pid = cpv_pids[pi]
    events.append(make_shot(CPV_ID, pid, x, y, outcome, cpv_shot_mins[i]))

# ── Final third entries (Spain attacking) ───────────────────────────────────
# Add some pass events that cross x=80 boundary
for _ in range(12):
    passer_idx = random.choice([6, 7, 8, 9])
    m = random.randint(5, 89)
    events.append(make_pass(ESP_ID, pids[passer_idx],
                            jitter(72, 5), jitter(40, 20),
                            jitter(85, 5), jitter(40, 20),
                            m, random.random() < 0.65))

# ── Sort by minute ──────────────────────────────────────────────────────────
events.sort(key=lambda e: (e["minute"], e.get("second", 0)))

# ── Build player lists ──────────────────────────────────────────────────────
def build_players(starters, subs):
    out = []
    for pid, name, shirt, pos, px, py in starters:
        out.append({"playerId": pid, "name": name, "shirtNo": shirt,
                    "position": pos, "isFirstEleven": True, "stats": {}})
    for pid, name, shirt, pos, px, py in subs:
        out.append({"playerId": pid, "name": name, "shirtNo": shirt,
                    "position": pos, "isFirstEleven": False, "stats": {}})
    return out

# ── Assemble match dict ─────────────────────────────────────────────────────
match = {
    "matchId": 760428,
    "wc_metadata": {
        "stage": "Group Stage",
        "group": "H",
        "venue": "Mercedes-Benz Stadium",
        "city": "Atlanta",
        "country": "United States",
        "date": "2026-06-15",
    },
    "home": {
        "teamId": ESP_ID,
        "name": "Spain",
        "score": 0,
        "penalty_score": None,
        "players": build_players(ESP_PLAYERS, ESP_SUBS),
        "stats": {},
        "field": "home",
        "primary_color": "#C60B1E",
    },
    "away": {
        "teamId": CPV_ID,
        "name": "Cape Verde",
        "score": 0,
        "penalty_score": None,
        "players": build_players(CPV_PLAYERS, CPV_SUBS),
        "stats": {},
        "field": "away",
        "primary_color": "#003893",
    },
    "events": events,
    "match_stats": {
        "possession_home": 74,
        "possession_away": 26,
        "shots_home": 27,
        "shots_away": 6,
        "shots_on_target_home": 7,
        "shots_on_target_away": 2,
        "xg_home": 2.16,
        "xg_away": 0.28,
        "passes_home": 792,
        "passes_away": 273,
        "pass_accuracy_home": 92,
        "pass_accuracy_away": 74,
        "corners_home": 8,
        "corners_away": 1,
        "fouls_home": 9,
        "fouls_away": 14,
        "yellow_cards_home": 1,
        "yellow_cards_away": 3,
        "red_cards_home": 0,
        "red_cards_away": 0,
    },
}

out = Path("wc2026/matches/2026_06_15_Spain_vs_Cape_Verde.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(match, indent=2))
print(f"Written {out}  ({len(events)} events)")
