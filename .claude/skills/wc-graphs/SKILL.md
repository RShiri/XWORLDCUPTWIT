---
name: wc-graphs
description: How every chart, graph and pitch map in this World Cup repo is built — the hand-rolled SVG idiom in wc2026_dashboard/app.js and match.js, the pitch/goal-mouth coordinate systems, the team-colour palette guards, and the matplotlib PNG infographic in wc2026/renderer.py. Use this whenever adding, editing, restyling, debugging or reviewing anything visual — a shot map, xG momentum line, radar, scatter, heatmap, bracket, histogram, timeline, animation or infographic panel — and also when a chart looks wrong (mirrored pitch, invisible team colour, squashed axis, missing dots on mobile) or when deciding where a new visual belongs. Read it before writing chart code, not after.
---

# Graphs in XWORLDCUPTWIT

Roughly fifty charts across three rendering surfaces, all of them hand-built. There is no
charting library anywhere in this project and that's deliberate: the site must run from
`file://` and from GitHub Pages with three script tags and no build step, and the PNG has
to render identically on the scrape PC and in CI. Everything below follows from that.

The single most useful move before writing a chart: **find the nearest existing one in
`references/inventory.md`, open it, and copy its shape.** These charts look like one
product because each was cloned from its neighbour, not because a style guide was enforced
afterwards.

## Which surface are you working on?

| You're building | Where | Read |
|---|---|---|
| A tournament-wide chart (teams, players, tabs) | `wc2026_dashboard/app.js` | `references/svg-charts.md` |
| A per-match chart | `wc2026_dashboard/match.js` | `references/svg-charts.md` |
| Anything drawn on a pitch or goal frame | either of the above | `references/pitch-maps.md` |
| A panel in the published infographic | `wc2026/renderer.py` | `references/png-renderer.md` |
| A new stat the chart needs | a `build_*.py` builder — **not** the chart | `references/inventory.md` |

Not every visual is an SVG: plain comparison bars are div widths in percent
(`.bar-row`/`.bar-track`/`.bar-fill` and friends), which get theming and responsiveness
for free. Reach for SVG when you need axes, a coordinate space, or marks that aren't
rectangles.

The last row of that table matters more than it looks. The JS files consume pre-built globals
(`WC_DATA`, `WC_PLAYERS`, `WC_SHOTS`, `WC_BREAKS`, `MATCH_DETAIL`). Computing a new metric
inside a renderer means it exists on exactly one chart, can't be cross-checked, and
silently disagrees with the PNG. Compute it in the builder, ship it in the payload, then
draw it.

## Reference files

- `references/inventory.md` — every chart, its function, its host element, what data it
  eats. Start here to find the precedent.
- `references/svg-charts.md` — the SVG skeleton, axis/tick helpers, `declutter`, legends,
  `teamScatter`, tooltips, the minute-scrubber interaction, sizing classes.
- `references/pitch-maps.md` — WhoScored coordinates, the three pitch geometries, the
  goal-mouth view, own-goal handling, build-up diagrams.
- `references/palette.md` — CSS variables, team colours, the collision and darkness
  guards, rating colours.
- `references/png-renderer.md` — matplotlib figure layout, theming, panel conventions.
- `references/backlog.md` — the ranked queue of charts worth building next, with the
  verified data inventory behind each. Read it when asked for "a new chart" without a
  specific one named.

## Workflow

1. **Locate the precedent** in `references/inventory.md`. Read that function end to end.
2. **Check the data exists.** Open the relevant `build_*.py` output or a
   `matches_detail/<id>.js`. If the field isn't there, add it to the builder first and
   regenerate before touching the chart.
3. **Write the chart** following the skeleton in `references/svg-charts.md` — empty state,
   `viewBox`, `pad*`/`plot*`, `sx`/`sy`, `GLOW_DEFS`, `esc()` on every string.
4. **Verify it in a browser**, not by reading the code. `py wc2026_dashboard/build_site.py
   --serve` then `http://localhost:8777/wc2026_dashboard/index.html`, or the preview tools
   with `.claude/launch.json` "wc-dashboard". Check a played match, an unplayed one, and a
   narrow viewport.
5. **Ship the right files** — see the deploy note at the bottom, it's the step that
   actually goes wrong.

## What every chart here does the same way

**Bail before you divide by zero.** Charts render when two matches have been played and
when a tab has no qualifying players. Every builder opens with a host check and an
`<p class="hint">Not enough data yet.</p>` empty state.

**Scale, never fix.** `viewBox` plus a CSS class carrying
`width:100%; height:auto; display:block`. No pixel `width`/`height` attributes. About half
the traffic is phones.

**Reachable by finger.** A `<title>` child is the free default; `data-info` +
`wireChartTaps(hostId, tipId)` when the detail matters, because it also writes into a
`.chart-tip` caption below the chart — a tooltip under the user's thumb is invisible. A
chart whose only affordance is `:hover` is blank on mobile.

**Team colour, guarded.** Use the team's own kit colour for its marks — it's the fastest
legend there is. But always through the two guards: lift near-black kits off the dark
background, and fall back to the standard `#9d6bff` / `#ff6a3d` pair when two sides'
colours are too close to tell apart. Both guards are in `references/palette.md`.

