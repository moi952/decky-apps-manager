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
import asyncio
import os
import re
import shlex
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import decky

from . import http_json, proc_env

_LOG = "flatpak"
_ICON_SIZES = ("256x256", "128x128", "64x64", "48x48")
# Caps how many apps' update checks run at once — each one is a
# flatpak subprocess (and, on a commit mismatch, a second, heavier
# --no-deploy pull), so unbounded concurrency could saturate the Deck's
# network/CPU rather than actually speed things up.
_CHECK_CONCURRENCY = 4
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
            "update_check_failed": False,
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


async def _has_real_update(scope: proc_env.Scope, app_id: str) -> Optional[bool]:
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

    Returns None (not False) when the command itself failed — that's
    "couldn't tell", not a confirmed "nothing to update" (see
    update_check_failed on the returned app dict).
    """
    code, out, err = await proc_env.run(
        ["flatpak", "update", scope_flag(scope), app_id,
         "--no-deploy", "-y", "--noninteractive"],
        scope, _LOG, timeout=120,
    )
    if code != 0:
        return None
    return "nothing to update" not in (out + err).lower()


async def _check_update(
    scope: proc_env.Scope, app_id: str, active: str, origin: str
) -> Tuple[Optional[str], bool]:
    """Returns (available_version_or_None, check_failed)."""
    if not active or not origin:
        return None, False
    info = await _remote_info(scope, origin, app_id)
    if not info:
        # _remote_info itself failed outright — can't tell "up to date"
        # from "couldn't check", unlike the branches below which got a
        # real answer either way.
        return None, True
    remote_commit = info.get("commit", "")
    if not remote_commit or remote_commit.startswith(active):
        return None, False
    confirmed = await _has_real_update(scope, app_id)
    if confirmed is None:
        return None, True
    if not confirmed:
        return None, False
    return info.get("version") or "", False


# One row of `flatpak update`'s pending-changes table: "1.\t   \t<ref>\t
# <branch>\t<op>[\t<remote>\t< size>]" — op is i(nstall)/u(pdate)/r(emove).
_UPDATE_ROW = re.compile(
    r"^\s*\d+\.\t[^\t]*\t([^\t]+)\t([^\t]*)\t([iur])(?:\t([^\t]*))?"
)

# Extensions that always ride along with their parent — Bazaar
# (update-worker.c's should_skip_extension_ref) leaves them out of its own
# update list for the same reason, and so does this.
_SKIPPED_SUFFIXES = (".Locale", ".Debug", ".Sources")

# (scope, new ref) -> {"remote": ..., "old": [refs]} for runtimes flatpak
# wants to *replace* with a successor (an "i" row paired with an "r" row,
# e.g. an NVIDIA GL driver bump). Filled by list_runtime_updates, read by
# update_one/update_many.
_pending_rebases: Dict[Tuple[str, str], Dict[str, Any]] = {}


def _common_prefix_len(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


async def _runtime_names(
    scope: proc_env.Scope, remotes: Set[str]
) -> Dict[Tuple[str, str], str]:
    """Display names (appstream) for runtimes, keyed by (id, branch) — the
    same source Bazaar uses (appdata name, falling back to the bare id).
    Installed ones come from `flatpak list`; a not-yet-installed successor
    only exists in its remote, hence remote-ls for those."""
    names: Dict[Tuple[str, str], str] = {}
    commands = [["flatpak", "list", "--runtime", scope_flag(scope),
                 "--columns=application,branch,name"]]
    commands += [["flatpak", "remote-ls", remote, scope_flag(scope), "--runtime",
                  "--columns=application,branch,name"] for remote in sorted(remotes)]
    for cmd in commands:
        code, out, _ = await proc_env.run(cmd, scope, _LOG, timeout=30)
        if code != 0:
            continue
        for rid, branch, name in _parse_columns(out, 3):
            if name.strip():
                names.setdefault((rid.strip(), branch.strip()), name.strip())
    return names


async def _runtime_updates_from_table(
    scope: proc_env.Scope, known_app_ids: Set[str]
) -> List[Dict[str, Any]]:
    """Fallback when libflatpak isn't reachable (see list_runtime_updates).

    Runtimes and extensions (Freedesktop/GNOME/KDE Platform, GL drivers,
    ...) with a pending change — what Discover files under "Application
    support". list_installed's `--app` never sees these, so without this
    they were never detected or updated at all.

    Read from `flatpak update`'s own pending-changes table (answering "n"
    to its prompt, so nothing is applied) rather than `remote-ls
    --updates`: confirmed on-device the latter misses real pending
    changes that this table and Discover both list.

    "u" rows are plain updates. An "i" row is a runtime being *replaced* by
    a successor (flatpak pairs it with an "r" row for the old one): no
    per-ref `flatpak update` can do that (confirmed on-device — neither
    ref accepts it), but installing the new ref then uninstalling the old
    one is exactly what flatpak's own transaction does for it, so that is
    what update_one/update_many run for these entries.

    Apps in the same table are skipped via known_app_ids (list_installed
    already covers them), and so are .Locale/.Debug/.Sources extensions.

    Best-effort — a failure here must never break the app list itself."""
    # Exit code deliberately ignored: answering "n" makes flatpak exit 1
    # (aborted) even though the table above it was printed fine — confirmed
    # on-device, and checking it threw away every real result. A timeout or
    # spawn failure comes back as -1 with empty stdout, so it parses to [].
    _, out, _ = await proc_env.run(
        ["flatpak", "update", scope_flag(scope)],
        scope, _LOG, timeout=60, stdin_data=b"n\n",
    )

    rows = []
    for line in out.splitlines():
        m = _UPDATE_ROW.match(line)
        if m:
            rows.append((m.group(3), m.group(1).strip(), m.group(2).strip(), (m.group(4) or "").strip()))

    removals = [(rid, br) for op, rid, br, _ in rows if op == "r"]
    names = await _runtime_names(scope, {remote for op, _, _, remote in rows if op == "i" and remote}) if rows else {}
    runtimes = []
    seen: Set[str] = set()
    for op, runtime_id, branch, remote in rows:
        if op == "r" or runtime_id in known_app_ids or runtime_id.endswith(_SKIPPED_SUFFIXES):
            continue
        ref = f"{runtime_id}//{branch}" if branch else runtime_id
        if ref in seen:
            continue
        seen.add(ref)
        if op == "i":
            if not remote:
                continue
            old = [
                f"{rid}//{br}" for rid, br in removals
                if br == branch and _common_prefix_len(rid, runtime_id) > runtime_id.rfind(".") + 1
            ]
            _pending_rebases[(scope, ref)] = {"remote": remote, "old": old}
        runtimes.append({
            "id": f"flatpak:{ref}:{scope}",
            "app_id": ref,
            "kind": "flatpak",
            "runtime": True,
            "name": names.get((runtime_id, branch), runtime_id),
            "_branch": branch,
            "version": None,
            "available_version": None,
            "has_update": True,
            "update_check_failed": False,
            "scope": scope,
        })
    # Two branches of one runtime (or the same one in both scopes' lists)
    # would otherwise read identically — only then is the branch worth showing.
    counts: Dict[str, int] = {}
    for r in runtimes:
        counts[r["name"]] = counts.get(r["name"], 0) + 1
    for r in runtimes:
        branch = r.pop("_branch")
        if counts[r["name"]] > 1 and branch and branch not in r["name"]:
            r["name"] = f"{r['name']} {branch}"
    return runtimes


# Same query Discover and Bazaar (update-worker.c) make:
# flatpak_installation_list_installed_refs_for_update. It also returns the
# *parent* of any extension with a pending change — confirmed on-device,
# that is why Discover lists Freedesktop/GNOME/KDE Platform as "updates"
# even though their own commit already equals the remote's: each carries a
# related extension (NVIDIA GL driver, Locale) that has one. `flatpak
# update <parent>` then updates those related refs too, which is the only
# per-ref way to do it. The plain CLI table (below) never shows these
# parents, so it can't be the source of truth for what Discover reports.
_LIBFLATPAK_SCRIPT = """
import sys, gi
gi.require_version("Flatpak", "1.0")
from gi.repository import Flatpak
inst = Flatpak.Installation.new_system(None) if sys.argv[1] == "system" else Flatpak.Installation.new_user(None)
for r in inst.list_installed_refs_for_update(None):
    if r.get_kind() != Flatpak.RefKind.RUNTIME:
        continue
    print("\\t".join([r.get_name(), r.get_arch(), r.get_branch(), r.get_appdata_name() or ""]))
