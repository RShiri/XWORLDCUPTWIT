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

# WhoScored World Cup 2026 competition URL base
WC2026_WS_BASE = os.environ.get(
    "WC2026_WHOSCORED_URL",
    "https://www.whoscored.com/Competitions/361/Matches",  # 361 = FIFA World Cup
)

_fetched_ids: set[int] = set()  # avoid re-fetching in the same run


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
        driver = uc.Chrome(options=options)
    except ImportError:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        options = Options()
        if os.environ.get("WC2026_VISIBLE") != "1":
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
        options.add_argument(
            "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
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


def _build_whoscored_url(home_name: str, away_name: str, ws_match_id: int | None) -> str | None:
    """Construct a WhoScored match URL from a known match ID."""
    if ws_match_id is None:
        return None
    h = re.sub(r"[^a-zA-Z0-9]", "-", home_name).strip("-")
    a = re.sub(r"[^a-zA-Z0-9]", "-", away_name).strip("-")
    return f"https://www.whoscored.com/Matches/{ws_match_id}/Live/World-Cup-2026-{h}-{a}"


def whoscored_search_match_id(home_name: str, away_name: str) -> int | None:
    """
    Search WhoScored WC2026 fixtures page for a specific match and return its ID.
    Uses Selenium since WhoScored is JS-rendered.
    """
    try:
        import undetected_chromedriver as uc
        options = uc.ChromeOptions()
        if os.environ.get("WC2026_VISIBLE") != "1":
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        driver = uc.Chrome(options=options)
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
        time.sleep(12)

        links = driver.find_elements("css selector", "a[href*='/Matches/']")
        for el in links:
            href  = el.get_attribute("href") or ""
            title = el.get_attribute("title") or el.text or ""
            h_hit = home_name.lower() in title.lower() or home_name.lower() in href.lower()
            a_hit = away_name.lower() in title.lower() or away_name.lower() in href.lower()
            if h_hit and a_hit:
                m = re.search(r"/Matches/(\d+)/", href)
                if m:
                    mid = int(m.group(1))
                    log.info("WhoScored: found match ID %d (%s)", mid, href)
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
        home_name = xml_match.get("home", {}).get("name", "Home")
        away_name = xml_match.get("away", {}).get("name", "Away")
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
        home_name = home_info.get("name", "Home")
        away_name = away_info.get("name", "Away")
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

    # Resolve team names: prefer FotMob JSON, fall back to XML match data
    if fm_data.get("_fotmob_unavailable") and xml_match:
        home_name = xml_match.get("home", {}).get("name", "Home")
        away_name = xml_match.get("away", {}).get("name", "Away")
    else:
        teams     = fm_data.get("header", {}).get("teams", [{}, {}])
        home_name = teams[0].get("name", "Home") if teams else "Home"
        away_name = teams[1].get("name", "Away") if len(teams) > 1 else "Away"

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
                    home_name = teams[0].get("name", "")
                    away_name = teams[1].get("name", "")
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
