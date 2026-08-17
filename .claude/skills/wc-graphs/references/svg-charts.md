# SVG charts — the house idiom

Every chart on the site is a hand-built SVG string, assembled into an array and joined
into `host.innerHTML`. There is no charting library, no build step, and no network fetch:
the site has to work from `file://` and from GitHub Pages with nothing but three script
tags. That constraint is the reason for the idiom below — keep it.

## Contents
- [The skeleton](#the-skeleton)
- [Axes and ticks](#axes-and-ticks)
- [Labels that collide](#labels-that-collide)
- [Legends](#legends)
- [teamScatter — don't rewrite it](#teamscatter--dont-rewrite-it)
- [Tooltips](#tooltips)
- [Minute scrubber + play button](#minute-scrubber--play-button)
- [Sizing conventions](#sizing-conventions)
- [Escaping and safety](#escaping-and-safety)

## The skeleton

```js
function renderThing(rows) {
  var host = document.getElementById("thingHost");
  if (!host) return;                                   // tab may not exist this edition
  if (!rows.length) { host.innerHTML = '<p class="hint">Not enough data yet.</p>'; return; }

  var W = 960, H = 560, padL = 58, padR = 14, padT = 24, padB = 50;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  function sx(v) { return padL + (v / xMax) * plotW; }
  function sy(v) { return (padT + plotH) - (v / yMax) * plotH; }

  var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="scatter-svg">' + GLOW_DEFS];
  // …gridlines, marks, labels…
  svg.push("</svg>");
  host.innerHTML = svg.join("") + chartLegend([...]);
}
```

Five things this buys you, all of which someone will otherwise re-derive badly:

- **Empty state first.** Charts render mid-tournament with two matches of data. Every
  builder bails to `<p class="hint">` rather than dividing by zero or drawing an axis to
  `Infinity`.
- **`viewBox` + a CSS width, never a pixel `width`/`height` attribute.** The SVG scales to
  its card on a phone. `W`/`H` are just the internal coordinate space — pick round numbers
  and forget about the real pixel size.
- **`padL/padR/padT/padB` then `plotW/plotH`.** Every chart uses these exact names, so you
  can read any of them cold.
- **`sx()`/`sy()` closures.** Data → screen in one place. When an axis needs flipping or
  re-centring you change one function, not fifty string concatenations.
- **`GLOW_DEFS` prepended.** `#wcGlow` is the neon-HUD signature that makes the dots on a
  dark card read as lit rather than painted. Duplicate `<defs>` with the same id across
  several SVGs on one page are harmless — they're identical — so every renderer just
  prepends it rather than coordinating a single shared block.

Round coordinates with `.toFixed(1)` as you push them. It keeps the emitted markup small
and diffable; `data.js` and friends are committed, and noisy float churn bloats the repo.

## Axes and ticks

Use `niceMax(v)` for the axis top and `niceTicks(max, target)` for the tick values —
they snap to 1/2/2.5/5/10 × 10ⁿ so a fan reads "0, 0.5, 1.0, 1.5" instead of
"0, 0.37, 0.74". `fmtTick(v)` prints integers bare and fractions to sensible precision.

Do not floor an axis at 1. For small metrics — xG per shot sits around 0.1–0.3 — a floor
of 1 squashes every dot into the bottom sliver of the plot.

When average lines matter more than the origin, pass `centerAvg:true` to `teamScatter`:
each axis then spans `0 … avg + (farthest point's distance from avg)`, which puts the
average crosshair near the middle with no dead space and no clipped outliers.

## Labels that collide

`declutter(pts, fontPx)` takes points carrying `{cx, cy, team}`, places each label to the
right of its dot, and pushes colliding labels downward until they clear. It writes back
`lx`, `ly`, and `led` — draw a thin leader line back to the dot when `led` is true, so a
name nudged 40px down still visibly belongs to its dot. `renderer.py::_decluster` is the
matplotlib equivalent (force-based rather than greedy, same purpose).

## Legends

`chartLegend([[color, label], …], note)` emits the standard `.chart-legend` row of round
swatches, with the optional `note` italicised on its own line underneath. Use the note for
the caveat — sample size, what's excluded, which baseline. A chart on this site is
expected to say what it can't show.

## `teamScatter` — don't rewrite it

`teamScatter(hostId, rows, cfg)` renders every team-level scatter in the xG lab. Rows
arrive pre-projected as `{team, x, y, col}`. `cfg` accepts:

| key | effect |
|---|---|
| `xLabel` / `yLabel` | axis captions (required) |
| `h` | height override (default 560) |
| `flipY` | higher value plots *lower* — for "goals conceded"-style axes where less is better |
| `avgX` / `avgY` | dashed average crosshair |
| `centerAvg` | recentre both axes on the averages (see above) |
| `diagonal` | dashed `y = x` line labelled "exactly deserved" |
| `corners` | `[{h:'l'|'r', v:'t'|'b', text, color}]` quadrant captions |
| `tip` | `fn(row) → string` appended to the dot's `<title>` |
| `legend` | HTML appended below the chart (usually `chartLegend(...)`) |

If you need a scatter with a genuinely different job, add a cfg flag rather than forking
the function. Three of the four xG-lab scatters differ only by flags, and that's why they
look like one family.

## Tooltips

Two mechanisms, both already wired to the single `<div id="tooltip">` at the bottom of
each page:

- **`<title>` child** on a mark. Free, native, works everywhere, no JS. Default to this.
- **`data-info="…"` + `wireChartTaps(hostId, tipId)`** when the chart needs to work under
  a finger. On desktop it shows the floating tooltip on hover; on touch it highlights the
  tapped dot and writes the text into a `.chart-tip` caption *below* the chart, because a
  tooltip rendered under the user's thumb is invisible. `tipId` points at that caption
  (`<div class="chart-tip" id="…">Tap any dot to see the player.</div>`).

`match.js` uses the lower-level `showTip(e, html)` / `hideTip()` pair for its pitch marks,
which take arbitrary HTML rather than the `"Name — detail"` string `tipHTML` expects.

Every interactive mark should be reachable both ways. Roughly half the site's traffic is
phones, and a chart whose only affordance is `:hover` is a blank chart there.

## Minute scrubber + play button

The pass explorer, dribbles and average-position charts share one interaction shape, and
new time-sliced charts should match it (`buildPasses` ~1050–1170 is the reference):

- one `state` object, one `draw()` that reads it — every control just mutates `state` and
  calls `draw()`
- `<input type="range">` bound to `setUpper(minute)`
- `▶` button that `setInterval`s at 180ms, flips its label to `❚❚`, and gets a
  `.playing` class; `stopPlay()` is called by every other control so scrubbing interrupts
  playback rather than fighting it
- optional window mode (rolling N-minute window) and a custom from/to range

`buildPlayerTrail` uses `requestAnimationFrame` instead, because it interpolates a smooth
path rather than stepping whole minutes. Follow that one only when you're animating
continuous motion.

## Sizing conventions

| Chart family | viewBox | CSS class |
|---|---|---|
| Team scatters, histograms | `960 × 560` | `.scatter-svg` |
| Standouts / Team Lab | varies | `.so-chart`, `.so-radar` |
| Match Centre time series | `820 × 360` | `.mv-mom-chart` |
| Full pitch | `100 × 64` (`PW × PH`) | `.pitch-svg` |
| Team Lab half pitch | see `tlPitch` | `.tl-pitch` (max-width 640) |
| Goal mouth | `-2 -2 104 56` | `.tl-goalmouth` |
| Breaks charts | varies | `.bk-svg` |

Each of those classes already sets `width:100%; height:auto; display:block`. If you invent
a new class, give it those three properties or the chart will not scale.

Add `preserveAspectRatio="xMidYMid meet"` and `role="img"` on new charts —
most of the newer ones have both, and the `role` plus an `aria-label` is the only thing a
screen reader gets from a `<svg>` full of `<path>`s.

## Escaping and safety

Team names, player names and stat labels all flow into markup. Run every one of them
through `esc()` — including inside `<title>` and `data-info`, where a stray `"` silently
breaks the attribute and swallows the rest of the element.
