# DISPATCH_PROMPT — Execute ROADMAP Phases B–F (multi-World-Cup platform)

> Paste into a dispatched Claude session, or just say: **"Execute DISPATCH_PROMPT.md"**.
> Companion docs: `ROADMAP.md` (the plan) and `CLAUDE.md` (repo rules). Phase A is
> merged (#44); the data side runs separately via Actions → **backfill-scrape**.

---

Execute ROADMAP.md Phases B–F. Read CLAUDE.md and ROADMAP.md first — the plan,
formats, and hard rules live there. Work phase by phase; one PR per phase; verify
each in a real browser (Playwright + the local :8777 server pattern) with zero
console errors before merging. Merge your own PRs (squash, house style) — that
authorization stands for this task.

STATE: Phase A is merged (#44). Raw data arrives as GitHub Release assets
(wc2022-raw / wc2018-raw zips) from the backfill-scrape dispatch workflow — the
owner runs those. Your dev container CANNOT reach external sites or download
Release assets; anything needing the real historical data must run in GitHub
Actions, not locally.

DO, IN ORDER:

**B — Edition-aware builds.** Wire `wc2026_dashboard/editions.py` into all builders
(build_data/players/shots/match_details/database/player_lab) via `--edition`,
default 2026. Historical outputs → `wc2026_dashboard/editions/<year>/…`, same
`window.WC_*` shapes + an `edition` field. build_data must handle 8 groups (A–H),
R16 knockout entry, no thirds, and the 2018 fair-play tiebreak (from editions.py
flags — no hardcoding). Skip breaks/power-rank for history. Develop against a
synthetic 32-team fixture set you generate locally (3–4 fake matches in the 2026
JSON schema). HARD RULE: `python build_*.py` with no args must leave every tracked
2026 output byte-identical — add that as a CI check (bracket-parity.yml fast job)
and prove it locally before the PR.
Also add `.github/workflows/backfill-build.yml` (workflow_dispatch: year):
downloads the wc<year>-raw Release zip with `gh`, unpacks to `history/`, runs the
edition builders, commits ONLY `wc2026_dashboard/editions/<year>/**` to main.
Raws are NEVER committed (`history/` stays git-ignored).

**C — Edition-aware frontend.** `?edition=2018|2022|2026` on index.html /
index_futuristic.html / match.html (default 2026, current URLs unchanged); header
pills 2018·2022·2026; the data loader picks paths per edition; format shim in
buildKnockout for 8-group/R16 slot ids; hide thirds table, Breaks and Power Rank
pills for historical editions; extend tools/download_badges.py for historical
nations (badge fetch runs in a workflow, not the container); share cards →
`share/<edition>/` for history (2026 paths unchanged).

**D — Futuristic default.** Root index.html redirect →
wc2026_dashboard/index_futuristic.html; swap skin-toggle labels; edition + skin
survive all internal links.

**E — Eras tab** (futuristic + classic): loads every available edition's data
under namespaced globals; per-cup headline tiles (goals/game, our-model xG/game,
xG/shot, set-piece share, pens/shootouts, upsets), cross-era team scatter,
champions' style-radar overlay, Golden Boot eras, 2018→2026 trend strip. Render
gracefully when only 2026 exists; light up as editions/<year>/ data lands.

**F — Guardrails.** Extend tests/test_bracket_parity.py edition-aware (round
integrity, resolver-vs-stored, no-team-twice for 8-group editions) + wire into CI.

OPERATIONAL NOTES: main moves under you (live scrapes + CI regen commits) —
rebuild/rebase on origin/main and force-with-lease rather than hand-merging
generated files; never commit timestamp-only churn in data.js/breaks.js/
database/manifest.js; stage specific paths, never `git add -A`; the 2026 final
scrapes ~2026-07-19 22:00 UTC and NOTHING may disrupt that pipeline. If the
wc2022-raw/wc2018-raw releases don't exist yet, still ship B–F fully verified on
synthetic data and state exactly which dispatch the owner runs to light each
edition up.

---

## Owner's checklist (outside the dispatched session)

1. Actions → **backfill-scrape** → `year=2022 · mode=smoke` (Cloudflare check, ~10 min).
2. Summary shows full scrapes → re-run `year=2022 · mode=full · publish=release`
   (~2–3 h). "Without events" instead → run `py tools/scrape_history.py 2022` on the
   home PC (resumable), then `--pack` and upload the zip to the `wc2022-raw` release.
3. Repeat for 2018.
4. After Phase B merges: Actions → **backfill-build** → `year=2022` (then 2018) to
   publish each edition's dashboard data.
