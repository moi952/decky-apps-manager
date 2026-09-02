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
import asyncio
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
# Caps how many apps' version lookups run at once — each one is a live
# GitHub/GitLab/Codeberg/Forgejo API call, not a free local read.
_RESOLVE_CONCURRENCY = 4


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
    """Same as _list_json, but also hands back raw stdout+stderr combined
    — needed by list_apps_with_updates() to notice a rate-limit marker
    even when it sits alongside otherwise-parseable JSON (see
    _parse_trailing_json's own note: the marker line(s) precede the
    JSON, they don't break it).

    Confirmed on-device this marker can land on stderr, not stdout, for
    --list-updates --json specifically: Gearlever's own Cli.py wraps
    each app's is_update_available() call in `with redirect_stdout(sys.
    stderr)` for the duration of a --json invocation — so the very
    `print(str(e))` this marker relies on (inside GithubUpdater.
    fetch_target_asset's own rate-limit except clause) ends up on
    stderr, invisible to a stdout-only check. A real GitHub rate limit
    then silently looked identical to "genuinely up to date" here."""
    code, out, err = await _run_gearlever([*args, "--json"])
    if code != 0:
        return [], ""
    data = _parse_trailing_json(out)
    combined = out + err
    if data is None:
        decky.logger.error(f"[{_LOG}] couldn't parse --json output for {args}: {out[:500]}")
        return [], combined
    return data.get(key, []), combined


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
    # the marker (see _list_json_raw's own note on why stderr has to be
    # checked too, not just stdout) is the only place that failure shows
    # up at all. When it's present, every GithubUpdater app not already
    # confirmed up-to-date-or-not might really be unchecked, so surface
    # the same rate_limited_until a per-app version lookup would
    # (apps_service.py already takes the max of these across all apps
    # for its one banner).
    rate_limited_until = None
    if _RATE_LIMIT_MARKER in raw:
        try:
            rate_limited_until = await gearlever_versions.check_rate_limit()
        except Exception as e:
            decky.logger.error(f"[{_LOG}] rate limit check: {e}")

    sem = asyncio.Semaphore(_RESOLVE_CONCURRENCY)

    async def _resolve(app: Dict[str, Any]) -> None:
        if app["file_path"] in paths_with_updates:
            app["has_update"] = True
            async with sem:
                info = await gearlever_versions.resolve_available_version(
                    app["update_manager"], app["update_manager_config"]
                )
            app["available_version"] = info.version
            app["release_notes"] = info.notes
            app["release_url"] = info.url
            app["github_rate_limited_until"] = info.rate_limited_until
        elif rate_limited_until and app["update_manager"] == "GithubUpdater":
            app["github_rate_limited_until"] = rate_limited_until

    await asyncio.gather(*(_resolve(app) for app in apps))
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


async def replace_appimage_file(file_path: str, url: str, version: str) -> bool:
    """Switches an already-integrated AppImage to a specific version by
    downloading `url` and overwriting the exact file Gearlever already
    tracks — its own desktop entry/config point at this literal path, so
    unlike a fresh install this needs no --integrate afterward, just the
    file itself replaced in place. Gearlever's own --update has no way to
    target anything but whatever its manager resolves as "latest", which
    is why this bypasses it entirely rather than trying to steer it.

    Downloaded to a sibling ".tmp-update" file first and swapped in with
    Path.replace() (atomic rename) rather than overwriting file_path
    directly — a failed/interrupted download then never leaves the
    working AppImage half-written.

    The swap alone isn't enough, though — see _set_desktop_entry_version's
    own note: Gearlever's displayed version comes from its .desktop
    file's X-AppImage-Version key, a value this raw swap never touches on
    its own, confirmed on-device (installing an older release still
    showed the previous version, and — since Gearlever's own update
    check compares real file content, not that stale string — correctly
    flagged "update available" right back to it). Patched by hand here so
    both this plugin and Gearlever's own app report the version that's
    actually now on disk. Best-effort: a failure here is logged but
    doesn't fail the swap itself, which already succeeded on its own
    terms (the app does run the new version either way)."""
    tmp = Path(f"{file_path}.tmp-update")
    code, _, _ = await proc_env.run(
        ["curl", "-sfL", "-o", str(tmp), url], "user", _LOG, timeout=900,
    )
    if code != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return False
    try:
        tmp.chmod(0o755)
        tmp.replace(file_path)
    except OSError as e:
        decky.logger.error(f"[{_LOG}] replacing {file_path}: {e}")
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return False

    desktop_file = _find_desktop_file(file_path)
    if desktop_file:
        _set_desktop_entry_version(desktop_file, version)
    else:
        decky.logger.error(f"[{_LOG}] no .desktop file found for {file_path}, version display may be stale")
    return True


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


