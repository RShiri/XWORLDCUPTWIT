"""Resolve knockout slot codes to the real teams now decided — the pipeline's self-heal.

The knockout fixtures are scheduled with *placeholder* FotMob ids and *slot-code* team
names (``2A``, ``3ABCDF``, ``Winner EF 1`` …) because the real draw isn't known when the
schedule is built. When Task Scheduler fires a knockout scrape, those slot codes can't drive
a WhoScored search and the placeholder id may not exist on FotMob, so the scrape comes back
empty and the game never publishes.

This module closes that gap. Given the placeholder FotMob id of a knockout fixture it:

  * finds the slot-coded stub file (e.g. ``2026_06_28_2A_vs_2B.json``),
  * resolves both sides to the **real** teams using the group standings, the FIFA best-third
    allocation table, and the results of any earlier knockout ties already played, and
  * (optionally) rediscovers the **real** FotMob match id by looking up the date + teams.

``run_match`` uses this to scrape with real names + the right id and to write the result
back to the original slot-coded stub, so the dashboard bracket and calendar pick it up.

It mirrors the dashboard's ``buildKnockout``/``resolveSlot`` logic (app.js) so the site and
the pipeline agree on who plays whom. Pure-stdlib; safe to import without selenium.
"""
from __future__ import annotations

import os
import re
import glob
import json
import logging
from pathlib import Path

log = logging.getLogger("wc2026.knockout_resolve")

_DIR = Path(__file__).resolve().parent
MATCH_DIR = _DIR / "matches"
SCHEDULE = _DIR / "REMAINING_SCHEDULE.json"

# FotMob ships some group fixtures with play-off placeholder names — map to the real nation
# (kept in sync with wc2026_dashboard/build_data.py NAME_MAP).
NAME_MAP = {
    "European Play-Off A": "Bosnia and Herzegovina",
    "European Play-Off B": "Sweden",
    "European Play-Off C": "Turkiye",
    "European Play-Off D": "Czechia",
    "FIFA Play-Off Tournament 2": "Iraq",
}

# FIFA Annex C best-third allocation: sorted qualifying-group combo → {group winner : group
# whose 3rd-placed team it faces}. Kept in sync with app.js FIFA_THIRD_ALLOC.
FIFA_THIRD_ALLOC = {
    "BDEFIJKL": {"A": "E", "B": "J", "D": "B", "E": "D", "G": "I", "I": "F", "K": "L", "L": "K"},
}


def _norm(name: str) -> str:
    return NAME_MAP.get(name, name)


# ── data loading ──────────────────────────────────────────────────────────
def _team_group() -> dict:
    """team -> group letter, from the schedule (group-stage rows only)."""
    sched = json.load(open(SCHEDULE, encoding="utf-8"))
    tg = {}
    for m in sched:
        g = m.get("group", "")
        if len(g) == 1 and g.isalpha():
            tg[_norm(m["home"])] = g
            tg[_norm(m["away"])] = g
    return tg


def _load_matches() -> list:
    """All match files as {slot_id, date, home, away, hs, as, played}."""
    out = []
    for f in sorted(glob.glob(str(MATCH_DIR / "*.json"))):
        base = os.path.basename(f)
        if "_cache" in base:
            continue
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        slot_id = base[:-5]
        hs = d.get("home", {}).get("score")
        as_ = d.get("away", {}).get("score")
        out.append({
            "slot_id": slot_id,
            "date": d.get("wc_metadata", {}).get("date") or d.get("date") or slot_id[:10].replace("_", "-"),
            "home": _norm(d.get("home", {}).get("name", "")),
            "away": _norm(d.get("away", {}).get("name", "")),
            "hs": hs, "as": as_,
            "played": hs is not None and as_ is not None,
            "match_id": d.get("matchId") or d.get("match_id") or d.get("id"),
        })
    return out


