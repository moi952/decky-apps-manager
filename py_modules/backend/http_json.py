"""http_json.py — small curl-based JSON GET helper.

Shared by anything in this backend that needs to hit a public HTTP API
(GitHub/GitLab/Codeberg/Forgejo releases, ...) — shells out to curl
through proc_env.run rather than pulling in a Python HTTP client, so it
gets the same LD_LIBRARY_PATH-stripped env every other subprocess here
already needs (see proc_env.py's own docstring).
"""
import json
from typing import Any, Dict, Optional

from . import proc_env

_LOG = "http_json"


async def get_json(
    url: str, headers: Optional[Dict[str, str]] = None, timeout: float = 15
) -> Optional[Any]:
    args = ["curl", "-sfL"]
    for key, value in (headers or {}).items():
        args += ["-H", f"{key}: {value}"]
    args.append(url)
    code, out, _ = await proc_env.run(args, "user", _LOG, timeout=timeout)
    if code != 0:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


async def has_internet(timeout: float = 3) -> bool:
    """Cheap connectivity probe — a bare IP (Cloudflare's 1.1.1.1), not a
    hostname, so it stays meaningful even when DNS itself isn't up yet
    (confirmed on-device: right after a Steam Deck reboot, the plugin's
    own first check ran before networking was ready at all — every
    flatpak/gearlever subprocess it spawned failed with "Could not
    resolve hostname"/"Internet connection not available", and nothing
    distinguished that from a genuine "checked, nothing new" answer, so
    the false negative got cached and stuck until whatever the next
    scheduled check happened to be, hours later). Callers doing a real
    update check should call this first and skip the check entirely
    rather than run it knowing it'll come back wrong."""
    code, _, _ = await proc_env.run(
        ["curl", "-sf", "--max-time", str(int(timeout)), "-o", "/dev/null", "https://1.1.1.1"],
        "user", _LOG, timeout=timeout + 2,
    )
    return code == 0
