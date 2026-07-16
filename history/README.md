# `history/` — raw historical scrape data

This directory holds the **raw** scraped match data for historical World Cup editions
(2018, 2022) backfilled via `tools/wc_history_fixtures.py` + `tools/scrape_history.py`.
It is **git-ignored** (this README is the one tracked exception — see `.gitignore`):
raw match JSONs are never committed to the repo. 2026's raws already weigh ~2 MB/game
(213 MB for 104 games); two more 64-game editions at the same density would add
~260 MB to a repo already carrying a lot of PNG/database history. Instead, raws are
archived as a **zipped GitHub Release asset** (`wc<year>-raw`) so they're reproducible
without bloating every future `git clone`.

Only the **generated** dashboard data built from these raws — `wc2026_dashboard/
editions/<year>/` (see that directory's own README) — gets committed.

## Layout

```
history/
  wc2022/
    fixtures.json          # [{fotmob_id, home, away, date, utc}] — 64 rows, one per match
    scrape_report.json      # last run's {ok: [...], no_events: [...], failed: [...]}
    wc2022-raw.zip           # produced by `--pack`; uploaded to the wc2022-raw Release
    matches/
      2022_11_20_Qatar_vs_Ecuador.json
      2022_11_21_England_vs_Iran.json
      …                      # one file per match, same schema as wc2026/matches/*.json
  wc2018/
    fixtures.json
    scrape_report.json
    wc2018-raw.zip
    matches/
      2018_06_14_Russia_vs_Saudi_Arabia.json
      …
```

## `fixtures.json`

The edition's full fixture list, discovered from FotMob's per-day matches feed
(`tools/wc_history_fixtures.py <year>`) — one row per match, sorted by kickoff:

```json
{"fotmob_id": 3370549, "home": "Qatar", "away": "Ecuador", "date": "2022-11-20", "utc": "2022-11-20T16:00:00Z"}
```

Plain JSON on purpose: if FotMob's feed ever changes shape, this file is easy to
hand-curate without touching the discovery script.

## `matches/<date>_<Home>_vs_<Away>.json`

One file per match, produced by the **same** `wc2026.scraper.fetch_and_save()` the
live 2026 pipeline uses — a historical scrape is not a different code path, just a
different `--edition` pointed at a different match directory (see `editions.py`).
Top-level shape (verified against a real scraped 2022 file):

```json
{
  "matchId": 3370549,
  "wc_metadata": {
    "stage": "World Cup Grp. A",
    "venue": "Al Bayt Stadium", "city": "Al-Khor", "country": "Qatar",
    "date": "2022-11-20", "attendance": null
  },
  "home": {"teamId": 2379, "name": "Qatar", "score": 0, "penalty_score": null,
            "players": [ /* WhoScored per-player stats + ratings */ ], "stats": {}, "field": {}},
  "away": { /* same shape */ },
  "events": [ /* full WhoScored event stream — shots, passes, cards, subs, … */ ],
  "match_stats": { /* merged FotMob+WhoScored team stats, multi-source averaged */ },
  "stats_by_source": {"fotmob": {}, "whoscored": {}},
  "playerIdNameDictionary": {},
  "_scraped_at": "2026-07-16T06:41:34+00:00",
  "_sources": ["fotmob", "whoscored"]
}
```

**Known gotcha (fixed in `wc2026_dashboard/editions.py::resolve_stage`)**: for 2022,
FotMob's own `wc_metadata.stage` is USELESS for the knockout rounds — every R16/QF/
SF/3rd-place match reports the identical generic "World Cup Final Stage", and the
Final itself reports just "World Cup" (no round word at all). The dashboard builders
override this with a curated date-range table, not the raw file's own `stage` field —
don't "fix" a builder to trust `stage` directly for 2022 knockout matches, it's wrong
at the source. 2018 is unaffected (FotMob gives it distinct per-round labels).

## Regenerating

```
py tools/wc_history_fixtures.py 2022        # build fixtures.json (needs network)
py tools/scrape_history.py 2022             # scrape everything missing (resumable)
py tools/scrape_history.py 2022 --pack      # zip raws + fixtures.json for Release upload
```

Resumable by design — a match whose file already has a real event stream is skipped;
re-running the same command only retries what's missing/incomplete. Must run on a
machine with a residential IP: WhoScored's Cloudflare protection blocks datacenter
runners (verified — GitHub Actions' `backfill-scrape` workflow gets "match ID not
found" for every fixture even with the correct search URLs; the owner's home PC,
which already runs the live 2026 pipeline successfully, works fine).
