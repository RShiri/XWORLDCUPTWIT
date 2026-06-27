# CLAUDE.md — project guide for AI sessions

WC2026 match analytics. Two outputs from one scraped dataset:
1. **PNG infographics** — `wc2026/renderer.py` (matplotlib/mplsoccer), published to `WorldCup2026/`.
2. **Interactive web dashboard** — `wc2026_dashboard/` static site, live on GitHub Pages:
   **https://rshiri.github.io/XWORLDCUPTWIT/** (root `index.html` redirects to `wc2026_dashboard/index.html`).

## Repo layout (what's load-bearing)
- **`wc2026/` = the LIVE pipeline only**: `run_match.py` (entry), `scraper.py`,
  `renderer.py`, `git_ops.py`, `team_colors.py` (+ `register_tasks.ps1`/`unregister_tasks.ps1`
  for the Windows scheduler, and `matches/`, `whoscored_ids.json`, `REMAINING_SCHEDULE.json`).
- **`tools/` = maintenance / one-time / legacy**, NOT on the automated path: `schedule.py`,
  `catchup.py`, `scrape_wc.py`, `render_all.py`, `push_all_pngs.py`, `patch_ws_players.py`,
  `download_badges.py`, `generate_placeholders.py`, and the legacy `pipeline.py` +
  `twitter_bot.py`. Run from repo root: `py tools/<script>.py`. See `tools/README.md`.
- **`wc2026_dashboard/` = the website** (source + generated `data.js`/`players.js`/
  `matches_detail/`/`database/`). **`WorldCup2026/` = published PNGs.**

## Pipeline
- One-shot per match: `py -m wc2026.run_match --fotmob-id <id>` (or `--from-file <json>`).
  Flags: `--no-push` (skip git), `--no-post` (skip WhatsApp). Scrapes FotMob + WhoScored
  → renders PNG → refreshes local dashboard data → **auto-deploys** to the live site.
- Data sources merge per match JSON in `wc2026/matches/<id>.json`: FotMob = match
  stats/xG/venue; WhoScored = event stream (shots/passes/dribbles) + player ratings.
- **Fully automated** via Windows Task Scheduler: `wc2026/register_tasks.ps1` arms one
  task per match (from `REMAINING_SCHEDULE.json`) that runs `py -m wc2026.run_match
  --fotmob-id <id>` at **kickoff+3h**. Tasks have `StartWhenAvailable=True`, so a run
  missed because the **PC was off catches up on next wake** — a stale site is therefore
  almost always the push failing, NOT a missed scrape. Re-run `register_tasks.ps1` after
  editing the schedule (`-Force` overwrites). Inspect with PowerShell `Get-ScheduledTask
  -TaskName "*WC2026*"`.

## Auto-deploy (how the live site stays current)
- `run_match` step 4 → `git_ops.push_match_update()`: clones the repo to a temp dir and,
  in ONE commit, pushes the PNG **+** regenerated `wc2026_dashboard/{data.js,players.js,
  matches_detail/,database/}` **+** the raw match JSON. Needs `GIT_TOKEN` env var.
- It only auto-pushes **generated** files. Edits to dashboard **source**
  (`app.js`, `match.js`, `styles.css`, `match.css`, `*.html`) need a **manual** `git push`.
- The render hook `_refresh_web_dashboard_db()` (renderer.py, runs on EVERY render)
  regenerates ALL dashboard data LOCALLY: the match-detail JS **and** `build_data.py`,
  `build_players.py`, `build_database.py` (CSVs + sqlite + manifest). So databases are
  always fresh after a scrape; the **push is a separate step** that can fail independently.

### ⚠️ Silent-push-failure (the #1 reason the site goes stale)
- `git_ops._run()` forces `-c credential.helper=`, so the bot can auth **only** via
  `GIT_TOKEN` — NOT your Git Credential Manager. If `GIT_TOKEN` is **missing or expired**,
  the clone (public read) and local commit succeed but `git push` fails. `run_match.py`
  catches it as **non-fatal** (`"Git push failed (continuing)"`) and moves on — leaving the
  rendered PNG in git-ignored `wc2026/output/` and the refreshed `data.js`/`players.js`/
  `database/`/`matches_detail/` **uncommitted in the working tree**, site unchanged.
