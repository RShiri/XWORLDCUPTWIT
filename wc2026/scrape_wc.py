"""
FIFA World Cup 2026 - WhoScored scraper (Barcelona-style, CAPTCHA-friendly).

Mirrors the proven Barcelona flow (fetch_single_match.py / pipeline.py):
navigate straight to a WhoScored match by its match ID, wait for the
`matchCentreData` blob (solving the Cloudflare CAPTCHA by hand in the visible
browser window), extract it, convert it into the wc2026 dashboard schema
(computing match_stats from the event stream), save the JSON, and render the
country-badge PNG.

This replaces the dead FotMob JSON API path. You run it locally because only a
real desktop session can clear WhoScored's Cloudflare challenge.

Usage:
  # Scrape one or more WhoScored match IDs (visible browser; solve CAPTCHA):
  py -m wc2026.scrape_wc --ws-id 1900001 1900002

  # Convert an already-saved raw matchCentreData cache (no browser, no CAPTCHA):
  py -m wc2026.scrape_wc --from-cache path/to/match_123_cache.json --stage "Group I"

  # Skip rendering (JSON only):
  py -m wc2026.scrape_wc --ws-id 1900001 --no-render
"""

from __future__ import annotations

import os
import sys
import json
import time
import math
import logging
import argparse
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

log = logging.getLogger("wc2026.scrape_wc")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [WC-SCRAPE] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

MATCHES_DIR = _REPO_ROOT / "wc2026" / "matches"
OUTPUT_DIR  = _REPO_ROOT / "wc2026" / "output"
MATCHES_DIR.mkdir(parents=True, exist_ok=True)

SHOT_TYPES = {"MissedShots", "SavedShot", "ShotOnPost", "Goal"}

# WhoScored FIFA World Cup 2026 identifiers (Region 247 / Tournament 36)
WC_SEASON = "10498"
WC_STAGE  = "25505"
WC_FIXTURES_URL = (
    f"https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/{WC_SEASON}"
    f"/Stages/{WC_STAGE}/Fixtures/International-FIFA-World-Cup-2026"
)

# WhoScored team name -> badge filename / nicer display name
TEAM_ALIASES = {
    "Cabo Verde":          "Cape Verde",
    "Republic of Korea":   "South Korea",
    "Korea Republic":      "South Korea",
    "IR Iran":             "Iran",
    "United States":       "USA",
}


def _canon_team(name: str) -> str:
    return TEAM_ALIASES.get(name, name)


# ══════════════════════════════════════════════════════════════════════════
# STATS COMPUTATION (from the WhoScored event stream)
# ══════════════════════════════════════════════════════════════════════════

def _ws_to_sb(x: float, y: float) -> tuple[float, float]:
    """Cheap linear WhoScored(0-100) -> StatsBomb(120x80) for xG geometry only."""
    return x * 1.2, 80.0 - y * 0.8


def _estimate_xg(x: float, y: float, quals: set[str]) -> float:
    """Geometry-based xG estimate matching the Barcelona wc_dashboard model."""
    sb_x, sb_y = _ws_to_sb(x, y)
    dx, dy = 120.0 - sb_x, 40.0 - sb_y
    dist = max(math.hypot(dx, dy), 0.5)
    angle = math.atan2(4.0, dist)
    xg = (angle / (math.pi / 2)) * (1.0 / (1.0 + dist / 30.0))
    if "Head" in quals:
        xg *= 0.4
    if "BigChance" in quals or "BigChanceCreated" in quals:
        xg = min(0.65, max(0.35, xg * 3.5))
    if "Penalty" in quals:
        xg = 0.76
    if dist > 18:
        xg *= (18.0 / dist) ** 2
    return round(min(max(xg, 0.01), 0.95), 3)


def _quals(ev: dict) -> set[str]:
    return {q.get("type", {}).get("displayName", "") for q in ev.get("qualifiers", [])}


