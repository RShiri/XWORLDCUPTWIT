# PNG infographic — `wc2026/renderer.py`

The published infographic is one matplotlib figure per match, 30×20 inches at 200 dpi,
composed of panel functions on a `GridSpec`. It's a different medium from the site — no
tooltips, no filters, no scrolling — so everything a reader needs has to be legible at
poster size and self-explanatory in one look.

## Contents
- [Entry point and theming](#entry-point-and-theming)
- [Figure layout](#figure-layout)
- [Writing a panel](#writing-a-panel)
- [Pitches](#pitches)
- [Guards worth knowing](#guards-worth-knowing)
- [Where the file has to land](#where-the-file-has-to-land)
- [Bulk re-renders](#bulk-re-renders)

## Entry point and theming

```python
render_wc_dashboard(match_data, output_path, theme="light")   # or theme="dark"
```

`set_theme(name)` swaps the palette by writing `_THEMES[name]` into module globals, then
`render_wc_dashboard` restores the previous theme in a `finally`. Panel code therefore
just references bare names — `CANVAS_BG`, `TEXT_DARK`, `PITCH_FACE`, `PANEL_BG`,
`ROW_BAND`, `GOLD` — and never branches on the theme itself. That's what keeps a 1800-line
renderer from growing an `if theme ==` at every draw call.

Two consequences when you add a colour:

- Add the key to **both** `light` and `dark`. A key present in only one theme keeps
  whatever the other theme last bound, and the failure mode is a dark-on-dark label that
  only appears if someone opens the dark PNG.
- Pick the dark value against `#0b0f1a`, not by eyeballing an inverted light value.
  Mid-greys that read fine on white vanish on the dark canvas.

Team colours go through `_dark_safe_color()` in the dark theme — Germany's black kit would
otherwise melt into the background.

`run_match` renders the canonical light `<id>.png` **plus** a `<id>_dark.png` sibling
(non-fatal if it fails). The Match Centre shows a "🌙 Dark PNG" button only when
`png_dark` is set in the match detail, so matches rendered before the dark theme existed
simply don't get the button.

## Figure layout

`_render_wc_dashboard` builds a 4-row × 3-column `GridSpec`
(`height_ratios=[1.35, 5.50, 5.00, 2.85]`):

| Row | Content |
|---|---|
| 0 | Header across all columns — crests, score, competition meta (`_draw_header`) |
| 1 | Five-column subgrid: lineup ∥ pass network ∥ stats table ∥ pass network ∥ lineup |
| 2 | Shot map and final-third entries |
| 3 | Win probability, full width |

Adding a panel means re-balancing `height_ratios` / `width_ratios`, not squeezing into
spare whitespace. Render one match before and after and compare the two PNGs — proportions
at 30×20in are hard to predict from the ratios alone.

## Writing a panel

Every panel is `_draw_<thing>(ax, match_data, …)` and owns its axes completely: it sets
its own limits, hides its own spines (or colours them `DIVIDER_CLR` as a section divider),
and draws its own title. Nothing outside reaches into an axes after the fact, which is
what lets panels be reordered.

- Fonts: `FONT_MAIN` / `FONT_BOLD` (`DejaVu Sans` — bundled with matplotlib, so the render
  is reproducible on the scrape PC and in CI without a font install).
- Text colour: `TEXT_DARK` (primary), `TEXT_MID`, `TEXT_LIGHT`.
- On a team-coloured fill, get the label colour from `_contrasting_text(bg_hex)` rather
  than assuming white — half the kits are light.
- Label collisions: `_decluster(xs, ys, rs, xlim, ylim)` (~500), the force-based twin of
  the JS `declutter`.
- Empty states are panel-local: `_draw_empty_pass_network` is the pattern — draw the pitch
  and a "no data" line rather than letting the panel throw and kill the whole figure.

## Pitches

`mplsoccer` with `pitch_type="statsbomb"`:

- `VerticalPitch` — pass networks, line-ups, shot map
- `Pitch` — final-third entries

Colours come from the theme (`PITCH_FACE` / `PITCH_EDGE` for line-up and network surfaces,
`PITCH_WHITE` / `PITCH_LINE_DARK` for the shot map and final-third panels).

Source events are WhoScored 0–100; `_ws_to_sb_x` (~45) converts to StatsBomb pitch
coordinates. `build_shot_df` (~137) is the shared shot extractor — use it rather than
re-walking the event stream, so the PNG's shot set matches the site's.

## Guards worth knowing

- **Empty stub refusal.** `_render_wc_dashboard` raises a clear `ValueError` when the match
  JSON has no events and no line-ups. Without it the stats table divides by zero and the
  run dies on an opaque traceback; with it, `run_match` logs the real reason and
  `tools/catchup.py` retries the scrape. Keep any new panel from swallowing that check.
- **Own goals** never enter `shots[]` — see `references/pitch-maps.md`.
- **xG** comes from `xg_core/` via the shared scorer, never from a coefficient typed into
  a panel. That's the only reason the PNG and the site agree.

## Where the file has to land

Rendered PNGs go to git-ignored `wc2026/output/`. The **published** copy has to be in
tracked `WorldCup2026/`, or the dashboard's "Infographic" link 404s.

`find_png` (`wc2026_dashboard/build_match_details.py` ~258) checks both locations but
*always emits the `WorldCup2026/` path* — it looks in `output/` only to decide whether a
render exists at all. That's on purpose: a fresh auto-deploy regenerates `data.js` before
the PNG lands in `WorldCup2026/`, so emitting the `output/` path would 404 the link on the
live site. Don't "fix" it into a real fallback.

## Bulk re-renders

Every render calls `_refresh_web_dashboard_db()`, which regenerates all the dashboard data
files. For a bulk re-render that's enormous wasted work:

```
WC_SKIP_WEB_REFRESH=1 py tools/render_all.py     # then run the builders once, afterwards
```

`render_all.py` renders both the light and dark variants, which is also how you backfill
the "🌙 Dark PNG" button onto older matches.

Only the **light** render may trigger the dashboard refresh — a `<id>_dark` stem must
never create a match-detail file.
