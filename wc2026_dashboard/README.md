# World Cup 2026 — Dashboard & xG Lab

A self-contained static website built from the WC2026 scraping pipeline data
(`../wc2026/matches/*.json`). No build tools, no dependencies, no internet needed.

## Sections

- **Tables** — live group standings (A–L), ranked by points → GD → GF, with the
  top two highlighted as qualifiers.
- **Matches** — every fixture & result in one place (this merges what used to be
  two near-identical tabs). Grouped by day, searchable, filterable by status / xG.
  - **Click any played game to open its Match Centre** (the whole row is the link;
    it shows a `↗` cue). Upcoming games are intentionally inert with a tooltip.
  - Each row also has an infographic-PNG link.
  - *Team totals* sub-view — sortable aggregate table (record, GF/GA, xG/xGA, shots
    & SoT per game, average possession & pass accuracy, big chances per game).
- **Players** — aggregated player statistics across every played match: goals,
  assists, G+A, xG, finishing (G−xG), shots, key passes, passes & accuracy,
  tackles, interceptions, cards and average rating. Leaderboard presets
  (scorers / assists / rating / xG / creativity), team filter, search, sortable
  on any column.
- **Match Centre** (`match.html?id=<match_id>`) — an interactive dashboard for a
  single game, opened by clicking any played match. It is **one scrolling page**
  (no tabs) with all sections stacked, plus an *Infographic PNG* button:
  - *Match stats* (default section) — the head-to-head comparison (possession, xG,
    shots, SoT, big chances, passes, pass accuracy, saves, duels, fouls), read from
    `data.js`. Any stat the provider didn't supply is **filled from the event stream**
    (shots/SoT/big chances/passes/pass accuracy/xG), so event-only games still show a
    full set; stats that can't be derived (possession/saves/duels/fouls) are skipped.
  - *Shot map* — every shot as a clickable dot on the pitch (home attacks right,
    away attacks left); dot size = xG. **Goals are drawn in the team's colour** with
    a gold ring. The across-pitch (y) axis is flipped (`PH - y`) to match the PNG /
    broadcast orientation — without it the map is mirrored about the centreline.
    Click a dot for who/minute/xG/body part/situation. Toggle teams / goals-only / min xG.
  - *Pass explorer* — every pass drawn on the pitch, **colour-coded by outcome**:
    two greens for completed (bright = progressive/key/assist, dim = normal) and two
    reds for incomplete. Minute timeline you can scrub or play back; filter by team,
    player, and pass type.
  - *Dribbles* — every take-on as a dot where it happened (green = successful, red
    ring = unsuccessful). Team/player/outcome filters, minute scrubber/▶, and a
    success-rate readout. Mirrors the pass explorer for `TakeOn` events.
  - *Pass network* — average-position passing network per team for the **starting XI,
    using passes up to that side's first substitution** (the window all 11 were on
    together — the standard convention; there is intentionally **no** minute scrubber).
    Nodes = players at average position (sized by passes involved, labelled with shirt
    number), links = passes between each pair (thickness = volume). Home/away toggle and
    a minimum-combined-passes threshold.
  - *Line-ups* — starting XI + substitutes with each player's **rating**
    (colour-coded), **goals/assists**, **yellow/red cards** and **minutes played**.
  - The page loads `data.js` (for Match stats) plus the per-match
    `matches_detail/<id>.js` event file.
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

## Live site & auto-deploy

The site is published with **GitHub Pages** from `main` (repo root): **https://rshiri.github.io/XWORLDCUPTWIT/**
(the root `index.html` redirects to `wc2026_dashboard/index.html`). Because Pages serves
the repo root, the site's `../team_logos/` and `../WorldCup2026/` paths resolve.
Stylesheets are cache-busted (`styles.css?v=Date.now()`) so CSS changes reach browsers
without a hard refresh; new match PNGs must live in the tracked `WorldCup2026/` (not the
git-ignored `wc2026/output/`) or their Infographic-PNG links 404.

**Per-match auto-deploy:** `run_match` step 4 calls `git_ops.push_match_update()` (needs
`GIT_TOKEN`; skip with `--no-push`). It clones the repo to a temp dir and, in one commit,
publishes the PNG **plus** the regenerated `data.js` / `players.js` / `matches_detail/` /
`database/` and the raw match JSON — so the whole live site updates per match, like the
PNG. It only pushes generated outputs; hand-edited source (`app.js`/`match.js`/CSS/HTML)
still needs a manual `git push`.

## Refreshing the data (local)

The site reads `data.js` (a generated `window.WC_DATA = {...}` blob).

**It refreshes itself automatically (locally).** `wc2026/renderer.py` calls
`_refresh_web_dashboard_db()` at the end of `render_wc_dashboard()`, so every time
the pipeline renders a finished game (via `pipeline.py`, `run_match.py`,
`render_all.py`, etc.) `data.js` is regenerated with the latest results and stats.
The refresh is best-effort and wrapped in try/except — it can never break a render.
(The push to the live site is the separate `push_match_update()` step above.)

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
(shots, passes, **dribbles/take-ons**, goals, line-ups). `match.html` loads a single
game's file via a `<script>` tag (so it works on `file://`). The renderer rebuilds the
just-played game's file automatically; rebuild them all manually with:

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
