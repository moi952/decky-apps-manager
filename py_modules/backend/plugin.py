import asyncio
import json
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

import decky

from . import apps_service
from .plugin_updater import PluginUpdaterMixin

_UPDATE_CHECK_INTERVAL_SECONDS = 3 * 60 * 60
# Floor for the background loop's own cadence — the user-facing interval
# setting's "every time" (0) only ever meant "when the panel opens", not
# "run this loop back-to-back forever"; anything below this is also
# clamped up to it, so a stray small value can't hammer flatpak/gearlever/
# GitHub in a tight loop.
_MIN_BACKGROUND_CHECK_INTERVAL_SECONDS = 15 * 60
# How soon to retry after a check was skipped for lack of connectivity
# (see apps_service.list_apps's own note) — much shorter than the real
# interval above, since this is specifically the boot-time race (Wi-Fi
# not reconnected yet) rather than a case where waiting the normal
# cadence would be fine.
_NO_NETWORK_RETRY_SECONDS = 60


def _background_loop_seconds() -> int:
    minutes = apps_service.get_update_check_interval_minutes()
    if minutes <= 0:
        return _UPDATE_CHECK_INTERVAL_SECONDS
    return max(minutes * 60, _MIN_BACKGROUND_CHECK_INTERVAL_SECONDS)


