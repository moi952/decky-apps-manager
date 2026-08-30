import json
import re
from pathlib import Path
from typing import Any, Dict, Optional

import decky

from . import http_json
from .project_config import load_project_config

# Checks GitHub Releases for a newer build of this plugin than the one
# currently installed. Used from Plugin._main() so a notification can fire
# once per Decky Loader session even if the user never opens the plugin's
# own panel — a plain frontend fetch() only runs once that panel actually
# mounts, which doesn't happen until the user opens it.
PLUGIN_JSON_PATH = Path(decky.DECKY_PLUGIN_DIR) / "plugin.json"


def _github_repo() -> str:
    config = load_project_config()
    return f"{config['githubOwner']}/{config['githubRepo']}"


def _version_tuple(v: str):
    """'1.2.10' -> (1, 2, 10), tolerant of a leading 'v' and non-numeric
    trailing junk (e.g. a '-beta' suffix on a hand-made tag)."""
    parts = []
    for p in v.lstrip("vV").split("."):
        m = re.match(r"\d+", p)
        parts.append(int(m.group()) if m else 0)
    return tuple(parts)


def _release_from_json(data: Dict[str, Any], fallback_url: str) -> Optional[Dict[str, Any]]:
    tag = data.get("tag_name", "")
    if not tag:
        return None
    # release.yml uploads exactly one asset per release (the zipped plugin
    # build) — pick whichever asset actually looks like it.
    assets = data.get("assets", []) or []
    zip_asset = next(
        (a for a in assets if str(a.get("name", "")).endswith(".zip")),
        None,
    )
    digest = str((zip_asset or {}).get("digest", "") or "")
    sha256 = digest[len("sha256:"):] if digest.startswith("sha256:") else ""
    return {
        "tag": tag,
        "version": tag.lstrip("vV"),
        "url": data.get("html_url", fallback_url),
        "asset_url": (zip_asset or {}).get("browser_download_url", ""),
        "sha256": sha256,
    }


class PluginUpdaterMixin:
    """Backend half of the plugin self-update check. Mixed into Plugin (see
    plugin.py) so its methods/attributes are reachable from _main()."""

    def _read_plugin_json(self) -> Dict[str, Any]:
        try:
            return json.loads(PLUGIN_JSON_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            decky.logger.error(f"[plugin_updater] reading plugin.json: {e}")
            return {}

    async def _fetch_latest_release_json(self) -> Optional[Dict[str, Any]]:
        repo = _github_repo()
        url = f"https://api.github.com/repos/{repo}/releases/latest"
        return await http_json.get_json(
            url,
            {
                "Accept": "application/vnd.github+json",
                "User-Agent": repo.split("/")[-1],
            },
        )

    async def check_plugin_update_on_load(self) -> Optional[Dict[str, Any]]:
        """Called once from _main(). Returns the update-info dict (matching
        the frontend's PluginUpdateInfo shape) only when a newer version is
        actually available — None otherwise, including on any check failure
        (nothing to notify about in that case)."""
        plugin_json = self._read_plugin_json()
        current = str(plugin_json.get("version", ""))
        display_name = str(plugin_json.get("name", load_project_config()["displayName"]))
        repo = _github_repo()

        data = await self._fetch_latest_release_json()
        release = (
            _release_from_json(data, f"https://github.com/{repo}/releases/latest")
            if data
            else None
        )
        if release is None:
            return None

        if not (_version_tuple(release["version"]) > _version_tuple(current)):
            return None

        return {
            "current_version": current,
            "latest_version": release["version"],
            "has_update": True,
            "release_url": release["url"],
            "asset_url": release["asset_url"],
            "sha256": release["sha256"],
            "plugin_display_name": display_name,
            "checked_ok": True,
        }
