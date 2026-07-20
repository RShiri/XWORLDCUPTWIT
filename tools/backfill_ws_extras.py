#!/usr/bin/env python3
"""Backfill WhoScored extras (formations, managers, referee) into already-scraped
match JSONs.

One-time catch-up for matches scraped before 2026-07-20, when the pipeline started
carrying these fields (scraper.extract_ws_extras → build_match_json). For every
wc2026/matches/*.json that has a real WhoScored event stream but no formations yet,
this re-opens the match on WhoScored (id from the whoscored_ids.json cache, Selenium
search as fallback — the same machinery the nightly scraper uses), re-reads
matchCentreData and patches ONLY the new fields in place:

    wc_metadata.referee
    home/away.manager
    home/away.formations   [{name, captain, start, end}]

Events, players, stats and everything else in the file stay byte-identical, so the
dashboards rebuilt from these files can only gain the new info.

Run from repo root ON THE SCRAPE PC (WhoScored is Cloudflare-fronted — this needs
the same Chrome/undetected-chromedriver setup the nightly pipeline uses; it will
not work from a datacenter/cloud host):

    py tools/backfill_ws_extras.py                # everything missing extras
    py tools/backfill_ws_extras.py --limit 5      # careful first run
    py tools/backfill_ws_extras.py --only 2026_06_16_France_vs_Senegal
    py tools/backfill_ws_extras.py --rebuild      # rebuild dashboard data after

Safe to interrupt and re-run: already-patched files are skipped, so a stopped run
just continues where it left off. Takes ~40s per match (page-load wait), so the
full 100+ match history is an overnight job. Holds the scrape lock so it can't
collide with a scheduled match task.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from wc2026 import scraper                      # noqa: E402
from wc2026._runlock import scrape_lock         # noqa: E402

MATCH_DIR = ROOT / "wc2026" / "matches"


def needs_backfill(d: dict) -> bool:
    """True when the file has a real WhoScored stream but no formations yet."""
    if not scraper.has_whoscored_stream(d):
        return False
    return not (d.get("home", {}).get("formations") or d.get("away", {}).get("formations"))


def resolve_ws_id(d: dict) -> int | None:
    """WhoScored match id via the slug cache, else the Selenium search."""
    home = d.get("home", {}).get("name", "")
    away = d.get("away", {}).get("name", "")
    ws_id = scraper._ws_cache_lookup(home, away)
    if ws_id:
        return ws_id
    return scraper.whoscored_search_match_id(home, away)


def patch_file(path: Path, force: bool = False) -> str:
    d = json.loads(path.read_text(encoding="utf-8"))
    if not scraper.has_whoscored_stream(d):
        return "skip (no WhoScored stream — nothing to backfill from)"
    if not force and not needs_backfill(d):
        return "skip (already has extras)"

    ws_id = resolve_ws_id(d)
    if not ws_id:
        return "FAIL (could not resolve WhoScored match id)"
    url = scraper._build_whoscored_url(d["home"]["name"], d["away"]["name"], ws_id)
    ws = scraper.whoscored_fetch_match(url)
    if not ws or not ws.get("events"):
        return "FAIL (matchCentreData fetch returned nothing)"

    # Guard against the search landing on the wrong fixture: the stored teamIds
    # CAME from WhoScored (has_whoscored_stream is true), so they must match.
    got = {ws.get("home", {}).get("teamId"), ws.get("away", {}).get("teamId")}
    want = {d.get("home", {}).get("teamId"), d.get("away", {}).get("teamId")}
    if got != want:
        return "FAIL (teamId mismatch %s vs %s — wrong match?)" % (got, want)

    ex = scraper.extract_ws_extras(ws)
    d.setdefault("wc_metadata", {})["referee"] = ex["referee"]
    d["home"]["manager"], d["home"]["formations"] = ex["home_manager"], ex["home_formations"]
    d["away"]["manager"], d["away"]["formations"] = ex["away_manager"], ex["away_formations"]

    with path.open("w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=2)
    forms = "/".join(f["name"] for f in ex["home_formations"][:1] + ex["away_formations"][:1]) or "?"
    return "patched (%s · ref: %s)" % (forms, ex["referee"] or "?")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="single match id (file stem) to backfill")
    ap.add_argument("--limit", type=int, default=0, help="stop after N patched matches")
    ap.add_argument("--force", action="store_true", help="re-patch files that already have extras")
    ap.add_argument("--sleep", type=float, default=5.0, help="pause between matches (seconds)")
    ap.add_argument("--rebuild", action="store_true",
                    help="rebuild all dashboard data afterwards (build_site.py)")
    args = ap.parse_args()

    files = sorted(MATCH_DIR.glob("*.json"))
    if args.only:
        files = [f for f in files if f.stem == args.only]
        if not files:
            sys.exit("no match file named %s" % args.only)

    done = failed = 0
    with scrape_lock():
        for i, path in enumerate(files):
            d = json.loads(path.read_text(encoding="utf-8"))
            if not args.force and not needs_backfill(d):
                continue
            if args.limit and done >= args.limit:
                break
            print("[%d/%d] %s …" % (i + 1, len(files), path.stem), flush=True)
            try:
                msg = patch_file(path, force=args.force)
            except Exception as exc:            # keep sweeping; re-run picks it up
                msg = "FAIL (%s)" % exc
            print("   ", msg, flush=True)
            if msg.startswith("patched"):
                done += 1
            elif msg.startswith("FAIL"):
                failed += 1
            time.sleep(args.sleep)

    print("\nbackfilled %d match(es), %d failed (re-run to retry failures)" % (done, failed))
    if args.rebuild and done:
        print("rebuilding dashboard data …", flush=True)
        subprocess.run([sys.executable, str(ROOT / "wc2026_dashboard" / "build_site.py")],
                       check=False)


if __name__ == "__main__":
    main()
