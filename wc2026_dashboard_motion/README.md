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
