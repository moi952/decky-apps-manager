"""apps_service.py — merges flatpak + Gearlever results, applies the
exclusion list, and orchestrates "update one"/"update all".

Caches the last full list in memory (`_cache`) so opening the panel
shows the same result the periodic background check (see plugin.py's
_apps_update_check_loop) already found, instantly — instead of
re-running every flatpak/gearlever subprocess again on every open.
Callers ask for a fresh check explicitly (`force=True`): the manual
refresh button, and right after any update mutates state.
"""
import asyncio
import base64
import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import decky

from . import appimage_catalog, flatpak, gearlever, gearlever_versions, http_json

_EXCLUDED_APPS_PATH = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "excluded_apps.json"
# Apps that stay fully visible/notified about, but auto-update is not
# allowed to silently touch — distinct from full exclusion above, which
# also hides them from notifications entirely.
_AUTO_UPDATE_SKIP_PATH = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auto_update_skip.json"
_GEARLEVER_NOTICE_PATH = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "gearlever_notice_seen.json"
_UPDATE_CHECK_INTERVAL_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "update_check_interval.json"
)
_AUTO_UPDATE_PATH = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auto_update.json"
_AUTO_UPDATE_INTERVAL_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auto_update_interval.json"
)
_AUTO_UPDATE_LAST_RUN_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auto_update_last_run.json"
)
_AUTO_UPDATE_HISTORY_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auto_update_history.json"
)
_AUTO_UPDATE_HISTORY_SEEN_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auto_update_history_seen.json"
)
_UPDATE_TOAST_ENABLED_PATH = (
    Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "update_toast_enabled.json"
)
_AUTO_UPDATE_HISTORY_MAX_ENTRIES = 30

# Minutes between automatic re-checks the frontend is allowed to run just
# from opening the panel/returning to its home page — 0 means "every
# time" (the previous, only behavior: list_apps's own in-memory cache has
# no TTL of its own, so without this the frontend's own "verify a cached
# result in the background" step re-ran every flatpak/gearlever
# subprocess — and every GitHub API call for AppImage version checks —
# on every single panel open, cached result or not).
_DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES = 60

# Minutes between actual auto-apply runs — deliberately separate from the
# check interval above: checking often (to surface the "updates found"
# badge promptly) and applying unattended less often are two different
# calls a user might reasonably want to make differently. 0 means "every
# time a check finds something", i.e. no extra throttling beyond the
# check interval itself. Defaults far more conservative than the check
# interval's own default, since this one changes system state on its own.
_DEFAULT_AUTO_UPDATE_INTERVAL_MINUTES = 720

_gearlever_installed_cache: Optional[bool] = None
_apps_cache: Optional[Dict[str, Any]] = None
# Set for the duration of install_gearlever() below — lets a component that
# remounted mid-install (closing/reopening the QAM tears down and recreates
# the whole React tree, but this backend process and the flatpak install it
# started keep running) ask "is one still going?" instead of always coming
# back up assuming nothing is happening.
_gearlever_installing: bool = False


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


