"""
WC2026 catch-up runner.

Reads REMAINING_SCHEDULE.json, finds every match whose scrape time has
already passed, and processes the ones that don't yet have a JSON file.

Team names from the schedule are injected directly as a fallback so the
script works even when the FotMob XML feed returns 403.

Usage:
    py wc2026/catchup.py                # run all missed matches
    py wc2026/catchup.py --dry-run      # preview without running
    py wc2026/catchup.py --no-push      # render only, don't push to GitHub
"""

from __future__ import annotations

import sys
import json
import logging
import argparse
from datetime import datetime
from pathlib import Path

_REPO_ROOT   = Path(__file__).resolve().parents[1]
_MATCHES_DIR = _REPO_ROOT / "wc2026" / "matches"
_OUTPUT_DIR  = _REPO_ROOT / "wc2026" / "output"
_SCHEDULE    = _REPO_ROOT / "wc2026" / "REMAINING_SCHEDULE.json"

sys.path.insert(0, str(_REPO_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [CATCHUP] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("wc2026.catchup")


def _json_exists(home: str, away: str, date: str) -> bool:
    stem = (
        f"{date.replace('-', '_')}_"
        f"{home.replace(' ', '_')}_vs_{away.replace(' ', '_')}.json"
    )
    return (_MATCHES_DIR / stem).exists()


def _build_xml_stub(m: dict, date: str) -> dict:
    """Minimal xml_match stub so team names resolve when FotMob XML is unavailable."""
    return {
        "id":   m["fotmob_id"],
        "home": {"name": m["home"], "id": None},
        "away": {"name": m["away"], "id": None},
        "status": {
            "scoreStr": "0 - 0",
            "utcTime":  f"{date}T12:00:00+00:00",
            "finished": True,
        },
    }


def run_match(m: dict, date: str, do_push: bool) -> bool:
    from wc2026.scraper  import fetch_and_save
    from wc2026.renderer import render_wc_dashboard, output_filename
    from wc2026.git_ops  import push_png_to_xworldcuptwit

    fid  = m["fotmob_id"]
    home = m["home"]
    away = m["away"]

    log.info("Scraping  %s vs %s  (fotmob_id=%d) …", home, away, fid)
    xml_stub  = _build_xml_stub(m, date)
    json_path = fetch_and_save(fid, xml_match=xml_stub)

    if not json_path or not json_path.exists():
        log.error("Scrape failed for %s vs %s — skipping.", home, away)
        return False

    log.info("Rendering %s vs %s …", home, away)
    try:
        with open(json_path, encoding="utf-8") as fh:
            match_data = json.load(fh)

        _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        png_path = output_filename(match_data, str(_OUTPUT_DIR))
        render_wc_dashboard(match_data, png_path)
        log.info("PNG saved → %s", png_path)
    except Exception as exc:
        log.error("Render failed for %s vs %s: %s", home, away, exc)
        return False

    if do_push:
        try:
            url = push_png_to_xworldcuptwit(
                png_path,
                commit_message=f"[WC2026] {home} vs {away} analytics dashboard",
            )
            log.info("Pushed   → %s", url)
        except Exception as exc:
            log.error("Push failed (continuing): %s", exc)

    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="WC2026 catch-up runner")
    parser.add_argument("--dry-run",  action="store_true", help="Preview only.")
    parser.add_argument("--no-push",  action="store_true", help="Skip GitHub push.")
    args = parser.parse_args()

    schedule = json.loads(_SCHEDULE.read_text(encoding="utf-8"))
    now = datetime.now()

    pending = []
    for m in schedule:
        scrape_str = m.get("scrape_at_israel", "")
        try:
            scrape_at = datetime.strptime(scrape_str, "%Y-%m-%d %H:%M")
        except ValueError:
            continue

        if scrape_at > now:
            continue  # not due yet

        home = m["home"]
        away = m["away"]
        date = scrape_str[:10]

        if _json_exists(home, away, date):
            log.info("SKIP  %-30s (already scraped)", f"{home} vs {away}")
            continue

        pending.append((m, date))

    if not pending:
        log.info("All past matches already processed. Nothing to do.")
        return

    log.info("")
    log.info("Missed matches to process (%d):", len(pending))
    for m, date in pending:
        log.info("  → %s vs %s  [%s]", m["home"], m["away"], date)
    log.info("")

    if args.dry_run:
        log.info("Dry run – exiting without running.")
        return

    ok_count = fail_count = 0
    for m, date in pending:
        success = run_match(m, date, do_push=not args.no_push)
        if success:
            ok_count += 1
        else:
            fail_count += 1

    log.info("")
    log.info("Done. Success: %d  |  Failed: %d", ok_count, fail_count)
    if fail_count:
        log.info("Check wc2026/run_match.log for error details.")


if __name__ == "__main__":
    main()
