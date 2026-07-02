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
  stats/xG/venue; WhoScored = event stream (shots/passes/dribbles) + player ratings;
  SofaScore = stats/xG/lineups (no token).
- **⚠️ OWNER REQUIREMENT — multi-source averaging (see [`DATA_SOURCES.md`](DATA_SOURCES.md)):**
  every match must be scraped from **all three** (FotMob + WhoScored + SofaScore) and the
  **overlapping numeric stats averaged** into the canonical "ultimate" value shown on the
  PNGs and the dashboard. Stats are currently first-available (FotMob-or-SofaScore), not
  yet averaged — moving to the average is the target; don't regress it. Score/goals/maps
  stay single-source (WhoScored). Read `DATA_SOURCES.md` before touching the scrape/merge.
- **Fully automated** via Windows Task Scheduler: `wc2026/register_tasks.ps1` arms one
  task per match (from `REMAINING_SCHEDULE.json`) that runs `py -m wc2026.run_match
  --fotmob-id <id>` at **kickoff+3h**. Tasks have `StartWhenAvailable=True`, so a run
  missed because the **PC was off catches up on next wake** — a stale site is therefore
  almost always the push failing, NOT a missed scrape. Re-run `register_tasks.ps1` after
  editing the schedule (`-Force` overwrites). Inspect with PowerShell `Get-ScheduledTask
  -TaskName "*WC2026*"`.

## Knockout self-heal (so KO ties actually scrape)
- Knockout fixtures are scheduled with **placeholder FotMob ids** and **slot-code names**
  (`2A`, `3ABCDF`, `Winner EF 1`) — left as-is the WhoScored search can't find the game and
  the placeholder id may not exist on FotMob, so the scrape returns nothing. `run_match` step 1
  calls **`wc2026/knockout_resolve.py`** `resolve_fixture(fotmob_id)`: it finds the slot stub,
  resolves both sides to the **real** teams now decided (group standings + FIFA best-third
  allocation + earlier KO results — same logic as the dashboard `buildKnockout`), then
  `find_fotmob_id_by_teams()` rediscovers the **real** FotMob id by date+teams. The scrape then
  runs with real names + the right id, and `fetch_and_save(out_path=…)` forces the result back
  into the original slot-coded stub so the bracket/calendar link it. **No manual id refresh
  needed.** No-op for group games (`resolve_fixture` returns `None`). Run from repo root:
  `py -m wc2026.knockout_resolve <placeholder_id>` to preview a fixture's resolved teams.

## Auto-deploy (how the live site stays current)
- `run_match` step 4 → `git_ops.push_match_update()`: clones the repo to a temp dir and,
  in ONE commit, pushes the PNG **+** regenerated `wc2026_dashboard/{data.js,players.js,
  shots.js,breaks.js,matches_detail/,database/}` **+** the raw match JSON. Needs `GIT_TOKEN` env var.
- It only auto-pushes **generated** files. Edits to dashboard **source**
  (`app.js`, `match.js`, `styles.css`, `match.css`, `*.html`) need a **manual** `git push`.
- The render hook `_refresh_web_dashboard_db()` (renderer.py, runs on EVERY render)
  regenerates ALL dashboard data LOCALLY: the match-detail JS **and** `build_data.py`,
  `build_players.py`, `build_shots.py`, `build_database.py` (CSVs + sqlite + manifest),
  `build_player_lab.py`, `build_breaks.py`. So databases are always fresh after a scrape;
  the **push is a separate step** that can fail independently.

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
  the modified `wc2026_dashboard/{data.js,players.js,shots.js,breaks.js,database/*,
  matches_detail/<id>.js}` + `wc2026/matches/<id>.json`, commit, `git push`. Stage
  specific paths (no `git add -A`).

## Web dashboard build
- `py wc2026_dashboard/build_site.py --serve` → build + serve on :8777
  (visit `http://localhost:8777/wc2026_dashboard/index.html`; server roots at repo root).
