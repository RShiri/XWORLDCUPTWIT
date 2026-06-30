# wc2026_dashboard_motion — the "Motion edition"

An **animated** copy of the dashboard that layers the
[`motion`](https://motion.dev) animation library on top of the existing site,
**without touching the original**. Live alongside the classic site at:

**https://rshiri.github.io/XWORLDCUPTWIT/wc2026_dashboard_motion/**

(The classic dashboard at `/wc2026_dashboard/` is unchanged.)

## How it works (thin shell, shared data)

This folder is deliberately tiny. It **reuses the original dashboard verbatim**
— all the heavy logic and the big generated data files are loaded straight from
`../wc2026_dashboard/` via relative paths, so the Motion edition **never drifts**
out of sync with the live data: every match auto-deploy updates it for free.

Only these files actually live here:

| File | Purpose |
|------|---------|
| `index.html` / `match.html` | Copies of the originals, re-pointed at `../wc2026_dashboard/` for CSS/JS/data, plus the motion layer. Body markup is identical. |
| `vendor/motion.js` | The vendored `motion` UMD build (v11.18.2, exposes `window.Motion`). Pulled from the npm registry — **no CDN**, matching the project's offline-capable ethos. |
| `motion-enhance.js` | The animation layer: header entrance, top scroll-progress bar, staggered card reveals per view + on tab switch, stat number count-ups, spring hover-lift on cards/tabs, and match-page section reveals. Loads *after* `app.js`/`match.js`. |

### Graphs: animated data, untouched everything-else

The charts/maps are still **rendered by the original, unchanged code** — same
SVG, same xG model, same data, same coordinates. On top of that, the animation
layer animates the **data marks** in as each chart first scrolls into view:

- scatter/quadrant **dots pop in** (spring), staggered
- shot maps, pass-network & average-position **nodes pop in**; pass / dribble /
  build-up **lines fade in**
- the **radar area scales up** from its centre
- the **xG-momentum lines draw on** (stroke-dashoffset) then goal markers pop
- the Team-Lab **xG heat cells** fade in; the match **stat bars grow** from 0

Hard guarantees that keep it flaw-free (all verified in a headless browser):

- **Only data marks animate** — never axes, gridlines, or pitch markings.
  Selection is per-chart-type (e.g. `tl-pitch` markings have no pitch class, so
  data is found via `<title>`/class; match `pitch-svg` markings use `.pitch-*`).
- **Interactivity is preserved** — we only set inline styles on the *existing*
  nodes (never replace them), so every `<title>` tooltip and click/mousemove
  listener keeps working; styles are cleared after, leaving the DOM pristine.
- **Marks land in identical positions** to the classic site — circles scale via
  `transform-box: fill-box` (pop in place, never fly to the SVG origin), and all
  inline transforms are removed once settled (0 leftover transforms verified).
- **No strobing** — each chart animates **once** on first reveal; the rapid
  scrubber/filter redraws (shot/pass/dribble/avg-pos play at ~180ms) never
  re-trigger it, and the goal-replay SVG (its own rAF driver) is excluded.
- **Nothing can stick hidden** — every reveal also clears its styles on a
  timeout, and a perf guard switches dense plots (the 698-dot KDE, 1800+ shot
  maps) to a light fade instead of per-mark springs.

The hover-lift still **excludes any card containing an `<svg>`/`<canvas>`**, so
charts never scale/blur or fight their own tooltips on hover.
| `motion-matchpath.js` | One surgical shim: rewrites `match.js`'s page-relative `matches_detail/<id>.js` request back to `../wc2026_dashboard/` so the shared per-match event files load (avoids duplicating ~78 files). |
| `motion.css` | Chrome for the layer (scroll bar, header badge, "Classic" link) + a hard `prefers-reduced-motion` opt-out. |

## Safety / degradation

- **Reduced motion:** users with `prefers-reduced-motion: reduce` get the page
  with **no animation at all** (only the badge/link), identical to classic.
- **Library missing:** if `motion` fails to load, the enhancer bails — the page
  is just the classic dashboard.
- **No stuck content:** every reveal also clears its inline styles on a timeout,
  independent of the animation engine, so nothing can be left invisible.

## Regenerating the HTML

`index.html` / `match.html` are generated from the originals so the body never
drifts. The transform is mechanical (re-point shared assets at
`../wc2026_dashboard/`, inject the motion scripts); see the project chat / the
`build_motion_html.py` helper used to produce them. The three hand-written files
(`motion-enhance.js`, `motion-matchpath.js`, `motion.css`) and `vendor/motion.js`
are the real source.
