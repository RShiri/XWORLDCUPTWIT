"""Push all re-rendered PNGs to GitHub in a single commit."""
import os, sys, shutil, subprocess, tempfile, glob
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

REPO_URL = os.environ["XWORLDCUPTWIT_REPO"]
BRANCH   = os.environ.get("XWORLDCUPTWIT_BRANCH", "main")
TOKEN    = os.environ.get("GIT_TOKEN", "")
SUBDIR   = "WorldCup2026"

authed = REPO_URL.replace("https://", f"https://x-access-token:{TOKEN}@", 1) if TOKEN else REPO_URL

import re as _re
_DATE_RE = _re.compile(r'^\d{4}_\d{2}_\d{2}_')
pngs = [p for p in glob.glob("wc2026/output/*.png")
        if _DATE_RE.match(os.path.basename(p)) and "06_01" not in os.path.basename(p)]

print(f"Pushing {len(pngs)} PNGs…")

with tempfile.TemporaryDirectory(prefix="xwctwit_bulk_") as tmpdir:
    subprocess.run(
        ["git", "clone", "--depth=1", "--branch", BRANCH, authed, tmpdir],
        check=True, capture_output=True
    )
    subdir_path = os.path.join(tmpdir, SUBDIR)
    os.makedirs(subdir_path, exist_ok=True)

    # Remove ALL existing PNGs in the subdir (clean slate — removes ghost files too)
    existing = glob.glob(os.path.join(subdir_path, "*.png"))
    if existing:
        subprocess.run(["git", "rm", "-q", "--"] + [os.path.join(SUBDIR, os.path.basename(p)) for p in existing],
                       cwd=tmpdir, check=True)

    # Recreate subdir (git rm may have removed it) and copy fresh PNGs in
    os.makedirs(subdir_path, exist_ok=True)
    for png in pngs:
        shutil.copy2(png, os.path.join(subdir_path, os.path.basename(png)))

    subprocess.run(["git", "config", "user.email", "wc2026bot@github.com"], cwd=tmpdir, check=True)
    subprocess.run(["git", "config", "user.name",  "WC2026 Analytics Bot"],  cwd=tmpdir, check=True)
    subprocess.run(["git", "add", SUBDIR], cwd=tmpdir, check=True)

    from datetime import date as _date
    msg = f"[WC2026] Update match infographics — {_date.today().isoformat()} ({len(pngs)} matches)"
    result = subprocess.run(
        ["git", "commit", "-m", msg],
        cwd=tmpdir, capture_output=True, text=True
    )
    if result.returncode != 0:
        print("Commit stdout:", result.stdout)
        print("Commit stderr:", result.stderr)
        sys.exit(1)

    subprocess.run(["git", "push", "origin", BRANCH], cwd=tmpdir, check=True)
    print("Done — all PNGs pushed.")
