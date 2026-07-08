"""
Git operations for pushing rendered PNGs to the XWORLDCUPTWIT repository.
Uses subprocess + a GitHub PAT embedded in the remote URL for auth.
"""

from __future__ import annotations

import os
import sys
import json
import shutil
import logging
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

XWCTWIT_REPO   = os.environ.get("XWORLDCUPTWIT_REPO",   "https://github.com/RShiri/XWORLDCUPTWIT.git")
XWCTWIT_BRANCH = os.environ.get("XWORLDCUPTWIT_BRANCH", "main")
XWCTWIT_SUBDIR = os.environ.get("XWORLDCUPTWIT_SUBDIR", "WorldCup2026")  # PNG subfolder in the repo

# The personal portfolio site (rshiri.github.io) hosts a native "Argentina Match
# Centre". Its per-match data is regenerated from THIS repo's event stream and
# pushed there so the portfolio auto-updates the same way the dashboard does.
PORTFOLIO_REPO   = os.environ.get("PORTFOLIO_REPO",   "https://github.com/RShiri/RShiri.github.io.git")
PORTFOLIO_BRANCH = os.environ.get("PORTFOLIO_BRANCH", "main")
PORTFOLIO_TEAM   = os.environ.get("PORTFOLIO_TEAM",   "Argentina")

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # repo root (holds wc2026_dashboard/, WorldCup2026/, wc2026/)


def _token_from_env_file(env_path: Path) -> str:
    """Read GIT_TOKEN straight from a .env file, WITHOUT needing python-dotenv.

    The normal loader (``load_dotenv`` in run_match.py / scraper.py) is wrapped in
    ``try/except ImportError`` and ``python-dotenv`` is not a declared dependency, so
    on a machine where it isn't installed the .env is never parsed and GIT_TOKEN
    silently stays unset — clone (public read) and the local commit still succeed, only
    the push fails. Parsing the file here ourselves makes the token in the repo-root
    .env work regardless of whether python-dotenv is present."""
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            key, sep, val = line.partition("=")
            if sep and key.strip() == "GIT_TOKEN":
                return val.strip().strip('"').strip("'").strip()
    except OSError:
        pass
    return ""


def _git_token() -> str:
    """Resolve the GitHub PAT: OS env first, else the repo-root .env file.

    Falling back to the .env directly also defeats the ``load_dotenv(..., override=False)``
    trap, where an *empty* GIT_TOKEN already present in the OS environment shadows the
    real value in .env (override=False keeps the empty one). We only trust the OS var
    when it is non-empty, otherwise read .env ourselves."""
    token = os.environ.get("GIT_TOKEN", "").strip()
    if not token:
        token = _token_from_env_file(PROJECT_ROOT / ".env")
    return token


def _authed_url(repo_url: str) -> str:
    """Inject GIT_TOKEN into the HTTPS remote URL if available."""
    token = _git_token()
    if not token:
        log.warning(
            "GIT_TOKEN is missing/empty (checked OS env and %s) — git push will fail "
            "and the site will NOT update. Put GIT_TOKEN=<PAT> in that .env (no quotes, "
            "no spaces) or set it in the environment.", PROJECT_ROOT / ".env",
        )
        return repo_url
    if repo_url.startswith("https://"):
        return repo_url.replace("https://", f"https://x-access-token:{token}@", 1)
    return repo_url


