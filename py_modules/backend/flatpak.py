"""flatpak.py — list/check/update Flatpak apps via the `flatpak` CLI.

Shells out rather than binding libflatpak (the approach Bazaar itself
uses under the hood): same operations, no GObject-introspection
dependency in a plugin's Python backend. Covers both installations —
`--system` (this is where Discover/KDE and `sudo flatpak install` land
apps) and `--user` — since either can hold apps the user cares about.

Update detection: `flatpak list` has no `--updates` flag (that's a
libflatpak-only concept — `FlatpakInstallation.list_installed_refs_
for_update()`, which is what Bazaar and GNOME Software actually call;
the CLI never exposed an equivalent, confirmed against Flatpak 1.18's
own --help, which lists no such option). The CLI-only substitute used
here: read each installed app's short `active` commit from `flatpak
list`, then compare it against the remote's current `Commit:` via
`flatpak remote-info` (a plain read, no elevated privileges needed
even for --system, and no local appstream/summary refresh required —
it queries the remote directly).
"""
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import decky

from . import http_json, proc_env

_LOG = "flatpak"
_ICON_SIZES = ("256x256", "128x128", "64x64", "48x48")
# Steam Deck is x86_64-only — same assumption Gearlever's own update
# managers make when picking an asset (see e.g. GithubUpdater.system_arch
# in its own source) — used below to locate cached appstream icons.
_SEARCH_ARCH = "x86_64"


def _installation_root(scope: proc_env.Scope) -> Path:
    if scope == "system":
        return Path("/var/lib/flatpak")
    return Path(decky.DECKY_USER_HOME) / ".local" / "share" / "flatpak"


def _parse_columns(stdout: str, expected_fields: int) -> List[List[str]]:
    rows = []
    for line in stdout.splitlines():
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != expected_fields:
            continue
        rows.append(fields)
    return rows


def scope_flag(scope: proc_env.Scope) -> str:
    return "--system" if scope == "system" else "--user"


async def list_installed(scope: proc_env.Scope) -> List[Dict[str, Any]]:
    code, out, _ = await proc_env.run(
        ["flatpak", "list", "--app", scope_flag(scope),
         "--columns=application,name,version,active,origin"],
        scope, _LOG,
    )
    if code != 0:
        return []

    apps = []
    for app_id, name, version, active, origin in _parse_columns(out, 5):
        apps.append({
            "id": f"flatpak:{app_id}:{scope}",
            "app_id": app_id,
            "kind": "flatpak",
            "name": name or app_id,
            "version": version,
            "available_version": None,
            "has_update": False,
            "scope": scope,
            "_active_commit": active,
            "_origin": origin,
        })
    return apps


_INFO_LINE = re.compile(r"^([^:]+):(.*)$")


async def _remote_info(scope: proc_env.Scope, origin: str, app_id: str) -> Dict[str, str]:
    code, out, _ = await proc_env.run(
        ["flatpak", "remote-info", scope_flag(scope), origin, app_id],
        scope, _LOG, timeout=20,
    )
    if code != 0:
        return {}
    info: Dict[str, str] = {}
    for line in out.splitlines():
        m = _INFO_LINE.match(line)
        if m:
            info[m.group(1).strip().lower()] = m.group(2).strip()
    return info


async def _has_real_update(scope: proc_env.Scope, app_id: str) -> bool:
    """Confirms a commit mismatch is an actual update, by asking flatpak's
    own update logic rather than trusting the raw commit string compare in
    _check_update below. --no-deploy pulls the new commit into the local
    repo without touching the deployed/active one — same cost as a real
    update minus the deploy step, safe to run speculatively.

    Needed because that raw compare alone is a false-positive trap on at
    least one real remote type: an OCI-backed remote (e.g. Anatase's own
    rolling-f44 repo) can republish a new commit for content that's
    already installed, with no actual change to deploy. Confirmed
    on-device: `flatpak update --no-deploy` reported "Nothing to update"
    for an app/remote pair the commit compare alone flagged as having an
    update — Discover, which goes through libflatpak's real update-check
    instead of a hand-rolled one, correctly showed no update there either.
    """
    code, out, err = await proc_env.run(
        ["flatpak", "update", scope_flag(scope), app_id,
         "--no-deploy", "-y", "--noninteractive"],
        scope, _LOG, timeout=120,
    )
    if code != 0:
        return False
    return "nothing to update" not in (out + err).lower()


async def _check_update(
    scope: proc_env.Scope, app_id: str, active: str, origin: str
) -> Optional[str]:
    """Returns the available version string if an update exists, else None."""
    if not active or not origin:
        return None
    info = await _remote_info(scope, origin, app_id)
    remote_commit = info.get("commit", "")
    if not remote_commit or remote_commit.startswith(active):
        return None
    if not await _has_real_update(scope, app_id):
        return None
    return info.get("version") or ""


