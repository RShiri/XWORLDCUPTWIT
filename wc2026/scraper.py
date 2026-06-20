"""
FIFA World Cup 2026 – Match Data Scraper

Two-source pipeline:
  1. FotMob   (cloudscraper, no browser) – polls for finished WC matches,
               extracts stats, shots, lineups, xG, venue metadata.
  2. WhoScored (Selenium)               – full event stream (passes, shots,
               dribbles, etc.) in the exact format the renderer expects.

Output: wc2026/matches/YYYY_MM_DD_TeamA_vs_TeamB.json

Usage:
  # Watch continuously (checks every 5 min for newly finished matches):
  python -m wc2026.scraper

  # Fetch one specific FotMob match ID immediately:
  python -m wc2026.scraper --fotmob-id 4321567

  # Skip WhoScored (FotMob data only – limited pass networks):
  python -m wc2026.scraper --fotmob-only
"""

from __future__ import annotations

import os
import sys
import json
import time
import logging
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(_REPO_ROOT / ".env", override=False)
except ImportError:
    pass

log = logging.getLogger("wc2026.scraper")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SCRAPER] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

MATCHES_DIR  = Path(__file__).parent / "matches"
MATCHES_DIR.mkdir(exist_ok=True)

POLL_INTERVAL = int(os.environ.get("WC2026_SCRAPE_POLL_SECONDS", 300))  # 5 min

# FotMob World Cup 2026 tournament ID (update if FotMob changes it)
WC2026_FOTMOB_ID = int(os.environ.get("WC2026_FOTMOB_LEAGUE_ID", 77))

# WhoScored World Cup 2026 fixtures page (season/stage-specific for WC2026)
WC2026_WS_BASE = os.environ.get(
    "WC2026_WHOSCORED_URL",
    "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/10498/Stages/25505/Fixtures/International-FIFA-World-Cup-2026",
)

_fetched_ids: set[int] = set()  # avoid re-fetching in the same run

# FotMob uses placeholder names for late-qualifying teams; map to real names
FOTMOB_NAME_OVERRIDES: dict[str, str] = {
    "FIFA Play-Off Tournament 1": "DR Congo",
    "FIFA Play-Off Tournament 2": "Iraq",
    # UEFA play-off path winners — FotMob keeps serving the placeholder slot
    # name even after the matches are played, which breaks the WhoScored slug
    # search. Map each slot to the real qualifier (confirmed via group fixtures
    # already in whoscored_ids.json: Canada–Bosnia, Korea–Czechia,
    # Australia–Türkiye, Sweden–Tunisia).
    "European Play-Off A": "Bosnia and Herzegovina",
    "European Play-Off B": "Sweden",
    "European Play-Off C": "Turkiye",
    "European Play-Off D": "Czechia",
}

# ══════════════════════════════════════════════════════════════════════════
# SCHEDULE HELPERS – team name resolution without FotMob
# ══════════════════════════════════════════════════════════════════════════

_SCHEDULE_PATH  = Path(__file__).parent / "REMAINING_SCHEDULE.json"
_schedule_cache: list[dict] | None = None


