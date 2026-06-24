# 🏆 FIFA World Cup 2026 Match Analytics & Infographics

Welcome to the **FIFA World Cup 2026 Match Analytics & Infographics** repository! This project hosts the complete, production-ready pipeline for scraping, processing, rendering, and publishing high-resolution post-match infographics for the World Cup 2026 tournament.

Originally part of the `BCNFINAL` project, this codebase and its national team assets have been fully migrated here to decouple World Cup match operations from Barcelona-specific analytics.

---

## 📂 Repository Structure

```
XWORLDCUPTWIT/
├── wc2026/                    # Core pipeline package
│   ├── matches/               # Scraped match event JSON caches
│   ├── output/                # Rendered infographic PNGs (git-ignored)
│   ├── download_badges.py     # Batch flag downloader script
│   ├── git_ops.py             # Temp-clone git publishing module
│   ├── pipeline.py            # File watcher and FastAPI webhook server
│   ├── register_tasks.ps1     # Scheduled task automation script (Windows)
│   ├── unregister_tasks.ps1   # Scheduled task cleanup script (Windows)
│   ├── renderer.py            # Matplotlib / mplsoccer infographic generator
│   ├── run_match.py           # CLI orchestrator entrypoint
│   ├── scrape_wc.py           # WhoScored crawler and parser
│   ├── scraper.py             # FotMob data acquisition module
│   ├── whoscored_ids.json     # WhoScored tournament match ID mapping
│   ├── REMAINING_SCHEDULE.json# Compiled match kick-offs and scrape times
│   └── README.md              # Package-specific setup guide
├── team_logos/
│   └── wc2026/                # High-resolution circular nation crests
├── WorldCup2026/              # Archive of published match infographics
├── .gitignore                 # Secrets, cache, and temp file patterns
├── .env.template              # Environment variables template
└── MIGRATION_AND_DEVELOPER_DOCS.md # Full technical and architecture documentation
```

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

For a full breakdown of the architecture, data structures, and the migration history, see the [MIGRATION_AND_DEVELOPER_DOCS.md](file:///c:/Users/puzik/XWORLDCUPTWIT/MIGRATION_AND_DEVELOPER_DOCS.md).

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
