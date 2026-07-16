#!/usr/bin/env python3
"""Backfill a whole historical World Cup (2018 / 2022) through the live scrape pipeline.

    py tools/scrape_history.py 2022                 # scrape everything missing
    py tools/scrape_history.py 2022 --max 3         # smoke run (Cloudflare check)
    py tools/scrape_history.py 2022 --fotmob-only   # degraded: stats/xG, no event stream
    py tools/scrape_history.py 2022 --dry-run       # plan only, no network
    py tools/scrape_history.py 2022 --pack          # zip raws for Release upload, no scrape

Reads history/wc<year>/fixtures.json (tools/wc_history_fixtures.py), then for each
fixture calls the SAME ``scraper.fetch_and_save`` the live pipeline uses — an
``xml_match`` stub with the real team names + date drives the WhoScored search
exactly like the 2026 knockout self-heal path — forcing output into
history/wc<year>/matches/YYYY_MM_DD_Home_vs_Away.json.

Resumable by design: a match whose file already looks REAL (has an event stream)
is skipped, and a file scraped earlier without events (e.g. WhoScored blocked on a
datacenter IP) is retried, so a partial Actions run can be finished from a home PC
with the identical command. Writes history/wc<year>/scrape_report.json either way.

Raw outputs are git-ignored (repo-size policy in ROADMAP.md) — publish the ``--pack``
zip as a GitHub Release / Actions artifact instead of committing it.
"""
from __future__ import annotations

import os
import sys
import json
import time
import argparse
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "wc2026_dashboard"))

from editions import edition  # noqa: E402

PAUSE_BETWEEN = 8  # seconds between matches: politeness + lets the uc driver settle


def _slug(name: str) -> str:
    return "".join(c if (c.isalnum() or c in " -") else "" for c in name).strip().replace(" ", "_")


def out_path_for(year: int, fx: dict) -> Path:
    date = (fx.get("date") or "0000-00-00").replace("-", "_")
    return Path(edition(year)["match_dir"]) / f"{date}_{_slug(fx['home'])}_vs_{_slug(fx['away'])}.json"


def is_real(path: Path) -> bool:
    """True when the file holds a full scrape (event stream present) — same idea as
    tools/catchup.py: a crash/fotmob-only stub must be retried, not treated as done."""
    if not path.exists():
        return False
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:
        return False
    return bool(d.get("events")) and d.get("home", {}).get("score") is not None


def xml_stub(fx: dict) -> dict:
    return {
        "id": fx["fotmob_id"],
        "home": {"name": fx["home"], "id": None},
        "away": {"name": fx["away"], "id": None},
        "status": {
            "scoreStr": "0 - 0",
            "utcTime": fx.get("utc") or (f"{fx.get('date')}T12:00:00+00:00" if fx.get("date") else ""),
            "finished": True,
        },
    }


def pack(year: int) -> Path:
    ed = edition(year)
    mdir = Path(ed["match_dir"])
    zpath = mdir.parent / f"wc{year}-raw.zip"
    files = sorted(mdir.glob("*.json"))
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, arcname=f"wc{year}/matches/{f.name}")
        fj = mdir.parent / "fixtures.json"
        if fj.exists():
            z.write(fj, arcname=f"wc{year}/fixtures.json")
    print(f"Packed {len(files)} match files -> {zpath} ({zpath.stat().st_size/1e6:.1f} MB)")
    return zpath


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill a historical World Cup via the live scraper")
    ap.add_argument("year", type=int, choices=(2018, 2022))
    ap.add_argument("--max", type=int, default=None, help="scrape at most N missing matches (smoke run)")
    ap.add_argument("--fotmob-only", action="store_true", help="skip WhoScored (no event stream)")
    ap.add_argument("--dry-run", action="store_true", help="plan only — no network, nothing written")
    ap.add_argument("--pack", action="store_true", help="zip raws + fixtures for upload, then exit")
    args = ap.parse_args()

    ed = edition(args.year)
    if args.pack:
        pack(args.year)
        return 0

    fixtures_file = Path(ed["match_dir"]).parent / "fixtures.json"
    if not fixtures_file.exists():
        print(f"Missing {fixtures_file} — run: py tools/wc_history_fixtures.py {args.year}")
        return 1
    fixtures = json.load(open(fixtures_file, encoding="utf-8"))
    todo = [fx for fx in fixtures if not is_real(out_path_for(args.year, fx))]
    done_already = len(fixtures) - len(todo)
    if args.max is not None:
        todo = todo[: args.max]
    print(f"{ed['name']}: {len(fixtures)} fixtures · {done_already} already complete · "
          f"{len(todo)} to scrape{' (dry run)' if args.dry_run else ''}")

    if args.dry_run:
        for fx in todo:
            print(f"  would scrape {fx['fotmob_id']}  {fx.get('date')}  {fx['home']} vs {fx['away']}"
                  f"  -> {out_path_for(args.year, fx)}")
        return 0

    os.makedirs(ed["match_dir"], exist_ok=True)
    os.environ.setdefault("SOFASCORE_FALLBACK", "1")

    # Lazy imports: everything above (dry-run/pack/resume math) works without scrape deps.
    from wc2026.scraper import fetch_and_save
    try:
        from wc2026._runlock import scrape_lock
    except Exception:                                    # pragma: no cover
        from contextlib import nullcontext as scrape_lock

    report = {"year": args.year, "ok": [], "no_events": [], "failed": []}
    with scrape_lock():
        for i, fx in enumerate(todo, 1):
            label = f"{fx['home']} vs {fx['away']} ({fx.get('date')}, id {fx['fotmob_id']})"
            out = out_path_for(args.year, fx)
            print(f"[{i}/{len(todo)}] {label}")
            try:
                saved = fetch_and_save(fx["fotmob_id"], fotmob_only=args.fotmob_only,
                                       xml_match=xml_stub(fx), out_path=out)
                if saved and is_real(Path(saved)):
                    report["ok"].append(label)
                elif saved:
                    report["no_events"].append(label)    # WhoScored blocked/miss — retryable
                else:
                    report["failed"].append(label)
            except Exception as exc:                     # keep sweeping; rerun retries it
                print(f"    FAILED: {exc}")
                report["failed"].append(f"{label} — {exc}")
            if i < len(todo):
                time.sleep(PAUSE_BETWEEN)

    rpt = Path(ed["match_dir"]).parent / "scrape_report.json"
    json.dump(report, open(rpt, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nDone: {len(report['ok'])} full · {len(report['no_events'])} without events "
          f"(retryable) · {len(report['failed'])} failed — report: {rpt}")
    print("Re-running the same command retries anything not yet complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
