"""appimage_catalog.py — browse and install AppImages that aren't managed
by Gearlever yet, via AppImageHub's public community feed
(https://github.com/AppImage/appimage.github.io) — the community-run
catalog Discover-for-Flatpak has no AppImage equivalent of. No API key,
no backend of its own to talk to: a single static feed.json, fetched
once and cached in memory (apps_service.list_apps's own cache pattern).

Installing an entry means downloading the AppImage file ourselves (the
feed only ever gives a URL, and Gearlever's own --integrate takes a local
path, not a URL) into the deck user's own cache dir, then handing that
file to `gearlever --integrate`, mirroring exactly what a user pressing
"Integrate" on a manually-downloaded AppImage would do. When the feed
links a GitHub repo, install() also configures Gearlever's own
GithubUpdater as the update source right after integrating — Gearlever's
CLI has no working way to do this itself via --integrate (see
gearlever.integrate()'s own note) — so nothing is left for the user to
set up afterward.
"""
import base64
import mimetypes
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import decky

from . import gearlever, http_json, proc_env

_LOG = "appimage_catalog"
_FEED_URL = "https://appimage.github.io/feed.json"
_BASE_URL = "https://appimage.github.io/database/"
_GITHUB_HEADERS = {"Accept": "application/vnd.github+json"}

_feed_cache: Optional[List[Dict[str, Any]]] = None


def _downloads_dir() -> Path:
    # Not DECKY_PLUGIN_RUNTIME_DIR — that's root-owned, and the download
    # itself runs as the deck user (proc_env's "user" scope), same reason
    # everything else user-scoped in this backend lives under the deck
    # user's own home instead of a plugin-owned directory.
    return Path(decky.DECKY_USER_HOME) / ".cache" / "decky-apps-manager" / "appimage-downloads"


