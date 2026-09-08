import React from "react";
import { ConfirmModal, showModal } from "@decky/ui";
import { call } from "@decky/api";

import { AppEntry } from "../types/apps";

// SteamClient.Apps.AddShortcut/RemoveShortcut/appStore are already
// globally typed by @decky/ui (steam-client/App.d.ts) — same globals
// decky-proton-launch already calls directly (SteamClient.Apps.
// SetAppLaunchOptions etc.), so no local declaration needed here.
//
// AddShortcut registers the new non-Steam app live in Steam's own
// in-memory app store immediately, no Steam restart required for it to
// become launchable — unlike writing a new entry straight into
// shortcuts.vdf from the backend, which Steam only loads at its own
// startup (confirmed against a real, working Decky plugin — unifideck —
// that documents exactly this distinction).

export interface ShortcutParams {
  exe: string;
  startDir: string;
  launchOptions: string;
}

// Only the two kinds this plugin manages, and only when this AppEntry
// actually carries its own kind-specific id — used to decide whether the
// button renders at all, before doing any of resolveShortcutParams's
// (possibly backend-round-tripping) work.
export const canBuildShortcut = (app: AppEntry): boolean =>
  (app.kind === "flatpak" && !!app.app_id) || (app.kind === "appimage" && !!app.file_path);

// Whichever string uniquely identifies this app in a shortcuts.vdf entry
// (the flatpak app id, or the AppImage's own path) — passed to the
// backend's find_steam_shortcut, which looks for it as a *substring* of
// Exe/LaunchOptions (see steam_shortcuts.py's own note on why exact
// matching doesn't work: a shortcut added by hand, or by the distro's own
// Flatpak/Steam integration, builds a completely different command
// around the very same id/path).
export const getShortcutIdentifier = (app: AppEntry): string | null => {
  if (app.kind === "flatpak" && app.app_id) return app.app_id;
  if (app.kind === "appimage" && app.file_path) return app.file_path;
  return null;
};

// Flatpak's own launch command is app-specific (varies by --command=,
// branch, arch — see flatpak.py's launch_command docstring), so it's
// resolved backend-side from that app's own exported .desktop file
// rather than guessed here. AppImage needs no such lookup.
export const resolveShortcutParams = async (app: AppEntry): Promise<ShortcutParams | null> => {
  if (app.kind === "flatpak" && app.app_id) {
    const resolved = await call<[string], [string, string] | null>(
      "get_flatpak_launch_command",
      app.id,
    );
    if (resolved) {
      const [exe, launchOptions] = resolved;
      return { exe, startDir: "/usr/bin", launchOptions };
    }
    // No exported .desktop entry found (rare) — falls back to the plain
    // form, which works for most apps but not ones needing their own
    // --command= (multi-binary Flatpaks like Gear Lever or Chrome).
    return { exe: "/usr/bin/flatpak", startDir: "/usr/bin", launchOptions: `run ${app.app_id}` };
  }
  if (app.kind === "appimage" && app.file_path) {
    // Confirmed on-device: the AppImage itself as Target doesn't work —
    // it needs to run through `env`, with the AppImage's own path (and
    // --no-sandbox, for the Electron-based ones) as the launch options.
    return {
      exe: "/usr/bin/env",
      startDir: "/",
      launchOptions: `"${app.file_path}" --no-sandbox`,
    };
  }
  return null;
};

