"""apps_service.py — merges flatpak + Gearlever results, applies the
exclusion list, and orchestrates "update one"/"update all".

Caches the last full list in memory (`_cache`) so opening the panel
shows the same result the periodic background check (see plugin.py's
_apps_update_check_loop) already found, instantly — instead of
re-running every flatpak/gearlever subprocess again on every open.
Callers ask for a fresh check explicitly (`force=True`): the manual
refresh button, and right after any update mutates state.
"""
import base64
import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import decky

from . import appimage_catalog, flatpak, gearlever

_EXCLUDED_APPS_PATH = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "excluded_apps.json"
_GEARLEVER_NOTICE_PATH = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "gearlever_notice_seen.json"
_UPDATE_CHECK_INTERVAL_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "update_check_interval.json"
)

# Minutes between automatic re-checks the frontend is allowed to run just
# from opening the panel/returning to its home page — 0 means "every
# time" (the previous, only behavior: list_apps's own in-memory cache has
# no TTL of its own, so without this the frontend's own "verify a cached
# result in the background" step re-ran every flatpak/gearlever
# subprocess — and every GitHub API call for AppImage version checks —
# on every single panel open, cached result or not).
_DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES = 60

_gearlever_installed_cache: Optional[bool] = None
_apps_cache: Optional[Dict[str, Any]] = None