def _resolve_url(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return _BASE_URL + path


async def _get_feed() -> List[Dict[str, Any]]:
    global _feed_cache
    if _feed_cache is not None:
        return _feed_cache
    data = await http_json.get_json(_FEED_URL, timeout=30)
    items = (data or {}).get("items", [])
    _feed_cache = items if isinstance(items, list) else []
    return _feed_cache


def _download_link(entry: Dict[str, Any]) -> Optional[str]:
    for link in entry.get("links") or []:
        if link.get("type") == "Download":
            return link.get("url")
    return None


def _github_repo(entry: Dict[str, Any]) -> Optional[str]:
    # AppImageHub's own feed gives this as a bare "owner/repo" shorthand
    # (not a full URL) — unlike its "Download" link, which is nearly
    # always just the repo's /releases *page*, not a real asset URL (see
    # install()'s own note). This is what lets install() ask GitHub's API
    # for the actual latest asset instead.
    for link in entry.get("links") or []:
        if link.get("type") == "GitHub":
            value = link.get("url")
            if value and "/" in value and not value.startswith(("http://", "https://")):
                return value
    return None


def _to_catalog_entry(
    entry: Dict[str, Any], installed_names: set, installed_repos: set
) -> Dict[str, Any]:
    icons = entry.get("icons") or []
    screenshots = entry.get("screenshots") or []
    name = entry.get("name", "")
    repo = _github_repo(entry)
    return {
        "name": name,
        "description": entry.get("description") or "",
        "categories": entry.get("categories") or [],
        "license": entry.get("license") or "",
        "icon_url": _resolve_url(icons[0]) if icons else None,
        "screenshots": [url for url in (_resolve_url(s) for s in screenshots) if url],
        "download_url": _download_link(entry),
        "repo": repo,
        # AppImageHub's feed has no concept of "already installed" at all
        # (unlike Flatpak's own remote-info check) — a name match against
        # Gearlever's own installed list is the fallback signal, but
        # Gearlever's own name for an app (derived from its embedded
        # desktop entry) doesn't always match the feed's own display name
        # for that same project, so a repo match (exact, whenever install()
        # configured GithubUpdater for it) is checked first.
        "installed": (
            bool(repo) and repo.strip().lower() in installed_repos
        ) or name.strip().lower() in installed_names,
    }


async def search(query: str, limit: int = 40) -> List[Dict[str, Any]]:
    if not query.strip():
        return []
    feed = await _get_feed()
    q = query.strip().lower()
    matches = [
        e for e in feed
        if q in str(e.get("name", "")).lower() or q in str(e.get("description", "")).lower()
    ]
    installed_names, installed_repos = await gearlever.list_installed_names_and_repos()
    return [
        entry
        for entry in (
            _to_catalog_entry(e, installed_names, installed_repos) for e in matches[:limit]
        )
        # Need at least one way to eventually resolve a real asset —
        # either the feed's own link already is one, or there's a GitHub
        # repo install() can ask directly.
        if entry["download_url"] or entry["repo"]
    ]


def _chown_deck(path: Path) -> None:
    uid, gid = proc_env.deck_uid(), proc_env.deck_gid()
    if uid is None or gid is None:
        return
    try:
        os.chown(path, uid, gid)
    except OSError as e:
        decky.logger.error(f"[{_LOG}] chown {path}: {e}")


async def _download_file(url: str, dest: Path, timeout: float) -> bool:
    # This runs as root (the backend's own process) — mkdir() below would
    # leave the directory root-owned, but the curl subprocess right after
    # runs as the deck user (proc_env's "user" scope) and needs to write
    # a new file into it. `.cache` itself always already exists (created
    # at the deck user's own first login) — only these two subdirs are
    # ever newly created here, so chowning just them is enough.
    dest.parent.mkdir(parents=True, exist_ok=True)
    _chown_deck(dest.parent)
    _chown_deck(dest.parent.parent)
    code, _, _ = await proc_env.run(
        ["curl", "-sfL", "-o", str(dest), url], "user", _LOG, timeout=timeout,
    )
    return code == 0 and dest.is_file() and dest.stat().st_size > 0


def _fnmatch_pattern(filename: str, tag_name: str) -> str:
    """Gearlever's own GithubUpdater matches future releases' assets
    against "repo_filename" with fnmatch (see Gearlever's own
    GithubUpdater.fetch_target_asset) — the exact filename of *this*
    release would only ever match this one release again, since most
    projects bake the version into the asset name (e.g.
    "4kWall-2026.8.8-x86_64.AppImage"). Replacing the release's own tag
    (with a leading "v" stripped, same convention gearlever_versions.py's
    own _strip_v uses) wherever it appears in the filename with a "*"
    targets exactly the version substring — not a blind digit-run
    wildcard, which would also swallow unrelated digits like "x86_64"."""
    stripped = tag_name[1:] if tag_name[:1] in ("v", "V") and tag_name[1:2].isdigit() else tag_name
    pattern = filename
    for candidate in (tag_name, stripped):
        if candidate and candidate in pattern:
            pattern = pattern.replace(candidate, "*")
    return pattern


async def _resolve_github_asset(repo: str) -> Optional[Dict[str, str]]:
    """AppImageHub's feed only ever gives the repo's *releases page* as a
    download link (see _download_link's own note) — not a real asset URL
    curl could actually fetch. Ask GitHub's own releases API for the
    latest release's actual AppImage asset instead, the same API
    gearlever_versions.py's GithubUpdater resolver already relies on.
    Returns the download URL, the bare asset filename, and an
    fnmatch-ready pattern derived from it (with the version wildcarded)
    — the latter is what Gearlever's own GithubUpdater needs as its
    "repo_filename" match config (see install()'s own note)."""
    release = await http_json.get_json(
        f"https://api.github.com/repos/{repo}/releases/latest", _GITHUB_HEADERS
    )
    tag_name = str((release or {}).get("tag_name") or "")
    for asset in (release or {}).get("assets") or []:
        name = str(asset.get("name") or "")
        if name.lower().endswith(".appimage"):
            url = asset.get("browser_download_url")
            if url:
                return {
                    "url": url,
                    "filename": name,
                    "pattern": _fnmatch_pattern(name, tag_name) if tag_name else name,
                }
    return None


async def install(name: str, download_url: str, repo: Optional[str] = None) -> bool:
    resolved_url = download_url
    asset_pattern: Optional[str] = None
    if repo:
        # Best-effort: an API miss (rate-limited, no releases, no asset
        # actually named *.AppImage) just falls back to the feed's own
        # link — no worse than before this resolution existed.
        asset = await _resolve_github_asset(repo)
        if asset:
            resolved_url = asset["url"]
            asset_pattern = asset["pattern"]
    if not resolved_url:
        return False

    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", name) or "app"
    ext = os.path.splitext(urlsplit(resolved_url).path)[1] or ".AppImage"
    dest = _downloads_dir() / f"{safe_name}{ext}"

    if not await _download_file(resolved_url, dest, timeout=900):
        return False

    # Gearlever's own --integrate has no working way to pass an update
    # source (see gearlever.integrate()'s own note) — when we already
    # know the GitHub repo, configure it ourselves right after,
    # comparing the installed list before/after to find which file path
    # is the one that just appeared (Gearlever renames/moves the file
    # into its own managed directory during install, derived from the
    # AppImage's embedded desktop entry name — not from this download's
    # own filename — so that's the only reliable way to find it again).
    before_paths = (
        await gearlever.list_installed_paths() if repo and asset_pattern else set()
    )

    try:
        ok = await gearlever.integrate(str(dest))
    finally:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass

    if ok and repo and asset_pattern:
        after_paths = await gearlever.list_installed_paths()
        new_path = next(iter(after_paths - before_paths), None)
        if new_path:
            await gearlever.set_update_source(
                new_path,
                "GithubUpdater",
                {"repo": repo, "repo_filename": asset_pattern, "allow_prereleases": "false"},
            )

    return ok


async def get_icon_data_uri(icon_url: str) -> str:
    if not icon_url:
        return ""
    ext = os.path.splitext(urlsplit(icon_url).path)[1] or ".png"
    dest = _downloads_dir() / f"icon-{abs(hash(icon_url))}{ext}"
    if not await _download_file(icon_url, dest, timeout=15):
        return ""
    try:
        mime, _ = mimetypes.guess_type(str(dest))
        mime = mime or "image/png"
        encoded = base64.b64encode(dest.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{encoded}"
    except OSError as e:
        decky.logger.error(f"[{_LOG}] reading downloaded icon {dest}: {e}")
        return ""
    finally:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
