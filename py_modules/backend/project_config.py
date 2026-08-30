import json
from pathlib import Path
from typing import Any, Dict

import decky

# project.config.json lives at the plugin root (same file the frontend
# imports directly — see src/utils/githubReleases.ts). Both sides read the
# same source of truth, so editing that one file is enough: no string
# substitution required for the update-checker to stay in sync. Static
# metadata that GitHub/npm/Decky render on their own (package.json,
# plugin.json, README.md) still needs scripts/init-template.js run once.
_CONFIG_PATH = Path(decky.DECKY_PLUGIN_DIR) / "project.config.json"

_DEFAULTS: Dict[str, Any] = {
    "githubOwner": "your-github-username",
    "githubRepo": "decky-my-plugin",
    "displayName": "My Plugin",
}


def load_project_config() -> Dict[str, Any]:
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        decky.logger.error(f"[project_config] failed to read {_CONFIG_PATH}: {e}")
        return dict(_DEFAULTS)
