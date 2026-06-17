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


def _authed_url(repo_url: str) -> str:
    """Inject GIT_TOKEN into the HTTPS remote URL if available."""
    token = os.environ.get("GIT_TOKEN", "").strip()
    if not token:
        return repo_url
    if repo_url.startswith("https://"):
        return repo_url.replace("https://", f"https://{token}@", 1)
    return repo_url


def _run(cmd: list[str], cwd: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    log.debug("$ %s", " ".join(cmd))
    return subprocess.run(
        cmd, cwd=cwd, check=check,
        capture_output=True, text=True,
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


def _raw_url(filename: str) -> str:
    """Construct the raw GitHub URL for a file in XWORLDCUPTWIT/WorldCup2026/."""
    base = (
        XWCTWIT_REPO
        .rstrip("/")
        .replace("github.com", "raw.githubusercontent.com")
        .removesuffix(".git")
    )
    return f"{base}/{XWCTWIT_BRANCH}/{XWCTWIT_SUBDIR}/{filename}"
