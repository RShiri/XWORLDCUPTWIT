#!/usr/bin/env python3
"""Publish WorldCup2026/*.png as a GitHub Release asset, and shrink the repo.

WHY. The 225 rendered infographics are ~381 MB — more than half of this
repository, which is already close to GitHub's 1 GB guidance. They are also
immutable: once a match is played its render never changes. That is exactly
what Release assets are for. They are CDN-served, do not count toward the
repository size, and keep a permanent public URL.

MIGRATION ORDER MATTERS. Publish first, verify, then switch the builders
over, and only then untrack the folder. Doing it the other way round 404s
every "Infographic PNG" link on the live site in between.

    # 1. upload (needs a token with `repo` scope; nothing is deleted here)
    GIT_TOKEN=ghp_... py tools/publish_png_release.py --upload

    # 2. point the builders at the Release and regenerate the detail files
    set WC_PNG_BASE_URL=https://github.com/RShiri/XWORLDCUPTWIT/releases/download/pngs-2026
    py wc2026_dashboard/build_match_details.py

    # 3. check a few Infographic links on the live site, THEN untrack
    py tools/publish_png_release.py --untrack
    git commit -m "move the WC2026 PNG archive to a Release asset"

`--untrack` runs `git rm --cached` and adds the folder to .gitignore, so the
files stay on disk locally. It does NOT rewrite history: the blobs remain in
past commits, so the repository only stops *growing* — see --help-history.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PNG_DIR = os.path.join(ROOT, "WorldCup2026")
MANIFEST = os.path.join(ROOT, "WorldCup2026_manifest.json")
REPO = os.environ.get("WC_REPO", "RShiri/XWORLDCUPTWIT")
TAG = os.environ.get("WC_PNG_TAG", "pngs-2026")
API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"


def token():
    t = os.environ.get("GIT_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not t:
        sys.exit("set GIT_TOKEN (a token with `repo` scope) first")
    return t


def api(method, url, data=None, headers=None, raw=None):
    hdrs = {"Authorization": "token " + token(),
            "Accept": "application/vnd.github+json",
            "User-Agent": "wc2026-png-publisher"}
    hdrs.update(headers or {})
    body = raw if raw is not None else (json.dumps(data).encode() if data else None)
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        sys.exit("%s %s -> %s %s" % (method, url, e.code, e.read().decode()[:300]))


def ensure_release():
    rel = api("GET", "%s/repos/%s/releases/tags/%s" % (API, REPO, TAG))
    if rel:
        print("release %s exists (id %s)" % (TAG, rel["id"]))
        return rel
    print("creating release %s" % TAG)
    return api("POST", "%s/repos/%s/releases" % (API, REPO), {
        "tag_name": TAG,
        "name": "World Cup 2026 infographics",
        "body": ("Rendered match infographics (light + dark). Served from here "
                 "instead of the repository: they are immutable and ~381 MB.\n\n"
                 "Linked by `wc2026_dashboard/build_match_details.py` via "
                 "`WC_PNG_BASE_URL`."),
    })


def uploaded_names(rel):
    return {a["name"] for a in rel.get("assets") or []}


def upload():
    if not os.path.isdir(PNG_DIR):
        sys.exit("no WorldCup2026/ directory here")
    rel = ensure_release()
    have = uploaded_names(rel)
    files = sorted(f for f in os.listdir(PNG_DIR) if f.lower().endswith(".png"))
    todo = [f for f in files if f not in have]
    print("%d PNGs, %d already uploaded, %d to go" % (len(files), len(have), len(todo)))
    for i, name in enumerate(todo, 1):
        path = os.path.join(PNG_DIR, name)
        with open(path, "rb") as fh:
            blob = fh.read()
        api("POST", "%s/repos/%s/releases/%s/assets?name=%s"
            % (UPLOADS, REPO, rel["id"], name),
            headers={"Content-Type": "image/png"}, raw=blob)
        print("  [%3d/%3d] %s (%.1f MB)" % (i, len(todo), name, len(blob) / 1e6))
    write_manifest(files)
    base = "https://github.com/%s/releases/download/%s" % (REPO, TAG)
    print("\ndone. now set:\n  WC_PNG_BASE_URL=%s\nthen re-run build_match_details.py" % base)


def write_manifest(files=None):
    if files is None:
        files = sorted(f for f in os.listdir(PNG_DIR) if f.lower().endswith(".png"))
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"repo": REPO, "tag": TAG, "count": len(files), "files": files},
                  fh, ensure_ascii=False, indent=1)
    print("wrote %s (%d files)" % (MANIFEST, len(files)))


def untrack():
    """Stop tracking the folder. Files stay on disk; history is untouched."""
    if not os.path.exists(MANIFEST):
        sys.exit("publish first (--upload): no manifest, so the builders would "
                 "lose track of which matches have a render")
    subprocess.run(["git", "rm", "-r", "--cached", "--quiet", "WorldCup2026"],
                   cwd=ROOT, check=True)
    gi = os.path.join(ROOT, ".gitignore")
    text = open(gi, encoding="utf-8").read() if os.path.exists(gi) else ""
    if "WorldCup2026/" not in text:
        with open(gi, "a", encoding="utf-8") as fh:
            fh.write("\n# Rendered infographics now live in a GitHub Release "
                     "(tools/publish_png_release.py);\n# WorldCup2026_manifest.json "
                     "records which matches have one.\nWorldCup2026/\n")
    print("untracked WorldCup2026/ and added it to .gitignore — files kept on disk.\n"
          "Commit the deletion + manifest + .gitignore together.")


def help_history():
    print(__doc__)
    print("""
SHRINKING THE REPOSITORY ITSELF
--------------------------------
Untracking stops growth but does not shrink the clone: every PNG blob still
lives in past commits, so `git clone` still transfers them. To actually
reclaim the space the history has to be rewritten, which is destructive and
must be a deliberate choice:

    pip install git-filter-repo
    git filter-repo --path WorldCup2026 --invert-paths
    git push --force origin main

That rewrites every commit hash. Anyone with a clone (including the scrape
PC) must re-clone; open PRs and permalinks to old commits break. Do it once,
deliberately, with everything pushed first — not as part of a routine change.
""")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--upload", action="store_true", help="create/reuse the release and upload missing PNGs")
    g.add_argument("--manifest", action="store_true", help="(re)write WorldCup2026_manifest.json only")
    g.add_argument("--untrack", action="store_true", help="git rm --cached the folder + gitignore it")
    g.add_argument("--help-history", action="store_true", help="how to actually shrink the clone")
    a = ap.parse_args()
    if a.upload:
        upload()
    elif a.manifest:
        write_manifest()
    elif a.untrack:
        untrack()
    else:
        help_history()


if __name__ == "__main__":
    main()