def _find_desktop_file(file_path: str) -> Optional[Path]:
    """Locates the .desktop entry Gearlever wrote for this AppImage,
    matched by its Exec target — the only link back from a bare file
    path to Gearlever's own tracking of that app."""
    applications_dir = Path(decky.DECKY_USER_HOME) / ".local" / "share" / "applications"
    try:
        for desktop_file in sorted(applications_dir.glob("*.desktop")):
            content = desktop_file.read_text(encoding="utf-8", errors="replace")
            if file_path in content:
                return desktop_file
    except OSError:
        pass
    return None


def _icon_from_desktop_file(desktop_file: Path) -> Optional[str]:
    try:
        content = desktop_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in content.splitlines():
        if line.startswith("Icon="):
            return line[len("Icon="):].strip() or None
    return None


def _set_desktop_entry_version(desktop_file: Path, version: str) -> bool:
    """Gearlever reads the version it displays (both --list-installed and
    its own GTK app — confirmed against its real source,
    AppImageProvider.list_installed -> _get_app_version) straight out of
    this .desktop file's X-AppImage-Version custom key — never by
    re-inspecting the AppImage binary's own bytes at list time. That key
    is only ever written when Gearlever itself runs its own real
    install_file() pipeline (on --integrate, or internally during
    --update), which replace_appimage_file() below deliberately bypasses
    (Gearlever's CLI has no way to target an arbitrary release — always
    "whatever the manager resolves as latest"). So this file is the one
    other place that has to be told about a version switch by hand, or
    both this plugin and Gearlever's own app keep reporting the version
    that was true before the swap. A plain line-level edit rather than a
    full desktop-entry parse/rewrite, so everything else in the file
    (icon, exec args, actions, comments) is left untouched."""
    try:
        content = desktop_file.read_text(encoding="utf-8")
    except OSError as e:
        decky.logger.error(f"[{_LOG}] reading {desktop_file}: {e}")
        return False

    new_line = f"X-AppImage-Version={version}"
    if re.search(r"(?m)^X-AppImage-Version=.*$", content):
        new_content = re.sub(r"(?m)^X-AppImage-Version=.*$", new_line, content, count=1)
    else:
        new_content, n = re.subn(
            r"(?m)^\[Desktop Entry\]$", f"[Desktop Entry]\n{new_line}", content, count=1
        )
        if n == 0:
            decky.logger.error(f"[{_LOG}] no [Desktop Entry] section in {desktop_file}")
            return False

    try:
        desktop_file.write_text(new_content, encoding="utf-8")
        return True
    except OSError as e:
        decky.logger.error(f"[{_LOG}] writing {desktop_file}: {e}")
        return False


def icon_path(file_path: str) -> Optional[Path]:
    """Best-effort icon lookup: find the .desktop entry Gearlever wrote for
    this AppImage (matched by Exec target), read its Icon= value, then
    resolve that as an absolute path or an XDG icon-theme name."""
    icon_ref: Optional[str] = None
    desktop_file = _find_desktop_file(file_path)
    if desktop_file:
        icon_ref = _icon_from_desktop_file(desktop_file)

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
