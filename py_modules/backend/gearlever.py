"""gearlever.py — list/check/update Gearlever-managed AppImages.

Gearlever (it.mijorus.gearlever) ships a headless CLI reached through
`flatpak run` (see src/Cli.py in its own repo). --list-installed and
--list-updates both support --json (a versioned, structured document —
see Cli._make_app_json), which is what this module uses instead of
parsing the fixed-width human table.

Config storage: as of Gearlever's "wip ini configuration" rewrite
(mid-2026), per-app update-source config lives in a single INI file,
$XDG_CONFIG_HOME/gearlever.conf, in a section named
`app.<md5hex(file_path)>.update_manager` — keyed by a hash of the
AppImage's own file path, not the old base64(app name) scheme the
now-unused apps.json used (see lib/ini_config.py::Config vs the
migration-only lib/json_config.py in Gearlever's own source).
"""
import configparser
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import decky

from . import gearlever_versions, proc_env

_LOG = "gearlever"
APP_ID = "it.mijorus.gearlever"


def _run_gearlever(args: List[str], timeout: Optional[float] = 60):
    return proc_env.run(["flatpak", "run", APP_ID, *args], "user", _LOG, timeout=timeout)


async def is_installed() -> bool:
    code, _, _ = await proc_env.run(["flatpak", "info", APP_ID], "user", _LOG, timeout=15)
    if code == 0:
        return True
    code, _, _ = await proc_env.run(["flatpak", "info", "--system", APP_ID], "user", _LOG, timeout=15)
    return code == 0


async def install() -> bool:
    code, _, _ = await proc_env.run(
        ["flatpak", "install", "flathub", APP_ID, "-y", "--noninteractive", "--system"],
        "system", _LOG, timeout=300,
    )
    if code == 0:
        return True
    code, _, _ = await proc_env.run(
        ["flatpak", "install", "flathub", APP_ID, "-y", "--noninteractive", "--user"],
        "user", _LOG, timeout=300,
    )
    return code == 0


def _gearlever_conf_path() -> Path:
    home = Path(decky.DECKY_USER_HOME)
    flatpak_path = home / ".var" / "app" / APP_ID / "config" / "gearlever.conf"
    if flatpak_path.is_file():
        return flatpak_path
    return home / ".config" / "gearlever.conf"


def get_update_config(file_path: str) -> Dict[str, Any]:
    """Mirrors Gearlever's own lib/ini_config.py::Config.get_app_update_
    config: section `app.<md5hex(file_path)>.update_manager` in
    gearlever.conf. Booleans come back as real bools (configparser
    stores Python's str(bool) — "True"/"False" — getboolean handles
    that plus yes/no/1/0 case-insensitively).

    gearlever.conf carries a [DEFAULT] section (fetch-updates-in-
    background) that configparser silently merges into every section's
    .items()/[] view — confirmed on-device this leaked into what we sent
    back through --set-update-source, which Gearlever's Cli.py rejects
    outright on any key it didn't ask for (exact-set match against the
    manager's own config template), so the save looked like a no-op.
    Excluding parser.defaults() keys is required, not just tidiness."""
    section = f"app.{hashlib.md5(file_path.encode('utf-8')).hexdigest()}.update_manager"
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read(_gearlever_conf_path(), encoding="utf-8")
    except (OSError, configparser.Error):
        return {}
    if not parser.has_section(section):
        return {}

    defaults = set(parser.defaults().keys())
    config: Dict[str, Any] = {}
    for key, value in parser.items(section):
        if key == "manager" or key in defaults:
            continue
        try:
            config[key] = parser.getboolean(section, key)
        except ValueError:
            config[key] = value
    return config


_EMBEDDED_INFO_LINE = re.compile(r"\[\s*\d+\](.*)$")


async def _read_embedded_update_info(file_path: str) -> Optional[str]:
    """Per the AppImageSpec draft, an AppImage can carry its own update
    string in a `.upd_info` ELF section — this is how Gearlever finds an
    update source for an app with no gearlever.conf entry at all
    (`embedded_source: true` in --json)."""
    code, out, _ = await proc_env.run(
        ["readelf", "--string-dump=.upd_info", "--wide", file_path],
        "user", _LOG, timeout=10,
    )
    if code != 0:
        return None
    for line in out.splitlines():
        m = _EMBEDDED_INFO_LINE.search(line)
        if m:
            return m.group(1).strip()
    return None


def _github_config_from_embedded(info: str) -> Optional[Dict[str, Any]]:
    # gh-releases-zsync|user|repo|tag|filename — `repo` here must end up
    # as "user/repo" (GithubUpdater.validate_config requires exactly one
    # "/"), matching what get_config_from_form now produces for a
    # manually-configured source (no more full repo_url for Github).
    prefix = "gh-releases-zsync|"
    if not info.startswith(prefix):
        return None
    parts = info[len(prefix):].split("|")
    if len(parts) != 4:
        return None
    user, repo, tag, filename = parts
    return {
        "repo": f"{user}/{repo}",
        "repo_filename": filename,
        "allow_prereleases": tag in ("latest-pre", "latest-all"),
    }