**Chrome from CSS variables.** `--muted` for ticks, `--line` for gridlines, `--text` for
captions, `--bad`/`--warn`/`--accent` for semantics. Old charts have hexes baked in; don't
copy that forward, and don't mass-convert them as a side quest either.

**Round the coordinates.** `.toFixed(1)` as you push. Generated JS is committed, and float
churn makes noisy diffs in a repo that regenerates data on every match.

## Editorial standards

These charts are published to a public site and screenshotted onto social media, so they
carry a higher burden than an internal dashboard would.

**Say what the chart can't show.** The `note` argument on `chartLegend` exists for this.
The Breaks tab keeps grey regression-to-mean bands behind its slopegraph specifically so
the reader can see how much of the apparent effect is just reversion; the MVP tab prints
its own caveats under the radar. When you add a chart that could be over-read, add the
device that stops it. Removing an existing one is a regression, not a simplification.

**Don't hide the axis.** No truncated y-axes on comparison bars, no dual axes with
different scales implying a correlation. If a metric needs its own scale (PPDA in the
Breaks dumbbells), label it as separate rather than quietly rescaling it.

**Orientation must be unambiguous.** Every pitch gets a direction marker, every diverging
chart gets both ends labelled. The reader has just watched the match — a mirrored map is
worse than no map.

**Single source per number.** xG and xA come from `xg_model.py` → `xg_core/` everywhere;
cooling-break statistics come from `tools/cooling_break_analysis.py`. Never inline a
coefficient or recompute a published statistic locally. The site and the PNGs agree by
construction, and that's the property worth protecting.

## Common failures

| Symptom | Cause |
|---|---|
| Pitch map mirrored vs the broadcast | The `PH - y` flip in `match.js ty()` was "simplified" away |
| A goal plotted at the wrong end for the wrong team | An own goal leaked into `shots[]` |
| Two team lines indistinguishable | Collision guard missing |
| A team's marks invisible | Darkness guard missing (black/navy kit on `--bg`) |
| Every dot squashed at the bottom | Axis floored at 1 instead of fitting the data |
| Labels overlapping into mush | `declutter` / `_decluster` not applied |
| Build-up diagram collapsed to one node | Own-goal look-back anchored at `:59` instead of the beneficiary's last touch |
| One glitched line across the whole pitch | `AGM_MAX_SEG` segment guard missing |
| Chart renders locally, stale on the live site | Source edit that needs a manual push — see below |
| Dark-theme PNG has an invisible label | A colour key added to `_THEMES["light"]` only |

## Shipping a chart change

The auto-deploy on `run_match` pushes **generated** files only —
`data.js`, `players.js`, `shots.js`, `breaks.js`, `matches_detail/`, `database/`, and the
PNGs. Chart *source* — `app.js`, `match.js`, `styles.css`, `match.css`,
`futuristic-theme.css`, the `*.html` — is **never** auto-pushed. A chart change that looks
perfect locally and never appears on the live site is almost always this.

So: commit and push your source edits by hand, staging specific paths (the working tree
usually carries unrelated in-progress work — no blind `git add -A`). The HTML loads its
stylesheets with `?v=Date.now()`; keep that when editing the head or CSS changes won't
reach browsers. After pushing, the live site needs about a minute plus one `Ctrl+F5`.

## The weekly auto-propose run

A Routine (`trig_01EAJTKw5J1mTkCRaPak11Hi`, Mondays 03:00 UTC) fires a fresh session
weekly to build the next chart off `references/backlog.md`. If you're that run, the rules
are:

- **One chart, one branch.** Take the highest-ranked `todo` item; skip `blocked` and
  `needs-decision` — those are waiting on a human.
- **Stop if a `claude/chart-*` branch already exists** on the remote
  (`git ls-remote --heads origin 'claude/chart-*'`). The previous chart is still awaiting
  review, and stacking unreviewed branches just costs the reviewer time.
- **Builder first.** Several items need a field added to a `build_*.py` before the chart is
  possible. Do that in the same branch and regenerate, or the chart has nothing to draw.
- **Never commit to `main`.**
- **Flip the item to `in-review (<branch>)`** in the same commit, so the next run doesn't
  rebuild it.
- **If nothing is actionable, stop and push nothing.** An empty queue is a fine outcome;
  an invented chart to fill the slot is not.
- Say plainly what the chart shows, what it can't, and what you actually verified.

**Delivery is a pushed branch, not a PR.** Fired sessions have no GitHub API access — no
`gh`, no `mcp__github__*`, and the environment's `GITHUB_TOKEN` is proxy-gated (403 against
`api.github.com`). Git push works fine. So the run pushes `claude/chart-<slug>` and ends
with the compare URL —
`https://github.com/RShiri/XWORLDCUPTWIT/compare/main...claude/chart-<slug>?expand=1` —
which arrives as a push notification and opens a pre-filled PR in two clicks. If a future
run does have the GitHub tools, open the PR directly instead.
