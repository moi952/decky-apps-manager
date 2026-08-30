"""proc_env.py — process environment for flatpak/gearlever subprocess calls.

The Decky backend runs as root with none of the desktop session's env
vars (verified on-device — see the sibling unifideck plugin's
services/download/prefix_warmup.py, which hit the exact same problem
for umu-run and documents an A/B-tested fix). Every flatpak/gearlever
subprocess we spawn needs HOME/XDG pointed at the deck user, and —
for --user scope and for Gearlever's own flatpak sandbox — a borrowed
XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS, or flatpak can't resolve
--user installs and `flatpak run` has no runtime dir to bind-mount.

--system scope does not need the borrowed session vars: root already
has direct write access to /var/lib/flatpak, so flatpak skips its
D-Bus system-helper/polkit path entirely (that path only triggers for
non-privileged callers).
"""
import asyncio
import os
import pwd
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

import decky

Scope = Literal["system", "user"]

_SESSION_ENV_KEYS = (
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "XAUTHORITY",
)


def _deck_uid() -> Optional[int]:
    try:
        return pwd.getpwnam(decky.DECKY_USER).pw_uid
    except KeyError:
        return None


def _deck_gid() -> Optional[int]:
    try:
        return pwd.getpwnam(decky.DECKY_USER).pw_gid
    except KeyError:
        return None


# Public aliases — anything outside this module that needs to hand a
# freshly root-created path to the deck user (e.g. a directory a "user"
# scope subprocess must then write into) needs these too.
deck_uid = _deck_uid
deck_gid = _deck_gid


def _session_env_from_steam_proc(uid: int) -> Dict[str, str]:
    """Scan /proc for the running Steam client owned by uid and return the
    session env vars from its environ, or {} if not found."""
    try:
        proc_entries = os.listdir("/proc")
    except OSError:
        return {}
    for entry in proc_entries:
        if not entry.isdigit():
            continue
        try:
            if os.stat(f"/proc/{entry}").st_uid != uid:
                continue
            with open(f"/proc/{entry}/comm") as fh:
                if fh.read().strip() != "steam":
                    continue
            data = Path(f"/proc/{entry}/environ").read_bytes()
        except OSError:
            continue
        found: Dict[str, str] = {}
        for chunk in data.split(b"\0"):
            key, sep, value = chunk.partition(b"=")
            if not sep or not value:
                continue
            try:
                name = key.decode()
            except UnicodeDecodeError:
                continue
            if name in _SESSION_ENV_KEYS:
                found[name] = value.decode(errors="replace")
        if found:
            return found
    return {}


def _user_session_env() -> Dict[str, str]:
    """The standard /run/user/<uid> runtime dir and its `bus` socket
    ALWAYS take priority over whatever a borrowed process's own environ
    reports for those two keys — confirmed on a device where Steam
    itself is Flatpak-packaged: its DBUS_SESSION_BUS_ADDRESS pointed at
    `/run/flatpak/bus`, a proxy path that only exists inside Steam's own
    bwrap mount namespace and isn't present on the host at all, which
    made every `flatpak run` we borrowed it into fail with "Failed to
    connect to bus". The borrowed env is only used to fill in keys with
    no reliable standard location (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY)."""
    uid = _deck_uid()
    if uid is None:
        return {}

    env: Dict[str, str] = {}
    runtime = f"/run/user/{uid}"
    if os.path.isdir(runtime):
        env["XDG_RUNTIME_DIR"] = runtime
        if os.path.exists(f"{runtime}/bus"):
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={runtime}/bus"

    for key, value in _session_env_from_steam_proc(uid).items():
        env.setdefault(key, value)

    return env


def build_env(scope: Scope) -> Dict[str, str]:
    env = os.environ.copy()
    env.pop("LD_LIBRARY_PATH", None)

    home = decky.DECKY_USER_HOME
    env["HOME"] = home
    env["USER"] = decky.DECKY_USER
    env["XDG_DATA_HOME"] = f"{home}/.local/share"
    env["XDG_CONFIG_HOME"] = f"{home}/.config"
    env["XDG_CACHE_HOME"] = f"{home}/.cache"

    if scope == "user":
        env.update(_user_session_env())

    return env


def _drop_privileges_kwargs(scope: Scope) -> Dict[str, int]:
    """--user scope (and Gearlever's own flatpak sandbox) must run AS the
    deck user, not merely with its HOME/XDG env borrowed: the session D-Bus
    daemon authenticates callers by real uid (SO_PEERCRED), so a root
    process presenting uid 0 gets refused ("Failed to connect to bus") even
    though the socket file itself is world-accessible. Actually dropping
    privileges via subprocess's user=/group= (safe pre-exec fork+setuid,
    unlike preexec_fn) makes the connection look like it comes from the
    deck user's own session, which the bus accepts.

    No-op (returns {}) when we're not root or the deck uid can't be
    resolved — in that case the subprocess simply keeps running as
    whatever we already are."""
    if scope != "user" or os.getuid() != 0:
        return {}
    uid = _deck_uid()
    gid = _deck_gid()
    if uid is None or gid is None:
        return {}
    return {"user": uid, "group": gid}


async def run(
    args: List[str],
    scope: Scope,
    log_prefix: str,
    timeout: Optional[float] = 60,
) -> Tuple[int, str, str]:
    """Run a subprocess with the right env/identity for `scope`, logging the
    command and any failure. Returns (returncode, stdout, stderr);
    returncode is -1 on timeout."""
    decky.logger.info(f"[{log_prefix}] $ {' '.join(args)}")
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=build_env(scope),
            **_drop_privileges_kwargs(scope),
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        decky.logger.error(f"[{log_prefix}] timed out after {timeout}s: {' '.join(args)}")
        return -1, "", "timed out"
    except Exception as e:
        decky.logger.error(f"[{log_prefix}] failed to spawn: {e}")
        return -1, "", str(e)

    stdout = out.decode(errors="replace")
    stderr = err.decode(errors="replace")
    if proc.returncode != 0:
        # Gearlever's CLI (Cli.py) reports its own errors via plain
        # print() to stdout, not stderr — logging stderr alone silently
        # dropped those messages (an empty "exit 1:" line in the log).
        detail = stderr.strip() or stdout.strip()
        decky.logger.error(f"[{log_prefix}] exit {proc.returncode}: {detail[:4000]}")
    return proc.returncode or 0, stdout, stderr