async def _resolve_update_manager_config(manager: str, file_path: str) -> Dict[str, Any]:
    config = get_update_config(file_path)
    if config:
        return config
    # No gearlever.conf section — GithubUpdater is the only manager
    # Gearlever can also derive from an AppImage's own embedded update
    # string (see handles_embedded across the model classes), so it's
    # the only case worth resolving here.
    if manager == "GithubUpdater":
        info = await _read_embedded_update_info(file_path)
        if info:
            derived = _github_config_from_embedded(info)
            if derived:
                return derived
    return {}


_RATE_LIMIT_MARKER = "rate limit exceeded"


def _parse_trailing_json(out: str) -> Optional[Dict[str, Any]]:
    """Gearlever's own CLI sometimes prints a raw Python exception
    straight to stdout ahead of the actual JSON — confirmed on-device:
    a GithubUpdater's own per-app update check hitting GitHub's
    anonymous rate limit prints "403 Client Error: rate limit
    exceeded..." (one line per affected app) directly to stdout, then
    the real --json output last. json.loads() on the whole blob just
    throws on that, silently going through as "no updates at all" (see
    _list_json's own use of this) — the JSON itself is always the very
    last non-empty line when this happens, so parsing from there instead
    survives it."""
    stripped = out.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped.splitlines()[-1])
    except json.JSONDecodeError:
        return None


async def _list_json_raw(args: List[str], key: str) -> tuple:
    """Same as _list_json, but also hands back the raw stdout — needed by
    list_apps_with_updates() to notice a rate-limit marker even when it
    sits alongside otherwise-parseable JSON (see _parse_trailing_json's
    own note: the marker line(s) precede the JSON, they don't break it)."""
    code, out, _ = await _run_gearlever([*args, "--json"])
    if code != 0:
        return [], ""
    data = _parse_trailing_json(out)
    if data is None:
        decky.logger.error(f"[{_LOG}] couldn't parse --json output for {args}: {out[:500]}")
        return [], out
    return data.get(key, []), out


async def _list_json(args: List[str], key: str) -> List[Dict[str, Any]]:
    data, _ = await _list_json_raw(args, key)
    return data


async def list_installed_paths() -> Set[str]:
    """Just the file paths, no per-app config resolution. Used to spot
    which path is new after an integrate (see appimage_catalog.install()'s
    own note on why that's the only reliable way to find a just-integrated
    app again)."""
    entries = await _list_json(["--list-installed"], "installed")
    return {str(e["path"]) for e in entries if e.get("path")}


async def list_installed_names_and_repos() -> tuple:
    """Both signals appimage_catalog.py's own "is this catalog entry
    already installed" check needs, from a single --list-installed call —
    names and repos used to each run their own separate one (this runs on
    every catalog search debounce, and each call launches Gearlever
    itself through flatpak run — real overhead, not a free local read —
    so a caller wanting both no longer pays for it twice).

    names: every installed app's own display name, lowercased — a
    best-effort fallback signal, since Gearlever's own name for an app
    (from its embedded desktop entry) doesn't always match AppImageHub's
    own feed name for that same project.

    repos: the configured GitHub repo ("user/repo", lowercased) for every
    installed app whose update source resolves to GithubUpdater — a far
    more precise signal than the name, since it's the exact value
    install() configured, whenever it's available. Resolving it still
    means reading each such app's own config (a local gearlever.conf
    parse, not a subprocess) — cheap enough for the small number of
    installed apps a catalog search debounce runs against."""
    entries = await _list_json(["--list-installed"], "installed")
    names = {str(e["name"]).strip().lower() for e in entries if e.get("name")}

    repos: Set[str] = set()
    for entry in entries:
        manager = entry.get("manager")
        file_path = entry.get("path")
        if manager != "GithubUpdater" or not file_path:
            continue
        config = await _resolve_update_manager_config(manager, file_path)
        repo = config.get("repo")
        if repo:
            repos.add(str(repo).strip().lower())

    return names, repos


async def list_installed() -> List[Dict[str, Any]]:
    entries = await _list_json(["--list-installed"], "installed")

    apps = []
    for entry in entries:
        manager = entry.get("manager")
        file_path = entry["path"]
        config = (
            await _resolve_update_manager_config(manager, file_path)
            if manager else {}
        )
        apps.append({
            "id": f"appimage:{file_path}",
            "file_path": file_path,
            "kind": "appimage",
            "name": entry["name"],
            "version": entry.get("current_version"),
            "available_version": None,
            "release_notes": None,
            "release_url": None,
            "github_rate_limited_until": None,
            "has_update": False,
            "needs_update_source": manager is None,
            "update_manager": manager,
            "update_manager_config": config,
            "desktop_id": entry.get("desktop_id"),
            "running": entry.get("running"),
            "embedded_source": entry.get("embedded_source", False),
        })
    return apps


