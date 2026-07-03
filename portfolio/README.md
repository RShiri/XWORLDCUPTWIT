# Ram Shiri - portfolio (redesign)

A dependency-free, single-page portfolio. Dark by default, light on toggle
(saved to `localStorage`, applied by an inline `<head>` script before the CSS
paints so there is no flash). No framework, no build step, no runtime deps - the
only external asset is the Google Fonts `<link>`.

This is the "broadcast / match-day-programme" redesign of the live portfolio:
Blaugrana palette (deep blue base, garnet accent, gold trim), Archivo display
type + IBM Plex Mono labels, squared corners. The interactive analytics panels
are carried over unchanged.

## Files
```
portfolio/
  index.html          markup + inline no-flash theme script + SEO/OG head
  styles.css          base design system (loaded first)
  sample.css          redesign overrides, layered on top of styles.css
  main.js             one vanilla IIFE: theme, nav, scrollspy, mobile drawer,
                      and the three interactive SVG visualizations
  assets/
    favicon.svg
    Ram_Shiri_CV.pdf
    img/              portrait, project shots, og.png (social card)
    data/             the real data the visualizations read
      yamal_shots.json      152 shots (2025/26, all comps)
      yamal_takeons.json    388 take-ons (won / failed)
      arg_alg_match.json    WC2026 match centre (score, stats, shots, replays)
```

## Sections
Nav (sticky, blurred) - Hero (player card) - About ("scouting report") -
Analytics (three built-by-hand SVG vizzes on the alt background) - Projects
(fixture-list layout) - Contact - footer.

## The visualizations (built by hand, inline SVG + vanilla JS)
1. **xG shot map** - every 2025/26 shot, dot size = xG, styled by outcome, each
   with a path to goal. Hover/tap for a floating tooltip.
2. **Take-on map** - won vs failed, with carry-direction arrows and category
   toggle chips (`aria-pressed`, strike-through when off).
3. **Match centre** - Argentina 3-0 Algeria: scoreboard, head-to-head stat bars,
   a two-team shot map, and animated pass-by-pass **goal replays** (press Play).

Honesty note: shot/take-on locations and outcomes are real event data; **xG is a
model estimate** (see the "How my expected-goals model works" note on the page).

## Run locally
```
# from the repo root (so /portfolio/... resolves):
python3 -m http.server 8799
# then open http://127.0.0.1:8799/portfolio/index.html
```
The visualizations `fetch()` the JSON in `assets/data/`, so open over HTTP (not
`file://`). Every panel still renders a sensible fallback if a fetch fails, and
all text content is usable with JavaScript disabled.

## Before you go live
- [ ] **Merge to the default branch.** GitHub Pages serves this repo from its
      default branch, so the site only goes live at
      `https://rshiri.github.io/XWORLDCUPTWIT/portfolio/` once this branch is merged.
- [ ] **LinkedIn link.** Set `LINKEDIN_URL` at the top of `main.js` to activate
      the LinkedIn link in Contact (it is empty by default).
- [ ] **Canonical / OG URL.** `index.html` uses
      `https://rshiri.github.io/XWORLDCUPTWIT/portfolio/`. If you move the folder
      or serve it from another host, update the `<link rel="canonical">` and the
      `og:`/`twitter:` URL + image tags.
- [ ] **CV.** Confirm `assets/Ram_Shiri_CV.pdf` is the current version.
- [ ] **Refresh data.** Drop new `assets/data/*.json` to update the vizzes; bump
      the `?v=` query string on the matching `fetch()` in `main.js` to bust caches.
- [ ] **Cache-bust CSS/JS** after edits: bump `?v=` on the `styles.css`,
      `sample.css`, and `main.js` links in `index.html`.

## Reverting the redesign
The redesign lives entirely in `sample.css` (loaded after `styles.css`). Remove
the `sample.css` link from `index.html` and swap the Archivo/IBM Plex Mono font
`<link>` back to Space Grotesk to fall back to the original look.