async def list_apps_with_updates(scope: proc_env.Scope) -> List[Dict[str, Any]]:
    apps = await list_installed(scope)
    for app in apps:
        active = app.pop("_active_commit", "")
        origin = app.pop("_origin", "")
        available = await _check_update(scope, app["app_id"], active, origin)
        if available is not None:
            app["has_update"] = True
            app["available_version"] = available or None
    return apps


async def check_single(app_id: str, scope: proc_env.Scope) -> Optional[bool]:
    """Fresh single-app update check, bypassing any cache — used right
    before actually applying an update, to catch a state that went stale
    since the last full list (e.g. updated another way in the meantime).
    Returns None if the app can't be found or checked at all."""
    apps = await list_installed(scope)
    match = next((a for a in apps if a["app_id"] == app_id), None)
    if not match:
        return None
    available = await _check_update(
        scope, app_id, match["_active_commit"], match["_origin"]
    )
    return available is not None


async def update_one(app_id: str, scope: proc_env.Scope) -> bool:
    code, _, _ = await proc_env.run(
        ["flatpak", "update", "-y", "--noninteractive", scope_flag(scope), app_id],
        scope, _LOG, timeout=600,
    )
    return code == 0


async def uninstall_one(app_id: str, scope: proc_env.Scope) -> bool:
    code, _, _ = await proc_env.run(
        ["flatpak", "uninstall", "-y", "--noninteractive", scope_flag(scope), app_id],
        scope, _LOG, timeout=120,
    )
    return code == 0


async def update_many(app_ids: List[str], scope: proc_env.Scope) -> bool:
    if not app_ids:
        return True
    code, _, _ = await proc_env.run(
        ["flatpak", "update", "-y", "--noninteractive", scope_flag(scope), *app_ids],
        scope, _LOG, timeout=1800,
    )
    return code == 0


def icon_path(app_id: str, scope: proc_env.Scope) -> Optional[Path]:
    icons_dir = _installation_root(scope) / "exports" / "share" / "icons" / "hicolor"
    for size in _ICON_SIZES:
        candidate = icons_dir / size / "apps" / f"{app_id}.png"
        if candidate.is_file():
            return candidate
    svg_candidate = icons_dir / "scalable" / "apps" / f"{app_id}.svg"
    if svg_candidate.is_file():
        return svg_candidate
    return None


# ── Search / install (browsing the catalog rather than what's already
# installed) ─────────────────────────────────────────────────────────────

async def list_remotes(scope: proc_env.Scope) -> List[str]:
    code, out, _ = await proc_env.run(
        ["flatpak", "remotes", scope_flag(scope), "--columns=name"], scope, _LOG,
    )
    if code != 0:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


async def _remote_url(scope: proc_env.Scope, remote: str) -> Optional[str]:
    code, out, _ = await proc_env.run(
        ["flatpak", "remotes", scope_flag(scope), "--columns=name,url"], scope, _LOG,
    )
    if code != 0:
        return None
    for row_name, url in _parse_columns(out, 2):
        if row_name == remote:
            return url
    return None


async def search(query: str) -> List[Dict[str, Any]]:
    """`flatpak search` with no --user/--system flag on the command itself
    consults remotes from both installations at once — this is what lets a
    single call cover every remote the user has configured (Flathub, any
    third-party remote, ...), not just Flathub.

    Unlike `remote-info`, this isn't a plain read: flatpak's own search
    builtin refreshes each configured remote's appstream data first and
    bails out entirely if that refresh fails for any of them — confirmed
    against flatpak's own app/flatpak-builtins-search.c (calls
    update_appstream() before searching, returns no results at all on
    failure rather than searching stale/partial data). Two things follow:
    it's genuinely slow the first time (real network fetches, not just a
    cache read — the 30s budget flatpak.py otherwise uses elsewhere was too
    tight and made a perfectly valid query come back empty), and it needs
    write access to the appstream cache for the *system* installation too
    — scope="system" keeps this running as root, which (per proc_env.py's
    own docstring) already has direct filesystem access there, sidestepping
    whatever the system polkit/D-Bus helper path would otherwise need for a
    plain non-privileged caller.
    """
    code, out, _ = await proc_env.run(
        ["flatpak", "search", query,
         "--columns=name,description,application,version,branch,remotes"],
        "system", _LOG, timeout=90,
    )
    if code != 0:
        return []

    results = []
    for name, description, app_id, version, branch, remotes in _parse_columns(out, 6):
        remote_list = [r.strip() for r in remotes.split(",") if r.strip()]
        results.append({
            "app_id": app_id,
            "name": name or app_id,
            "description": description,
            "version": version,
            "branch": branch,
            "remotes": remote_list,
            "remote": remote_list[0] if remote_list else "",
        })
    return results


