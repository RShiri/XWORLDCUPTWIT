"""
FIFA World Cup 2026 – Combined one-shot match runner.

Does the entire flow for ONE match in a single synchronous call:
    scrape (WhoScored via FotMob id) → render PNG → push to GitHub → post to X.

Unlike pipeline.py (a long-running watcher with a delayed-tweet thread), this
module runs start-to-finish and exits. That makes it ideal for Windows Task
Scheduler: register one task per match firing at (kick-off + 2h), each calling

    py -m wc2026.run_match --fotmob-id <ID>

Usage:
    py -m wc2026.run_match --fotmob-id 4667812
    py -m wc2026.run_match --fotmob-id 4667812 --fotmob-only   # skip WhoScored
    py -m wc2026.run_match --fotmob-id 4667812 --no-post       # render+push only
    py -m wc2026.run_match --fotmob-id 4667812 --no-push       # render+post only
    py -m wc2026.run_match --from-file wc2026/matches/x.json    # skip scraping
"""

from __future__ import annotations

import os
import sys
import json
import logging
import argparse
from pathlib import Path

# ── Bootstrap path + env ──────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(_REPO_ROOT / ".env", override=False)
except ImportError:
    pass

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")

from wc2026.scraper     import fetch_and_save, fotmob_fetch_wc_matches
from wc2026.renderer    import render_wc_dashboard, output_filename
from wc2026.git_ops     import push_png_to_xworldcuptwit

log = logging.getLogger("wc2026.run_match")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [RUN] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(_REPO_ROOT / "wc2026" / "run_match.log", encoding="utf-8"),
    ],
)

OUTPUT_DIR = _REPO_ROOT / "wc2026" / "output"


def send_whatsapp_notification(image_url: str, text: str) -> bool:
    """Send match notification with dashboard image link to WhatsApp."""
    provider = os.environ.get("WHATSAPP_PROVIDER", "").lower()
    phone = os.environ.get("WHATSAPP_PHONE")
    
    if not phone:
        log.warning("WhatsApp notification skipped: WHATSAPP_PHONE not set in .env.")
        return False
        
    if provider == "twilio":
        sid = os.environ.get("WHATSAPP_TWILIO_SID")
        token = os.environ.get("WHATSAPP_TWILIO_TOKEN")
        from_num = os.environ.get("WHATSAPP_TWILIO_FROM", "whatsapp:+14155238886")
        
        if not sid or not token:
            log.warning("WhatsApp Twilio skipped: SID or Token not configured in .env.")
            return False
            
        try:
            from twilio.rest import Client
            client = Client(sid, token)
            message = client.messages.create(
                body=text,
                media_url=[image_url],
                from_=from_num,
                to=f"whatsapp:{phone}"
            )
            log.info("WhatsApp sent via Twilio: SID=%s", message.sid)
            return True
        except ImportError:
            log.error("WhatsApp Twilio failed: 'twilio' package not installed. Run 'pip install twilio'")
            return False
        except Exception as e:
            log.error("WhatsApp Twilio failed: %s", e)
            return False
            
    elif provider == "callmebot":
        key = os.environ.get("WHATSAPP_CALLMEBOT_KEY")
        if not key:
            log.warning("WhatsApp CallMeBot skipped: WHATSAPP_CALLMEBOT_KEY not set.")
            return False
            
        try:
            import urllib.parse
            import urllib.request
            
            msg = f"{text}\n\nView Dashboard: {image_url}"
            encoded_msg = urllib.parse.quote_plus(msg)
            url = f"https://api.callmebot.com/whatsapp.php?phone={phone}&text={encoded_msg}&apikey={key}"
            
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as response:
                resp_text = response.read().decode("utf-8")
                if "success" in resp_text.lower() or response.status == 200:
                    log.info("WhatsApp sent via CallMeBot.")
                    return True
                else:
                    log.error("WhatsApp CallMeBot response: %s", resp_text)
                    return False
        except Exception as e:
            log.error("WhatsApp CallMeBot failed: %s", e)
            return False
            
    else:
        log.warning("WhatsApp skipped: WHATSAPP_PROVIDER must be 'twilio' or 'callmebot' in .env.")
        return False