- **Diagnose:** recent "deploy" commits authored by **Ram**, none by **WC2026 Analytics
  Bot** ⇒ auto-push has never landed. Validate the token (never print it):
  `curl -s -H "Authorization: token <TOKEN>" https://api.github.com/user` must return your
  login, not `Bad credentials` (401 = expired/revoked/typo'd, even if format looks right).
- **Recover a stuck match manually:** copy `wc2026/output/<id>.png` →
  `WorldCup2026/<id>.png` (tracked, else the Infographic link 404s), then stage that PNG +
  the modified `wc2026_dashboard/{data.js,players.js,database/*,matches_detail/<id>.js}` +
  `wc2026/matches/<id>.json`, commit, `git push`. Stage specific paths (no `git add -A`).

## Web dashboard build
- `py wc2026_dashboard/build_site.py --serve` → build + serve on :8777
  (visit `http://localhost:8777/wc2026_dashboard/index.html`; server roots at repo root).
- Builders: `build_data.py`→data.js, `build_match_details.py`→matches_detail/<id>.js
  (shots/passes/dribbles/goals/lineups), `build_players.py`→players.js,
  `build_database.py`→database/.

## Match dashboard view (`match.js`)
- **All Goals Map** (last section on each match page, below all stats): a per-goal,
  Opta-style build-up reconstructed from `D.shots`/`D.passes`/`D.dribbles`/`D.saves` —
  numbered shirt-# touch nodes, **dotted** passes, **curved dotted** crosses (`p.cross`),
  **solid** carries/dribbles, orange move-start, red shot (scorer + xG floated above the
  node), and a grey keeper-save node for rebounds. Home attacks ▶, away ◀ (dir label
  matches side). Own goals appear as a single red **"OG"** node labelled "Own goal" at the
  beneficiary's attacking end (coords mirrored 180° in `build_match_details`, since the raw
  event sits at the conceding team's end). Reuses `tx()/ty()/pitchMarkup()`; 0–0 render nothing. A per-goal **"Download PNG"** button serialises that goal's
  SVG→canvas (dependency-free) with a metadata header (teams+score · stage · date ·
  scorer+min) and an "All rights reserved to @RShiri" credit. `AGM_MAX_SEG` drops any
  diagram segment longer than ~half the pitch (defends against glitched source coords).
- **`build_match_details.py` per-match exports**: `shots[]` (`cross/key/through/prog`
  flags, `body`), `passes[]`, `dribbles[]`, **`saves[]`** (keeper saves → rebound nodes),
  `goals[]` (with `own`/`pen`), `lineups`.

## Gotchas (read before editing)
- **Own goals**: WhoScored stores an own goal with `isOwnGoal:true`, the **conceding**
  team's `teamId`, and coords at that player's own-goal end. `build_match_details.py` and
  `renderer.py` credit it to the **opponent** (timeline `own:true`, shown "(OG)") and keep
  it **out of `shots[]` / the shot map** — otherwise the wrong team is credited and the
  shot map / All Goals Map plot a bogus goal at the wrong end (drew a line across the whole
  pitch). Detect via `isOwnGoal or "OwnGoal" qualifier`. Team `score` totals come from the
  scraper feed and are already correct.
- **Concurrent scrapes**: `wc2026/_runlock.py` (`scrape_lock`) serialises scrapers so two
  Task-Scheduler matches firing together don't collide on the shared undetected-chromedriver
  (WinError 183 / wedged Chrome). `renderer.render_wc_dashboard` raises a clear error on an
  empty stub instead of dividing by zero; `tools/catchup.py` `_is_real` treats a crash-stub
  (has `_sources/_scraped_at` but no events/lineups) as incomplete so the daily sweep retries.
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