// Confirmed on-device: AddShortcut's own name/directory/launchOptions
// arguments don't reliably stick (a created shortcut showed up with
// AppName "env"/"flatpak" — literally the Exe's own basename — and an
// empty LaunchOptions) — only Exe itself is honored. Explicitly setting
// each field right after creation is what actually makes them stick,
// same defensive pattern unifideck's own createTemporaryShortcut uses
// for LaunchOptions (it re-sets that one after AddShortcut too — a hint
// I should have generalized to every field the first time).
//
// `>>> 0` normalizes to an unsigned 32-bit value — shortcuts.vdf stores
// appid as a signed int32, so a real appid past 2^31 reads back negative
// unless masked (confirmed reading the file directly); cheap insurance
// against the same signedness mismatch on the JS side.
export const addSteamShortcut = async (
  name: string,
  params: ShortcutParams,
): Promise<number | null> => {
  const rawAppId = await SteamClient.Apps.AddShortcut(
    name,
    params.exe,
    params.startDir,
    params.launchOptions,
  );
  if (typeof rawAppId !== "number" || rawAppId === 0) return null;
  const appId = rawAppId >>> 0;
  SteamClient.Apps.SetShortcutName(appId, name);
  SteamClient.Apps.SetShortcutStartDir(appId, params.startDir);
  SteamClient.Apps.SetShortcutLaunchOptions(appId, params.launchOptions);
  return appId;
};

export const removeSteamShortcut = (appId: number): void => {
  SteamClient.Apps.RemoveShortcut(appId >>> 0);
};

// Steam's own ELibraryAssetType enum isn't re-exported by @decky/ui's
// public types, so passed as the literal it always is. This is only for
// Capsule (the big Library grid tile) — without setting it, a fresh
// non-Steam shortcut shows a plain black tile (confirmed on-device).
// The small icon does NOT go through this call: confirmed on-device that
// SetCustomArtworkForApp(..., assetType=Icon) writes nothing at all (no
// on-disk artifact appears for it, unlike every other asset type) —
// that's SetShortcutIcon's job instead, see setSteamShortcutIconPath.
export const LIBRARY_ASSET_TYPE_CAPSULE = 0;

export const setSteamShortcutCapsuleArtwork = (
  appId: number,
  base64: string,
  format: "png" | "jpg",
): void => {
  void SteamClient.Apps.SetCustomArtworkForApp(
    appId >>> 0,
    base64,
    format,
    LIBRARY_ASSET_TYPE_CAPSULE,
  );
};

// SetShortcutIcon takes a path, not bytes — the PNG (already rasterized
// frontend-side, see rasterizeIconToPngBase64) is written to a plain file
// first via the backend's save_shortcut_icon_png (a bare file write, not
// a conversion — nothing there depends on a system package either).
export const setSteamShortcutIconPath = (appId: number, iconPath: string): void => {
  SteamClient.Apps.SetShortcutIcon(appId >>> 0, iconPath);
};

// SetCustomArtworkForApp only takes png/jpg — Steam doesn't accept an SVG
// (confirmed on-device: Chrome's Flatpak only exports one, and its
// shortcut came up with no icon at all). Rather than depend on a system
// tool to convert it (confirmed absent on some real installs — Bazzite
// had no rsvg-convert at all, unlike SteamOS the day before), this
// rasterizes through the same Chromium every Decky plugin already runs
// inside: load the (possibly-SVG) data URI into an <img>, draw it onto an
// offscreen <canvas>, and read the result back out as PNG. No install-
// specific dependency, works identically everywhere this plugin runs.
export const rasterizeIconToPngBase64 = (
  dataUri: string,
  size = 256,
): Promise<string | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const pngDataUri = canvas.toDataURL("image/png");
      resolve(pngDataUri.split(",")[1] ?? null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
};

// Same pattern (and the same confirmed-working SteamClient.User.
// StartRestart call) as decky-proton-launch's own restart modal — only
// ever shown after this plugin's own add/remove button, never for a
// shortcut created through Steam's native "Add a Non-Steam Game" flow,
// which this plugin has no hand in.
export const openRestartSteamModal = (
  title: string,
  description: string,
  restartLabel: string,
  laterLabel: string,
): void => {
  showModal(
    React.createElement(ConfirmModal, {
      strTitle: title,
      strDescription: description,
      strOKButtonText: restartLabel,
      strCancelButtonText: laterLabel,
      onOK: () => SteamClient.User.StartRestart(false),
    }),
  );
};