async def list_apps_with_updates() -> List[Dict[str, Any]]:
    apps = await list_installed()
    if not apps:
        return apps

    updates, raw = await _list_json_raw(["--list-updates"], "updates")
    paths_with_updates = {entry["path"] for entry in updates}

    # Gearlever's own --list-updates silently skips an app whose
    # GithubUpdater check hit GitHub's rate limit (it just never adds it
    # to `updates`, indistinguishable there from "genuinely up to date") —
    # its own stdout is the only place that failure shows up at all (see
    # _parse_trailing_json's note). When it's present, every GithubUpdater
    # app not already confirmed up-to-date-or-not might really be
    # unchecked, so surface the same rate_limited_until a per-app version
    # lookup would (apps_service.py already takes the max of these across
    # all apps for its one banner).
    rate_limited_until = None
    if _RATE_LIMIT_MARKER in raw:
        try:
            rate_limited_until = await gearlever_versions.check_rate_limit()
        except Exception as e:
            decky.logger.error(f"[{_LOG}] rate limit check: {e}")

    for app in apps:
        if app["file_path"] in paths_with_updates:
            app["has_update"] = True
            info = await gearlever_versions.resolve_available_version(
                app["update_manager"], app["update_manager_config"]
            )
            app["available_version"] = info.version
            app["release_notes"] = info.notes
            app["release_url"] = info.url
            app["github_rate_limited_until"] = info.rate_limited_until
        elif rate_limited_until and app["update_manager"] == "GithubUpdater":
            app["github_rate_limited_until"] = rate_limited_until
    return apps


async def check_single(file_path: str) -> Optional[bool]:
    """Fresh single-app update check, bypassing any cache — used right
    before actually applying an update, to catch a state that went stale
    since the last full list. Returns None if the app isn't found."""
    apps = await list_apps_with_updates()
    match = next((a for a in apps if a["file_path"] == file_path), None)
    return match["has_update"] if match else None


async def update_one(file_path: str) -> bool:
    code, _, _ = await _run_gearlever(["--update", file_path, "--yes"], timeout=600)
    return code == 0


async def update_many(file_paths: List[str]) -> bool:
    ok = True
    for file_path in file_paths:
        if not await update_one(file_path):
            ok = False
    return ok


async def integrate(file_path: str) -> bool:
    """Registers a downloaded AppImage with Gearlever — the same
    operation as manually running its own --integrate, just headless.
    Gearlever's CLI also advertises a `--update-url` flag here, but its
    own Cli.py never actually reads it (confirmed against Gearlever's own
    source — integrate() only ever derives an update source from an
    AppImage's *embedded* update string, never from an argv flag), so
    there's no point passing one. A caller that already knows a real
    update source (e.g. appimage_catalog.install(), which has the GitHub
    repo) configures it itself afterwards via set_update_source()."""
    code, _, _ = await _run_gearlever(["--integrate", file_path, "-y"], timeout=120)
    return code == 0


async def remove_one(file_path: str) -> bool:
    """Trashes the AppImage plus its .desktop file/icons (Gearlever's own
    default) rather than a hard delete — --delete would skip the trash,
    not something to reach for without the user asking specifically."""
    code, _, _ = await _run_gearlever(["--remove", file_path, "-y"], timeout=30)
    return code == 0


async def set_update_source(file_path: str, manager: str, config: Dict[str, str]) -> bool:
    args = ["--set-update-source", file_path, "--manager", manager]
    args += [f"{key}={value}" for key, value in config.items()]
    code, _, _ = await _run_gearlever(args, timeout=30)
    return code == 0


def _icon_from_desktop_file(desktop_file: Path) -> Optional[str]:
    try:
        content = desktop_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in content.splitlines():
        if line.startswith("Icon="):
            return line[len("Icon="):].strip() or None
    return None


def icon_path(file_path: str) -> Optional[Path]:
    """Best-effort icon lookup: find the .desktop entry Gearlever wrote for
    this AppImage (matched by Exec target), read its Icon= value, then
    resolve that as an absolute path or an XDG icon-theme name."""
    local_share = Path(decky.DECKY_USER_HOME) / ".local" / "share"
    applications_dir = local_share / "applications"
    icon_ref: Optional[str] = None
    try:
        for desktop_file in sorted(applications_dir.glob("*.desktop")):
            content = desktop_file.read_text(encoding="utf-8", errors="replace")
            if file_path in content:
                icon_ref = _icon_from_desktop_file(desktop_file)
                break
    except OSError:
        return None

    if not icon_ref:
        return None
    if icon_ref.startswith("/"):
        return Path(icon_ref) if Path(icon_ref).is_file() else None

    icons_dir = local_share / "icons" / "hicolor"
    for size in ("256x256", "128x128", "64x64", "48x48"):
        candidate = icons_dir / size / "apps" / f"{icon_ref}.png"
        if candidate.is_file():
            return candidate
    svg_candidate = icons_dir / "scalable" / "apps" / f"{icon_ref}.svg"
    if svg_candidate.is_file():
        return svg_candidate

    for ext in ("png", "svg", "xpm"):
        candidate = local_share / "pixmaps" / f"{icon_ref}.{ext}"
        if candidate.is_file():
            return candidate
    return None