def _standings(matches: list, tg: dict) -> dict:
    """letter -> rows sorted by Pts, GD, GF, name (group stage only)."""
    groups: dict = {}
    for m in matches:
        if not m["played"]:
            continue
        h, a = m["home"], m["away"]
        gh, ga = tg.get(h), tg.get(a)
        if gh is None or gh != ga:
            continue  # not a same-group (group-stage) match
        grp = groups.setdefault(gh, {})
        for t in (h, a):
            grp.setdefault(t, dict(team=t, P=0, W=0, D=0, L=0, GF=0, GA=0, GD=0, Pts=0))
        hs, as_ = m["hs"], m["as"]
        H, A = grp[h], grp[a]
        H["P"] += 1; A["P"] += 1
        H["GF"] += hs; H["GA"] += as_; A["GF"] += as_; A["GA"] += hs
        if hs > as_:
            H["W"] += 1; H["Pts"] += 3; A["L"] += 1
        elif hs < as_:
            A["W"] += 1; A["Pts"] += 3; H["L"] += 1
        else:
            H["D"] += 1; A["D"] += 1; H["Pts"] += 1; A["Pts"] += 1
    out = {}
    for letter, teams in groups.items():
        rows = list(teams.values())
        for r in rows:
            r["GD"] = r["GF"] - r["GA"]
        rows.sort(key=lambda r: (-r["Pts"], -r["GD"], -r["GF"], r["team"]))
        out[letter] = rows
    return dict(sorted(out.items()))


def _third_alloc(standings: dict) -> dict:
    """slot code like '3ABCDF' -> team, via the FIFA best-third allocation table."""
    letters = sorted(standings)
    if len(letters) < 12 or not all(
        len(standings[g]) >= 4 and all(r["P"] >= 3 for r in standings[g]) for g in letters
    ):
        return {}
    ranking = []
    for g in letters:
        r = standings[g][2]
        ranking.append({"grp": g, "team": r["team"], "Pts": r["Pts"], "GD": r["GD"], "GF": r["GF"]})
    ranking.sort(key=lambda t: (-t["Pts"], -t["GD"], -t["GF"], t["team"]))
    combo = "".join(sorted(t["grp"] for t in ranking[:8]))
    winner_to_third = FIFA_THIRD_ALLOC.get(combo)
    if not winner_to_third:
        return {}
    by_grp = {t["grp"]: t["team"] for t in ranking}
    # Map each schedule slot code (e.g. "3ABCDF") to its team via the 1X winner it faces.
    alloc = {}
    sched = json.load(open(SCHEDULE, encoding="utf-8"))
    for m in sched:
        for side, other in (("home", "away"), ("away", "home")):
            code = m[side]
            if not re.match(r"^3[A-L]{2,}$", code):
                continue
            wm = re.match(r"^1([A-L])$", m[other])
            if not wm:
                continue
            third_g = winner_to_third.get(wm[1])
            if third_g and third_g in by_grp:
                alloc[code] = by_grp[third_g]
    return alloc


# ── bracket tree ──────────────────────────────────────────────────────────
def _digits(s: str) -> int:
    return len(re.findall(r"[123]", s))


def _round_of(slot_id: str):
    if re.match(r"^Winner_SF_\d_vs_Winner_SF_\d$", slot_id): return "F"
    if re.match(r"^Loser_SF_\d_vs_Loser_SF_\d$", slot_id): return "TP"
    if re.match(r"^Winner_QF_\d_vs_Winner_QF_\d$", slot_id): return "SF"
    if re.match(r"^Winner_EF_\d_vs_Winner_EF_\d$", slot_id): return "QF"
    sd = slot_id.split("_vs_")
    if len(sd) == 2 and all(re.match(r"^[123][0-9A-L]*$", x) for x in sd) and _digits(sd[0]) == _digits(sd[1]):
        if _digits(sd[0]) == 1: return "R32"
        if _digits(sd[0]) == 2: return "R16"
    return None


def _ref_nums(slot_id: str, tag: str) -> list:
    return [int(a or b) for a, b in re.findall(r"Winner_%s_(\d)|Loser_%s_(\d)" % (tag, tag), slot_id)]