class Plugin(PluginUpdaterMixin):

    async def ping(self) -> str:
        decky.logger.info("[ping] pong")
        return "pong"

    # ── Apps update (flatpak + Gearlever AppImages) ──────────────────────

    async def list_apps(self, force: bool = False) -> Dict[str, Any]:
        return await apps_service.list_apps(force=force)

    async def update_app(self, app_id: str) -> str:
        return await apps_service.update_app(app_id)

    async def uninstall_app(self, app_id: str) -> bool:
        return await apps_service.uninstall_app(app_id)

    async def update_all_apps(self) -> bool:
        return await apps_service.update_all()

    async def get_excluded_apps(self) -> List[str]:
        return apps_service.get_excluded_apps()

    async def set_excluded_apps(self, ids: List[str]) -> bool:
        return apps_service.set_excluded_apps(ids)

    async def get_auto_update_skip_apps(self) -> List[str]:
        return apps_service.get_auto_update_skip_apps()

    async def set_auto_update_skip_apps(self, ids: List[str]) -> bool:
        return apps_service.set_auto_update_skip_apps(ids)

    async def get_app_icon(self, app_id: str) -> str:
        return apps_service.get_app_icon(app_id)

    async def is_gearlever_installed(self) -> bool:
        return await apps_service.is_gearlever_installed()

    async def install_gearlever(self) -> bool:
        return await apps_service.install_gearlever()

    async def is_gearlever_installing(self) -> bool:
        return apps_service.is_gearlever_installing()

    async def get_gearlever_notice_seen(self) -> bool:
        return apps_service.get_gearlever_notice_seen()

    async def set_gearlever_notice_seen(self) -> bool:
        return apps_service.set_gearlever_notice_seen()

    async def list_appimage_versions(self, file_path: str) -> List[Dict[str, Any]]:
        return await apps_service.list_appimage_versions(file_path)

    async def install_appimage_version(self, file_path: str, url: str, version: str) -> bool:
        return await apps_service.install_appimage_version(file_path, url, version)

    async def set_gearlever_update_source(
        self, file_path: str, manager: str, config: Dict[str, str]
    ) -> bool:
        return await apps_service.set_gearlever_update_source(file_path, manager, config)

    async def get_update_check_interval_minutes(self) -> int:
        return apps_service.get_update_check_interval_minutes()

    async def set_update_check_interval_minutes(self, minutes: int) -> bool:
        return apps_service.set_update_check_interval_minutes(minutes)

    async def get_auto_update_enabled(self) -> bool:
        return apps_service.get_auto_update_enabled()

    async def set_auto_update_enabled(self, enabled: bool) -> bool:
        return apps_service.set_auto_update_enabled(enabled)

    async def get_auto_update_interval_minutes(self) -> int:
        return apps_service.get_auto_update_interval_minutes()

    async def set_auto_update_interval_minutes(self, minutes: int) -> bool:
        return apps_service.set_auto_update_interval_minutes(minutes)

    async def get_auto_update_history(self) -> List[Dict[str, Any]]:
        return apps_service.get_auto_update_history()

    async def get_auto_update_history_has_unseen(self) -> bool:
        return apps_service.get_auto_update_history_has_unseen()

    async def mark_auto_update_history_seen(self) -> bool:
        return apps_service.mark_auto_update_history_seen()

    async def get_update_toast_enabled(self) -> bool:
        return apps_service.get_update_toast_enabled()

    async def set_update_toast_enabled(self, enabled: bool) -> bool:
        return apps_service.set_update_toast_enabled(enabled)

    # ── Flatpak catalog (search/install apps not yet installed) ─────────

    async def search_flatpak_catalog(self, query: str) -> List[Dict[str, Any]]:
        return await apps_service.search_flatpak_catalog(query)

    async def install_flatpak_catalog_app(self, app_id: str, remote: str) -> bool:
        return await apps_service.install_flatpak_catalog_app(app_id, remote)

    async def get_flatpak_catalog_icon(self, app_id: str) -> str:
        return apps_service.get_flatpak_catalog_icon(app_id)

    async def get_flatpak_screenshots(self, app_id: str) -> List[str]:
        return await apps_service.get_flatpak_screenshots(app_id)

    # ── AppImage catalog (search/install apps Gearlever doesn't manage yet) ─

    async def search_appimage_catalog(self, query: str) -> List[Dict[str, Any]]:
        return await apps_service.search_appimage_catalog(query)

    async def install_appimage_catalog_app(
        self, name: str, download_url: str, repo: Optional[str] = None
    ) -> bool:
        return await apps_service.install_appimage_catalog_app(name, download_url, repo)

    async def get_appimage_catalog_icon(self, icon_url: str) -> str:
        return await apps_service.get_appimage_catalog_icon(icon_url)

    async def _apps_update_check_loop(self):
        while True:
            no_network_yet = False
            try:
                data = await apps_service.list_apps(force=True)
                no_network_yet = not data.get("network_available", True)
                if not no_network_yet:
                    pending_flatpak = [
                        a for a in data["flatpak_apps"] if a["has_update"] and not a["excluded"]
                    ]
                    pending_gearlever = [
                        a for a in data["gearlever_apps"] if a["has_update"] and not a["excluded"]
                    ]
                    count = len(pending_flatpak) + len(pending_gearlever)
                    auto_flatpak = [a for a in pending_flatpak if not a.get("auto_update_skipped")]
                    auto_gearlever = [a for a in pending_gearlever if not a.get("auto_update_skipped")]
                    auto_count = len(auto_flatpak) + len(auto_gearlever)
                    if (
                        auto_count
                        and apps_service.get_auto_update_enabled()
                        and apps_service.auto_update_due()
                    ):
                        apps_service.record_auto_update_run()
                        ok = await apps_service.update_all(respect_auto_update_skip=True)
                        apps_service.record_auto_update_history(
                            [
                                {"id": a["id"], "name": a["name"], "kind": a["kind"]}
                                for a in (*auto_flatpak, *auto_gearlever)
                            ],
                            ok,
                        )
                        await decky.emit(
                            "apps_auto_updated" if ok else "apps_update_available",
                            {"count": auto_count},
                        )
                    elif count:
                        await decky.emit("apps_update_available", {"count": count})
            except Exception:
                decky.logger.error(f"[_apps_update_check_loop] {traceback.format_exc()}")

            if no_network_yet:
                await asyncio.sleep(_NO_NETWORK_RETRY_SECONDS)
                continue
            # Re-read the interval fresh every cycle rather than once at
            # startup, so a setting change the user makes in Settings takes
            # effect on the very next iteration, not just after a restart.
            await asyncio.sleep(_background_loop_seconds())

    # ── What's New (tracks which version's changelog the user has already
    # seen — see WhatsNewContext.tsx / WhatsNewBanner.tsx) ───────────────────

    def _whats_new_path(self) -> Path:
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "whats_new_seen.json"

    async def get_whats_new_seen_version(self) -> str:
        try:
            path = self._whats_new_path()
            if path.is_file():
                return json.loads(path.read_text(encoding="utf-8")).get("version", "")
        except Exception as e:
            decky.logger.error(f"[get_whats_new_seen_version] {e}")
        return ""

    async def set_whats_new_seen_version(self, version: str) -> bool:
        try:
            path = self._whats_new_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"version": version}), encoding="utf-8")
            return True
        except Exception as e:
            decky.logger.error(f"[set_whats_new_seen_version] {e}")
            return False

    # ── Other plugins (tracks which plugin ids from moi952/decky-plugins the
    # user has already seen — see OtherPluginsContext.tsx) ──────────────────

    def _other_plugins_seen_path(self) -> Path:
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "other_plugins_seen.json"

    async def get_other_plugins_seen_ids(self) -> List[str]:
        try:
            path = self._other_plugins_seen_path()
            if path.is_file():
                return json.loads(path.read_text(encoding="utf-8")).get("ids", [])
        except Exception as e:
            decky.logger.error(f"[get_other_plugins_seen_ids] {e}")
        return []

    async def set_other_plugins_seen_ids(self, ids: List[str]) -> bool:
        try:
            path = self._other_plugins_seen_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"ids": ids}), encoding="utf-8")
            return True
        except Exception as e:
            decky.logger.error(f"[set_other_plugins_seen_ids] {e}")
            return False

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def _main(self):
        decky.logger.info("plugin loaded")
        try:
            update_info = await self.check_plugin_update_on_load()
            if update_info:
                decky.logger.info(
                    f"[_main] update available: {update_info['latest_version']}"
                )
                await decky.emit("plugin_update_available", update_info)
        except Exception:
            decky.logger.error(f"[_main] update check failed:\n{traceback.format_exc()}")

        self._apps_update_task = asyncio.create_task(self._apps_update_check_loop())

    async def _unload(self):
        decky.logger.info("plugin unloaded")
        task = getattr(self, "_apps_update_task", None)
        if task:
            task.cancel()

    async def _uninstall(self):
        decky.logger.info("plugin uninstalling")

    async def _migration(self):
        pass
