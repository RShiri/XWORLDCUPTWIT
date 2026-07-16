# ROADMAP — Multi-World-Cup platform (2018 · 2022 · 2026), then Tier 2/3

**North star:** one futuristic-first site where every World Cup edition gets the full
dashboard treatment we built for 2026 — same xG model, same visuals — plus an **Eras**
view that compares tournaments against each other. Priority order: this multi-cup work
first, then Tier 2, then Tier 3 (both appended at the bottom).

**Ground rules (the "don't break anything" contract)**
1. The live 2026 pipeline (`wc2026/run_match.py` → scheduler → auto-deploy) is untouched.
   Every 2026 output keeps its **exact current path and byte-identical content**; CI gets a
   check that proves it.
2. Historical **raw** match JSONs are **never committed** — 2026 raws already weigh 213 MB
   for 104 games (~2 MB/game); two 64-game editions would add ~260 MB to a repo already at
   ~630 MB. Raws live in a git-ignored `history/` dir on the scraping machine and are
   archived as a **zipped GitHub Release asset** for reproducibility. Only **generated**
   artifacts (~25 MB/edition: data.js, players.js, shots.js, matches_detail/, database/)
   are committed.
3. The scrape itself runs **on the owner's Windows machine** (same as the live pipeline).
   Verified: the cloud dev container cannot reach FotMob/WhoScored (proxy policy), so the
   deliverable is a one-command backfill runner, not a cloud scrape.

---

## Phase A — Historical data acquisition (2018 Russia, 2022 Qatar)

> **STATUS: SHIPPED — dispatchable.** Actions → **backfill-scrape** → Run workflow.
> Run order: `year=2022, mode=smoke` first (3 matches — proves whether WhoScored's
> Cloudflare admits a datacenter runner); if the summary shows full scrapes, re-run
> with `mode=full, publish=release` (~2–3 h). If smoke returns "without events", run
> the identical `py tools/scrape_history.py 2022` on the home PC instead (resumable,
> same files), then `--pack` and upload the zip to the `wc2022-raw` release. Repeat
> for 2018. Raws stay git-ignored either way.

**A1 · Fixture discovery.** New `tools/wc_history_fixtures.py` builds a per-edition fixture
list `history/wc<year>/fixtures.json` (`[{fotmob_id, home, away, date, stage}]`, 64 rows each)
from FotMob's league endpoint (World Cup = league 77; 2018/2022 seasons) with a hand-checkable
fallback (the file is plain JSON — easy to curate if an endpoint changed). WhoScored and
FotMob both retain full event/stat archives for 2018 and 2022.

**A2 · Backfill runner.** New `tools/scrape_history.py <year>`:
- loops the fixture list; for each row builds the same `xml_match` stub `run_match` uses and
  calls `scraper.fetch_and_save(fotmob_id, xml_match=stub, out_path=history/wc<year>/matches/<id>.json)`
  — real team names + dates drive the WhoScored search exactly like the knockout self-heal path;
- takes `scrape_lock()`, is **resumable** (skips files that already exist and pass the
  crash-stub check from `tools/catchup.py::_is_real`), supports `--fotmob-only` as a degraded
  fallback, and sleeps politely between games (64 games ≈ 2–4 h wall-clock per edition);
- **run on the owner's PC**: `py tools/scrape_history.py 2022` then `py tools/scrape_history.py 2018`.

**A3 · Storage policy.** `history/` is git-ignored. After each edition completes:
`py tools/scrape_history.py <year> --pack` zips the raws; upload as a GitHub Release asset
(`wc<year>-raw-v1.zip`). The Data tab's "raw match files" note points there for history.

**Format notes captured now:** 2018/2022 = 32 teams, 8 groups (A–H), knockout enters at the
**Round of 16**, no best-thirds rule; 2018 group tiebreak = fair play points (affects one
table: Japan/Senegal); both editions have shootouts; WhoScored event coverage incl.
GoalMouthY/Z exists for both, so shot maps, goal-placement, momentum, WP and the All Goals
Map all work unchanged. Our own calibrated xG model scores every era — one methodology,
true cross-era comparability (a differentiator vs. sites that mix vendor xG).

## Phase B — Multi-edition build system

- New `wc2026_dashboard/editions.py`: the single registry
  `EDITIONS = {2026: {match_dir, out_dir=".", groups="A..L", ko_entry="R32", thirds=True},
  2022: {match_dir="history/wc2022/matches", out_dir="editions/2022", groups="A..H",
  ko_entry="R16", thirds=False}, 2018: {…}}`.
- Every builder (`build_data/players/shots/match_details/database/player_lab`) gains
  `--edition` (default 2026). **2026 default = today's paths and behavior, unchanged.**
  Historical outputs land in `wc2026_dashboard/editions/<year>/…` with the same
  `window.WC_*` payload shapes plus an `edition` field.
- `build_site.py --edition 2022` builds one edition; `--all` sweeps all three.
- Skipped for history (by design, not by accident): `build_breaks` (cooling-break baselines
  are frozen on 2026 group stage) and Power-Rank inputs (FIFA_PTS is a 2026-dated snapshot;
  per-edition snapshots are a possible later add).