def compute_match_stats(events: list[dict], home_id, away_id) -> dict:
    """Compute the flat match_stats dict the wc2026 renderer reads."""
    out: dict = {}

    def team_block(tid):
        evs = [e for e in events if e.get("teamId") == tid]
        passes = [e for e in evs if e.get("type", {}).get("displayName") == "Pass"]
        acc = [e for e in passes if e.get("outcomeType", {}).get("displayName") == "Successful"]
        shots = [e for e in evs if e.get("type", {}).get("displayName") in SHOT_TYPES]
        sot = [e for e in shots if e.get("type", {}).get("displayName") in ("SavedShot", "Goal")]
        xg = sum(_estimate_xg(e.get("x", 50), e.get("y", 50), _quals(e)) for e in shots)
        bcc = sum(1 for e in evs if "BigChanceCreated" in _quals(e))
        bcm = sum(1 for e in shots
                  if "BigChance" in _quals(e)
                  and e.get("type", {}).get("displayName") != "Goal")
        saves = sum(1 for e in evs if e.get("type", {}).get("displayName") == "Save")
        fouls = sum(1 for e in evs
                    if e.get("type", {}).get("displayName") == "Foul"
                    and e.get("outcomeType", {}).get("displayName") == "Unsuccessful")
        duels = [e for e in evs if e.get("type", {}).get("displayName") in ("Aerial", "Tackle", "TakeOn")]
        duels_won = [e for e in duels if e.get("outcomeType", {}).get("displayName") == "Successful"]
        duel_pct = round(100 * len(duels_won) / len(duels)) if duels else 0
        return {
            "passes": len(passes),
            "pass_accuracy": round(100 * len(acc) / len(passes)) if passes else 0,
            "shots": len(shots),
            "shots_on_target": len(sot),
            "xg": round(xg, 2),
            "big_chances_created": bcc,
            "big_chances_missed": bcm,
            "saves": saves,
            "fouls": fouls,
            "duels_won": duel_pct,
        }

    h = team_block(home_id)
    a = team_block(away_id)

    # Possession proxy = pass share
    tot = (h["passes"] + a["passes"]) or 1
    h_poss = round(100 * h["passes"] / tot)
    pairs = {**{f"{k}_home": v for k, v in h.items()},
             **{f"{k}_away": v for k, v in a.items()}}
    pairs["possession_home"] = h_poss
    pairs["possession_away"] = 100 - h_poss
    # Also expose passes_total / passes_accuracy aliases the renderer prefers
    pairs["passes_total_home"] = h["passes"]
    pairs["passes_total_away"] = a["passes"]
    pairs["passes_accuracy_home"] = h["pass_accuracy"]
    pairs["passes_accuracy_away"] = a["pass_accuracy"]
    out.update(pairs)
    return out


# ══════════════════════════════════════════════════════════════════════════
# CONVERTER: raw WhoScored matchCentreData  ->  wc2026 schema
# ══════════════════════════════════════════════════════════════════════════

def whoscored_to_wc2026(mcd: dict, *, stage: str = "Group Stage",
                        competition: str = "FIFA World Cup 2026") -> dict:
    """
    Convert a raw WhoScored matchCentreData dict into the wc2026 dashboard schema.
    Events are passed through unchanged (renderer expects raw WhoScored coords).
    """
    home = mcd.get("home", {})
    away = mcd.get("away", {})
    events = mcd.get("events", [])

    h_id = home.get("teamId")
    a_id = away.get("teamId")
    home_name = _canon_team(home.get("name", "Home"))
    away_name = _canon_team(away.get("name", "Away"))

    def players(side):
        out = []
        for p in side.get("players", []):
            out.append({
                "playerId":      p.get("playerId"),
                "name":          p.get("name", ""),
                "shirtNo":       p.get("shirtNo", 0),
                "position":      p.get("position", ""),
                "isFirstEleven": bool(p.get("isFirstEleven", False)),
                "stats":         {},
            })
        return out

    h_score = home.get("scores", {}).get("fulltime", home.get("scores", {}).get("running", 0)) or 0
    a_score = away.get("scores", {}).get("fulltime", away.get("scores", {}).get("running", 0)) or 0

    date_str = str(mcd.get("startDate", mcd.get("startTime", "")))[:10]

    return {
        "matchId": mcd.get("matchId", 0),
        "wc_metadata": {
            "stage":   mcd.get("_competition", stage),
            "venue":   mcd.get("venueName", ""),
            "city":    "",
            "country": "United States",
            "date":    date_str,
            "competition": competition,
        },
        "home": {
            "teamId": h_id, "name": home_name,
            "score": h_score, "penalty_score": None,
            "players": players(home), "stats": {}, "field": "home",
        },
        "away": {
            "teamId": a_id, "name": away_name,
            "score": a_score, "penalty_score": None,
            "players": players(away), "stats": {}, "field": "away",
        },
        "events": events,
        "match_stats": compute_match_stats(events, h_id, a_id),
    }


# ══════════════════════════════════════════════════════════════════════════
# SCRAPE via cloudscraper (bypasses Cloudflare - no browser, no CAPTCHA)
# ══════════════════════════════════════════════════════════════════════════

_SCRAPER = None

def _scraper():
    global _SCRAPER
    if _SCRAPER is None:
        import cloudscraper
        _SCRAPER = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True}
        )
    return _SCRAPER


def scrape_whoscored_match(ws_id: str) -> dict | None:
    """
    Fetch a WhoScored match by ID via Selenium (to bypass Cloudflare) and extract matchCentreData.
    """
    from wc2026.scraper import whoscored_fetch_match
    url = f"https://www.whoscored.com/Matches/{ws_id}/Live/x"
    log.info("Fetching match %s via Selenium ...", ws_id)
    try:
        data = whoscored_fetch_match(url, timeout=40)
        if not data:
            log.error("  Failed to fetch or parse WhoScored data for match %s", ws_id)
            return None
        data["matchId"] = int(ws_id)
        log.info("  OK: %s %s-%s %s (%d events)",
                 data.get("home", {}).get("name"),
                 data.get("home", {}).get("scores", {}).get("fulltime"),
                 data.get("away", {}).get("scores", {}).get("fulltime"),
                 data.get("away", {}).get("name"),
                 len(data.get("events", [])))
        return data
    except Exception as exc:
        log.error("  scrape error (id=%s): %s", ws_id, exc)
        return None


