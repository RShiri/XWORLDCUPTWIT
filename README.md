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
The system automatically parses the tournament schedule to register a Single-Trigger Scheduled Task for each remaining match. The task runs precisely at **kick-off + 2 hours** (expected final whistle).

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
2. **Pass Networks**: Touch-volume scaled nodes and passing lane thresholds. Home team on the left, away on the right.
3. **Zebra-Striped Stats Table**: High-contrast comparative metrics including passes shown as `total/accurate (accuracy%)`.
4. **Shot Maps**: Attempts sized by individual xG values, with title and stats line rendered inside the axes.
5. **Final Third Passes**: Directional pass vectors into the final third. Home on the left, away on the right, with per-channel (LW/CTR/RW) breakdowns and completion counts below the map.

For a full breakdown of the architecture, data structures, and the migration history, see the [MIGRATION_AND_DEVELOPER_DOCS.md](file:///c:/Users/puzik/XWORLDCUPTWIT/MIGRATION_AND_DEVELOPER_DOCS.md).
