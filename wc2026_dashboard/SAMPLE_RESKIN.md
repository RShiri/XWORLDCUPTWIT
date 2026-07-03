# WC2026 dashboard - Blaugrana reskin (sample)

A **preview** re-skin of the dashboard in the portfolio site's broadcast /
match-day identity, kept **separate from the live dashboard** so the original
design is untouched.

## Sample URLs
- Dashboard: `.../wc2026_dashboard/sample.html`
- Match centre: `.../wc2026_dashboard/match_sample.html?id=<match_id>`
  (played-match rows in `sample.html` route here automatically)

Once merged to the default branch these live at
`https://rshiri.github.io/XWORLDCUPTWIT/wc2026_dashboard/sample.html`.
Both pages are marked `noindex` (they are a preview, not the canonical site).

## Files
- `dash-sample.css` - the entire reskin. A **chrome-only** override loaded
  *after* `styles.css` (and `match.css`). It re-tokenises the palette and type:
  deep-blue base, garnet accent, gold trim, Archivo display + IBM Plex Mono
  labels, squared 4px corners. Charts, tabs, tables and every interaction are
  the originals, unchanged.
- `sample.html` - copy of `index.html` that also loads the fonts + override and
  routes the Match Centre to `match_sample.html` (app.js opens a match by
  setting `window.location` on the row, so a capture-phase click handler
  redirects it; modifier/middle clicks still open the original in a new tab).
- `match_sample.html` - copy of `match.html` that loads the override; its
  "All matches" link points back to `sample.html`.

Both sample pages reuse the **live generated data** (`data.js`, `players.js`,
`shots.js`, `breaks.js`, `matches_detail/`, `database/`) and the live `app.js` /
`match.js`, so the reskin stays current after every scrape with no extra work.

## Nothing here is auto-generated
The scrape/auto-deploy pipeline only regenerates the data files; it never
touches these three source files. Edits to them (like the rest of the dashboard
source) need a manual `git push`.

## Reverting
Delete `dash-sample.css`, `sample.html`, `match_sample.html`. The live
`index.html` / `match.html` are unaffected.

## Promoting it to the real design (later, if you want)
Point `index.html` / `match.html` at `dash-sample.css` (add the `<link>` +ONE
fonts `<link>`), or fold `dash-sample.css` into `styles.css`. Not done here on
purpose - this is a preview only.
