"""
X (Twitter) API v2 integration for posting WC 2026 match infographics.
Requires Tweepy ≥ 4.14 with v1.1 media upload + v2 tweet creation.

Required env vars:
  X_API_KEY            – OAuth 1.0a consumer key
  X_API_SECRET         – OAuth 1.0a consumer secret
  X_ACCESS_TOKEN       – User access token
  X_ACCESS_TOKEN_SECRET – User access token secret
"""

from __future__ import annotations

import os
import logging
from pathlib import Path

log = logging.getLogger(__name__)


def _get_clients():
    """Return (tweepy.Client v2, tweepy.API v1.1) pair."""
    try:
        import tweepy
    except ImportError as e:
        raise RuntimeError(
            "tweepy not installed. Run: pip install tweepy"
        ) from e

    api_key    = os.environ["X_API_KEY"]
    api_secret = os.environ["X_API_SECRET"]
    acc_token  = os.environ["X_ACCESS_TOKEN"]
    acc_secret = os.environ["X_ACCESS_TOKEN_SECRET"]

    auth = tweepy.OAuth1UserHandler(api_key, api_secret, acc_token, acc_secret)
    api_v1 = tweepy.API(auth)

    client_v2 = tweepy.Client(
        consumer_key=api_key,
        consumer_secret=api_secret,
        access_token=acc_token,
        access_token_secret=acc_secret,
    )
    return client_v2, api_v1


def build_caption(match_data: dict) -> str:
    """
    Compose a clean textual match summary caption for the tweet.
    """
    meta   = match_data.get("wc_metadata", {})
    home_d = match_data.get("home", {})
    away_d = match_data.get("away", {})
    stats  = match_data.get("match_stats", {})

    home_name  = home_d.get("name", "Home")
    away_name  = away_d.get("name", "Away")
    home_score = home_d.get("score", 0)
    away_score = away_d.get("score", 0)
    home_pk    = home_d.get("penalty_score")
    away_pk    = away_d.get("penalty_score")

    stage  = meta.get("stage", "Group Stage")
    venue  = meta.get("venue", "")
    city   = meta.get("city", "")
    date   = meta.get("date", "")

    xg_h   = stats.get("xg", {}).get("home")
    xg_a   = stats.get("xg", {}).get("away")
    pos_h  = stats.get("possession", {}).get("home")
    pos_a  = stats.get("possession", {}).get("away")

    score_line = f"{home_name} {home_score}–{away_score} {away_name}"
    if home_pk is not None and away_pk is not None:
        score_line += f" (pens {home_pk}–{away_pk})"

    lines = [
        f"⚽ #FIFAWorldCup2026 | {stage}",
        f"📊 {score_line}",
        f"📅 {date}" + (f" | {venue}, {city}" if venue else ""),
    ]

    if xg_h is not None and xg_a is not None:
        lines.append(f"xG: {home_name} {xg_h:.2f} — {xg_a:.2f} {away_name}")

    if pos_h is not None and pos_a is not None:
        lines.append(f"Possession: {pos_h}% – {pos_a}%")

    lines += [
        "",
        "#WorldCup2026 #Analytics #FootballData",
    ]
    return "\n".join(lines)


def post_match_infographic(png_path: str, match_data: dict) -> str | None:
    """
    Upload png_path as media and post a tweet with the match caption.
    Returns the tweet URL or None on failure.
    """
    png_path = os.path.abspath(png_path)
    if not os.path.exists(png_path):
        log.error("PNG not found: %s", png_path)
        return None

    # Dry-run mode (no credentials set → log and exit)
    if not os.environ.get("X_API_KEY"):
        log.warning(
            "X API credentials not set. Set X_API_KEY / X_API_SECRET / "
            "X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET to enable posting."
        )
        return None

    try:
        client_v2, api_v1 = _get_clients()
    except Exception as exc:
        log.error("Failed to create Twitter clients: %s", exc)
        return None

    caption = build_caption(match_data)

    try:
        log.info("Uploading media: %s", os.path.basename(png_path))
        media = api_v1.media_upload(filename=png_path)
        log.info("Media uploaded, id=%s", media.media_id)

        resp = client_v2.create_tweet(text=caption, media_ids=[media.media_id])
        tweet_id = resp.data["id"]
        tweet_url = f"https://x.com/i/web/status/{tweet_id}"
        log.info("Tweet posted → %s", tweet_url)
        return tweet_url

    except Exception as exc:
        log.error("Failed to post tweet: %s", exc)
        return None