- Builders: `build_data.py`→data.js, `build_match_details.py`→matches_detail/<id>.js
  (shots/passes/dribbles/goals/lineups), `build_players.py`→players.js,
  `build_shots.py`→shots.js (every shot tournament-wide: `window.WC_SHOTS`
  `[{t,o,h,x,y,xg,g,ot,s,m}]`, own goals + shootouts excluded — powers Team Lab),
  `build_database.py`→database/, `build_breaks.py`→breaks.js (`window.WC_BREAKS`,
  cooling-break windows — powers the Breaks tab; ALL the math lives in
  `tools/cooling_break_analysis.py::export_breaks` so the tab always agrees with
  `COOLING_BREAK_ANALYSIS.md`; baseline μ/σ + regression control stay **frozen on the
  group stage** on purpose — don't "fix" them to include knockout games).
- **`xg_model.py`** is the shared shot-extraction + xG/xA module that ALL builders import.
  Since 2026-07 it (and `renderer.py`) routes through **`xg_core/`** — a vendored copy of
  XLALIGA's calibrated models (v2 xG artifact + pass-level xA artifact, scored by
  `XGScorer`/`XAScorer`; stdlib-only, lightgbm silently upgrades to the full blend). No
  hard-coded coefficients remain, so site and PNGs agree by construction. **Canonical
  xg_core lives in `XLALIGA\xg_core`** — retrain there, re-copy the folder here. The
  `regen-dashboard-data.yml` CI regenerates data on push and must keep its
  `pip install lightgbm` step, or the site drifts to the LR-only fallback values. For bulk
  PNG re-renders (`tools/render_all.py`) set `WC_SKIP_WEB_REFRESH=1` and run the builders
  once afterwards.

## Match dashboard view (`match.js`)
- **xG momentum** (`buildMomentum`, `#mv-momentum`, near the top under Match stats): a cumulative
  **xG "race"** over the 90 mins — each side's line steps up by every shot's xG (`D.shots`), with
  ⚽ markers at goal minutes (`D.goals`, incl. pens/OGs — OGs carry no xG so they mark without a
  step), an HT dashed line, and a legend showing final xG vs actual goals. Uses `D.home.color`/
  `D.away.color`, but falls back to a distinct blue/orange pair when the two team colours are too
  close (hex distance < 90) so the lines never blur together.
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
- **Goal replays** (`mv-goals-anim`, the section directly **below** All Goals Map): an
  animated "movie" of each goal driven by the same `buildGoalSequences()` data. `▶ Play`
  walks a ball along the build-up (`agmBuildAnimSVG`/`agmAnimateMove` via SVG
  `getPointAtLength`): dotted passes, curved-dotted crosses, **deliberately slower** solid
  dribbles/carries, then the shot into the net + a "Goal!" flash. The **scorer's node runs
  onto the ball** through the final carry (`moveScorer`, skipped for own goals). Per-goal
  tabs, a speed slider, and a **dependency-free WebM export** (`exportGoalVideo` —
  `MediaRecorder` + `canvas.captureStream`, falls back to PNG) with the same header band +
  credit as the PNG. Reuses `agmSeqSVG` as the video backdrop; markers suffixed `…2` to
  avoid `<defs>` id clashes with the static map.
- **Pitch markings** (`pitchMarkup()`): every pitch (shot/pass/dribble/avg-pos maps) draws
  full markings incl. **goal posts/net** (`.pitch-goal`/`.pitch-net`) and the **penalty
  arc** (the "D", `arcR` slice outside the box).
