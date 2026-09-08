import React, { useEffect, useState } from "react";
import { call, toaster } from "@decky/api";
import { ActionButton } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { SiSteam } from "react-icons/si";

import { AppEntry } from "../types/apps";
import {
  addSteamShortcut,
  canBuildShortcut,
  getShortcutIdentifier,
  openRestartSteamModal,
  rasterizeIconToPngBase64,
  removeSteamShortcut,
  resolveShortcutParams,
  setSteamShortcutCapsuleArtwork,
  setSteamShortcutIconPath,
} from "../utils/steamShortcut";

interface SteamShortcutButtonProps {
  app: AppEntry;
}

// Lets the user add this already-installed Flatpak/AppImage as a
// non-Steam shortcut (or remove it again) straight from its detail page.
// "Already added" is answered by checking Steam's own shortcuts.vdf live
// every time (see steamShortcut.ts's own note) — no bookkeeping of our
// own that could drift out of sync with what Steam actually has.
export const SteamShortcutButton: React.FC<SteamShortcutButtonProps> = ({ app }) => {
  const { t } = useTranslation("apps_view");
  const [steamAppId, setSteamAppId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const identifier = getShortcutIdentifier(app);
    if (!identifier) return;
    call<[string], number | null>("find_steam_shortcut", identifier).then((id) => {
      if (!cancelled) setSteamAppId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [app.id]);

  if (!canBuildShortcut(app)) return null;

  const add = async () => {
    setBusy(true);
    try {
      const params = await resolveShortcutParams(app);
      if (!params) {
        toaster.toast({ title: "Steam", body: t("steam_shortcut_add_failed_toast") });
        return;
      }
      const newId = await addSteamShortcut(app.name, params);
      if (newId != null) {
        const iconDataUri = await call<[string], string>("get_app_icon", app.id);
        if (iconDataUri) {
          const pngBase64 = await rasterizeIconToPngBase64(iconDataUri);
          if (pngBase64) {
            setSteamShortcutCapsuleArtwork(newId, pngBase64, "png");
            const iconPath = await call<[string, string], string>(
              "save_shortcut_icon_png",
              app.id,
              pngBase64,
            );
            if (iconPath) setSteamShortcutIconPath(newId, iconPath);
          }
        }
        setSteamAppId(newId);
        openRestartSteamModal(
          t("steam_shortcut_restart_title"),
          t("steam_shortcut_restart_added_body"),
          t("steam_shortcut_restart_btn"),
          t("steam_shortcut_restart_later_btn"),
        );
      } else {
        toaster.toast({ title: "Steam", body: t("steam_shortcut_add_failed_toast") });
      }
    } catch (e) {
      // AddShortcut rejecting must never leave the button stuck on
      // "busy" forever with no feedback at all — see the finally below.
      console.error("[SteamShortcutButton] AddShortcut failed", e);
      toaster.toast({ title: "Steam", body: t("steam_shortcut_add_failed_toast") });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (steamAppId == null) return;
    removeSteamShortcut(steamAppId);
    setSteamAppId(null);
    openRestartSteamModal(
      t("steam_shortcut_restart_title"),
      t("steam_shortcut_restart_removed_body"),
      t("steam_shortcut_restart_btn"),
      t("steam_shortcut_restart_later_btn"),
    );
  };

  const added = steamAppId != null;

  return (
    <ActionButton
      width="100%"
      variant={added ? "danger" : "normal"}
      disabled={busy}
      onClick={added ? remove : add}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <SiSteam size={14} />
        <span>
          {added ? t("steam_shortcut_remove_button") : t("steam_shortcut_add_button")}
        </span>
      </div>
    </ActionButton>
  );
};