def get_auto_update_skip_apps() -> List[str]:
    try:
        if _AUTO_UPDATE_SKIP_PATH.is_file():
            return json.loads(_AUTO_UPDATE_SKIP_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        decky.logger.error(f"[apps_service] reading auto_update_skip.json: {e}")
    return []


def set_auto_update_skip_apps(ids: List[str]) -> bool:
    try:
        _AUTO_UPDATE_SKIP_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTO_UPDATE_SKIP_PATH.write_text(json.dumps(ids, indent=2), encoding="utf-8")
        _invalidate_auto_update_skip_flags(set(ids))
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing auto_update_skip.json: {e}")
        return False


def _add_auto_update_skip(app_id: str) -> None:
    """Marks a single app as auto-update-skipped without a round trip
    through the frontend — used right after a manual version switch
    (see install_appimage_version below), since silently auto-updating
    an app back to latest right after the user deliberately picked a
    different version would undo their own choice on the very next
    background cycle."""
    ids = get_auto_update_skip_apps()
    if app_id not in ids:
        set_auto_update_skip_apps([*ids, app_id])


def _invalidate_auto_update_skip_flags(skip_ids: set) -> None:
    if not _apps_cache:
        return
    for app in [*_apps_cache["flatpak_apps"], *_apps_cache["gearlever_apps"]]:
        app["auto_update_skipped"] = app["id"] in skip_ids


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


def get_auto_update_enabled() -> bool:
    try:
        if _AUTO_UPDATE_PATH.is_file():
            return json.loads(_AUTO_UPDATE_PATH.read_text(encoding="utf-8")).get(
                "enabled", False
            )
    except Exception as e:
        decky.logger.error(f"[apps_service] reading auto_update.json: {e}")
    return False


def set_auto_update_enabled(enabled: bool) -> bool:
    try:
        _AUTO_UPDATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTO_UPDATE_PATH.write_text(json.dumps({"enabled": enabled}), encoding="utf-8")
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing auto_update.json: {e}")
        return False


def get_auto_update_interval_minutes() -> int:
    try:
        if _AUTO_UPDATE_INTERVAL_PATH.is_file():
            return json.loads(_AUTO_UPDATE_INTERVAL_PATH.read_text(encoding="utf-8")).get(
                "minutes", _DEFAULT_AUTO_UPDATE_INTERVAL_MINUTES
            )
    except Exception as e:
        decky.logger.error(f"[apps_service] reading auto_update_interval.json: {e}")
    return _DEFAULT_AUTO_UPDATE_INTERVAL_MINUTES


def set_auto_update_interval_minutes(minutes: int) -> bool:
    try:
        _AUTO_UPDATE_INTERVAL_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTO_UPDATE_INTERVAL_PATH.write_text(
            json.dumps({"minutes": minutes}), encoding="utf-8"
        )
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing auto_update_interval.json: {e}")
        return False


def _get_auto_update_last_run() -> float:
    try:
        if _AUTO_UPDATE_LAST_RUN_PATH.is_file():
            return json.loads(_AUTO_UPDATE_LAST_RUN_PATH.read_text(encoding="utf-8")).get(
                "at", 0
            )
    except Exception as e:
        decky.logger.error(f"[apps_service] reading auto_update_last_run.json: {e}")
    return 0


def record_auto_update_run() -> None:
    try:
        _AUTO_UPDATE_LAST_RUN_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTO_UPDATE_LAST_RUN_PATH.write_text(
            json.dumps({"at": time.time()}), encoding="utf-8"
        )
    except Exception as e:
        decky.logger.error(f"[apps_service] writing auto_update_last_run.json: {e}")


def auto_update_due() -> bool:
    """Whether enough time has passed since the last actual auto-apply run,
    per its own interval — independent of how often the check itself
    happens to run (see get_update_check_interval_minutes)."""
    minutes = get_auto_update_interval_minutes()
    if minutes <= 0:
        return True
    return (time.time() - _get_auto_update_last_run()) >= minutes * 60


def get_auto_update_history() -> List[Dict[str, Any]]:
    try:
        if _AUTO_UPDATE_HISTORY_PATH.is_file():
            return json.loads(_AUTO_UPDATE_HISTORY_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        decky.logger.error(f"[apps_service] reading auto_update_history.json: {e}")
    return []


def record_auto_update_history(apps: List[Dict[str, str]], ok: bool) -> None:
    """Appends one entry (newest first, capped) — a permanent-ish log kept
    on its own, independent of whether the user has actually seen it (see
    get_auto_update_history_has_unseen/mark_auto_update_history_seen
    below) and independent of the toast fired alongside the same event,
    which can easily go unseen since the loop this is called from runs
    while the panel may well be closed."""
    if not apps:
        return
    history = get_auto_update_history()
    history.insert(0, {"timestamp": time.time(), "apps": apps, "ok": ok})
    del history[_AUTO_UPDATE_HISTORY_MAX_ENTRIES:]
    try:
        _AUTO_UPDATE_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTO_UPDATE_HISTORY_PATH.write_text(json.dumps(history), encoding="utf-8")
    except Exception as e:
        decky.logger.error(f"[apps_service] writing auto_update_history.json: {e}")


def get_auto_update_history_has_unseen() -> bool:
    history = get_auto_update_history()
    if not history:
        return False
    seen_until = 0.0
    try:
        if _AUTO_UPDATE_HISTORY_SEEN_PATH.is_file():
            seen_until = json.loads(
                _AUTO_UPDATE_HISTORY_SEEN_PATH.read_text(encoding="utf-8")
            ).get("seen_until", 0)
    except Exception as e:
        decky.logger.error(f"[apps_service] reading auto_update_history_seen.json: {e}")
    return history[0]["timestamp"] > seen_until


def mark_auto_update_history_seen() -> bool:
    try:
        _AUTO_UPDATE_HISTORY_SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        _AUTO_UPDATE_HISTORY_SEEN_PATH.write_text(
            json.dumps({"seen_until": time.time()}), encoding="utf-8"
        )
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing auto_update_history_seen.json: {e}")
        return False


def get_update_toast_enabled() -> bool:
    try:
        if _UPDATE_TOAST_ENABLED_PATH.is_file():
            return json.loads(_UPDATE_TOAST_ENABLED_PATH.read_text(encoding="utf-8")).get(
                "enabled", True
            )
    except Exception as e:
        decky.logger.error(f"[apps_service] reading update_toast_enabled.json: {e}")
    return True


def set_update_toast_enabled(enabled: bool) -> bool:
    try:
        _UPDATE_TOAST_ENABLED_PATH.parent.mkdir(parents=True, exist_ok=True)
        _UPDATE_TOAST_ENABLED_PATH.write_text(
            json.dumps({"enabled": enabled}), encoding="utf-8"
        )
        return True
    except Exception as e:
        decky.logger.error(f"[apps_service] writing update_toast_enabled.json: {e}")
        return False


async def is_gearlever_installed(force: bool = False) -> bool:
    global _gearlever_installed_cache
    if force or _gearlever_installed_cache is None:
        _gearlever_installed_cache = await gearlever.is_installed()
    return _gearlever_installed_cache


def is_gearlever_installing() -> bool:
    return _gearlever_installing


async def install_gearlever() -> bool:
    global _gearlever_installed_cache, _gearlever_installing
    _gearlever_installing = True
    try:
        ok = await gearlever.install()
        _gearlever_installed_cache = ok
        return ok
    finally:
        _gearlever_installing = False


async def list_apps(force: bool = False) -> Dict[str, Any]:
    global _apps_cache
    if not force and _apps_cache is not None:
        return {**_apps_cache, "from_cache": True, "network_available": True}

    if not await http_json.has_internet():
        # Every flatpak/gearlever subprocess below fails the exact same
        # way whether there's genuinely nothing new or the network just
        # isn't up yet (confirmed on-device: right after a reboot, this
        # ran before Wi-Fi had reconnected, and the resulting "no update
        # found anywhere" got cached and stuck for hours since nothing
        # told the caller it was actually a failed check). Serve the
        # existing cache untouched instead of overwriting it with a run
        # that's guaranteed wrong; with no cache yet either, an honest
        # empty result beats a false "up to date" one.
        if _apps_cache is not None:
            return {**_apps_cache, "from_cache": True, "network_available": False}
        return {
            "flatpak_apps": [],
            "gearlever_apps": [],
            "gearlever_installed": False,
            "github_rate_limited_until": None,
            "checked_at": time.time(),
            "from_cache": False,
            "network_available": False,
        }

    excluded = set(get_excluded_apps())

    # system/user scopes, and the Gearlever list, are fully independent —
    # each does its own round of subprocess/network calls, so running them
    # concurrently instead of one after another is a straight wall-clock
    # win with no shared state to worry about.
    gearlever_installed = await is_gearlever_installed()
    if gearlever_installed:
        flatpak_lists, gearlever_apps = await asyncio.gather(
            asyncio.gather(*(flatpak.list_apps_with_updates(scope) for scope in ("system", "user"))),
            gearlever.list_apps_with_updates(),
        )
    else:
        flatpak_lists = await asyncio.gather(
            *(flatpak.list_apps_with_updates(scope) for scope in ("system", "user"))
        )
        gearlever_apps = []
    flatpak_apps: List[Dict[str, Any]] = [app for scope_apps in flatpak_lists for app in scope_apps]

    skip_auto = set(get_auto_update_skip_apps())
    for app in [*flatpak_apps, *gearlever_apps]:
        app["excluded"] = app["id"] in excluded
        app["auto_update_skipped"] = app["id"] in skip_auto

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
    return {**_apps_cache, "from_cache": False, "network_available": True}


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


async def update_all(respect_auto_update_skip: bool = False) -> bool:
    """respect_auto_update_skip=True is for the background auto-update
    loop only — a manual "Update all" click should still update
    everything the user hasn't fully excluded, skip-flagged app included
    (that flag only means "don't touch this one on your own")."""
    excluded = set(get_excluded_apps())
    skip_auto = set(get_auto_update_skip_apps()) if respect_auto_update_skip else set()
    data = await list_apps(force=True)

    ok = True
    for scope in ("system", "user"):
        ids = [
            app["app_id"] for app in data["flatpak_apps"]
            if app["scope"] == scope and app["has_update"]
            and app["id"] not in excluded and app["id"] not in skip_auto
        ]
        if ids and not await flatpak.update_many(ids, scope):
            ok = False

    file_paths = [
        app["file_path"] for app in data["gearlever_apps"]
        if app["has_update"] and app["id"] not in excluded and app["id"] not in skip_auto
    ]
    if file_paths and not await gearlever.update_many(file_paths):
        ok = False

    await list_apps(force=True)
    return ok


async def list_appimage_versions(file_path: str) -> List[Dict[str, Any]]:
    apps = await gearlever.list_installed()
    match = next((a for a in apps if a["file_path"] == file_path), None)
    if not match or match.get("update_manager") != "GithubUpdater":
        return []
    return await gearlever_versions.list_github_versions(
        match.get("update_manager_config") or {}
    )


async def install_appimage_version(file_path: str, url: str, version: str) -> bool:
    ok = await gearlever.replace_appimage_file(file_path, url, version)
    if ok:
        # Picking a specific version is a deliberate override — auto-update
        # silently bumping it back to latest on the very next background
        # cycle would undo it right away, so this app opts out of the
        # automatic path (manual "Update all"/single update still work as
        # normal; see update_all's own note).
        _add_auto_update_skip(f"appimage:{file_path}")
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