- **CI guard:** `regen-dashboard-data.yml` gains a step that rebuilds 2026 and fails if any
  tracked 2026 output changed vs. the committed files whenever `editions/` code is touched —
  the executable form of ground rule #1.

## Phase C — Edition-aware frontend

- **URL contract:** `?edition=2018|2022|2026` on `index_futuristic.html` / `index.html` /
  `match.html` (default 2026). The existing cache-busted `document.write` loader resolves
  data paths per edition; header gains edition pills **2018 · 2022 · 2026**.
- **Format-aware views:** `buildKnockout` gets a small format shim — 8-group editions parse
  `1A_vs_2B`-style R16 slot ids and skip the thirds table/`FIFA_THIRD_ALLOC`; the bracket
  tree renders R16→F (+ third-place match). Tables render 8 groups. 2018's fair-play
  tiebreak is applied in `build_data` standings for that edition only.
- **Tabs per edition:** historical editions show Tables, Story, Awards, Matches, Players,
  Standouts, Team Lab, Player Lab, xG Analysis, Data; **Breaks and Power Rank stay
  2026-only** (hidden pills elsewhere). Story's hero/roads/records and Awards work as-is —
  they only read the edition's data files.
- **Assets:** extend `tools/download_badges.py` for historical nations missing from
  `team_logos/wc2026/` (e.g. Russia, Peru, Iceland, Costa Rica…); share cards write to
  `share/<edition>/…` for history (2026 stays at `share/<id>.html` — no link breakage).

## Phase D — Futuristic by default

- Root `index.html` redirect → `wc2026_dashboard/index_futuristic.html`.
- Skin toggle flips: futuristic is home, "Classic view" is the escape hatch. All internal
  links (`match.html` back-links, share-shim redirects) preserve the chosen skin + edition.
- One-line rollback (revert the redirect) if it ever needs undoing.

## Phase E — "Eras" comparison view (the xG-Analysis of tournaments)

New tab on the futuristic home, loading all editions' `data.js`/`players.js`/`shots.js`
under namespaced globals (`window.WC_DATA_2018` …):
- **Headline tiles per cup:** goals/game, our-model xG/game, xG/shot, set-piece share,
  penalties + shootouts, comebacks, upsets count.
- **Era scatter:** every team-tournament as a dot (attack xG/g vs defence xGA/g), colored by
  edition — the quadrant chart, across eras.
- **Champions compared:** style-fingerprint radar overlay of the three champions; their
  roads side-by-side.
- **Golden Boot eras:** top scorers of each cup on one bar scale; finishing (G−xG) leaders.
- **Trend strip:** 2018 → 2022 → 2026 lines for goals/game, pens/game, xG/game (VAR &
  stoppage-time eras visible in data).

## Phase F — Guardrails & CI for three editions

- `tests/test_bracket_parity.py` becomes edition-aware where it applies (2026 full checks;
  historical editions: round-integrity + resolver-vs-stored + no-team-twice, using the R16
  format shim). Runs for `editions/` outputs in the same workflow.
- The 2026 byte-identity check from Phase B wired into `bracket-parity.yml` (fast job).
- Playwright smoke (local, pre-PR): each edition × both skins × all visible tabs, zero
  console errors — same bar every merge in this repo has met so far.

**Sequencing & rough effort:** B (M) and A-code (S) land first in one PR (runner + registry,
no data). Owner runs A on the PC (2–4 h/edition, can run overnight; 2022 first). Then C (L),
D (S), E (M), F (S) as separate PRs, each browser-verified. Nothing blocks the 2026 live
pipeline at any point; the final on Jul 19 scrapes exactly as today.

---

## Future plan — after the multi-cup platform

### Tier 2 (archive mode)
1. **Multi-source averaging** — FotMob + WhoScored + SofaScore overlapping stats averaged
   into the canonical value (the standing owner requirement in `DATA_SOURCES.md`); freeze
   the archive on the final methodology.
2. **Player similarity** — "players like X" from percentile distance over per-90s (FBref
   retired theirs in Jan 2026; the machinery half-exists in Standouts).
3. **Global search** — players/teams/matches, client-side, in the header.
4. **Penalty-shootout lab** — every shootout kick (placement, order, pressure) across
   editions; data already in the raws.
5. **Prediction post-mortem** — how the Power Rank did: Brier score, upsets missed.
6. **Discipline board** — cards per team/player/match; goals-by-venue board.
7. **PWA / offline archive** — installable, works offline for the next four years.

### Tier 3 (infra & stretch)
1. **Lazy-load heavy data** — `breaks.js`/`shots.js` (and per-edition files) on tab open.
2. **Data-quality page** — per-source coverage from `team_match_stats_by_source`.
3. **xT zone model** — possession-value grid on top of the event stream (needs training in
   XLALIGA's `xg_core` first; vendored copy follows, per the house rule).
