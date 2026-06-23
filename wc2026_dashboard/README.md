# World Cup 2026 — Dashboard & xG Lab

A self-contained static website built from the WC2026 scraping pipeline data
(`../wc2026/matches/*.json`). No build tools, no dependencies, no internet needed.

## Sections

- **Tables** — live group standings (A–L), ranked by points → GD → GF, with the
  top two highlighted as qualifiers.
- **Matches** — every fixture & result in one place (this merges what used to be
  two near-identical tabs). Grouped by day, searchable, filterable by status / xG.
  - Tap any played game to expand its complete head-to-head stat line (possession,
    xG, shots, SoT, big chances, passes, pass accuracy, saves, duels, fouls).
  - Each played game links to its Match Centre and infographic PNG.
  - *Team totals* sub-view — sortable aggregate table (record, GF/GA, xG/xGA, shots
    & SoT per game, average possession & pass accuracy, big chances per game).
- **Players** — aggregated player statistics across every played match: goals,
  assists, G+A, xG, finishing (G−xG), shots, key passes, passes & accuracy,
  tackles, interceptions, cards and average rating. Leaderboard presets
  (scorers / assists / rating / xG / creativity), team filter, search, sortable
  on any column.
- **Match Centre** (`match.html?id=<match_id>`) — an interactive dashboard for a
  single game, linked from every match with event data:
  - *Shot map* — every shot as a clickable dot on the pitch (home attacks right,
    away attacks left); dot size = xG. **Goals are drawn in the team's colour** with
    a gold ring; on/off-target and blocked are styled distinctly. Click a dot to see
    who took it, the minute, xG, body part and situation. Toggle teams / goals-only /
    minimum xG.
  - *Pass explorer* — every pass drawn on the pitch, **colour-coded by outcome**:
    two greens for completed (bright = progressive/key/assist, dim = normal) and two
    reds for incomplete (bright = forward/key attempt, dim = normal). Minute timeline
    you can scrub or play back; filter by team, player, and pass type.
  - *Pass network* — average-position passing network per team: nodes are players at
    their average pitch position (sized by passes involved, labelled with shirt
    number), links are passes between each pair (thickness = volume). Home/away toggle,
    a minimum-passes threshold, and a minute scrubber/▶ to watch the network build live.
  - *Line-ups* — starting XI + substitutes with each player's **rating**
    (colour-coded), **goals/assists**, **yellow/red cards** and **minutes played**.
  - *Infographic PNG* button — opens the rendered match infographic from our PNG
    collection (`WorldCup2026/`, falling back to `wc2026/output/`).
- **xG Analysis** — the efficiency lab:
  - Pearson correlation (r) and r² between xG and actual goals across every
    team-match with xG data.
  - Scatter plot of xG vs goals with a perfect-finishing (y=x) reference and a
    best-fit regression line.
  - **Attack vs defence quadrant** — each team by xG created vs xG conceded per game.
  - **Does xG predict the table?** — actual points vs *expected points* from a
    Poisson model on each match's xG (spots over- and under-achievers).
  - Finishing bars: total goals minus total xG per team (clinical vs wasteful).
  - **Most clinical / wasteful finishers** — players ranked by goals vs shot xG.
  - Sortable per-team ledger: G, xG, G−xG, GA, xGA, xGA−GA, xGD.
  - "Did the better xG team win?" — agreement rate between the xG favourite and
    the real result.
- **Data** — the full database for download: game results, per-game team stats,
  per-game and aggregate player stats, and standings as CSV; everything as one
  **SQLite** file (`wc2026.sqlite`); plus a pointer to the raw scraped match JSON.

## Usage

The one-stop script builds the data and serves the site (with no-cache headers so a
refresh after an auto-update always shows the latest results):

```
py wc2026_dashboard/build_site.py --serve         # build once + serve on :8777
py wc2026_dashboard/build_site.py --watch --serve # also rebuild on match-file changes
py wc2026_dashboard/build_site.py                 # just rebuild data, no server
```

Then visit http://localhost:8777/wc2026_dashboard/. You can also open `index.html`
directly from disk; serving is only needed so the flag images under `../team_logos/`
and the PNG collection resolve.

## Refreshing the data

The site reads `data.js` (a generated `window.WC_DATA = {...}` blob).

**It updates itself automatically.** `wc2026/renderer.py` calls
`_refresh_web_dashboard_db()` at the end of `render_wc_dashboard()`, so every time
the pipeline renders a finished game (via `pipeline.py`, `run_match.py`,
`render_all.py`, etc.) `data.js` is regenerated with the latest results and stats.
The refresh is best-effort and wrapped in try/except — it can never break a render.

To rebuild it manually:

```
py wc2026_dashboard/build_data.py
```

`build_data.py` normalises FotMob play-off placeholder names (e.g.
`European Play-Off A → Bosnia and Herzegovina`, `FIFA Play-Off Tournament 2 → Iraq`),
computes the standings, and bundles the match list and xG records.

### Two data sources (FotMob + WhoScored)

The scraper already merges both feeds into each match JSON (`_sources` records which
were used): **FotMob** supplies match-level stats, xG and venue; **WhoScored** supplies
the rich event stream (every shot/pass) and per-player stat lines + ratings. The site
uses both — FotMob's match stats and xG where present, WhoScored events for the shot/
pass maps and player aggregates. The team pass totals computed from the WhoScored
player feeds match FotMob's match totals within a few percent, confirming the merge.

3 of 41 played games (`European Play-Off D vs South Africa`, `Switzerland vs
European Play-Off A`, `Uruguay vs Cape Verde`) have **no event data from either
source** — FotMob's match-detail API 404s and WhoScored has no record — so they have
no shots/passes/xG. A re-scrape was attempted and confirmed the data simply isn't
published yet; they fill in automatically once it is.

### Missing xG is now filled in

FotMob only supplies a match-level xG for some games. For every other game that
has WhoScored shot events, `build_data.py` computes team xG by summing per-shot xG
with **the same model the PNG renderer uses** (`xg_model.py`, copied verbatim from
`wc2026/renderer.py`). These are flagged `xg_estimated` and marked **est** in the
UI. This took xG coverage from 18 → 37 of 40 played games; the only gaps left are
the 3 matches that have no shot events at all (FotMob-only scrapes).

### Match Centre data

`build_match_details.py` writes one `matches_detail/<id>.js` per game with events
(shots, passes, goals, line-ups). `match.html` loads a single game's file via a
`<script>` tag (so it works on `file://`). The renderer rebuilds the just-played
game's file automatically; rebuild them all manually with:

```
py wc2026_dashboard/build_match_details.py
```

## Files

| File | Purpose |
|------|---------|
| `index.html` / `styles.css` / `app.js` | Main multi-tab dashboard |
| `match.html` / `match.css` / `match.js` | Interactive single-match centre |
| `build_site.py` | Build all + optional `--watch` / `--serve` (no-cache threaded server) |
| `build_data.py` | Reads match JSONs → writes `data.js` (with xG fill-in + PNG paths) |
| `build_match_details.py` | Writes `matches_detail/<id>.js` (shots, passes, ratings, cards, line-ups) |
| `build_players.py` | Aggregates player stats → `players.js` |
| `build_database.py` | Exports `database/` (CSV tables + `wc2026.sqlite` + manifest) |
| `xg_model.py` | Shared shot-xG model (mirrors `wc2026/renderer.py`) |
| `data.js` | Generated index data (do not edit by hand) |
| `matches_detail/` | Generated per-match shot/pass/line-up files |