async def get_screenshots(app_id: str) -> List[str]:
    """Screenshots aren't in `flatpak search`'s own output at all — the
    only source for these is Flathub's own web API, which means this is
    Flathub-specific: an app installed from another remote (e.g. this
    plugin's own Anatase support) simply has none, same as an app
    Flathub doesn't carry at all. Called lazily, once, only when a detail
    page for one specific app is actually open — never during search
    itself, which would mean one extra network call per result.
    The zoomed view shows these close to full-screen, so the smallest
    available size (originally picked here) looked visibly soft/blurry
    blown up that large — the largest size at or under ~800px wide is
    plenty crisp there without downloading a screenshot's full original
    (which this API also offers, but is often several times heavier)."""
    data = await http_json.get_json(f"https://flathub.org/api/v2/appstream/{app_id}")
    urls = []
    for shot in (data or {}).get("screenshots") or []:
        sizes = [s for s in (shot.get("sizes") or []) if s.get("src")]
        under_cap = [s for s in sizes if int(s.get("width") or 0) <= 800]
        candidates = under_cap or sizes
        best = max(candidates, key=lambda s: int(s.get("width") or 0), default=None)
        if best:
            urls.append(best["src"])
    return urls


async def remote_scope(remote: str) -> proc_env.Scope:
    """Which installation actually has `remote` configured — install must
    target that one, or flatpak rejects it ("error: Nothing matches
    ${remote}"). Checked at install time rather than cached: cheap, and
    avoids ever acting on a stale remote/scope pairing from a search done
    a while ago. System wins when a remote happens to be configured in
    both, matching where Discover/`sudo flatpak install` land apps."""
    if remote in await list_remotes("system"):
        return "system"
    return "user"


async def install(app_id: str, remote: str, scope: proc_env.Scope) -> bool:
    """A --system install isn't a plain root filesystem write like the reads
    elsewhere in this module — flatpak always routes it through
    org.freedesktop.Flatpak.SystemHelper over D-Bus, which applies its own
    polkit checks against the calling process. Confirmed on-device on one
    machine (Anatase) before this plugin declared the "root" flag in
    plugin.json: without it, Decky runs a plugin's backend as the
    unprivileged host user (SandboxedPlugin drops to HOST_USER, not root),
    and a --system install failed outright ("Flatpak system operation
    GetRevokefsFd/Deploy not allowed for user"). The "root" flag should
    make this a non-issue going forward, but plugins are meant to run
    across whatever mix of SteamOS/Bazzite/CachyOS/Anatase/etc. the user
    has — polkit rules and default remote scoping aren't guaranteed
    identical across all of them, so this still falls back rather than
    assuming the fix that worked on one machine holds everywhere.

    --user installs write directly to the user's own ~/.local/share/
    flatpak, no SystemHelper/polkit involved at all — same fallback shape
    gearlever.py's own install() above already uses for Gearlever itself.
    One more gap that's just as real across distros: `remote` may only be
    configured for --system (confirmed on-device: this same Anatase
    machine has no --user remotes at all) — --user install would then fail
    with "nothing matches", not a permission error. Mirroring the remote's
    URL into --user (matching whatever --system already trusts, so no new
    remote/key the user didn't already implicitly accept) before retrying
    covers that case too.
    """
    code, _, _ = await proc_env.run(
        ["flatpak", "install", scope_flag(scope), remote, app_id,
         "-y", "--noninteractive"],
        scope, _LOG, timeout=600,
    )
    if code == 0 or scope == "user":
        return code == 0

    if remote not in await list_remotes("user"):
        url = await _remote_url(scope, remote)
        if not url:
            return False
        add_code, _, _ = await proc_env.run(
            ["flatpak", "remote-add", "--user", "--if-not-exists", remote, url],
            "user", _LOG, timeout=30,
        )
        if add_code != 0:
            return False

    code, _, _ = await proc_env.run(
        ["flatpak", "install", "--user", remote, app_id, "-y", "--noninteractive"],
        "user", _LOG, timeout=600,
    )
    return code == 0


def _appstream_icons_dirs(scope: proc_env.Scope) -> List[Path]:
    """One dir per remote cached under this installation's appstream data —
    the icon cache for a not-yet-installed app (unlike icon_path() above,
    which only ever finds icons for apps already exported locally).

    <root>/appstream/<remote>/<arch>/ isn't itself the checkout — for a
    remote synced the "collections" way (confirmed on-device for flathub),
    the actual appstream.xml/icons live one level deeper, under whichever
    content-addressed checkout directory `active` currently points to.
    Skip a remote with no `active` yet (never successfully synced) rather
    than guess a fixed subdirectory name.
    """
    root = _installation_root(scope) / "appstream"
    try:
        remotes = os.listdir(root)
    except OSError:
        return []
    dirs = []
    for name in remotes:
        active = root / name / _SEARCH_ARCH / "active"
        if active.is_dir():
            dirs.append(active / "icons")
    return dirs


def search_icon_path(app_id: str) -> Optional[Path]:
    for scope in ("system", "user"):
        for icons_dir in _appstream_icons_dirs(scope):
            for size in _ICON_SIZES:
                candidate = icons_dir / size / f"{app_id}.png"
                if candidate.is_file():
                    return candidate
            svg_candidate = icons_dir / "scalable" / f"{app_id}.svg"
            if svg_candidate.is_file():
                return svg_candidate
    return None