def get_excluded_apps() -> List[str]:
    try:
        if _EXCLUDED_APPS_PATH.is_file():
            return json.loads(_EXCLUDED_APPS_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        decky.logger.error(f"[apps_service] reading excluded_apps.json: {e}")
    return []


def set_excluded_apps(ids: List[str]) -> bool:
    try:
        _EXCLUDED_APPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        _EXCLUDED_APPS_PATH.write_text(json.dumps(ids, indent=2), encoding="utf-8")
        _invalidate_excluded_flags(set(ids))
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing excluded_apps.json: {e}")
        return False


def _invalidate_excluded_flags(excluded: set) -> None:
    """Exclusion is a pure local flag with nothing to re-check over the
    network, so patch the cache in place rather than throwing away a
    perfectly good, possibly-expensive-to-rebuild app list."""
    if not _apps_cache:
        return
    for app in [*_apps_cache["flatpak_apps"], *_apps_cache["gearlever_apps"]]:
        app["excluded"] = app["id"] in excluded


def get_gearlever_notice_seen() -> bool:
    try:
        if _GEARLEVER_NOTICE_PATH.is_file():
            return json.loads(_GEARLEVER_NOTICE_PATH.read_text(encoding="utf-8")).get("seen", False)
    except Exception as e:
        decky.logger.error(f"[apps_service] reading gearlever_notice_seen.json: {e}")
    return False


def set_gearlever_notice_seen() -> bool:
    try:
        _GEARLEVER_NOTICE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _GEARLEVER_NOTICE_PATH.write_text(json.dumps({"seen": True}), encoding="utf-8")
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing gearlever_notice_seen.json: {e}")
        return False


def get_update_check_interval_minutes() -> int:
    try:
        if _UPDATE_CHECK_INTERVAL_PATH.is_file():
            return json.loads(_UPDATE_CHECK_INTERVAL_PATH.read_text(encoding="utf-8")).get(
                "minutes", _DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES
            )
    except Exception as e:
        decky.logger.error(f"[apps_service] reading update_check_interval.json: {e}")
    return _DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES


def set_update_check_interval_minutes(minutes: int) -> bool:
    try:
        _UPDATE_CHECK_INTERVAL_PATH.parent.mkdir(parents=True, exist_ok=True)
        _UPDATE_CHECK_INTERVAL_PATH.write_text(
            json.dumps({"minutes": minutes}), encoding="utf-8"
        )
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing update_check_interval.json: {e}")
        return False


async def is_gearlever_installed(force: bool = False) -> bool:
    global _gearlever_installed_cache
    if force or _gearlever_installed_cache is None:
        _gearlever_installed_cache = await gearlever.is_installed()
    return _gearlever_installed_cache


async def install_gearlever() -> bool:
    global _gearlever_installed_cache
    ok = await gearlever.install()
    _gearlever_installed_cache = ok
    return ok


async def list_apps(force: bool = False) -> Dict[str, Any]:
    global _apps_cache
    if not force and _apps_cache is not None:
        return {**_apps_cache, "from_cache": True}

    excluded = set(get_excluded_apps())

    flatpak_apps: List[Dict[str, Any]] = []
    for scope in ("system", "user"):
        flatpak_apps += await flatpak.list_apps_with_updates(scope)

    gearlever_apps: List[Dict[str, Any]] = []
    if await is_gearlever_installed():
        gearlever_apps = await gearlever.list_apps_with_updates()

    for app in [*flatpak_apps, *gearlever_apps]:
        app["excluded"] = app["id"] in excluded

    # Highest reset time across every AppImage whose version lookup hit
    # GitHub's anonymous rate limit this cycle — one plugin-wide notice
    # covers all of them rather than repeating the same explanation per app.
    rate_limit_resets = [
        app["github_rate_limited_until"] for app in gearlever_apps
        if app.get("github_rate_limited_until")
    ]

    _apps_cache = {
        "flatpak_apps": flatpak_apps,
        "gearlever_apps": gearlever_apps,
        "gearlever_installed": await is_gearlever_installed(),
        "github_rate_limited_until": max(rate_limit_resets) if rate_limit_resets else None,
        "checked_at": time.time(),
    }
    return {**_apps_cache, "from_cache": False}


def _parse_flatpak_id(app_id: str) -> Optional[Dict[str, str]]:
    # "flatpak:<app-id>:<scope>"
    parts = app_id.split(":", 2)
    if len(parts) != 3 or parts[0] != "flatpak":
        return None
    return {"app_id": parts[1], "scope": parts[2]}


def _parse_appimage_id(app_id: str) -> Optional[str]:
    # "appimage:<file-path>"
    if not app_id.startswith("appimage:"):
        return None
    return app_id[len("appimage:"):]


async def update_app(app_id: str) -> str:
    """Returns "updated", "already_up_to_date", or "error"."""
    flatpak_ref = _parse_flatpak_id(app_id)
    if flatpak_ref:
        still_pending = await flatpak.check_single(flatpak_ref["app_id"], flatpak_ref["scope"])
        if still_pending is False:
            return "already_up_to_date"
        ok = await flatpak.update_one(flatpak_ref["app_id"], flatpak_ref["scope"])
        await list_apps(force=True)
        return "updated" if ok else "error"

    file_path = _parse_appimage_id(app_id)
    if file_path:
        still_pending = await gearlever.check_single(file_path)
        if still_pending is False:
            return "already_up_to_date"
        ok = await gearlever.update_one(file_path)
        await list_apps(force=True)
        return "updated" if ok else "error"

    decky.logger.error(f"[apps_service] update_app: unrecognized id {app_id}")
    return "error"


async def uninstall_app(app_id: str) -> bool:
    flatpak_ref = _parse_flatpak_id(app_id)
    if flatpak_ref:
        ok = await flatpak.uninstall_one(flatpak_ref["app_id"], flatpak_ref["scope"])
        if ok:
            await list_apps(force=True)
        return ok

    file_path = _parse_appimage_id(app_id)
    if file_path:
        ok = await gearlever.remove_one(file_path)
        if ok:
            await list_apps(force=True)
        return ok

    decky.logger.error(f"[apps_service] uninstall_app: unrecognized id {app_id}")
    return False


async def update_all() -> bool:
    excluded = set(get_excluded_apps())
    data = await list_apps(force=True)

    ok = True
    for scope in ("system", "user"):
        ids = [
            app["app_id"] for app in data["flatpak_apps"]
            if app["scope"] == scope and app["has_update"] and app["id"] not in excluded
        ]
        if ids and not await flatpak.update_many(ids, scope):
            ok = False

    file_paths = [
        app["file_path"] for app in data["gearlever_apps"]
        if app["has_update"] and app["id"] not in excluded
    ]
    if file_paths and not await gearlever.update_many(file_paths):
        ok = False

    await list_apps(force=True)
    return ok


async def set_gearlever_update_source(file_path: str, manager: str, config: Dict[str, str]) -> bool:
    ok = await gearlever.set_update_source(file_path, manager, config)
    if ok:
        await list_apps(force=True)
    return ok


def _read_as_data_uri(path: Optional[Path]) -> str:
    if not path or not path.is_file():
        return ""
    mime, _ = mimetypes.guess_type(str(path))
    mime = mime or "application/octet-stream"
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError as e:
        decky.logger.error(f"[apps_service] reading icon {path}: {e}")
        return ""
    return f"data:{mime};base64,{encoded}"


def get_app_icon(app_id: str) -> str:
    flatpak_ref = _parse_flatpak_id(app_id)
    if flatpak_ref:
        return _read_as_data_uri(flatpak.icon_path(flatpak_ref["app_id"], flatpak_ref["scope"]))

    file_path = _parse_appimage_id(app_id)
    if file_path:
        return _read_as_data_uri(gearlever.icon_path(file_path))

    return ""


# ── Flatpak catalog (search/install apps not yet installed) ─────────────

async def search_flatpak_catalog(query: str) -> List[Dict[str, Any]]:
    if not query.strip():
        return []
    installed_ids = {
        app["app_id"] for app in (_apps_cache or {}).get("flatpak_apps", [])
    }
    results = await flatpak.search(query)
    for entry in results:
        entry["installed"] = entry["app_id"] in installed_ids
    return results


async def install_flatpak_catalog_app(app_id: str, remote: str) -> bool:
    scope = await flatpak.remote_scope(remote)
    ok = await flatpak.install(app_id, remote, scope)
    if ok:
        await list_apps(force=True)
    return ok


def get_flatpak_catalog_icon(app_id: str) -> str:
    return _read_as_data_uri(flatpak.search_icon_path(app_id))


async def get_flatpak_screenshots(app_id: str) -> List[str]:
    return await flatpak.get_screenshots(app_id)


# ── AppImage catalog (search/install apps Gearlever doesn't manage yet) ──

async def search_appimage_catalog(query: str) -> List[Dict[str, Any]]:
    return await appimage_catalog.search(query)


async def install_appimage_catalog_app(
    name: str, download_url: str, repo: Optional[str] = None
) -> bool:
    ok = await appimage_catalog.install(name, download_url, repo)
    if ok:
        await list_apps(force=True)
    return ok


async def get_appimage_catalog_icon(icon_url: str) -> str:
    return await appimage_catalog.get_icon_data_uri(icon_url)
