"""
Git operations for pushing rendered PNGs to the XWORLDCUPTWIT repository.
Uses subprocess + a GitHub PAT embedded in the remote URL for auth.
"""

from __future__ import annotations

import os
import shutil
import logging
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

XWCTWIT_REPO   = os.environ.get("XWORLDCUPTWIT_REPO",   "https://github.com/RShiri/XWORLDCUPTWIT.git")
XWCTWIT_BRANCH = os.environ.get("XWORLDCUPTWIT_BRANCH", "main")
XWCTWIT_SUBDIR = os.environ.get("XWORLDCUPTWIT_SUBDIR", "WorldCup2026")  # PNG subfolder in the repo

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # repo root (holds wc2026_dashboard/, WorldCup2026/, wc2026/)


def _authed_url(repo_url: str) -> str:
    """Inject GIT_TOKEN into the HTTPS remote URL if available."""
    token = os.environ.get("GIT_TOKEN", "").strip()
    if not token:
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

        # 1. the infographic PNG
        subdir_path = os.path.join(tmpdir, XWCTWIT_SUBDIR)
        os.makedirs(subdir_path, exist_ok=True)
        shutil.copy2(png_path, os.path.join(subdir_path, filename))

        # 2. the regenerated interactive-site outputs (NOT the hand-edited source)
        _copy_file_into(tmpdir, "wc2026_dashboard/data.js")
        _copy_file_into(tmpdir, "wc2026_dashboard/players.js")
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


def _raw_url(filename: str) -> str:
    """Construct the raw GitHub URL for a file in XWORLDCUPTWIT/WorldCup2026/."""
    base = (
        XWCTWIT_REPO
        .rstrip("/")
        .replace("github.com", "raw.githubusercontent.com")
        .removesuffix(".git")
    )
    return f"{base}/{XWCTWIT_BRANCH}/{XWCTWIT_SUBDIR}/{filename}"