- **Pass explorer**: filter by team/player/**type** — type includes **Progressive** (uses
  the `prog` flag already in the data) alongside key/through/cross/incomplete; plus a
  **Final third** toggle (`paThird` — passes that END in the attacking third, WhoScored
  x ≥ 66.7). Minute timeline with scrub + ▶.
- **Dribbles**: each take-on draws a **carry-direction arrow** (`drArrG`/`drArrR` markers,
  green=success/red=fail) from the take-on dot to the next touch (`ex/ey`); hover tooltip
  retained. Team/player/outcome filters + minute ▶.
- **Average position** (`buildAvgPos`, `mv-avgpos`, **under Pass network**): per-minute
  average-position shape with a **window selector + ▶ play button** (like the pass-explorer
  timeline). As subs happen the leaving player's node is removed and the incoming player's
  node appears, so you can watch the shape change across phases of the game.
- **`build_match_details.py` per-match exports**: `shots[]` (`cross/key/through/prog`
  flags, `body`), `passes[]` (`prog`/`cross`/`key`/`through`/`x,y,ex,ey`), `dribbles[]`
  (`ex/ey` carry end), **`saves[]`** (keeper saves → rebound nodes), `goals[]` (with
  `own`/`pen`), `lineups`.

## Main dashboard view (`app.js`)
- **Knockout bracket** (`renderBracket`, main page): Round-of-32 → final, results once
  played else the slot placeholder (`1A`, `WinnerEF1`, …). Laid out **from both sides into
  the centre** (`.bracket-tree.two-sided { justify-content:center }`).
- **Best third-placed teams** (`renderThirdPlace`/`computeThirds`, `#thirdTable`): ranks the
  12 group third-placed teams (Pts → GD → GF → name); top 8 advance to the R32. Only renders
  once every group has played all matches (`r.P >= 3` for all four rows). The bracket's
  `3ABCDF`-style slot placeholders are **resolved to real teams** via FIFA's Annex C
  allocation table (`FIFA_THIRD_ALLOC`, keyed by the sorted 8-group qualifying combination →
  maps each `1X` group WINNER to the GROUP whose third-placed team it faces). Only the combos
  that can actually occur are listed; if the live combo isn't in the table the bracket keeps
  the `3rd: A/B/..` placeholder. `resolveSlot` consults `computeThirds().assignByCode` to fill
  the slots.
- **Tab order** (`nav.tabs`): Tables · Matches · Players · Standouts · Team Lab · Player Lab ·
  **Breaks** · xG Analysis · Data · Power Rank. Tab switching is `data-view`-driven (a button's
  `data-view="x"` toggles `#view-x`), so reordering is pure HTML — see `app.js` ~line 148.
- **Breaks** (`#view-breaks`, `renderBreaks`/`initBreaks`, `app.js`): cooling-break analysis
  from `window.WC_BREAKS` (breaks.js). KPI stat tiles, a per-match **momentum river** (rolling
  momentum differential with shaded break bands + HT line + goal markers; team colours with a
  darkness guard + the blue/orange collision fallback à la `match.js` `buildMomentum`), a
  clickable per-match diverging **shift strip** vs baseline churn (μ/+1σ guides), pre→post pace
  **dumbbells** (PPDA on its own scale), and a dominant-vs-chasing **slopegraph** whose grey
  bands show the regression-to-mean control — keep that honesty device. Filters: break 1/2,
  5/7/10-min window, Group/All, dominance rule. Detected break minutes are inferred from
  event-stream dead gaps (see `COOLING_BREAK_ANALYSIS.md`); stage codes come from
  `_stage_code()` (stage string + slot-coded id — raw `wc_metadata.stage` lies on overwritten
  KO stubs).
- **Power Rank & Predictions** (`renderPower`/`predictAll`, `#view-predict`, after Data): a Power
  Index for the 32 Round-of-32 teams = hardcoded `FIFA_PTS` (FIFA/Coca-Cola
  ranking, 11 Jun 2026 — top ~45 published, lowest few approximated) **+** a ±100-capped
  group-stage form adjustment (`powerRating`: pts/game, GD/game, xGD/game from `AGG`). `winProb`
  (Elo-style, 400-pt scale) + `predictScore` drive a favourite-advances simulation of every
  knockout tie to a predicted champion. `buildKnockout()` (shared with `renderBracket`) provides
  the linked R32→Final tree + `resolveSlot`; `predictAll` recurses it, projecting each tie from
  the predicted winners feeding it (third-place = the two beaten semi-finalists). Deterministic
  projection, not a full bracket-probability sim.
- **Scatter charts** (`teamScatter`, shared): powers the attack-vs-defence quadrant,
  expected-points, and **Quality vs quantity of shots** views. That last one passes
  `centerAvg:true` → axes span `0 .. avg + max-distance-from-avg` per axis so the avg
  lines sit near centre with no dead space and no clipped outliers (instead of the default
  `niceMax`-padded fit, which squashed the dots to the bottom).
- **Standouts** (`#view-standouts`, `renderStandouts`/`renderScatter2`/`renderRadar`, all in
  `app.js`): a player-analysis tab, all client-side from `window.WC_PLAYERS`, tied together by one
  **spotlight-player** picker (`soState.player`). Four linked tools: (1) a **distribution / KDE**
  density plot for any stat — every player a jittered dot, mean line, ≥2σ dots pink, spotlight gold
  + percentile; (2) **"the unique ones"** σ-ranked anomaly list; (3) a **two-stat scatter**
  (`soScatterSVG`) with a 3rd stat as dot size, quadrant mean lines, and **preset chips**
  (`SO_PRESETS`: Solid defenders, Shot blockers, Shot-stoppers, Creators, Ball winners, Finishers,
  Dribble & create); (4) a **percentile radar** (`radarSVG`) vs same-position peers (90+ min),
  role-specific axes for outfield vs GK. Stat list = `SO_STATS`.
- **Player metrics** (`build_players.py`, in `players.js`): besides the basics it now aggregates
  from the event stream — `progPasses` (successful passes advancing ≥15 x toward goal), `xa`
  (expected assists: each shot's xG credited to the key passer who set it up), `xga`/`xga90`
  (opponent xG faced **while on the pitch**), `gPrev` (goals prevented = xG faced − goals conceded
  on pitch; for keepers = shot-stopping), `blocks` (outfielder shot blocks = `Save`+`OutfielderBlock`
  qualifier), `clrBox` (clearances inside own penalty area). xG-faced/gPrev is *team-on-pitch*
  context (teammates sharing minutes share the value); for keepers it's individual.
- **Team Lab** (`#view-teamlab`, `renderTeamLab`/`tlShotMap`/`tlRadar`/`tlTeamStyle`, `app.js`):
  team-analysis tab driven by `window.WC_SHOTS` (`shots.js`) + the `data.js` team stats. A
  **shot map / xG heatmap** on a half-pitch drawn goal-at-top / attacking ↑ (`tlPitch`), per-team
  or all, filterable by outcome (all/on-target/goals) and situation (open/set/pen), with **Shot
  dots** (sized by xG) and **xG heatmap** (zone-shaded) modes; plus a per-team **style
  fingerprint** percentile radar (possession, shots/game, xG/game, xG/shot, set-piece xG share,
  pass accuracy, defensive solidity = −xGA/game) vs all teams.

## Gotchas (read before editing)
- **Knockout fixtures = slot-coded stubs**: each KO match ships as a tiny stub JSON named by
  its slot code (`2026_06_28_2A_vs_2B.json`, `..._Winner_EF_1_vs_Winner_EF_2.json`) so the
  bracket/calendar have something to link before teams are known. When a KO tie is played,
  FotMob returns the **real** team names — naming the scraped file after them would leave the
  stub as a duplicate calendar row **and** give the result an id the bracket can't parse (the
  bracket keys off the `2A_vs_2B` slot code in the id). So `scraper._output_path` calls
  `_existing_file_for_id(fotmob_id)` and **overwrites the stub in place** (same slot filename,
  real content). Don't "fix" the scraper to name KO files by team — it re-introduces both bugs.
- **Calendar shows possible KO teams** (`matchDisplay`/`koSide` in `app.js` `renderMatches`):
  unplayed KO fixtures resolve their slot codes via `buildKnockout()` — R32 → the real two
  teams (groups done), a side waiting on one earlier tie → the two candidates (`A / B`,
  italic), a side waiting on a whole sub-bracket → the `Winner R16 #n` placeholder. Updates by
  itself as results land. Played KO games already carry real names (see stub gotcha) and pass
  straight through. A `ko-stage` chip tags the round.
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
