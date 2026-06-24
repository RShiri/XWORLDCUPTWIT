# CLAUDE.md — project guide for AI sessions

WC2026 match analytics. Two outputs from one scraped dataset:
1. **PNG infographics** — `wc2026/renderer.py` (matplotlib/mplsoccer), published to `WorldCup2026/`.
2. **Interactive web dashboard** — `wc2026_dashboard/` static site, live on GitHub Pages:
   **https://rshiri.github.io/XWORLDCUPTWIT/** (root `index.html` redirects to `wc2026_dashboard/index.html`).

## Pipeline
- One-shot per match: `py -m wc2026.run_match --fotmob-id <id>` (or `--from-file <json>`).
  Flags: `--no-push` (skip git), `--no-post` (skip WhatsApp). Scrapes FotMob + WhoScored
  → renders PNG → refreshes local dashboard data → **auto-deploys** to the live site.
- Data sources merge per match JSON in `wc2026/matches/<id>.json`: FotMob = match
  stats/xG/venue; WhoScored = event stream (shots/passes/dribbles) + player ratings.

## Auto-deploy (how the live site stays current)
- `run_match` step 4 → `git_ops.push_match_update()`: clones the repo to a temp dir and,
  in ONE commit, pushes the PNG **+** regenerated `wc2026_dashboard/{data.js,players.js,
  matches_detail/,database/}` **+** the raw match JSON. Needs `GIT_TOKEN` env var.
- It only auto-pushes **generated** files. Edits to dashboard **source**
  (`app.js`, `match.js`, `styles.css`, `match.css`, `*.html`) need a **manual** `git push`.
- The render hook `_refresh_web_dashboard_db()` regenerates dashboard data LOCALLY only;
  the push is the separate `push_match_update()` step.

## Web dashboard build
- `py wc2026_dashboard/build_site.py --serve` → build + serve on :8777
  (visit `http://localhost:8777/wc2026_dashboard/index.html`; server roots at repo root).
- Builders: `build_data.py`→data.js, `build_match_details.py`→matches_detail/<id>.js
  (shots/passes/dribbles/goals/lineups), `build_players.py`→players.js,
  `build_database.py`→database/.

## Gotchas (read before editing)
- **Live PNGs must be in tracked `WorldCup2026/`**, NOT git-ignored `wc2026/output/`, or
  Infographic-PNG links 404. `find_png` prefers WorldCup2026 then falls back to output.
- **Shot/pass maps**: `match.js` `ty()` flips the across-pitch y (`PH - y` for home) to
  match the PNG/broadcast orientation. Don't "simplify" it away — it un-mirrors the map.
- **Pass network**: starting XI only, passes up to each side's first substitution
  (`subs[0].on`); no minute scrubber — that's the correct convention, don't re-add it.
- **CSS cache-busting**: `index.html`/`match.html` load `styles.css?v=Date.now()` so
  changes reach browsers. Keep that when editing the HTML head.
- **Committing**: the working tree often has unrelated in-progress changes — stage
  specific paths, don't blind `git add -A`. Don't commit `.claude/` (local config).
- No `gh` CLI on this machine; GitHub Pages was enabled via REST API with `GIT_TOKEN`.
- Git auth uses a PAT (credential helper / `GIT_TOKEN`); never print it.

## Verifying dashboard changes
Use the preview tools (`preview_start` with `.claude/launch.json` "wc-dashboard"), navigate
to `/wc2026_dashboard/...`, and check via `preview_eval`/`preview_screenshot`. After
pushing dashboard changes, the live site needs ~1 min + one `Ctrl+F5`.
