"""
FIFA World Cup 2026 – Automated Analytics Pipeline

Watches wc2026/matches/ for new JSON match files.
On detection:
  1. Immediately renders the dashboard PNG via renderer.py
  2. Pushes the PNG to the XWORLDCUPTWIT GitHub repo
  3. Schedules a 25-minute delayed post to X/Twitter

Can also be triggered via HTTP POST webhook (FastAPI).

Usage:
  python -m wc2026.pipeline          # start file watcher + webhook server
  python -m wc2026.pipeline --once <path/to/match.json>  # process one file
"""

from __future__ import annotations

import os
import sys
import json
import time
import logging
import argparse
import threading
from pathlib import Path
from datetime import datetime, timezone

# ── Bootstrap path ────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(_REPO_ROOT / ".env", override=False)

from wc2026.renderer    import render_wc_dashboard, output_filename
from wc2026.git_ops     import push_png_to_xworldcuptwit
from wc2026.twitter_bot import post_match_infographic

log = logging.getLogger("wc2026.pipeline")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [WC2026] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

WATCH_DIR    = _REPO_ROOT / "wc2026" / "matches"
OUTPUT_DIR   = _REPO_ROOT / "wc2026" / "output"
TWEET_DELAY  = int(os.environ.get("WC2026_TWEET_DELAY_SECONDS", 1500))  # 25 minutes
POLL_INTERVAL = int(os.environ.get("WC2026_POLL_SECONDS", 60))

_processed: set[str] = set()  # tracks already-handled files


# ══════════════════════════════════════════════════════════════════════════
# Core processing step
# ══════════════════════════════════════════════════════════════════════════

def process_match_file(filepath: str | Path) -> bool:
    """
    Full pipeline for a single WC 2026 match JSON file:
      load → render PNG → push to XWORLDCUPTWIT → schedule tweet.
    Returns True on success.
    """
    filepath = Path(filepath)
    log.info("Processing: %s", filepath.name)

    # 1 – Load data
    try:
        with open(filepath, encoding="utf-8") as fh:
            match_data = json.load(fh)
    except Exception as exc:
        log.error("Cannot read %s: %s", filepath, exc)
        return False

    # 2 – Render dashboard PNG
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        png_path = output_filename(match_data, str(OUTPUT_DIR))
        render_wc_dashboard(match_data, png_path)
        log.info("PNG rendered → %s", png_path)
    except Exception as exc:
        log.error("Render failed for %s: %s", filepath.name, exc)
        return False

    # 3 – Push PNG to XWORLDCUPTWIT
    try:
        home = match_data.get("home", {}).get("name", "Home")
        away = match_data.get("away", {}).get("name", "Away")
        raw_url = push_png_to_xworldcuptwit(
            png_path,
            commit_message=f"[WC2026] {home} vs {away} analytics dashboard",
        )
        log.info("PNG pushed to XWORLDCUPTWIT → %s", raw_url)
    except Exception as exc:
        log.error("Git push failed: %s", exc)
        # Non-fatal – still schedule tweet if we have the PNG

    # 4 – Schedule delayed tweet (25 min)
    _schedule_tweet(png_path, match_data, delay=TWEET_DELAY)
    return True


# ══════════════════════════════════════════════════════════════════════════
# Delayed tweet
# ══════════════════════════════════════════════════════════════════════════

def _schedule_tweet(png_path: str, match_data: dict, delay: int) -> None:
    home = match_data.get("home", {}).get("name", "Home")
    away = match_data.get("away", {}).get("name", "Away")

    def _post():
        log.info("Tweet scheduled in %ds for %s vs %s …", delay, home, away)
        time.sleep(delay)
        log.info("Posting tweet for %s vs %s …", home, away)
        url = post_match_infographic(png_path, match_data)
        if url:
            log.info("Tweet live → %s", url)
        else:
            log.warning("Tweet posting skipped or failed.")

    t = threading.Thread(target=_post, daemon=True, name=f"tweet_{home}_{away}")
    t.start()


# ══════════════════════════════════════════════════════════════════════════
# File watcher (polling)
# ══════════════════════════════════════════════════════════════════════════