def _load_schedule() -> list[dict]:
    global _schedule_cache
    if _schedule_cache is None:
        try:
            _schedule_cache = json.loads(_SCHEDULE_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("Could not load schedule file: %s", exc)
            _schedule_cache = []
    return _schedule_cache


def schedule_team_names(fotmob_id: int) -> tuple[str, str, str]:
    """Return (home, away, YYYY-MM-DD) from REMAINING_SCHEDULE for a FotMob ID."""
    for m in _load_schedule():
        if m.get("fotmob_id") == fotmob_id:
            date = m.get("scrape_at_israel", "")[:10]
            return m.get("home", ""), m.get("away", ""), date
    return "", "", ""


def schedule_lookup_by_teams(home: str, away: str) -> tuple[int | None, str]:
    """
    Return (fotmob_id, YYYY-MM-DD) by fuzzy-matching team names in the schedule.
    Partial, case-insensitive match so 'Congo' finds 'DR Congo' etc.
    """
    h_low, a_low = home.strip().lower(), away.strip().lower()
    for m in _load_schedule():
        sched_h = m.get("home", "").lower()
        sched_a = m.get("away", "").lower()
        if (h_low in sched_h or sched_h in h_low) and \
           (a_low in sched_a or sched_a in a_low):
            return m["fotmob_id"], m.get("scrape_at_israel", "")[:10]
    return None, ""


# ══════════════════════════════════════════════════════════════════════════
# FOTMOB – no browser required
# ══════════════════════════════════════════════════════════════════════════

def _fotmob_scraper():
    try:
        import cloudscraper
        return cloudscraper.create_scraper()
    except ImportError:
        import requests
        s = requests.Session()
        s.headers.update({"User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )})
        return s


def fotmob_fetch_wc_matches() -> list[dict]:
    """
    Return finished WC 2026 matches by scanning today's and yesterday's XML feed.
    FotMob's JSON leagues endpoint is defunct; the XML matches feed still works at
    https://api.fotmob.com/matches?date=YYYYMMDD
    """
    import xml.etree.ElementTree as ET
    from datetime import datetime, timezone, timedelta

    scraper = _fotmob_scraper()
    now_utc = datetime.now(timezone.utc)
    dates_to_check = [
        (now_utc - timedelta(days=1)).strftime("%Y%m%d"),
        now_utc.strftime("%Y%m%d"),
    ]

    matches: list[dict] = []
    seen_ids: set = set()

    for date_str in dates_to_check:
        url = f"https://api.fotmob.com/matches?date={date_str}"
        log.info("FotMob XML: fetching matches for %s …", date_str)
        try:
            resp = scraper.get(url, timeout=20)
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
        except Exception as exc:
            log.error("FotMob XML fetch failed (%s): %s", date_str, exc)
            continue

        for league in root.iter("league"):
            league_name = league.get("name", "")
            pl = league.get("pl", "")
            # Filter to WC 2026 (pl=77)
            if pl != str(WC2026_FOTMOB_ID):
                continue
            for match in league.iter("match"):
                mid = match.get("id")
                if not mid or mid in seen_ids:
                    continue
                seen_ids.add(mid)
                status_code = match.get("Status", "N")
                h_score = match.get("hScore", "0")
                a_score = match.get("aScore", "0")
                time_str = match.get("time", "")
                # Parse match UTC time from FotMob XML format "DD.MM.YYYY HH:MM"
                utc_time = None
                try:
                    utc_time = datetime.strptime(time_str, "%d.%m.%Y %H:%M").replace(
                        tzinfo=timezone.utc
                    )
                except Exception:
                    pass
                # Consider finished if: status is 'FT'/'AET'/'PEN', OR
                # score differs from 0-0, OR kick-off was >115 min ago
                is_finished = (
                    status_code in ("FT", "AET", "PEN", "FT_PEN")
                    or (h_score != "0" or a_score != "0")
                    or (utc_time is not None and (now_utc - utc_time).total_seconds() > 115 * 60)
                )
                matches.append({
                    "id":       int(mid),
                    "home":     {"name": match.get("hTeam", ""), "id": match.get("hId")},
                    "away":     {"name": match.get("aTeam", ""), "id": match.get("aId")},
                    "status":   {
                        "scoreStr": f"{h_score} - {a_score}",
                        "finished": is_finished,
                        "utcTime":  utc_time.isoformat() if utc_time else "",
                    },
                    "_league":  league_name,
                })

    log.info("FotMob XML: found %d WC2026 matches across checked dates", len(matches))
    return matches


def fotmob_fetch_match_details(match_id: int) -> dict:
    """
    FotMob's JSON matchDetails endpoint is defunct (returns 404).
    Returns a minimal stub so build_match_json() can still proceed using
    WhoScored as the primary data source.
    """
    log.warning(
        "FotMob matchDetails JSON API is unavailable (404). "
        "Match %d will be built from WhoScored data only.", match_id
    )
    return {"_fotmob_unavailable": True, "general": {}, "header": {}, "content": {}}


def _compute_ws_stats(events: list, home_tid, away_tid) -> dict:
    """Compute match stats from the WhoScored event stream.

    Used as the stats source when FotMob's matchDetails API is unavailable.
    xG is intentionally absent — WhoScored events carry no expected-goals data.
    """
    SHOT_ALL = {"Goal", "SavedShot", "MissedShots", "ShotOnPost", "BlockedShot"}
    SHOT_ON  = {"Goal", "SavedShot"}
    DUEL     = {"Aerial", "Tackle", "TakeOn"}

    def _t(e): return e.get("type", {}).get("displayName", "")
    def _o(e): return e.get("outcomeType", {}).get("displayName", "")

    def per_team(fn):
        return {"home": fn(home_tid), "away": fn(away_tid)}

    shots = per_team(lambda tid: sum(1 for e in events if _t(e) in SHOT_ALL and e.get("teamId") == tid))
    sot   = per_team(lambda tid: sum(1 for e in events if _t(e) in SHOT_ON  and e.get("teamId") == tid))
    # Save events belong to the goalkeeper's (defending) team.
    saves = per_team(lambda tid: sum(1 for e in events if _t(e) == "Save" and e.get("teamId") == tid))
    # A Foul event is logged twice — Successful for the team that won it,
    # Unsuccessful for the team that committed it. "Fouls" = fouls committed.
    fouls = per_team(lambda tid: sum(1 for e in events
                                     if _t(e) == "Foul" and _o(e) == "Unsuccessful"
                                     and e.get("teamId") == tid))
    bc    = per_team(lambda tid: sum(1 for e in events if e.get("teamId") == tid
                                     and any(q.get("type", {}).get("displayName") == "BigChance"
                                             for q in e.get("qualifiers", []))))

    # Duels won = won aerials/tackles/take-ons. Every duel has one winner, so the
    # percentage is each team's share of all won duels.
    dw = per_team(lambda tid: sum(1 for e in events if _t(e) in DUEL
                                  and _o(e) == "Successful" and e.get("teamId") == tid))
    dw_total = dw["home"] + dw["away"]
    duels_won = {
        "home": int(round(100 * dw["home"] / dw_total)) if dw_total else 0,
        "away": int(round(100 * dw["away"] / dw_total)) if dw_total else 0,
    }

    # Passes (total / accurate / accuracy%).
    pt = per_team(lambda tid: sum(1 for e in events if _t(e) == "Pass" and e.get("teamId") == tid))
    pa = per_team(lambda tid: sum(1 for e in events if _t(e) == "Pass"
                                  and _o(e) == "Successful" and e.get("teamId") == tid))
    passes_accuracy = {
        "home": int(round(100 * pa["home"] / pt["home"])) if pt["home"] else 0,
        "away": int(round(100 * pa["away"] / pt["away"])) if pt["away"] else 0,
    }

    # Possession proxy: share of total passes (touch-time data is not available).
    pt_total = pt["home"] + pt["away"]
    possession = {
        "home": int(round(100 * pt["home"] / pt_total)) if pt_total else 50,
        "away": int(round(100 * pt["away"] / pt_total)) if pt_total else 50,
    }

    return {
        "shots":               shots,
        "shots_on_target":     sot,
        "saves":               saves,
        "fouls":               fouls,
        "big_chances_created": bc,
        "duels_won":           duels_won,
        "possession":          possession,
        "passes_total":        pt,
        "passes_accurate":     pa,
        "passes_accuracy":     passes_accuracy,
    }


def _parse_fotmob_stats(fm_data: dict) -> dict:
    """Extract match_stats dict from FotMob matchDetails response."""
    stats = {}
    try:
        periods = (
            fm_data.get("content", {})
            .get("stats", {})
            .get("Periods", {})
            .get("All", {})
            .get("stats", [])
        )
        label_map = {
            "Expected goals (xG)":  "xg",
            "Ball possession":      "possession",
            "Shots on target":      "shots_on_target",
            "Total shots":          "shots",
            "Big chances":          "big_chances_created",
            "Successful dribbles":  "duels_won",
            "Saves":                "saves",
            "Fouls":                "fouls",
            "Passes":               "passes_total",
            "Accurate passes":      "passes_accurate",
        }
        for item in periods:
            key = label_map.get(item.get("title", ""))
            if not key:
                continue
            vals = item.get("stats", [])
            if len(vals) < 2:
                continue
            def _num(v):
                v = str(v).replace("%", "").strip()
                try:    return float(v) if "." in v else int(v)
                except: return None
            stats[key] = {"home": _num(vals[0]), "away": _num(vals[1])}
    except Exception as exc:
        log.warning("FotMob stats parse error: %s", exc)

    # Derive passes_accuracy from passes_total + passes_accurate
    pt = stats.get("passes_total", {})
    pa = stats.get("passes_accurate", {})
    if pt and pa:
        for side in ("home", "away"):
            if pt.get(side) and pa.get(side):
                stats.setdefault("passes_accuracy", {})[side] = int(
                    round(pa[side] / pt[side] * 100)
                )

    return stats


def _parse_fotmob_shots(fm_data: dict, home_id: int, away_id: int) -> list[dict]:
    """
    Convert FotMob shotmap shots into WhoScored-compatible event dicts.
    These are appended to the events list so the renderer can use them.
    """
    shots_raw = (
        fm_data.get("content", {})
        .get("shotmap", {})
        .get("shots", [])
    ) or []

    events = []
    for s in shots_raw:
        tid = s.get("teamId")
        # FotMob x/y are 0-100 from attacking perspective; flip away team
        x = float(s.get("x", 50))
        y = float(s.get("y", 50))
        if tid == away_id:
            x = 100 - x
            y = 100 - y

        outcome_map = {
            "Goal":          "Goal",
            "SavedShot":     "SavedShot",
            "AttemptSaved":  "SavedShot",
            "Miss":          "MissedShots",
            "BlockedShot":   "MissedShots",
            "ShotOnPost":    "ShotOnPost",
        }
        ev_type = outcome_map.get(s.get("eventType", ""), "MissedShots")
        is_goal = ev_type == "Goal"

        quals = []
        if s.get("isOnTarget"):
            pass
        if s.get("isBigChance"):
            quals.append({"type": {"displayName": "BigChance"}})
        bp = s.get("situation", "")
        if "Penalty" in bp:
            quals.append({"type": {"displayName": "Penalty"}})
        foot = s.get("shotType", "")
        if foot:
            quals.append({"type": {"displayName": "RightFoot" if "right" in foot.lower() else "LeftFoot"}})

        events.append({
            "id":           float(s.get("id", 0)),
            "eventId":      s.get("id", 0),
            "minute":       s.get("min", 0),
            "second":       0,
            "teamId":       tid,
            "x":            x,
            "y":            y,
            "expandedMinute": s.get("min", 0),
            "period":       {"displayName": "FirstHalf" if s.get("min", 0) <= 45 else "SecondHalf",
                             "value": 1 if s.get("min", 0) <= 45 else 2},
            "type":         {"displayName": ev_type, "value": 16 if is_goal else 13},
            "outcomeType":  {"displayName": "Successful" if is_goal else "Unsuccessful",
                             "value": 1 if is_goal else 0},
            "qualifiers":   quals,
            "satisfiedEventsTypes": [],
            "isTouch":      True,
            "playerId":     s.get("playerId"),
            "_source":      "fotmob",
        })

    return events


def _parse_fotmob_lineup(fm_data: dict, side: str) -> list[dict]:
    """Extract player list from FotMob lineup (home or away)."""
    idx = 0 if side == "home" else 1
    try:
        lineup = fm_data["content"]["lineup"][side]["players"]
    except (KeyError, IndexError, TypeError):
        return []

    players = []
    pos_map = {
        "GK": "GK", "CB": "DC", "LB": "DL", "RB": "DR",
        "CM": "MC", "DM": "DMC", "AM": "AMC", "LW": "ML",
        "RW": "MR", "ST": "FW", "CF": "FW",
    }
    for p in lineup:
        if not isinstance(p, dict):
            continue
        players.append({
            "playerId":     p.get("id"),
            "name":         p.get("name", ""),
            "shirtNo":      p.get("shirt", 0),
            "position":     pos_map.get(p.get("position", ""), "MC"),
            "isFirstEleven": p.get("positionRow", 99) < 11,
            "stats":        {},
        })
    return players


def _parse_fotmob_venue(fm_data: dict) -> dict:
    """Extract venue/city/stage from FotMob matchDetails."""
    general = fm_data.get("general", {})
    return {
        "venue":   general.get("venue", ""),
        "city":    general.get("venueCity", ""),
        "country": general.get("venueCountry", ""),
        "stage":   general.get("parentLeagueName", "Group Stage"),
    }


# ══════════════════════════════════════════════════════════════════════════
# WHOSCORED – Selenium (full event stream)
# ══════════════════════════════════════════════════════════════════════════

def whoscored_fetch_match(ws_url: str, timeout: int = 30) -> dict | None:
    """
    Open a WhoScored match URL with Selenium, extract matchCentreData JSON.
    Returns the parsed dict or None on failure.
    """
    try:
        import undetected_chromedriver as uc
        options = uc.ChromeOptions()
        if os.environ.get("WC2026_VISIBLE") != "1":
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
        driver = uc.Chrome(options=options, version_main=149)
    except ImportError:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        options = Options()
        if os.environ.get("WC2026_VISIBLE") != "1":
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
        driver = webdriver.Chrome(options=options)

    log.info("WhoScored: loading %s …", ws_url)
    try:
        driver.get(ws_url)
        time.sleep(timeout)

        html   = driver.page_source
        marker = "matchCentreData:"
        idx    = html.find(marker)
        if idx == -1:
            log.warning("WhoScored: matchCentreData not found in page source.")
            return None

        snippet = html[idx + len(marker):].strip()

        # Extract JSON by matching braces
        if "matchCentreEventTypeJson" in snippet:
            json_str = snippet.split("matchCentreEventTypeJson")[0].strip().rstrip(",")
        else:
            # Fallback: count braces
            depth, end = 0, 0
            for i, ch in enumerate(snippet):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            json_str = snippet[:end]

        data = json.loads(json_str)
        log.info("WhoScored: parsed %d events.", len(data.get("events", [])))
        return data

    except Exception as exc:
        log.error("WhoScored scrape error: %s", exc)
        return None
    finally:
        try:
            driver.quit()
        except Exception:
            pass


# WhoScored uses different names for some teams; map to the slug fragment they use.
_WS_NAME_ALIASES: dict[str, str] = {
    "south korea":            "republic-of-korea",
    "korea republic":         "republic-of-korea",
    "cape verde":             "cabo-verde",
    "ivory coast":            "ivory-coast",
    "cote d'ivoire":          "ivory-coast",
    "côte d'ivoire":          "ivory-coast",
    "dr congo":               "dr-congo",
    "democratic republic of congo": "dr-congo",
    "bosnia and herzegovina": "bosnia-and-herzegovina",
    "new zealand":            "new-zealand",
    "saudi arabia":           "saudi-arabia",
    "united states":          "usa",
    "turkiye":                "turkiye",
    "turkey":                 "turkiye",
}


def _ws_slug_key(name: str) -> str:
    """Normalise a team name to the slug fragment WhoScored would use."""
    lower = name.lower().strip()
    if lower in _WS_NAME_ALIASES:
        return _WS_NAME_ALIASES[lower]
    return re.sub(r"[^a-z0-9]+", "-", lower).strip("-")


def _ws_cache_lookup(home_name: str, away_name: str) -> int | None:
    """Check whoscored_ids.json for a pre-known match ID."""
    cache_path = Path(__file__).parent / "whoscored_ids.json"
    if not cache_path.exists():
        return None
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        h_key = _ws_slug_key(home_name)
        a_key = _ws_slug_key(away_name)
        for ws_id, entry in cache.items():
            slug = entry.get("slug", "")
            if h_key in slug and a_key in slug:
                log.info("WhoScored: cache hit — ID %s for %s vs %s", ws_id, home_name, away_name)
                return int(ws_id)
    except Exception as exc:
        log.warning("WhoScored: cache lookup error: %s", exc)
    return None


def _build_whoscored_url(home_name: str, away_name: str, ws_match_id: int | None) -> str | None:
    """Construct a WhoScored match URL. Uses cached slug when the ID is known."""
    if ws_match_id is None:
        return None
    # Prefer the cached slug so aliased names (Cape Verde → cabo-verde) work correctly
    cache_path = Path(__file__).parent / "whoscored_ids.json"
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
            entry = cache.get(str(ws_match_id))
            if entry and entry.get("slug"):
                slug = entry["slug"]
                return f"https://www.whoscored.com/matches/{ws_match_id}/live/international-fifa-world-cup-2026-{slug}"
        except Exception:
            pass
    # Fallback: derive slug from team names
    h = _ws_slug_key(home_name)
    a = _ws_slug_key(away_name)
    return f"https://www.whoscored.com/matches/{ws_match_id}/live/international-fifa-world-cup-2026-{h}-{a}"


def whoscored_search_match_id(home_name: str, away_name: str) -> int | None:
    """Return WhoScored match ID: cache first, then live competition page search."""
    cached = _ws_cache_lookup(home_name, away_name)
    if cached:
        return cached

    try:
        import undetected_chromedriver as uc
        options = uc.ChromeOptions()
        if os.environ.get("WC2026_VISIBLE") != "1":
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        driver = uc.Chrome(options=options, version_main=149)
    except ImportError:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        options = Options()
        if os.environ.get("WC2026_VISIBLE") != "1":
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        driver = webdriver.Chrome(options=options)

    log.info("WhoScored: searching for %s vs %s …", home_name, away_name)
    try:
        driver.get(WC2026_WS_BASE)
        time.sleep(14)
        h_key = re.sub(r"[^a-z0-9]", "", home_name.lower())
        a_key = re.sub(r"[^a-z0-9]", "", away_name.lower())
        for el in driver.find_elements("css selector", "a[href*='/matches/']"):
            href = el.get_attribute("href") or ""
            combined = re.sub(r"[^a-z0-9]", "", href.lower())
            if h_key in combined and a_key in combined:
                m = re.search(r"/matches/(\d+)/", href)
                if m:
                    mid = int(m.group(1))
                    log.info("WhoScored: found match ID %d", mid)
                    return mid
        log.warning("WhoScored: match ID not found for %s vs %s", home_name, away_name)
        return None
    except Exception as exc:
        log.error("WhoScored search error: %s", exc)
        return None
    finally:
        try:
            driver.quit()
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════════════
# BUILD WC2026 MATCH JSON
# ══════════════════════════════════════════════════════════════════════════

def build_match_json(fm_data: dict, ws_data: dict | None,
                     xml_match: dict | None = None) -> dict:
    """
    Merge FotMob details + optional WhoScored event stream into the
    wc2026 match schema expected by renderer.py.

    When FotMob JSON details are unavailable (fm_data has _fotmob_unavailable=True),
    names/scores are taken from xml_match (the dict parsed from the XML feed)
    and ws_data is the mandatory event source.
    """
    fotmob_unavailable = fm_data.get("_fotmob_unavailable", False)

    # ── Team names & IDs ─────────────────────────────────────────────────────
    if fotmob_unavailable and xml_match:
        home_name = FOTMOB_NAME_OVERRIDES.get(xml_match.get("home", {}).get("name", "Home"), xml_match.get("home", {}).get("name", "Home"))
        away_name = FOTMOB_NAME_OVERRIDES.get(xml_match.get("away", {}).get("name", "Away"), xml_match.get("away", {}).get("name", "Away"))
        home_id   = xml_match.get("home", {}).get("id")
        away_id   = xml_match.get("away", {}).get("id")
        score_str = xml_match.get("status", {}).get("scoreStr", "0 - 0")
        utc_time  = xml_match.get("status", {}).get("utcTime", "")
        general   = {"matchId": xml_match.get("id", 0)}
    else:
        general   = fm_data.get("general", {})
        header    = fm_data.get("header", {})
        teams     = header.get("teams", [{}, {}])
        home_info = teams[0] if len(teams) > 0 else {}
        away_info = teams[1] if len(teams) > 1 else {}
        home_id   = home_info.get("id")
        away_id   = away_info.get("id")
        home_name = FOTMOB_NAME_OVERRIDES.get(home_info.get("name", "Home"), home_info.get("name", "Home"))
        away_name = FOTMOB_NAME_OVERRIDES.get(away_info.get("name", "Away"), away_info.get("name", "Away"))
        score_str = header.get("status", {}).get("scoreStr", "0 - 0")
        utc_time  = header.get("status", {}).get("utcTime", "")

    try:
        parts      = re.split(r"\s*-\s*", score_str)
        home_score = int(parts[0].strip())
        away_score = int(parts[1].strip())
    except Exception:
        home_score = away_score = 0

    try:
        dt = datetime.fromisoformat(utc_time.replace("Z", "+00:00"))
        date_str = dt.strftime("%Y-%m-%d")
    except Exception:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    venue_info = _parse_fotmob_venue(fm_data) if not fotmob_unavailable else {
        "venue": "", "city": "", "country": "United States", "stage": "Group Stage"
    }

    # ── Events & players ─────────────────────────────────────────────────────
    if ws_data and ws_data.get("events"):
        ws_home      = ws_data.get("home", {})
        ws_away      = ws_data.get("away", {})
        events       = ws_data["events"]
        home_tid     = ws_home.get("teamId", home_id)
        away_tid     = ws_away.get("teamId", away_id)
        home_players = ws_home.get("players", [])
        away_players = ws_away.get("players", [])
        # WhoScored has the real fulltime scores — use them
        ws_home_score = ws_home.get("scores", {}).get("fulltime")
        ws_away_score = ws_away.get("scores", {}).get("fulltime")
        if ws_home_score is not None:
            home_score = int(ws_home_score)
        if ws_away_score is not None:
            away_score = int(ws_away_score)
        # Patch names into WhoScored data if FotMob was unavailable
        if fotmob_unavailable:
            ws_home["name"] = home_name
            ws_away["name"] = away_name
        ws_home["scores"] = {"fulltime": home_score}
        ws_away["scores"] = {"fulltime": away_score}
        log.info("Using WhoScored events (%d)", len(events))
    elif not fotmob_unavailable:
        events       = _parse_fotmob_shots(fm_data, home_id, away_id)
        home_tid     = home_id
        away_tid     = away_id
        home_players = _parse_fotmob_lineup(fm_data, "home")
        away_players = _parse_fotmob_lineup(fm_data, "away")
        log.info("Using FotMob shot events only (%d)", len(events))
    else:
        log.error("No event data available (FotMob unavailable + no WhoScored data).")
        events       = []
        home_tid     = home_id
        away_tid     = away_id
        home_players = []
        away_players = []

    match_stats = _parse_fotmob_stats(fm_data)

    # Big chance missed: shots that were big chances but not goals
    def _bc_missed(side_id):
        return sum(
            1 for e in events
            if e.get("teamId") == side_id
            and any(q.get("type", {}).get("displayName") == "BigChance"
                    for q in e.get("qualifiers", []))
            and e.get("type", {}).get("displayName") != "Goal"
        )

    match_stats.setdefault("big_chances_missed", {
        "home": _bc_missed(home_tid),
        "away": _bc_missed(away_tid),
    })

    # Compute pass totals / accurate passes from the event stream (WhoScored data)
    for _side, _tid in [("home", home_tid), ("away", away_tid)]:
        _passes  = [e for e in events if e.get("teamId") == _tid
                    and e.get("type", {}).get("displayName") == "Pass"]
        _total   = len(_passes)
        _accurate = sum(1 for e in _passes
                        if e.get("outcomeType", {}).get("displayName") == "Successful")
        if _total > 0:
            match_stats.setdefault(f"passes_total_{_side}", _total)
            match_stats[f"passes_accurate_{_side}"] = _accurate
            match_stats.setdefault(f"passes_accuracy_{_side}",
                                   int(round(100 * _accurate / _total)))

    # Fill remaining stats from WhoScored events when FotMob didn't provide them.
    if events:
        for _k, _v in _compute_ws_stats(events, home_tid, away_tid).items():
            match_stats.setdefault(_k, _v)

    pid_name = {}
    for p in home_players + away_players:
        pid = p.get("playerId")
        if pid:
            pid_name[str(pid)] = p.get("name", "")

    return {
        "matchId":  general.get("matchId", 0),
        "wc_metadata": {
            "stage":      venue_info.get("stage", "Group Stage"),
            "group":      general.get("parentLeagueName", None),
            "venue":      venue_info.get("venue", ""),
            "city":       venue_info.get("city", ""),
            "country":    venue_info.get("country", "United States"),
            "date":       date_str,
            "attendance": general.get("attendance"),
        },
        "home": {
            "teamId":  home_tid,
            "name":    home_name,
            "score":   home_score,
            "penalty_score": None,
            "players": home_players,
            "stats":   {},
            "field":   "home",
        },
        "away": {
            "teamId":  away_tid,
            "name":    away_name,
            "score":   away_score,
            "penalty_score": None,
            "players": away_players,
            "stats":   {},
            "field":   "away",
        },
        "events":      events,
        "match_stats": match_stats,
        "playerIdNameDictionary": pid_name,
        "_scraped_at": datetime.now(timezone.utc).isoformat(),
        "_sources":    ["fotmob"] + (["whoscored"] if ws_data else []),
    }


# ══════════════════════════════════════════════════════════════════════════
# SAVE & TRIGGER
# ══════════════════════════════════════════════════════════════════════════

def _output_path(match_json: dict) -> Path:
    meta  = match_json.get("wc_metadata", {})
    date  = meta.get("date", "2026_06_01").replace("-", "_")
    home  = match_json["home"]["name"].replace(" ", "_")
    away  = match_json["away"]["name"].replace(" ", "_")
    return MATCHES_DIR / f"{date}_{home}_vs_{away}.json"


def fetch_and_save(fotmob_id: int, fotmob_only: bool = False,
                   xml_match: dict | None = None) -> Path | None:
    """Full pipeline for one match: fetch → build JSON → save."""
    if fotmob_id in _fetched_ids:
        log.info("Match %d already fetched this session, skipping.", fotmob_id)
        return None

    fm_data = fotmob_fetch_match_details(fotmob_id)  # now returns stub if API is down

    # Resolve team names: prefer FotMob JSON, fall back to XML match data.
    # Apply FOTMOB_NAME_OVERRIDES here too so placeholder slot names (e.g.
    # "European Play-Off C") become the real qualifier before the WhoScored
    # slug search runs — otherwise the search can never match the real fixture.
    if fm_data.get("_fotmob_unavailable") and xml_match:
        home_name = xml_match.get("home", {}).get("name", "Home")
        away_name = xml_match.get("away", {}).get("name", "Away")
    else:
        teams     = fm_data.get("header", {}).get("teams", [{}, {}])
        home_name = teams[0].get("name", "Home") if teams else "Home"
        away_name = teams[1].get("name", "Away") if len(teams) > 1 else "Away"
    home_name = FOTMOB_NAME_OVERRIDES.get(home_name, home_name)
    away_name = FOTMOB_NAME_OVERRIDES.get(away_name, away_name)

    ws_data = None
    if not fotmob_only:
        ws_mid = whoscored_search_match_id(home_name, away_name)
        if ws_mid:
            ws_url  = _build_whoscored_url(home_name, away_name, ws_mid)
            ws_data = whoscored_fetch_match(ws_url)

    match_json = build_match_json(fm_data, ws_data, xml_match=xml_match)
    out_path   = _output_path(match_json)

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(match_json, fh, indent=2)

    _fetched_ids.add(fotmob_id)
    log.info("Saved → %s", out_path)
    return out_path


# ══════════════════════════════════════════════════════════════════════════
# CONTINUOUS WATCHER
# ══════════════════════════════════════════════════════════════════════════

def watch_loop(fotmob_only: bool = False) -> None:
    """Poll FotMob every POLL_INTERVAL seconds for newly finished WC matches."""
    log.info("Watcher started. Polling every %ds for WC2026 matches …", POLL_INTERVAL)
    while True:
        try:
            matches = fotmob_fetch_wc_matches()
            for m in matches:
                status = m.get("status", {})
                # Only process matches that have finished
                if not status.get("finished", False):
                    continue
                mid = m.get("id")
                if mid and mid not in _fetched_ids:
                    # Check output file doesn't already exist
                    teams     = [m.get("home", {}), m.get("away", {})]
                    home_name = FOTMOB_NAME_OVERRIDES.get(teams[0].get("name", ""), teams[0].get("name", ""))
                    away_name = FOTMOB_NAME_OVERRIDES.get(teams[1].get("name", ""), teams[1].get("name", ""))
                    utc_time  = status.get("utcTime", "")
                    try:
                        date_str = datetime.fromisoformat(
                            utc_time.replace("Z", "+00:00")
                        ).strftime("%Y_%m_%d")
                    except Exception:
                        date_str = "*"
                    pattern = f"{date_str}_{home_name.replace(' ','_')}_vs_{away_name.replace(' ','_')}.json"
                    existing = list(MATCHES_DIR.glob(pattern))
                    if existing:
                        _fetched_ids.add(mid)
                        continue
                    log.info("New finished match: %s vs %s (id=%d)", home_name, away_name, mid)
                    fetch_and_save(mid, fotmob_only=fotmob_only, xml_match=m)

        except Exception as exc:
            log.error("Watch loop error: %s", exc)

        time.sleep(POLL_INTERVAL)


# ══════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="WC2026 Match Scraper")
    parser.add_argument("--fotmob-id", type=int,
                        help="Fetch a specific FotMob match ID and exit.")
    parser.add_argument("--fotmob-only", action="store_true",
                        help="Skip WhoScored (FotMob data only, no pass networks).")
    args = parser.parse_args()

    if args.fotmob_id:
        # Try to find the xml_match stub from today/yesterday's feed
        xml_stub = None
        try:
            all_matches = fotmob_fetch_wc_matches()
            xml_stub = next((m for m in all_matches if m.get("id") == args.fotmob_id), None)
        except Exception:
            pass
        path = fetch_and_save(args.fotmob_id, fotmob_only=args.fotmob_only, xml_match=xml_stub)
        sys.exit(0 if path else 1)
    else:
        watch_loop(fotmob_only=args.fotmob_only)


if __name__ == "__main__":
    main()
