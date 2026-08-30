import asyncio
import json
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

import decky

from . import apps_service
from .plugin_updater import PluginUpdaterMixin

_UPDATE_CHECK_INTERVAL_SECONDS = 3 * 60 * 60


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

    async def get_app_icon(self, app_id: str) -> str:
        return apps_service.get_app_icon(app_id)

    async def is_gearlever_installed(self) -> bool:
        return await apps_service.is_gearlever_installed()

    async def install_gearlever(self) -> bool:
        return await apps_service.install_gearlever()

    async def get_gearlever_notice_seen(self) -> bool:
        return apps_service.get_gearlever_notice_seen()

    async def set_gearlever_notice_seen(self) -> bool:
        return apps_service.set_gearlever_notice_seen()

    async def set_gearlever_update_source(
        self, file_path: str, manager: str, config: Dict[str, str]
    ) -> bool:
        return await apps_service.set_gearlever_update_source(file_path, manager, config)

    async def get_update_check_interval_minutes(self) -> int:
        return apps_service.get_update_check_interval_minutes()

    async def set_update_check_interval_minutes(self, minutes: int) -> bool:
        return apps_service.set_update_check_interval_minutes(minutes)

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
            try:
                data = await apps_service.list_apps(force=True)
                count = sum(1 for a in data["flatpak_apps"] if a["has_update"] and not a["excluded"])
                count += sum(1 for a in data["gearlever_apps"] if a["has_update"] and not a["excluded"])
                if count:
                    await decky.emit("apps_update_available", {"count": count})
            except Exception:
                decky.logger.error(f"[_apps_update_check_loop] {traceback.format_exc()}")
            await asyncio.sleep(_UPDATE_CHECK_INTERVAL_SECONDS)

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