def _run(cmd: list[str], cwd: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    log.debug("$ %s", " ".join(cmd))
    env = {
        "GIT_TERMINAL_PROMPT": "0",
        **os.environ
    }
    if cmd and cmd[0] == "git":
        cmd = [cmd[0], "-c", "credential.helper="] + cmd[1:]
    return subprocess.run(
        cmd, cwd=cwd, check=check,
        capture_output=True, text=True, env=env
    )


def push_png_to_xworldcuptwit(png_path: str, commit_message: str | None = None) -> str:
    """
    Clone XWORLDCUPTWIT into a temp directory, copy png_path into the repo,
    commit it, and push to the remote.

    Returns the raw GitHub URL of the pushed file.
    """
    png_path  = os.path.abspath(png_path)
    filename  = os.path.basename(png_path)
    repo_url  = _authed_url(XWCTWIT_REPO)
    msg       = commit_message or f"Add match infographic: {filename}"

    with tempfile.TemporaryDirectory(prefix="xwctwit_") as tmpdir:
        log.info("Cloning %s …", XWCTWIT_REPO)
        _run(["git", "clone", "--depth=1", "--branch", XWCTWIT_BRANCH,
               repo_url, tmpdir])

        # Place PNG inside WorldCup2026/ subfolder
        subdir_path = os.path.join(tmpdir, XWCTWIT_SUBDIR)
        os.makedirs(subdir_path, exist_ok=True)
        dest = os.path.join(subdir_path, filename)
        shutil.copy2(png_path, dest)
        log.info("Copied %s → repo/%s/%s", filename, XWCTWIT_SUBDIR, filename)

        _run(["git", "config", "user.email", "wc2026bot@github.com"], cwd=tmpdir)
        _run(["git", "config", "user.name",  "WC2026 Analytics Bot"],  cwd=tmpdir)
        _run(["git", "add", os.path.join(XWCTWIT_SUBDIR, filename)], cwd=tmpdir)

        result = _run(["git", "commit", "-m", msg], cwd=tmpdir, check=False)
        if result.returncode != 0 and "nothing to commit" in result.stdout:
            log.warning("Nothing new to commit – PNG already exists in repo.")
            return _raw_url(filename)

        log.info("Pushing to %s / %s …", XWCTWIT_REPO, XWCTWIT_BRANCH)
        _run(["git", "push", "origin", XWCTWIT_BRANCH], cwd=tmpdir)

    raw_url = _raw_url(filename)
    log.info("Push complete → %s", raw_url)
    return raw_url


def _copy_file_into(tmpdir: str, rel: str) -> bool:
    """Copy PROJECT_ROOT/rel into the cloned repo at the same relative path."""
    src = PROJECT_ROOT / rel
    if not src.exists():
        log.warning("Dashboard sync: missing %s (skipped)", rel)
        return False
    dst = Path(tmpdir) / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


def _copy_tree_into(tmpdir: str, rel: str) -> bool:
    """Replace the cloned repo's PROJECT_ROOT/rel directory with the local one."""
    src = PROJECT_ROOT / rel
    if not src.exists():
        log.warning("Dashboard sync: missing dir %s (skipped)", rel)
        return False
    dst = Path(tmpdir) / rel
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return True


def push_match_update(png_path: str, match_id: str | None = None,
                      commit_message: str | None = None) -> str:
    """
    Publish a finished match to the live site in one commit: the rendered PNG
    *plus* the regenerated web-dashboard outputs (data.js, players.js, the match
    detail file, the database export) and the raw match JSON. This is what makes
    the interactive website auto-update per match, the same way the PNG does.

    Returns the raw GitHub URL of the pushed PNG.
    """
    png_path = os.path.abspath(png_path)
    filename = os.path.basename(png_path)
    if match_id is None:
        match_id = os.path.splitext(filename)[0]
    repo_url = _authed_url(XWCTWIT_REPO)
    msg = commit_message or f"[WC2026] {match_id} analytics dashboard"

    with tempfile.TemporaryDirectory(prefix="xwctwit_") as tmpdir:
        log.info("Cloning %s …", XWCTWIT_REPO)
        _run(["git", "clone", "--depth=1", "--branch", XWCTWIT_BRANCH, repo_url, tmpdir])
        _run(["git", "config", "user.email", "wc2026bot@github.com"], cwd=tmpdir)
        _run(["git", "config", "user.name",  "WC2026 Analytics Bot"],  cwd=tmpdir)

        # 1. the infographic PNG (+ its dark-mode sibling when rendered)
        subdir_path = os.path.join(tmpdir, XWCTWIT_SUBDIR)
        os.makedirs(subdir_path, exist_ok=True)
        shutil.copy2(png_path, os.path.join(subdir_path, filename))
        stem, ext = os.path.splitext(png_path)
        dark_path = f"{stem}_dark{ext}"
        if os.path.exists(dark_path):
            shutil.copy2(dark_path, os.path.join(subdir_path, os.path.basename(dark_path)))

        # 2. the regenerated interactive-site outputs (NOT the hand-edited source)
        _copy_file_into(tmpdir, "wc2026_dashboard/data.js")
        _copy_file_into(tmpdir, "wc2026_dashboard/players.js")
        _copy_file_into(tmpdir, "wc2026_dashboard/shots.js")
        _copy_file_into(tmpdir, "wc2026_dashboard/breaks.js")
        _copy_tree_into(tmpdir, "wc2026_dashboard/matches_detail")
        _copy_tree_into(tmpdir, "wc2026_dashboard/database")

        # 3. the raw scraped match JSON
        _copy_file_into(tmpdir, os.path.join("wc2026", "matches", match_id + ".json"))

        _run(["git", "add", "-A"], cwd=tmpdir)
        result = _run(["git", "commit", "-m", msg], cwd=tmpdir, check=False)
        if result.returncode != 0 and "nothing to commit" in (result.stdout + result.stderr):
            log.warning("Nothing new to commit – site already up to date.")
            return _raw_url(filename)
        log.info("Pushing match update to %s / %s …", XWCTWIT_REPO, XWCTWIT_BRANCH)
        _run(["git", "push", "origin", XWCTWIT_BRANCH], cwd=tmpdir)

    raw_url = _raw_url(filename)
    log.info("Match update pushed → %s", raw_url)
    return raw_url


def _match_involves(match_id: str, team: str) -> bool:
    """True if the given team played in this match (checks the raw scraped JSON)."""
    raw = PROJECT_ROOT / "wc2026" / "matches" / f"{match_id}.json"
    try:
        d = json.loads(raw.read_text(encoding="utf-8"))
        return team in (d.get("home", {}).get("name"), d.get("away", {}).get("name"))
    except (OSError, ValueError):
        return False


def push_argentina_portfolio(match_id: str) -> bool:
    """
    Regenerate the personal-portfolio Argentina Match Centre data from THIS
    repo's event stream and push it to rshiri.github.io — so a new Argentina
    game reaches the portfolio the same way it reaches the dashboard.

    No-op (returns False) unless the just-scraped match involves PORTFOLIO_TEAM,
    keeping every other match free. The generator (build_argentina.py) lives in
    the portfolio repo and is the single source of truth; we run the copy in the
    fresh clone against this repo's freshly-refreshed matches_detail/. Non-fatal:
    any failure is logged and swallowed by the caller.
    """
    if not _match_involves(match_id, PORTFOLIO_TEAM):
        log.info("Portfolio sync: %s does not involve %s — skipped.", match_id, PORTFOLIO_TEAM)
        return False

    repo_url = _authed_url(PORTFOLIO_REPO)
    with tempfile.TemporaryDirectory(prefix="portfolio_") as tmpdir:
        log.info("Cloning %s …", PORTFOLIO_REPO)
        _run(["git", "clone", "--depth=1", "--branch", PORTFOLIO_BRANCH, repo_url, tmpdir])

        gen = os.path.join(tmpdir, "assets", "data", "build_argentina.py")
        if not os.path.exists(gen):
            log.warning("Portfolio sync: %s not found in the clone (branch not merged yet?) — "
                        "skipping.", "assets/data/build_argentina.py")
            return False
        out_dir = os.path.join(tmpdir, "assets", "data", "argentina")

        log.info("Regenerating %s Match Centre data …", PORTFOLIO_TEAM)
        _run([sys.executable, gen, "--source", str(PROJECT_ROOT), "--out", out_dir])

        _run(["git", "config", "user.email", "wc2026bot@github.com"], cwd=tmpdir)
        _run(["git", "config", "user.name",  "WC2026 Analytics Bot"],  cwd=tmpdir)
        # Stage only the generated data (never a blind add — the repo has hand-edited source).
        _run(["git", "add", "assets/data/argentina"], cwd=tmpdir)

        msg = f"[portfolio] {PORTFOLIO_TEAM} match centre: {match_id}"
        result = _run(["git", "commit", "-m", msg], cwd=tmpdir, check=False)
        if result.returncode != 0 and "nothing to commit" in (result.stdout + result.stderr):
            log.warning("Portfolio sync: nothing new to commit — already up to date.")
            return False
        log.info("Pushing portfolio update to %s / %s …", PORTFOLIO_REPO, PORTFOLIO_BRANCH)
        _run(["git", "push", "origin", PORTFOLIO_BRANCH], cwd=tmpdir)

    log.info("Portfolio Match Centre updated for %s.", match_id)
    return True


def _raw_url(filename: str) -> str:
    """Construct the raw GitHub URL for a file in XWORLDCUPTWIT/WorldCup2026/."""
    base = (
        XWCTWIT_REPO
        .rstrip("/")
        .replace("github.com", "raw.githubusercontent.com")
        .removesuffix(".git")
    )
    return f"{base}/{XWCTWIT_BRANCH}/{XWCTWIT_SUBDIR}/{filename}"