"""


async def list_runtime_updates(
    scope: proc_env.Scope, known_app_ids: Set[str]
) -> List[Dict[str, Any]]:
    """Runtimes with something to update, as Discover and Bazaar report
    them. Uses libflatpak through the system Python's GObject bindings; if
    those aren't there (or the call fails), falls back to reading
    `flatpak update`'s own table, which lacks the parent entries but still
    finds the extensions themselves.

    .Locale/.Debug/.Sources are skipped, like Bazaar does — they ride along
    with their parent. Best-effort: never allowed to break the app list."""
    code, out, _ = await proc_env.run(
        ["/usr/bin/python3", "-c", _LIBFLATPAK_SCRIPT, scope],
        scope, _LOG, timeout=60,
    )
    if code != 0:
        return await _runtime_updates_from_table(scope, known_app_ids)

    runtimes = []
    seen: Set[str] = set()
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        runtime_id, arch, branch, name = (p.strip() for p in parts)
        if not runtime_id or runtime_id.endswith(_SKIPPED_SUFFIXES):
            continue
        ref = f"{runtime_id}/{arch}/{branch}"
        if ref in seen:
            continue
        seen.add(ref)
        runtimes.append({
            "id": f"flatpak:{ref}:{scope}",
            "app_id": ref,
            "kind": "flatpak",
            "runtime": True,
            "name": name or runtime_id,
            "version": None,
            "available_version": None,
            "has_update": True,
            "update_check_failed": False,
            "scope": scope,
        })
    return runtimes


async def _disabled_remotes(scope: proc_env.Scope) -> Set[str]:
    """Remotes flatpak keeps but never talks to — typically the
    "<name>-origin" one flatpak creates when installing from a local
    .flatpak bundle. Hidden from a plain `flatpak remotes`, hence
    --show-disabled."""
    code, out, _ = await proc_env.run(
        ["flatpak", "remotes", scope_flag(scope), "--show-disabled",
         "--columns=name,options"],
        scope, _LOG, timeout=15,
    )
    if code != 0:
        return set()
    disabled = set()
    for line in out.splitlines():
        name, _, options = line.partition("\t")
        if "disabled" in options.split(","):
            disabled.add(name.strip())
    return disabled


async def list_apps_with_updates(scope: proc_env.Scope) -> List[Dict[str, Any]]:
    apps = await list_installed(scope)
    disabled = await _disabled_remotes(scope)
    sem = asyncio.Semaphore(_CHECK_CONCURRENCY)

    async def _check(app: Dict[str, Any]) -> None:
        active = app.pop("_active_commit", "")
        origin = app.pop("_origin", "")
        if origin in disabled:
            # Installed by hand from a bundle — there's no remote to check
            # against, so "no updates, ever" is the answer, not a failure.
            app["manually_installed"] = True
            return
        async with sem:
            available, failed = await _check_update(scope, app["app_id"], active, origin)
        if available is not None:
            app["has_update"] = True
            app["available_version"] = available or None
        app["update_check_failed"] = failed

    await asyncio.gather(*(_check(app) for app in apps))

    try:
        apps.extend(await list_runtime_updates(scope, {a["app_id"] for a in apps}))
    except Exception as e:
        decky.logger.error(f"[{_LOG}] runtime update check ({scope}): {e}")
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


async def _apply_rebase(app_id: str, scope: proc_env.Scope) -> bool:
    """Install the successor runtime, then drop the one it replaces."""
    info = _pending_rebases.get((scope, app_id))
    if info is None:
        # Plugin restarted since the check that found it — look again.
        await list_runtime_updates(scope, set())
        info = _pending_rebases.get((scope, app_id))
    if info is None:
        return False
    code, _, _ = await proc_env.run(
        ["flatpak", "install", scope_flag(scope), info["remote"], app_id,
         "-y", "--noninteractive"],
        scope, _LOG, timeout=1800,
    )
    if code != 0:
        return False
    for old in info["old"]:
        await proc_env.run(
            ["flatpak", "uninstall", "-y", "--noninteractive", scope_flag(scope), old],
            scope, _LOG, timeout=300,
        )
    _pending_rebases.pop((scope, app_id), None)
    return True


async def update_one(app_id: str, scope: proc_env.Scope) -> bool:
    if (scope, app_id) in _pending_rebases:
        return await _apply_rebase(app_id, scope)
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
    rebases = [i for i in app_ids if (scope, i) in _pending_rebases]
    plain = [i for i in app_ids if i not in rebases]
    ok = True
    if plain:
        code, _, _ = await proc_env.run(
            ["flatpak", "update", "-y", "--noninteractive", scope_flag(scope), *plain],
            scope, _LOG, timeout=1800,
        )
        ok = code == 0
    for ref in rebases:
        if not await _apply_rebase(ref, scope):
            ok = False
    return ok


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


# Standard freedesktop Exec= field codes (Desktop Entry Specification) —
# always meaningless for a Steam shortcut, which never launches with an
# associated file/URI.
_DESKTOP_FIELD_CODES = {
    "%f", "%F", "%u", "%U", "%d", "%D", "%n", "%N", "%i", "%c", "%k", "%v", "%m",
}


def _strip_exec_placeholders(tokens: List[str]) -> List[str]:
    """Drop freedesktop field codes and Flatpak's own `@@u ... @@` file-
    forwarding bracket (both only matter when launching with a file/URI
    argument, which a plain Steam shortcut never has)."""
    out: List[str] = []
    in_forwarding_bracket = False
    for tok in tokens:
        if tok == "@@":
            in_forwarding_bracket = False
            continue
        if tok.startswith("@@"):
            in_forwarding_bracket = True
            continue
        if in_forwarding_bracket or tok in _DESKTOP_FIELD_CODES:
            continue
        out.append(tok)
    return out


def launch_command(app_id: str, scope: proc_env.Scope) -> Optional[Tuple[str, str]]:
    """(exe, launch_options) from this app's own exported .desktop Exec=
    line — app-specific (varies by --command=, branch, arch), so a single
    generic `flatpak run <app_id>` doesn't work for every app (confirmed:
    Gear Lever needs --command=gearlever, Chrome needs --command=/app/
    bin/chrome). Used to build a Steam non-Steam shortcut that actually
    launches this app correctly.

    Only the first Exec= is read — a .desktop file's [Desktop Entry]
    group (the app's own main launch command) always comes before any
    [Desktop Action ...] group (extra context-menu actions, e.g. Chrome's
    "New Window"), so the first Exec= encountered scanning top to bottom
    is always the right one.
    """
    desktop_path = (
        _installation_root(scope) / "exports" / "share" / "applications" / f"{app_id}.desktop"
    )
    if not desktop_path.is_file():
        return None
    try:
        for line in desktop_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("Exec="):
                continue
            tokens = _strip_exec_placeholders(shlex.split(line[len("Exec="):].strip()))
            if not tokens:
                return None
            exe = tokens[0]
            if "/" not in exe:
                exe = shutil.which(exe) or f"/usr/bin/{exe}"
            launch_options = " ".join(
                shlex.quote(t) if " " in t else t for t in tokens[1:]
            )
            return exe, launch_options
    except Exception as e:
        decky.logger.error(f"[flatpak] reading {desktop_path}: {e}")
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
