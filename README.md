# 🏆 FIFA World Cup 2026 Match Analytics & Infographics

Welcome to the **FIFA World Cup 2026 Match Analytics & Infographics** repository! This project hosts the complete, production-ready pipeline for scraping, processing, rendering, and publishing high-resolution post-match infographics for the World Cup 2026 tournament.

Originally part of the `BCNFINAL` project, this codebase and its national team assets have been fully migrated here to decouple World Cup match operations from Barcelona-specific analytics.

---

## 📂 Repository Structure

```
XWORLDCUPTWIT/
├── wc2026/                    # Core pipeline package (live per-match flow ONLY)
│   ├── matches/               # Scraped match event JSON caches
│   ├── output/                # Rendered infographic PNGs (git-ignored)
│   ├── run_match.py           # CLI orchestrator entrypoint (scrape→render→push→post)
│   ├── scraper.py             # FotMob data acquisition module
│   ├── renderer.py            # Matplotlib / mplsoccer PNG generator (+ refreshes dashboard)
│   ├── git_ops.py             # Temp-clone git publishing module
│   ├── team_colors.py         # National team colour palettes
│   ├── register_tasks.ps1     # Windows Task Scheduler: arm one task per match
│   ├── unregister_tasks.ps1   # Windows Task Scheduler: remove WC2026 tasks
│   ├── whoscored_ids.json     # WhoScored tournament match ID mapping
│   ├── REMAINING_SCHEDULE.json# Compiled match kick-offs and scrape times
│   └── README.md              # Package-specific setup guide
├── tools/                     # Maintenance / one-time / legacy scripts (NOT the live flow)
│   ├── schedule.py            # Fetch fixtures from FotMob → REMAINING_SCHEDULE.json
│   ├── catchup.py             # Backfill matches whose scheduled run was missed
│   ├── scrape_wc.py           # Manual WhoScored scraper (CAPTCHA by hand)
│   ├── render_all.py          # Re-render every cached match JSON
│   ├── push_all_pngs.py       # Bulk-push re-rendered PNGs in one commit
│   ├── patch_ws_players.py    # Backfill player ratings on FotMob-only JSONs
│   ├── download_badges.py     # One-time flag downloader (flagcdn.com)
│   ├── generate_placeholders.py # One-time shield-crest badge generator
│   ├── pipeline.py            # LEGACY file-watcher pipeline (superseded by run_match)
│   ├── twitter_bot.py         # LEGACY X/Twitter posting (live flow uses WhatsApp)
│   └── README.md              # Per-script guide
├── wc2026_dashboard/          # Interactive static website (auto-deployed per match)
├── team_logos/wc2026/         # High-resolution nation crests
├── WorldCup2026/              # Archive of published match infographics
├── .gitignore                 # Secrets, cache, and temp file patterns
├── .env.template              # Environment variables template (copy → .env)
├── CLAUDE.md                  # Guide for AI sessions (start here)
└── MIGRATION_AND_DEVELOPER_DOCS.md # Full technical and architecture documentation
```

> **`wc2026/` = the live pipeline; `tools/` = everything you run by hand.** The Windows
> scheduled tasks invoke only `py -m wc2026.run_match`, so nothing in `tools/` is on the
> automated path. Run `tools/` scripts from the repo root: `py tools/<script>.py`.

---

## 🚀 Setup & Installation

### 1. Requirements
* Python 3.10+
* Google Chrome (installed on host machine for WhoScored scraping)
* Windows OS (for Task Scheduler integration)

Install Python dependencies:
```bash
pip install -r wc2026/requirements.txt
```

### 2. Environment Configuration
Copy `.env.template` to `.env` at the root of the repository:
```bash
cp .env.template .env
```
Open `.env` and configure your credentials:
* `GIT_TOKEN`: GitHub Personal Access Token with write access to this repository.
* `WHATSAPP_PROVIDER` & credentials (e.g., Twilio or CallMeBot) to receive push alerts.
* `WC2026_VISIBLE=1`: Runs the browser in visible mode to bypass Cloudflare bot checks when scraping WhoScored.

---

## ⚙️ How to Run

