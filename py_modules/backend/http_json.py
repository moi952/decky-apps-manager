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