def run_match(
    fotmob_id: int | None = None,
    from_file: str | None = None,
    *,
    fotmob_only: bool = False,
    do_push: bool = True,
    do_whatsapp: bool = True,
) -> bool:
    """
    Full single-match flow. Returns True on success.
    Either `fotmob_id` or `from_file` must be given.
    """
    # ── 1. Acquire match JSON ─────────────────────────────────────────────
    if from_file:
        json_path = Path(from_file)
        if not json_path.exists():
            log.error("Match file not found: %s", json_path)
            return False
        log.info("Using existing match file: %s", json_path.name)
    elif fotmob_id is not None:
        log.info("Scraping match id=%d …", fotmob_id)
        # Pull the XML stub so names/date resolve even though FotMob JSON is dead
        xml_stub = None
        try:
            xml_stub = next(
                (m for m in fotmob_fetch_wc_matches() if m.get("id") == fotmob_id),
                None,
            )
        except Exception as exc:
            log.warning("Could not fetch XML stub for id=%d: %s", fotmob_id, exc)

        json_path = fetch_and_save(fotmob_id, fotmob_only=fotmob_only, xml_match=xml_stub)
        if not json_path:
            log.error("Scrape failed for id=%d — aborting.", fotmob_id)
            return False
        log.info("Scraped → %s", json_path)
    else:
        log.error("Must provide either --fotmob-id or --from-file.")
        return False

    # ── 2. Load data ──────────────────────────────────────────────────────
    try:
        with open(json_path, encoding="utf-8") as fh:
            match_data = json.load(fh)
    except Exception as exc:
        log.error("Cannot read %s: %s", json_path, exc)
        return False

    home = match_data.get("home", {}).get("name", "Home")
    away = match_data.get("away", {}).get("name", "Away")
    home_score = match_data.get("home", {}).get("score", 0)
    away_score = match_data.get("away", {}).get("score", 0)

    # ── 3. Render dashboard PNG ───────────────────────────────────────────
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        png_path = output_filename(match_data, str(OUTPUT_DIR))
        render_wc_dashboard(match_data, png_path)
        log.info("PNG rendered → %s", png_path)
    except Exception as exc:
        log.error("Render failed for %s vs %s: %s", home, away, exc)
        return False

    # ── 4. Push PNG to XWORLDCUPTWIT (non-fatal) ──────────────────────────
    raw_url = None
    if do_push:
        try:
            raw_url = push_png_to_xworldcuptwit(
                png_path,
                commit_message=f"[WC2026] {home} vs {away} analytics dashboard",
            )
            log.info("PNG pushed → %s", raw_url)
        except Exception as exc:
            log.error("Git push failed (continuing): %s", exc)
    else:
        log.info("Skipping Git push (--no-push).")

    # ── 5. Send to WhatsApp ───────────────────────────────────────────────
    if do_whatsapp:
        if not raw_url:
            # Fallback to direct raw github URL pattern if push is disabled or failed
            raw_url = f"https://raw.githubusercontent.com/RShiri/XWORLDCUPTWIT/main/WorldCup2026/{os.path.basename(png_path)}"
        
        stage = match_data.get("wc_metadata", {}).get("stage", "Group Stage")
        msg = f"⚽ World Cup 2026 Match Report ({stage})\n🏆 {home} {home_score} - {away_score} {away}"
        send_whatsapp_notification(raw_url, msg)
    else:
        log.info("Skipping WhatsApp notification.")

    log.info("DONE: %s vs %s", home, away)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="WC2026 one-shot: scrape → render → push → whatsapp for a single match."
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--fotmob-id", type=int, help="FotMob match ID to scrape and process.")
    src.add_argument("--from-file", help="Path to an existing match JSON (skip scraping).")

    parser.add_argument("--fotmob-only", action="store_true",
                        help="Skip WhoScored (FotMob shot data only).")
    parser.add_argument("--no-push", action="store_true",
                        help="Don't push the PNG to GitHub.")
    parser.add_argument("--no-post", action="store_true",
                        help="Don't send to WhatsApp (legacy flag).")
    args = parser.parse_args()

    ok = run_match(
        fotmob_id=args.fotmob_id,
        from_file=args.from_file,
        fotmob_only=args.fotmob_only,
        do_push=not args.no_push,
        do_whatsapp=not args.no_post,
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