class _Tree:
    """Links each knockout match to its two feeder ties, mirroring app.js buildKnockout."""
    def __init__(self, matches: list):
        self.by_slot = {}
        rounds = {k: [] for k in ("R32", "R16", "QF", "SF", "F", "TP")}
        for ix, m in enumerate(matches):
            sid = re.sub(r"^\d{4}_\d{2}_\d{2}_", "", m["slot_id"])
            rd = _round_of(sid)
            if not rd:
                continue
            m["_sid"], m["_ix"] = sid, ix
            rounds[rd].append(m)
            self.by_slot[sid] = m
        for k in ("R32", "R16", "QF", "SF"):
            rounds[k].sort(key=lambda m: (m["date"], m["_ix"]))
        self.rounds = rounds
        r32by = {}
        for m in rounds["R32"]:
            r32by["|".join(sorted(m["_sid"].split("_vs_")))] = m
        ef = {}
        for i, m in enumerate(rounds["R16"]):
            ef[i + 1] = m
            m["_kids"] = [r32by.get("|".join(sorted(re.findall(r"[123][A-L]+", side))))
                          for side in m["_sid"].split("_vs_")]
        qf = {}
        for m in rounds["QF"]:
            efs = _ref_nums(m["_sid"], "EF")
            if efs:
                qf[(min(efs) + 1) // 2] = m
                m["_kids"] = [ef.get(n) for n in efs]
        sf = {}
        for m in rounds["SF"]:
            qfs = _ref_nums(m["_sid"], "QF")
            if qfs:
                sf[(min(qfs) + 1) // 2] = m
                m["_kids"] = [qf.get(n) for n in qfs]
        if rounds["F"]:
            rounds["F"][0]["_kids"] = [sf.get(n) for n in _ref_nums(rounds["F"][0]["_sid"], "SF")]
        if rounds["TP"]:
            rounds["TP"][0]["_kids"] = [sf.get(n) for n in _ref_nums(rounds["TP"][0]["_sid"], "SF")]


def _winner_of(m: dict):
    if m and m["played"]:
        return m["home"] if m["hs"] > m["as"] else m["away"]
    return None


# ── public API ────────────────────────────────────────────────────────────
def build_resolution_context() -> dict:
    """Load + index everything ``resolve_fixture`` needs, ONCE.

    Reading every match file (some are 100k+ lines) and recomputing standings on each
    ``resolve_fixture`` call is what made the catch-up sweep crawl (one full re-load per
    schedule row). Build this context once and pass it to ``resolve_fixture(id, ctx=…)``
    to resolve many fixtures cheaply. Re-build it (don't reuse) after a scrape writes new
    results, since standings / earlier-KO winners change."""
    matches = _load_matches()
    tg = _team_group()
    standings = _standings(matches, tg)
    return {
        "matches":   matches,
        "by_id":     {str(m.get("match_id")): m for m in matches if m.get("match_id") is not None},
        "standings": standings,
        "alloc":     _third_alloc(standings),
        "tree":      _Tree(matches),
    }


def resolve_fixture(fotmob_id, ctx: dict | None = None) -> tuple:
    """Resolve a knockout fixture (by its placeholder FotMob id) to (home, away, stub_path).

    Returns real team names where decidable, else (None) for an unresolved side. ``stub_path``
    is the slot-coded file the scraped result should be written back to (or None if no stub).
    Pass ``ctx`` from ``build_resolution_context()`` to resolve many fixtures without
    re-loading the match files each time (the default builds a fresh context per call)."""
    ctx = ctx or build_resolution_context()
    standings = ctx["standings"]
    alloc     = ctx["alloc"]
    tree      = ctx["tree"]
    stub = ctx["by_id"].get(str(fotmob_id))
    if not stub:
        return None, None, None
    stub_path = str(MATCH_DIR / (stub["slot_id"] + ".json"))
    sid = re.sub(r"^\d{4}_\d{2}_\d{2}_", "", stub["slot_id"])
    if _round_of(sid) is None:
        return None, None, stub_path  # not a knockout fixture

    node = tree.by_slot.get(sid)

    def resolve_slot(code: str):
        m = re.match(r"^([12])([A-L])$", code)
        if m:
            grp = standings.get(m[2])
            if grp and all(r["P"] >= 3 for r in grp):
                idx = int(m[1]) - 1
                if idx < len(grp):
                    return grp[idx]["team"]
            return None
        if re.match(r"^3[A-L]{2,}$", code):
            return alloc.get(code)
        return None

    def participant(match, idx):
        if match is None:
            return None
        kids = match.get("_kids")
        if kids and idx < len(kids) and kids[idx] is not None:
            return _winner_of(kids[idx])           # winner of the feeder tie
        return resolve_slot(sid_side(match, idx))  # group/third slot

    def sid_side(match, idx):
        parts = match["_sid"].split("_vs_")
        return parts[idx] if idx < len(parts) else ""

    home = participant(node, 0)
    away = participant(node, 1)
    return home, away, stub_path


# FotMob/WhoScored/our-schedule spell some nations differently. Collapse the known
# variants to one canonical key so a fixture matches regardless of which feed named it.
_TEAM_ALIASES = {
    "turkiye":        "turkey",
    "southkorea":     "korearepublic",
    "korea":          "korearepublic",
    "republicofkorea":"korearepublic",
    "unitedstates":   "usa",
    "unitedstatesofamerica": "usa",
    "iriran":         "iran",
    "cotedivoire":    "ivorycoast",
    "congodr":        "drcongo",
    "democraticrepublicofcongo": "drcongo",
    "czechrepublic":  "czechia",
    "bosniaandherzegovina": "bosnia",
    "caboverde":      "capeverde",
}


def _team_key(name: str) -> str:
    """Alias-aware, punctuation/accent-insensitive comparison key for a team name.

    Accents are folded (Türkiye→turkiye, Côte d'Ivoire→cotedivoire) before the alias
    table collapses spelling variants, so the same nation keys identically across the
    FotMob feed, our schedule, and the resolver."""
    import unicodedata
    s = unicodedata.normalize("NFKD", _norm(name or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    k = re.sub(r"[^a-z]", "", s.lower())
    return _TEAM_ALIASES.get(k, k)


def _fotmob_search_dates(around_date: str | None) -> list:
    """YYYYMMDD strings to scan: the match date ±1 day (so catch-up days later still
    sees it), else fall back to FotMob's default yesterday/today window (dates=None)."""
    if not around_date:
        return None
    from datetime import date, timedelta
    try:
        d = date.fromisoformat(around_date[:10])
    except Exception:
        return None
    return [(d + timedelta(days=off)).strftime("%Y%m%d") for off in (-1, 0, 1)]


def find_fotmob_id_by_teams(home: str, away: str, around_date: str | None = None):
    """Best-effort: find the real FotMob match id for ``home`` vs ``away`` near a date.

    Reuses the scraper's FotMob fixture fetch. Returns an int id or None. Matching is
    alias-aware (so FotMob's spelling variants still match) and date-windowed around the
    fixture date; when several fixtures match the teams, the one closest to ``around_date``
    wins. Imported lazily so this module stays selenium-free for the resolver/tests."""
    try:
        from wc2026.scraper import fotmob_fetch_wc_matches
    except Exception as exc:  # pragma: no cover - import guard
        log.warning("FotMob lookup unavailable: %s", exc)
        return None

    want = {_team_key(home), _team_key(away)}
    try:
        fixtures = fotmob_fetch_wc_matches(dates=_fotmob_search_dates(around_date)) or []
    except Exception as exc:
        log.warning("FotMob fixture fetch failed: %s", exc)
        return None

    candidates = []  # (date_distance, id)
    for fx in fixtures:
        h = fx.get("home", {}).get("name", "")
        a = fx.get("away", {}).get("name", "")
        if {_team_key(h), _team_key(a)} != want:
            continue
        mid = fx.get("id")
        if mid is None:
            continue
        utc = fx.get("status", {}).get("utcTime", "") or ""
        dist = abs_days(utc[:10], around_date) if (around_date and utc[:10]) else 0
        if around_date and utc[:10] and dist > 2:
            continue  # same teams, far-off date → almost certainly a different fixture
        candidates.append((dist, int(mid)))

    if not candidates:
        log.info("FotMob real-id lookup: no fixture matched %s vs %s near %s",
                 home, away, around_date)
        return None
    candidates.sort(key=lambda c: c[0])  # closest date first
    best_id = candidates[0][1]
    log.info("FotMob real-id lookup: %s vs %s → id=%s", home, away, best_id)
    return best_id


def abs_days(d1: str, d2: str) -> int:
    from datetime import date
    try:
        a = date.fromisoformat(d1[:10]); b = date.fromisoformat(d2[:10])
        return abs((a - b).days)
    except Exception:
        return 0


if __name__ == "__main__":  # quick manual check
    import sys
    fid = int(sys.argv[1]) if len(sys.argv) > 1 else 4653705
    print(resolve_fixture(fid))
