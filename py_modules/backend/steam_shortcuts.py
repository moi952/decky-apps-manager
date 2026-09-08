"""steam_shortcuts.py — read-only lookups against Steam's own
shortcuts.vdf.

"Is this app already a Steam shortcut" is answered by checking the real
file live, every time — not a separate bookkeeping file of our own,
which could silently drift out of sync with what Steam itself actually
has (e.g. the user removing a shortcut from Steam's own UI). Creating/
removing a shortcut is still only ever done frontend-side (see
steamShortcut.ts's own note on why a backend write here wouldn't take
effect mid-session) — this module never writes shortcuts.vdf.
"""
from pathlib import Path
from typing import List, Optional

import decky

from .binary_vdf import read_binary


def _steam_path() -> Path:
    return Path(decky.DECKY_USER_HOME) / ".local" / "share" / "Steam"


def _user_dirs() -> List[Path]:
    userdata = _steam_path() / "userdata"
    if not userdata.is_dir():
        return []
    return [
        d for d in userdata.iterdir()
        if d.is_dir() and d.name.isdigit() and int(d.name) > 0
    ]


def _shortcuts_paths() -> List[Path]:
    return [
        d / "config" / "shortcuts.vdf"
        for d in _user_dirs()
        if (d / "config" / "shortcuts.vdf").is_file()
    ]


def find_shortcut_appid(identifier: str) -> Optional[int]:
    """`identifier` is the Flatpak app id or the AppImage's own file path
    — whichever this app is uniquely known by. Matched as a *substring* of
    Exe or LaunchOptions, not exact equality: confirmed on-device that a
    shortcut added by hand, or by a distro's own Flatpak/Steam integration
    (e.g. Bazzite's Anatase), carries a completely different Exe (a
    wrapper binary, not /usr/bin/flatpak) and a differently-quoted,
    differently-ordered LaunchOptions — but the app id or file path itself
    still always appears verbatim somewhere in one of those two fields,
    regardless of who or what constructed the command around it."""
    for path in _shortcuts_paths():
        try:
            nodes, _ = read_binary(path.read_bytes(), 0)
        except Exception as e:
            decky.logger.error(f"[steam_shortcuts] reading {path}: {e}")
            continue
        for tag, key, children in nodes:
            if tag != 0x00 or key.lower() != "shortcuts":
                continue
            for etag, _, efields in children:
                if etag != 0x00:
                    continue
                appid_val = None
                exe_val = ""
                launch_options_val = ""
                for ftag, fkey, fvalue in efields:
                    if ftag == 0x02 and fkey.lower() == "appid":
                        appid_val = fvalue & 0xFFFFFFFF
                    if ftag == 0x01 and fkey.lower() == "exe":
                        exe_val = fvalue
                    if ftag == 0x01 and fkey.lower() == "launchoptions":
                        launch_options_val = fvalue
                if appid_val is not None and (
                    identifier in exe_val or identifier in launch_options_val
                ):
                    return appid_val
    return None