def discover_fixtures() -> dict:
    """
    Scrape the WhoScored WC2026 fixtures page and return
    {match_id: {"slug": str, "played": bool, "home_score": int, "away_score": int}}.
    """
    import re
    log.info("Discovering WC2026 fixtures from WhoScored ...")
    h = _scraper().get(WC_FIXTURES_URL, timeout=30).text
    games: dict = {}
    # Played matches carry a score (two <span> values) on the scoresBtn anchor
    for mid, slug, hs, a in re.findall(
        r'scoresBtn-(\d+)"[^>]*href="/matches/\d+/live/'
        r'international-fifa-world-cup-2026-([a-z0-9-]+)"><span>(\d+)</span><span>(\d+)</span>', h):
        games[mid] = {"slug": slug, "played": True,
                      "home_score": int(hs), "away_score": int(a)}
    # All listed matches (played + scheduled)
    for mid, slug in re.findall(
        r'/matches/(\d+)/live/international-fifa-world-cup-2026-([a-z0-9-]+)', h):
        games.setdefault(mid, {"slug": slug, "played": False})
    played = sum(1 for g in games.values() if g["played"])
    log.info("Discovered %d fixtures (%d played).", len(games), played)
    return games


# ══════════════════════════════════════════════════════════════════════════
# SAVE + RENDER
# ══════════════════════════════════════════════════════════════════════════

def _save_and_render(wc_json: dict, raw_mcd: dict | None, render: bool) -> Path:
    home = wc_json["home"]["name"].replace(" ", "_")
    away = wc_json["away"]["name"].replace(" ", "_")
    date = wc_json["wc_metadata"]["date"].replace("-", "_") or "2026"
    base = f"{date}_{home}_vs_{away}"

    json_path = MATCHES_DIR / f"{base}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(wc_json, fh, indent=2, ensure_ascii=False)
    log.info("Saved JSON -> %s", json_path)

    # Also keep the raw cache for re-processing if we scraped it live
    if raw_mcd is not None:
        cache = MATCHES_DIR / f"match_{wc_json.get('matchId', base)}_cache.json"
        with open(cache, "w", encoding="utf-8") as fh:
            json.dump(raw_mcd, fh, ensure_ascii=False)

    if render:
        from wc2026.renderer import render_wc_dashboard, output_filename
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        png = output_filename(wc_json, str(OUTPUT_DIR))
        render_wc_dashboard(wc_json, png)
        log.info("Rendered PNG (with country badges) -> %s", png)
    return json_path


def main() -> None:
    p = argparse.ArgumentParser(description="WC2026 WhoScored scraper + renderer")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--ws-id", nargs="+", help="WhoScored match ID(s) to scrape")
    src.add_argument("--from-cache", help="Convert an existing raw matchCentreData JSON")
    src.add_argument("--all-played", action="store_true",
                     help="Auto-discover and scrape EVERY played WC2026 game")
    src.add_argument("--discover", action="store_true",
                     help="Just list discovered fixtures and exit")
    p.add_argument("--stage", default="Group Stage", help="Tournament stage label")
    p.add_argument("--no-render", action="store_true", help="Save JSON only, skip PNG")
    args = p.parse_args()

    render = not args.no_render

    if args.discover:
        games = discover_fixtures()
        for mid, g in sorted(games.items(), key=lambda x: int(x[0])):
            sc = f"{g.get('home_score')}-{g.get('away_score')}" if g["played"] else "scheduled"
            print(f"  {mid}  {g['slug']:42s} {sc}")
        return

    if args.from_cache:
        with open(args.from_cache, encoding="utf-8") as fh:
            mcd = json.load(fh)
        wc = whoscored_to_wc2026(mcd, stage=args.stage)
        _save_and_render(wc, None, render)
        return

    if args.all_played:
        games = discover_fixtures()
        ids = [m for m, g in games.items() if g["played"]]
    else:
        ids = args.ws_id

    ok = 0
    for wid in ids:
        mcd = scrape_whoscored_match(wid)
        if not mcd:
            log.warning("Skipping id=%s (no data)", wid)
            continue
        wc = whoscored_to_wc2026(mcd, stage=args.stage)
        _save_and_render(wc, mcd, render)
        ok += 1
        time.sleep(2)  # be polite between matches
    log.info("Done. %d/%d matches processed.", ok, len(ids))


if __name__ == "__main__":
    main()
