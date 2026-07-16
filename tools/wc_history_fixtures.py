#!/usr/bin/env python3
"""Discover a historical World Cup's fixture list from FotMob's per-day matches feed.

    py tools/wc_history_fixtures.py 2022
    py tools/wc_history_fixtures.py 2018 --out history/wc2018/fixtures.json

Walks every day of the edition's window (editions.py) through the SAME
``fotmob_fetch_wc_matches(dates=…)`` the live pipeline uses (league id 77 covers
every World Cup edition; one HTTP call per day) and writes

    history/wc<year>/fixtures.json  = [{fotmob_id, home, away, date, utc}]

sorted by kickoff. The file is plain JSON on purpose: if an endpoint ever changes
shape, it can be hand-curated and the scrape runner won't care where it came from.
Needs network (FotMob) — run on a machine/runner with open egress.
"""
from __future__ import annotations

import os
import sys
import json
import argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "wc2026_dashboard"))

from editions import edition, date_strings  # noqa: E402


def discover(year: int) -> list:
    from wc2026.scraper import fotmob_fetch_wc_matches   # lazy: needs cloudscraper
    fixtures = fotmob_fetch_wc_matches(dates=date_strings(year)) or []
    rows = []
    for fx in fixtures:
        mid = fx.get("id")
        h = (fx.get("home") or {}).get("name") or ""
        a = (fx.get("away") or {}).get("name") or ""
        utc = ((fx.get("status") or {}).get("utcTime") or "")
        if not (mid and h and a):
            continue
        rows.append({
            "fotmob_id": int(mid),
            "home": h,
            "away": a,
            "date": utc[:10] or None,
            "utc": utc or None,
        })
    rows.sort(key=lambda r: (r["utc"] or "", r["fotmob_id"]))
    # de-dup by id, keep first
    seen, out = set(), []
    for r in rows:
        if r["fotmob_id"] in seen:
            continue
        seen.add(r["fotmob_id"])
        out.append(r)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Build history/wc<year>/fixtures.json from FotMob")
    ap.add_argument("year", type=int, choices=(2018, 2022))
    ap.add_argument("--out", default=None, help="output path (default history/wc<year>/fixtures.json)")
    args = ap.parse_args()

    ed = edition(args.year)
    out = args.out or os.path.join(ROOT, "history", f"wc{args.year}", "fixtures.json")
    rows = discover(args.year)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=1)

    exp = ed["expected_matches"]
    print(f"Wrote {out} — {len(rows)} fixtures (expected {exp})")
    if len(rows) != exp:
        print(f"WARNING: fixture count != {exp}. Inspect/curate the JSON before scraping "
              f"(duplicates, missing days, or a feed change).")
        return 2 if len(rows) < exp * 0.9 else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
