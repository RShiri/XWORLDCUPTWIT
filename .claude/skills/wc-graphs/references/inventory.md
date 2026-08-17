# Graph inventory — every chart in the project

Find the nearest precedent here, open it, and copy its shape. Line numbers drift; the
function names don't — `grep -n "function <name>" <file>` if a number looks stale.

## Contents
- [Match Centre (`wc2026_dashboard/match.js`)](#match-centre-wc2026_dashboardmatchjs)
- [Main dashboard (`wc2026_dashboard/app.js`)](#main-dashboard-wc2026_dashboardappjs)
- [PNG infographic (`wc2026/renderer.py`)](#png-infographic-wc2026rendererpy)
- [Shared helpers](#shared-helpers-grab-these-before-writing-anything-new)
- [Data each surface consumes](#data-each-surface-consumes)

---

## Match Centre (`wc2026_dashboard/match.js`)

One page per match, sections stacked in this order (`boot()` ~line 148 builds the
`block(title, id)` list — add new sections there, order matters editorially).

| Section | Host id | Builder | Kind |
|---|---|---|---|
| Match stats | `mv-stats` | `buildMatchStats` ~726 | Opposed fill bars (**HTML/CSS**, not SVG) |
| xG momentum | `mv-momentum` | `buildMomentum` ~207 | Cumulative step line ("xG race") |
| Win probability | `mv-winprob` | `buildWinProb` ~308 | Stacked smoothed area, 3-way (H/D/A) |
| Shot map | `mv-shots` | `buildShots` ~772 | Full-pitch dots, xG-sized |
| On-target shots | `mv-shots-ot` | `buildOnTargetShots` ~889 | Goal-mouth view (`GM`) |
| Pass explorer | `mv-passes` | `buildPasses` ~985 | Full-pitch lines + minute scrubber |
| Dribbles | `mv-dribbles` | `buildDribbles` ~1172 | Take-on dots + carry arrows |
| Pass network | `mv-network` | `buildNetwork` ~1327 | Node/edge graph on pitch |
| Average position | `mv-avgpos` | `buildAvgPos` ~1516 | Per-minute shape + window scrubber |
| Player trail | `mv-trail` | `buildPlayerTrail` ~1773 | Catmull-Rom smoothed path, rAF animated |
| Line-ups | `mv-lineups` | `buildLineups` ~1949 | Cards, not a chart |
| All goals map | `mv-goals` | `buildAllGoals` ~2346 | Opta-style build-up diagram + PNG export |
| Goal replays | `mv-goals-anim` | `buildGoalReplays` ~2666 | Animated SVG + WebM export |
| Penalty shootout | `mv-shootout` | `buildShootout` ~2735 | Goal-mouth view |

Both goal sections share one data builder: `buildGoalSequences(D)` ~2013. If you change
how a build-up is reconstructed, both the static map and the replay change together —
that's deliberate, don't fork it.

## Main dashboard (`wc2026_dashboard/app.js`)

Tabs (`nav.tabs button[data-view]` → `#view-<x>`): tables · matches · players ·
standouts · teamlab · playerlab · breaks · xg · data · predict · mvp · story · awards ·
eras. Reordering tabs is pure HTML — the switcher is `data-view`-driven (~line 148).

### xG Analysis (`#view-xg`)
| Chart | Function | Kind |
|---|---|---|
| xG vs goals scatter | `renderScatter` ~520 | Scatter + `y=x` diagonal |
| xG distribution | `renderXgDist` ~578 | Histogram |
| Correlation panel | `renderCorr` ~625 | Stat readout |
| Attack vs defence | `renderQuadrant` ~666 | `teamScatter` (`flipY`) |
| Expected points | `renderXpts` ~724 | `teamScatter` + diagonal |
| Shot quality vs quantity | `renderShotQuality` ~835 | `teamScatter` (`centerAvg:true`) |
| Home vs away | `renderHomeAway` ~867 | Paired bars (**HTML/CSS**) |
| Unluckiest results | `renderUnlucky` ~888 | Ranked table |
| Finishing | `renderFinishingBars` ~914 | Diverging bars (**HTML/CSS**) |
| Source agreement | `renderAgreement` ~981 | Table |

Not everything visual is an SVG. Simple bars — `.ha-row`/`.ha-track`/`.ha-fill`,
`.bar-row`/`.bar-track`/`.bar-fill`, `.stat-cmp`/`.sc-bar`/`.sc-fill` — are div widths in
percent, which get responsiveness and theming for free and need no scale functions. Reach
for SVG when you need axes, a coordinate space, or marks that aren't rectangles.

### Standouts (`#view-standouts`) — one spotlight player wires all four
| Chart | Function |
|---|---|
| Distribution / KDE strip | `soDistChart` ~2181 |
| Anomaly (σ-rank) list | inside `renderStandouts` ~2273 |
| Two-stat scatter (3rd stat = size) | `soScatterSVG` ~2381 |
| Percentile radar vs positional peers | `radarSVG` ~2492 |

Preset chips live in `SO_PRESETS`; the stat menu in `SO_STATS`.

### Team Lab (`#view-teamlab`)
| Chart | Function |
|---|---|
| Half-pitch shot map / xG heatmap | `tlShotMap` ~2734 (pitch: `tlPitch` ~2675) |
| Goal-mouth placement | `tlGoalMouth` ~2703 |
| Style fingerprint radar | `tlRadar` ~2832 (stats: `teamStyleFrom` ~2785) |

### Player Lab (`#view-playerlab`)
| Chart | Function |
|---|---|
| Percentile radar (1–2 players) | `plRadarDraw` ~4658 |
| Action maps | `plGraph` ~4713 on `plPitchHalf` / `plPitchFull` ~4700/~4710 |

Note: Player Lab carries its **own** pitch geometry and its own `PL_*` colour constants —
see the pitch-maps and palette references before extending it.

### Breaks (`#view-breaks`) — cooling-break study
| Chart | Function |
|---|---|
| KPI tiles | `renderBkStats` ~3030 |
| Momentum river (per match) | `renderBkRiver` ~3060 |
| Diverging shift strip vs baseline | `renderBkStrip` ~3146 |
| Pre→post pace dumbbells | `renderBkPace` ~3191 |
| Dominant-vs-chasing slopegraph | `renderBkDominance` ~3235 |

All the maths lives in `tools/cooling_break_analysis.py::export_breaks` → `breaks.js`, so
the tab and `COOLING_BREAK_ANALYSIS.md` can never disagree. Do the stats there, not here.
The grey regression-to-mean bands in the slopegraph are the honesty device — keep them.

### Other tabs
| Chart | Function | Notes |
|---|---|---|
| Knockout bracket | `renderBracket` ~1663 | Tree laid out from both sides into the centre |
| Best third-placed | `renderThirdPlace` ~1444 | Table; only renders once every group is complete |
| Power Rank + predictions | `renderPower` ~1926, `predictAll` ~1897 | Deterministic projection, not a probability sim |
| Final hub trend | `fhTrend` ~3552 | Small multiples line |
| Best XI on a pitch | inside `renderAwards` ~3903 (svg ~4066) | |
| MVP top-10 bar | inside `renderMVP` ~4244 (svg ~4296) | |
| MVP component strips | `stripSVG` (svg ~4346) | |
| MVP scatters ×3 | svg ~4428 | Local mini-scatter, not `teamScatter` |
| MVP top-3 radar | svg ~4510 | |
| Eras scatter | inside `renderEras` ~3778 (svg ~3884) | |

## PNG infographic (`wc2026/renderer.py`)

One 30×20in, 200dpi matplotlib figure per match, composed of panel functions. Entry:
`render_wc_dashboard(match_data, output_path, theme="light"|"dark")` ~1644 →
`_render_wc_dashboard` ~1666 lays out the grid and calls:

| Panel | Function |
|---|---|
| Header (crests, score, meta) | `_draw_header` ~383 |
| Pass network ×2 | `_draw_pass_network` ~529 (empty-state `_draw_empty_pass_network` ~703) |
| Stats table | `_draw_stats_table` ~720 |
| Shot map | `_draw_shot_map` ~870 |
| Final-third entries | `_draw_final_third_entries` ~965 |
| Line-up ×2 | `_draw_lineup` ~1166 |
| Win probability (full-width) | `_draw_win_probability` ~1329 |

Support: `build_shot_df` ~137, `_decluster` ~500 (the matplotlib twin of the JS
`declutter`), `_place_flag` ~330, `_rating_color` ~1159, `_put_endpoint_crest` ~1624.

## Shared helpers (grab these before writing anything new)

`app.js`
- `niceMax` ~76, `niceTicks` ~83, `fmtTick` ~91 — axis ticks that land on round numbers
- `declutter(pts, fontPx)` ~95 — greedy label placement + leader-line flag
- `GLOW_DEFS` ~113 — the `#wcGlow` filter; prepend to your `<svg>`
- `chartLegend(items, note)` ~120 — the standard swatch legend
- `teamScatter(hostId, rows, cfg)` ~130 — one renderer for every team scatter
- `wireChartTaps(hostId, tipId)` ~2557 — hover tooltip + touch-tap caption
- `esc` ~64, `el` ~58, `logoImg` ~66

`match.js`
- `PW/PH` ~7, `tx/ty` ~63, `pitchMarkup()` ~67, `GM` (goal-mouth view) ~113
- `GLOW_DEFS` ~11, `showTip/hideTip` ~2852, `esc` ~17

## Data each surface consumes

| File | Global | Built by | Feeds |
|---|---|---|---|
| `data.js` | `WC_DATA` | `build_data.py` | Tables, matches, xG lab, bracket, power rank |
| `players.js` | `WC_PLAYERS` | `build_players.py` | Players tab, Standouts, MVP |
| `shots.js` | `WC_SHOTS` | `build_shots.py` | Team Lab (every shot, OGs + shootouts excluded) |
| `breaks.js` | `WC_BREAKS` | `build_breaks.py` → `tools/cooling_break_analysis.py` | Breaks tab |
| `matches_detail/<id>.js` | `MATCH_DETAIL` | `build_match_details.py` | Every Match Centre chart |
| `player_lab/<Team>.js` | per-team payload | `build_player_lab.py` | Player Lab |

All xG/xA values come from `wc2026_dashboard/xg_model.py` → `xg_core/`. Never inline an xG
coefficient in a chart; the whole point of the shared module is that the PNGs and the site
agree by construction.
