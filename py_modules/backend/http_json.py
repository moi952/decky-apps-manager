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
    # --max-time is the real, OS-level bound — without it, a stalled
    # connection (GitHub/network hiccup mid-request) has nothing forcing
    # curl itself to give up. proc_env.run's own `timeout` is only an
    # asyncio-level wrapper around waiting for the process; on its own it
    # can leave curl running as an orphaned process indefinitely once the
    # Python side stops waiting (see proc_env.run's own note on why it now
    # kills on timeout too — belt and suspenders, not either/or).
    args = ["curl", "-sfL", "--max-time", str(int(timeout))]
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


async def resolve_redirect(url: str, timeout: float = 15) -> Optional[str]:
    """The single Location a request to `url` redirects to — never
    follows it. Some hosts redirect based on server-side state regardless
    of the request path's exact content (e.g. GitHub's own
    releases/latest/download/<name> always resolves to the real latest
    release's tag, whether or not <name> is an actual asset in it) — that
    lets a caller resolve that state with one request that never touches
    a rate-limited API."""
    code, out, _ = await proc_env.run(
        ["curl", "-sI", "-o", "/dev/null", "-w", "%{redirect_url}",
         "--max-time", str(int(timeout)), url],
        "user", _LOG, timeout=timeout,
    )
    if code != 0:
        return None
    return out.strip() or None


async def url_exists(url: str, timeout: float = 15) -> bool:
    """True if `url` resolves (following redirects) to a successful
    response — a plain HEAD, no body downloaded."""
    code, _, _ = await proc_env.run(
        ["curl", "-sfIL", "-o", "/dev/null", "--max-time", str(int(timeout)), url],
        "user", _LOG, timeout=timeout,
    )
    return code == 0


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
