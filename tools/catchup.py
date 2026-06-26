"""
WC2026 catch-up sweep — the safety net that publishes any match the per-match
scheduled task failed to publish.

Reads REMAINING_SCHEDULE.json, finds every match whose scrape time has already
passed, and (re)processes any that don't yet have a *complete* scrape. A match
counts as incomplete if no JSON exists for its FotMob id, OR the JSON is still a
stub placeholder (null score and no events) — which is exactly what a crashed
per-match task leaves behind. Detection is by `match_id`, not filename, so it is
robust to play-off slot renaming (e.g. "European Play-Off D" → "Czechia").

Each pending match is handed to wc2026.run_match.run_match(), so it goes through
the same retry-enabled scrape + full-site push (push_match_update) as the live
per-match tasks — no divergent/obsolete push path.

Usage:
    py tools/catchup.py                # publish any missed/stub matches
    py tools/catchup.py --dry-run      # preview without running
    py tools/catchup.py --no-push      # render only, don't push to GitHub
"""

from __future__ import annotations

import sys
import json
import logging
import argparse
import unicodedata
from datetime import datetime
from pathlib import Path

_REPO_ROOT   = Path(__file__).resolve().parents[1]
_MATCHES_DIR = _REPO_ROOT / "wc2026" / "matches"
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


def _norm(s: str) -> str:
    """Lowercase, accent-stripped, separator-normalized name for comparison
    (so 'Türkiye' == 'Turkiye', 'Curaçao' == 'Curacao')."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip().lower().replace("-", " ").replace("_", " ")


def _is_real(d: dict) -> bool:
    """True only if the JSON holds an actually-scraped match, not the empty stub
    a crashed run leaves behind.

    IMPORTANT: a crashed WhoScored scrape still writes ``_sources=['fotmob']``
    and ``_scraped_at`` (the FotMob metadata step succeeds before the browser
    step fails), while leaving ``events: []`` and empty lineups. So those fields
    must NOT be used as the "real" signal — doing so made the sweep skip
    crash-stubs as "already published" and they vanished from the site. The only
    reliable evidence of a completed scrape is real event data or lineups."""
    if d.get("events"):
        return True
    home = d.get("home") or {}
    away = d.get("away") or {}
    return bool(home.get("players") or away.get("players"))


def _published_name_sets() -> set[frozenset]:
    """{frozenset(home,away)} for every *real* match JSON already on disk.

    Matching schedule entries against these team-name sets is robust to
    home/away order, kickoff-vs-scrape date drift, and play-off slot renaming
    (which we resolve via FOTMOB_NAME_OVERRIDES at the call site).
    """
    sigs: set[frozenset] = set()
    for path in _MATCHES_DIR.glob("*.json"):
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not _is_real(d):
            continue
        home = _norm((d.get("home") or {}).get("name", ""))
        away = _norm((d.get("away") or {}).get("name", ""))
        if home and away:
            sigs.add(frozenset((home, away)))
    return sigs


def main() -> None:
    parser = argparse.ArgumentParser(description="WC2026 catch-up sweep")
    parser.add_argument("--dry-run", action="store_true", help="Preview only.")
    parser.add_argument("--no-push", action="store_true", help="Skip GitHub push.")
    args = parser.parse_args()

    from wc2026.run_match import run_match  # retry-enabled scrape + full-site push
    from wc2026.scraper import FOTMOB_NAME_OVERRIDES  # play-off slot -> real team

    schedule  = json.loads(_SCHEDULE.read_text(encoding="utf-8"))
    now       = datetime.now()
    published = _published_name_sets()

    pending = []
    for m in schedule:
        scrape_str = m.get("scrape_at_israel", "")
        try:
            scrape_at = datetime.strptime(scrape_str, "%Y-%m-%d %H:%M")
        except ValueError:
            continue

        if scrape_at > now:
            continue  # not due yet

        home, away = m["home"], m["away"]
        # A match is "done" if a real file matches its raw names OR its play-off
        # resolved names (e.g. "European Play-Off D" vs Mexico -> Czechia vs Mexico).
        raw      = frozenset((_norm(home), _norm(away)))
        resolved = frozenset((_norm(FOTMOB_NAME_OVERRIDES.get(home, home)),
                              _norm(FOTMOB_NAME_OVERRIDES.get(away, away))))
        if raw in published or resolved in published:
            log.info("SKIP  %-34s (already published)", f"{home} vs {away}")
            continue

        pending.append(m)

    if not pending:
        log.info("All past matches already published. Nothing to do.")
        return

    log.info("")
    log.info("Missed / stub matches to publish (%d):", len(pending))
    for m in pending:
        log.info("  -> %s vs %s  (id=%d)", m["home"], m["away"], m["fotmob_id"])
    log.info("")

    if args.dry_run:
        log.info("Dry run - exiting without running.")
        return

    ok_count = fail_count = 0
    for m in pending:
        log.info("Publishing %s vs %s (id=%d) ...", m["home"], m["away"], m["fotmob_id"])
        try:
            success = run_match(
                fotmob_id=m["fotmob_id"],
                do_push=not args.no_push,
                do_whatsapp=False,
            )
        except Exception as exc:
            log.error("run_match crashed for id=%d: %s", m["fotmob_id"], exc)
            success = False
        if success:
            ok_count += 1
        else:
            fail_count += 1

    log.info("")
    log.info("Done. Published: %d  |  Failed: %d", ok_count, fail_count)
    if fail_count:
        log.info("Check wc2026/run_match.log for error details.")


if __name__ == "__main__":
    main()