def _poll_loop() -> None:
    """Poll WATCH_DIR every POLL_INTERVAL seconds for new JSON files."""
    log.info("Watcher started – polling %s every %ds", WATCH_DIR, POLL_INTERVAL)
    WATCH_DIR.mkdir(parents=True, exist_ok=True)

    while True:
        try:
            for p in sorted(WATCH_DIR.glob("*.json")):
                key = str(p)
                if key not in _processed:
                    _processed.add(key)
                    process_match_file(p)
        except Exception as exc:
            log.error("Poll error: %s", exc)
        time.sleep(POLL_INTERVAL)


def _start_watchdog() -> None:
    """Use watchdog library for push-based file-system events (optional)."""
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler, FileCreatedEvent

        class _Handler(FileSystemEventHandler):
            def on_created(self, event: FileCreatedEvent) -> None:
                if event.is_directory or not event.src_path.endswith(".json"):
                    return
                key = event.src_path
                if key not in _processed:
                    _processed.add(key)
                    # Small delay so the writer can finish flushing
                    time.sleep(1.5)
                    process_match_file(event.src_path)

        WATCH_DIR.mkdir(parents=True, exist_ok=True)
        observer = Observer()
        observer.schedule(_Handler(), str(WATCH_DIR), recursive=False)
        observer.start()
        log.info("Watchdog observer started on %s", WATCH_DIR)
        return observer

    except ImportError:
        log.warning("watchdog not installed – falling back to polling.")
        return None


# ══════════════════════════════════════════════════════════════════════════
# FastAPI webhook endpoint
# ══════════════════════════════════════════════════════════════════════════

def _build_app():
    """Build FastAPI app with a /webhook endpoint for push-based triggers."""
    try:
        from fastapi import FastAPI, HTTPException, BackgroundTasks
        from pydantic import BaseModel
    except ImportError:
        return None

    app = FastAPI(title="WC2026 Analytics Webhook")

    class WebhookPayload(BaseModel):
        filepath: str  # absolute or relative path to the match JSON
        secret:   str | None = None

    WEBHOOK_SECRET = os.environ.get("WC2026_WEBHOOK_SECRET", "")

    @app.post("/webhook/match")
    async def webhook_match(payload: WebhookPayload, bg: BackgroundTasks):
        if WEBHOOK_SECRET and payload.secret != WEBHOOK_SECRET:
            raise HTTPException(status_code=403, detail="Invalid secret")
        bg.add_task(process_match_file, payload.filepath)
        return {"status": "queued", "file": payload.filepath}

    @app.get("/health")
    async def health():
        return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}

    return app


# ══════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="WC2026 Analytics Pipeline")
    parser.add_argument("--once", metavar="FILE",
                        help="Process a single match JSON file and exit.")
    parser.add_argument("--no-webhook", action="store_true",
                        help="Disable the FastAPI webhook server.")
    parser.add_argument("--port", type=int, default=8765,
                        help="Webhook server port (default 8765).")
    args = parser.parse_args()

    if args.once:
        ok = process_match_file(args.once)
        sys.exit(0 if ok else 1)

    # Start watchdog or polling in a background thread
    observer = _start_watchdog()
    if observer is None:
        watcher_thread = threading.Thread(target=_poll_loop, daemon=True,
                                          name="wc2026_poller")
        watcher_thread.start()

    # Start FastAPI webhook server unless disabled
    if not args.no_webhook:
        app = _build_app()
        if app is not None:
            try:
                import uvicorn
                log.info("Starting webhook server on port %d …", args.port)
                uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")
            except ImportError:
                log.warning("uvicorn not installed – webhook server disabled.")
                # Block main thread if no server
                if observer:
                    observer.join()
                else:
                    watcher_thread.join()
        else:
            log.warning("FastAPI not available – webhook server disabled.")
            if observer:
                observer.join()
            else:
                watcher_thread.join()
    else:
        log.info("Webhook server disabled by --no-webhook flag.")
        if observer:
            observer.join()
        else:
            watcher_thread.join()


if __name__ == "__main__":
    main()
