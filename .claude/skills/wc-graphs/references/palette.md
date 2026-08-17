# Palette — chrome, team colours, and the guards

The rule that makes the whole site look like one product: **chrome comes from CSS
variables, data comes from team colours, and team colours always pass through a guard.**

## Contents
- [CSS variables (the live values)](#css-variables-the-live-values)
- [Hardcoded hexes in JS](#hardcoded-hexes-in-js)
- [Team colours](#team-colours)
- [The two guards](#the-two-guards)
- [Rating colours](#rating-colours)
- [PNG themes](#png-themes)

## CSS variables (the live values)

`styles.css` defines a `:root` palette, then `futuristic-theme.css` ("Telemetry", loaded
after it on **every** page) overrides it. Telemetry is the site's only skin now, not an
alternate — so the values below are what actually renders. If you sample a colour out of
`styles.css` and hardcode it, you'll be one skin behind.

| Variable | Telemetry value | Use for |
|---|---|---|
| `--bg` | `#050611` | page ground |
| `--bg-2` | `#0b0d1f` | pitch surface, inset panels |
| `--card` | `rgba(15,16,34,.72)` | chart card |
| `--card-2` | `rgba(21,20,46,.8)` | node fill, raised panel |
| `--line` | `rgba(140,150,210,.16)` | gridlines, borders |
| `--line-strong` | `rgba(140,150,210,.32)` | axis lines |
| `--text` | `#eef0fb` | axis captions, labels |
| `--muted` | `#8b8fb8` | tick numbers, notes, secondary marks |
| `--accent` | `#33e893` | positive / primary highlight |
| `--accent-2` | `#9d6bff` | secondary highlight, "home" fallback |
| `--warn` | `#ffc857` | move-start, caution, xG figures |
| `--bad` | `#ff5c7a` | shots, negative deltas |
| `--good` | `#33e893` | same as accent, semantic alias |

Prefer the variable (`fill="var(--muted)"`, or a CSS class) over the literal. A chart that
reads its colours from variables re-skins for free; one with hexes baked in has to be
found and edited by hand.

## Hardcoded hexes in JS

Some older renderers emit hex literals directly into the SVG string — mostly the xG-lab
scatters (`#14152e` gridlines, `#8b8fb8` ticks, `#d6d9f5` labels, `#33366e` leader lines)
and all of Player Lab (`PL_ACC`, `PL_BLUE`, `PL_MUTED`, `#262c52`, `#0b0d1f`). They match
the Telemetry values, so they look right today.

Don't propagate the pattern into new charts, and don't mass-convert the old ones as a side
quest either — a sweeping colour refactor is its own change with its own screenshots.

## Team colours

`wc2026/team_colors.py` holds `{primary, secondary}` for all 48 nations, sourced from each
federation's kit. It flows into the match payloads as `D.home.color` / `D.away.color` and
into `data.js` rows as `hc` / `ac`.

Use the team's own colour whenever a mark belongs to a team. It's the fastest legend there
is — readers already know Brazil is yellow.

## The two guards

Kit colours were chosen by federations, not by a chart designer, so two failure modes
recur. Both guards already exist; copy them rather than reinventing.

**Collision** — two teams whose colours are close enough that two lines blur into one
(Portugal vs Senegal, both green). Measure plain RGB distance and fall back to a clearly
distinct pair when it's under 90:

```js
if (dist(hex(colH), hex(colA)) < 90) { colH = "#9d6bff"; colA = "#ff6a3d"; }   // purple / orange
```
Reference: `match.js buildMomentum` ~229.

**Darkness** — a near-black kit (Germany `#000000`) disappears against `--bg`. Compute
perceived luminance and lift the colour when it's under 60:

```js
if (0.299*r + 0.587*g + 0.114*b < 60) col = "#9d6bff";
```
Reference: `app.js bkColors` ~2998, which applies the darkness guard to each side *first*
and then the collision check — order matters, because lifting both sides can create a new
collision.

`renderer.py::_dark_safe_color` ~295 is the PNG-side equivalent for the dark theme.

The fallback pair is `#9d6bff` / `#ff6a3d` everywhere. Keep it consistent: a reader who
learns that purple/orange means "kit colours were unusable" can read every chart on the
site.

## Rating colours

Player match ratings use one three-stop scale, so a 7.4 is the same colour in the PNG
line-up and in the web line-up: `match.js ratingColor` ~1946 and
`renderer.py::_rating_color` ~1159 (`RATING_HIGH` / `RATING_GOOD` / `RATING_LOW` per
theme). Change one, change both.

## PNG themes

`renderer.py::_THEMES` holds a full `light` and `dark` palette; `set_theme(name)` swaps it
by writing the keys into module globals, so panel code just references `TEXT_DARK`,
`PITCH_FACE`, `PANEL_BG` and so on and never branches on the theme.

Adding a colour to one theme means adding it to **both** — a key missing from `dark` stays
bound to whatever `light` last set, which produces a black-on-black label that only shows
up if you actually open the dark PNG. Details in `references/png-renderer.md`.
