"""
wc2026/patch_ws_players.py

Re-scrape WhoScored for all FotMob-only match JSONs to add player ratings.

For each match JSON whose starters have no rating data this script:
  1. Finds the WhoScored match ID (from whoscored_ids.json cache, or by
     searching the competition page as a fallback).
  2. Scrapes the WhoScored match page with Selenium.
  3. Replaces the players and events in the JSON with WhoScored data
     (which includes per-player ratings and a rich event stream for pass
     networks, shot maps, etc.).
  4. Keeps all existing FotMob match_stats (xG, big_chances, duels_won,
     passes, fouls, saves — the "official" aggregate figures).

Usage:
  python -m wc2026.patch_ws_players
  python -m wc2026.patch_ws_players --match 2026_06_11_Mexico_vs_South_Africa.json
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(_REPO_ROOT / ".env", override=False)
except ImportError:
    pass

from wc2026.scraper import (
    whoscored_fetch_match,
    whoscored_search_match_id,
    _build_whoscored_url,
    _ws_cache_lookup,
)

log = logging.getLogger("wc2026.patch_ws")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [PATCH] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

MATCHES_DIR = Path(__file__).parent / "matches"
WS_IDS_FILE = Path(__file__).parent / "whoscored_ids.json"


def _has_ratings(md: dict) -> bool:
    for side in ("home", "away"):
        for p in md.get(side, {}).get("players", []):
            if p.get("isFirstEleven") and p.get("stats", {}).get("ratings"):
                return True
    return False


def _find_ws_id_and_slug(home: str, away: str) -> tuple[int, str] | tuple[None, None]:
    ws_cache: dict = {}
    if WS_IDS_FILE.exists():
        try:
            ws_cache = json.loads(WS_IDS_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("Could not read whoscored_ids.json: %s", exc)

    ws_id = _ws_cache_lookup(home, away)
    if ws_id:
        entry = ws_cache.get(str(ws_id), {})
        return ws_id, entry.get("slug", "")

    log.info("Cache miss for %s vs %s — searching competition page…", home, away)
    ws_id = whoscored_search_match_id(home, away)
    if ws_id:
        entry = ws_cache.get(str(ws_id), {})
        return ws_id, entry.get("slug", "")

    return None, None


def patch_match(json_path: Path, force: bool = False) -> bool:
    with open(json_path, encoding="utf-8") as f:
        md = json.load(f)

    home = md.get("home", {}).get("name", "")
    away = md.get("away", {}).get("name", "")

    if not force and _has_ratings(md):
        log.info("SKIP  %s — already has ratings", json_path.name)
        return True

    log.info("PATCH %s vs %s …", home, away)

    ws_id, slug = _find_ws_id_and_slug(home, away)
    if not ws_id:
        log.warning("No WhoScored ID found for %s vs %s — skipping.", home, away)
        return False

    ws_url = _build_whoscored_url(home, away, ws_id)
    log.info("Scraping: %s", ws_url)

    ws_data = whoscored_fetch_match(ws_url)
    if not ws_data or not ws_data.get("events"):
        log.error("WhoScored returned no data for %s vs %s", home, away)
        return False

    ws_home = ws_data.get("home", {})
    ws_away = ws_data.get("away", {})

    if ws_home.get("players"):
        md["home"]["players"] = ws_home["players"]
    if ws_away.get("players"):
        md["away"]["players"] = ws_away["players"]

    md["events"] = ws_data["events"]

    if ws_home.get("teamId"):
        md["home"]["teamId"] = ws_home["teamId"]
    if ws_away.get("teamId"):
        md["away"]["teamId"] = ws_away["teamId"]

    ws_h_score = ws_home.get("scores", {}).get("fulltime")
    ws_a_score = ws_away.get("scores", {}).get("fulltime")
    if ws_h_score is not None:
        md["home"]["scores"] = {"fulltime": int(ws_h_score)}
    if ws_a_score is not None:
        md["away"]["scores"] = {"fulltime": int(ws_a_score)}

    sources = md.get("_sources", ["fotmob"])
    if "whoscored" not in sources:
        sources.append("whoscored")
    md["_sources"] = sources

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(md, f, indent=2, ensure_ascii=False)

    starters = [p for p in ws_home.get("players", []) if p.get("isFirstEleven")]
    rated    = [p for p in starters if p.get("stats", {}).get("ratings")]
    log.info("Saved %s — %d/%d starters have ratings", json_path.name, len(rated), len(starters))
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Patch match JSONs with WhoScored player ratings.")
    ap.add_argument("--match", metavar="FILE", help="Patch only this filename (basename).")
    ap.add_argument("--force", action="store_true", help="Re-patch even if ratings already present.")
    ap.add_argument("--delay", type=float, default=5.0,
                    help="Seconds to wait between matches (default 5).")
    args = ap.parse_args()

    if args.match:
        files = [MATCHES_DIR / args.match]
    else:
        files = sorted(
            f for f in MATCHES_DIR.glob("2026_*.json")
            if not f.name.endswith("_cache.json")
        )

    ok = fail = 0
    for f in files:
        if not f.exists():
            log.error("File not found: %s", f)
            fail += 1
            continue
        try:
            result = patch_match(f, force=args.force)
            if result:
                ok += 1
            else:
                fail += 1
        except Exception as exc:
            log.error("Exception while patching %s: %s", f.name, exc, exc_info=True)
            fail += 1

        if args.match:
            break
        time.sleep(args.delay)

    log.info("Done: %d patched/skipped, %d failed", ok, fail)


if __name__ == "__main__":
    main()