### Run a Match Report Manually
Use `run_match.py` to trigger the scraping, rendering, uploading, and notification pipeline:
```bash
# Option A: Scrape a live/completed match using a FotMob ID
py -m wc2026.run_match --fotmob-id 4667812

# Option B: Run the pipeline using a pre-scraped local JSON file
py -m wc2026.run_match --from-file wc2026/matches/2026_06_17_Argentina_vs_Algeria.json

# Option C: Run without pushing to Git or sending alerts (local test)
py -m wc2026.run_match --fotmob-id 4667812 --no-push --no-post
```

### Automate Scrapes via Windows Task Scheduler
The system automatically parses the tournament schedule to register a Single-Trigger Scheduled Task for each remaining match. The task runs at **kick-off + 3 hours** — enough margin to clear stoppage time/VAR so the scrape captures the finalized score (was +2h, which occasionally snapshotted a match still in injury time). After editing `REMAINING_SCHEDULE.json`, re-run `register_tasks.ps1` to apply new trigger times (it overwrites existing tasks with `-Force`).

Run from PowerShell (elevated/admin prompt recommended):
```powershell
# Register tasks for all remaining matches
powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1

# Register tasks only for the next 5 days
powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1 -DaysAhead 5

# Check what would be registered (Dry Run)
powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1 -WhatIf

# Unregister/Clean up all WC2026 scheduled tasks
powershell -ExecutionPolicy Bypass -File wc2026\unregister_tasks.ps1
```

---

## 🎨 Layout Highlights

The generated infographics are rendered as **5920px × 3419px (30" × 17")** white-canvas layouts containing:
1. **Dynamic Headers**: Aspect-ratio-preserved team badges aligned beside larger, mobile-friendly team names.
2. **Lineup Panels** (outer columns): large, readable starting XI with shirt number, name and color-coded rating, plus a goal ball (`●`) per goal scored and an `A` per assist beside the rating, and a `↓min` exit marker on substituted players. A **SUBS** block lists the used substitutes with their rating and who they came on for (`for <player> <min'>`).
3. **Pass Networks**: Touch-volume scaled nodes and passing lane thresholds, pulled in tight against the central stats table. Home team on the left, away on the right.
4. **Zebra-Striped Stats Table**: High-contrast comparative metrics including passes shown as `accurate/total (accuracy%)`.
5. **Shot Maps**: Attempts sized by individual xG values, with title and stats line rendered inside the axes.
6. **Final Third Passes**: Directional pass vectors into the final third. Home on the left, away on the right, with per-channel (LW/CTR/RW) breakdowns and completion counts below the map.

For a full breakdown of the architecture, data structures, and the migration history, see the [MIGRATION_AND_DEVELOPER_DOCS.md](MIGRATION_AND_DEVELOPER_DOCS.md).

---

## 🌐 Interactive Web Dashboard

Alongside the static PNGs, `wc2026_dashboard/` is a self-contained static website
(group tables, matches, players, an xG efficiency lab, and a per-match **Match Centre**
with shot map, pass explorer, dribbles, pass network and line-ups). It is published with
**GitHub Pages** and is live at **https://rshiri.github.io/XWORLDCUPTWIT/**.

**It auto-deploys per match.** Running a match through `run_match` (without `--no-push`)
publishes, in one commit, the infographic PNG **and** the regenerated dashboard data
(`data.js`, `players.js`, `matches_detail/<id>.js`, the SQLite/CSV export) plus the raw
match JSON — so the live website updates automatically the same way the PNG does. Only
generated outputs are auto-pushed; edits to the dashboard *source* (`app.js`, `match.js`,
CSS, HTML) need a manual `git push`. See [wc2026_dashboard/README.md](wc2026_dashboard/README.md)
for the full feature list and build commands.

> ⚠️ **The auto-push needs a VALID `GIT_TOKEN`.** `git_ops` deliberately disables the
> system credential manager, so the bot can authenticate **only** via `GIT_TOKEN` from
> `.env`. If that token is missing or expired, the push fails **silently** —
> `run_match` logs `Git push failed (continuing)` and moves on, leaving the rendered PNG
> and refreshed dashboard files sitting **uncommitted in your working tree** while the
> live site stays stale. Tell-tale sign: recent "deploy" commits are authored by you, not
> by `WC2026 Analytics Bot`. Sanity-check the token with:
> `curl -s -H "Authorization: token <TOKEN>" https://api.github.com/user` — it must return
> your login, **not** `Bad credentials`. To recover a stuck match, see the recovery steps
> in [CLAUDE.md](CLAUDE.md).
