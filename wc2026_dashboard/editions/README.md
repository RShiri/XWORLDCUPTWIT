# `wc2026_dashboard/editions/` — generated multi-edition dashboard data

Built dashboard data for **historical** World Cup editions (2018, 2022), produced by
running every builder with `--edition <year>` (see `../editions.py`, the single
registry of what editions exist and how their formats differ). **2026's own output
stays at the dashboard root** (`wc2026_dashboard/data.js`, not `editions/2026/`) —
that's ground rule #1 of `ROADMAP.md`: every 2026 path and byte stays exactly as it
was before the multi-edition work, enforced by `tools/check_2026_identity.py` in CI.

This directory (unlike `history/`, the raw scrape data) **is committed** — it's
~25 MB/edition of generated JS/CSV/SQLite that the static site serves directly, no
build step needed at request time.

## Layout

```
wc2026_dashboard/editions/
  2022/
    data.js                 # window.WC_DATA — matches, standings, xG records, +edition/+format
    players.js               # window.WC_PLAYERS — aggregated player stats
    shots.js                  # window.WC_SHOTS — every shot, tournament-wide
    matches_detail/
      2022_11_20_Qatar_vs_Ecuador.js   # window.MATCH_DETAIL — shots/passes/dribbles/lineups
      _index.js                          # window.MATCH_DETAIL_INDEX — which matches have a detail page
    database/
      results.csv, team_match_stats.csv, player_match_stats.csv, players.csv, standings.csv
      wc2022.sqlite            # all of the above as SQL tables
      manifest.js              # window.WC_DATABASE — Data-tab download list + raw_release pointer
    player_lab/
      Qatar.js, Ecuador.js, …  # window.WC_PLAYERLAB[team] — per-player action maps, one file per nation
      _index.js                 # window.WC_PLAYERLAB_TEAMS
  2018/
    (same shape)
```

`wc2026_dashboard/share/2022/<id>.html` and `share/2018/<id>.html` (siblings of
`editions/`, not inside it) hold the per-match Open-Graph share shims — same idea as
2026's `share/<id>.html`, one directory level deeper per edition.

## How the frontend picks this up

`index.html` / `index_futuristic.html` / `match.html` read `?edition=2018|2022`
(default 2026) and load `editions/<year>/…` instead of the root files — see each
HTML file's inline loader script. `app.js` never hardcodes per-year rules: it reads
the tournament's shape from `data.js`'s own `format` field (`{groups, koEntry,
thirds, fairPlay, name}`, written by `editions.py::format_payload`) — 8 groups /
Round-of-16 entry / no best-thirds for 2018 & 2022, vs 12 groups / Round-of-32 /
best-thirds for 2026. The **Eras** tab (`app.js::renderEras`) is the one place that
loads *multiple* editions at once — it fetches whichever of `data.js` /
`editions/2022/data.js` / `editions/2018/data.js` are available and compares them
side by side, degrading gracefully when an edition isn't published yet (a 404 there
just means "not backfilled yet", not an error).

**2026-only, deliberately absent here**: `breaks.js` (cooling-break baselines are
frozen on the 2026 group stage) and the Power Rank tab's inputs (`FIFA_PTS` is a
2026-dated ranking snapshot). Neither builder runs for historical editions.

## Regenerating

```
py wc2026_dashboard/build_site.py --edition 2022     # rebuild just 2022
py wc2026_dashboard/build_site.py --edition 2018     # rebuild just 2018
py wc2026_dashboard/build_site.py --all               # sweep every edition with raws present
```

Needs the raw match files in `history/wc<year>/matches/` first (see that
directory's own README) — either backfilled for real, or a synthetic dataset from
`tools/make_synthetic_history.py <year>` for local development/testing without the
real raws.
