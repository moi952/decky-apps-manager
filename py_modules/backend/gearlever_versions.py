"""gearlever_versions.py — best-effort "what version is actually
available" for a Gearlever-managed AppImage with an update source
configured.

Gearlever's own CLI never fills this in: --list-updates --json hardcodes
available_version: null (see Cli.py::_make_app_json in Gearlever's own
source) because none of its built-in update managers use version
*numbers* to decide whether an update exists — they diff a zsync SHA-1,
an asset digest, or a byte size instead (see e.g.
GithubUpdater.is_update_available). This module runs only after
Gearlever has already said `has_update: true` for an app; it just
resolves a version *label* (plus release notes, when the same API call
already returns them) to display, by querying the same releases API
each manager's own `fetch_target_asset` uses to find its download asset.

StaticFileUpdater has no such API (a plain URL carries no version) and
is intentionally not covered — resolve_available_version returns nothing
useful for it, same as for an unrecognized/unconfigured manager.
"""
from typing import Any, Dict, Optional
from urllib.parse import quote, urlsplit

import decky

from . import http_json

_LOG = "gearlever_versions"
_GITHUB_HEADERS = {"Accept": "application/vnd.github+json"}


class VersionInfo:
    """version: the release tag (leading 'v' stripped). notes: the
    release's own free-text body, if the API returned one (may be None
    even on success — an author can publish a release with no
    description). url: a human-readable page for that release, for a
    "view full release" link. rate_limited_until: only ever set (and
    only for GithubUpdater) when the lookup came back empty specifically
    because the anonymous GitHub API quota is exhausted right now."""

    __slots__ = ("version", "notes", "url", "rate_limited_until")

    def __init__(
        self,
        version: Optional[str] = None,
        notes: Optional[str] = None,
        url: Optional[str] = None,
        rate_limited_until: Optional[int] = None,
    ):
        self.version = version
        self.notes = notes
        self.url = url
        self.rate_limited_until = rate_limited_until


async def _github_rate_limit_reset() -> Optional[int]:
    """None unless GitHub's anonymous quota (60/hour/IP) is actually
    exhausted right now — checked only when a GithubUpdater lookup above
    already came back empty, to explain *why* rather than silently
    showing a dash. GitHub's own /rate_limit endpoint is exempt from that
    quota (always 200), so this is safe to call even while rate-limited."""
    status = await http_json.get_json("https://api.github.com/rate_limit")
    core = ((status or {}).get("resources") or {}).get("core") or {}
    if core.get("remaining") == 0:
        return core.get("reset")
    return None


# Public alias — gearlever.py's own list_apps_with_updates() needs this
# too, for the case where gearlever's own --list-updates never got a real
# answer for a GithubUpdater app at all (see that module's own note).
check_rate_limit = _github_rate_limit_reset


def _strip_v(tag: str) -> str:
    """'v1.2.3' -> '1.2.3', but leaves a non-version-looking tag (e.g. a
    branch name someone put in `repo_filename`'s release) untouched."""
    if tag[:1] in ("v", "V") and tag[1:2].isdigit():
        return tag[1:]
    return tag


def _from_release(release: Optional[Dict[str, Any]]) -> Optional[VersionInfo]:
    tag = (release or {}).get("tag_name")
    if not tag:
        return None
    return VersionInfo(
        version=_strip_v(tag),
        notes=(release or {}).get("body") or None,
        url=(release or {}).get("html_url"),
    )


def _repo_pair(value: str) -> Optional[tuple]:
    parts = value.split("/")
    return (parts[0], parts[1]) if len(parts) == 2 else None


def _host_repo_pair(url: str) -> Optional[tuple]:
    """"https://host/user/repo[/...]" -> (host, user, repo)."""
    parts = urlsplit(url)
    path = [p for p in parts.path.split("/") if p]
    if not parts.netloc or len(path) < 2:
        return None
    return (parts.netloc, path[0], path[1])


async def _github(config: Dict[str, Any]) -> Optional[VersionInfo]:
    pair = _repo_pair(str(config.get("repo", "")))
    if not pair:
        return None
    repo = "/".join(pair)
    allow_pre = bool(config.get("allow_prereleases"))
    if allow_pre:
        releases = await http_json.get_json(
            f"https://api.github.com/repos/{repo}/releases", _GITHUB_HEADERS
        )
        release = next((r for r in releases or [] if not r.get("draft")), None)
    else:
        release = await http_json.get_json(
            f"https://api.github.com/repos/{repo}/releases/latest", _GITHUB_HEADERS
        )
    return _from_release(release)


async def _gitlab(config: Dict[str, Any]) -> Optional[VersionInfo]:
    triple = _host_repo_pair(str(config.get("repo_url", "")))
    if not triple:
        return None
    host, user, repo = triple
    project_path = quote(f"{user}/{repo}", safe="")
    url = f"https://{host}/api/v4/projects/{project_path}/releases"
    releases = await http_json.get_json(url)
    release = releases[0] if releases else None
    info = _from_release(release)
    # GitLab's own release objects use "description", not "body".
    if info and not info.notes and release:
        info.notes = release.get("description") or None
    if info and not info.url and release:
        info.url = release.get("_links", {}).get("self")
    return info


async def _codeberg(config: Dict[str, Any]) -> Optional[VersionInfo]:
    pair = _repo_pair(str(config.get("repo", "")))
    if not pair:
        return None
    allow_pre = bool(config.get("allow_prereleases"))
    query = "?draft=exclude" if allow_pre else "?pre-release=exclude&draft=exclude"
    url = f"https://codeberg.org/api/v1/repos/{pair[0]}/{pair[1]}/releases{query}"
    releases = await http_json.get_json(url)
    release = releases[0] if releases else None
    info = _from_release(release)
    if info and not info.notes and release:
        info.notes = release.get("body") or None
    return info


async def _forgejo(config: Dict[str, Any]) -> Optional[VersionInfo]:
    triple = _host_repo_pair(str(config.get("repo_url", "")))
    if not triple:
        return None
    host, user, repo = triple
    base = f"https://{host}/api/v1/repos/{user}/{repo}/releases"
    allow_pre = bool(config.get("allow_prereleases"))
    if allow_pre:
        releases = await http_json.get_json(base)
        release = next((r for r in releases or [] if not r.get("draft")), None)
    else:
        release = await http_json.get_json(f"{base}/latest")
    return _from_release(release)


_RESOLVERS = {
    "GithubUpdater": _github,
    "GitlabUpdater": _gitlab,
    "CodebergUpdater": _codeberg,
    "ForgejoUpdater": _forgejo,
}


async def resolve_available_version(
    manager: Optional[str], config: Dict[str, Any]
) -> VersionInfo:
    resolver = _RESOLVERS.get(manager or "")
    if not resolver:
        return VersionInfo()
    try:
        info = await resolver(config)
    except Exception as e:
        decky.logger.error(f"[{_LOG}] {manager}: {e}")
        return VersionInfo()
    if info is not None:
        return info
    if manager == "GithubUpdater":
        try:
            return VersionInfo(rate_limited_until=await _github_rate_limit_reset())
        except Exception as e:
            decky.logger.error(f"[{_LOG}] rate limit check: {e}")
    return VersionInfo()
