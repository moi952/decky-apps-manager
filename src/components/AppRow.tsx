import React, { useEffect, useState } from "react";
import { call } from "@decky/api";
import { ActionButton, MediaRow } from "@moi952/decky-ui-kit";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { useTranslation } from "react-i18next";

import { AppEntry, AppRowStatus } from "../types/apps";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";

interface AppRowProps {
  app: AppEntry;
  status: AppRowStatus;
  mode: "list" | "excluded";
  // AllAppsView: rows start collapsed (buttons hidden) to keep the full
  // list short; pressing the row reveals them. Home never collapses —
  // it only ever holds apps that need attention, so the actions should
  // be visible right away.
  collapsible?: boolean;
  // Pressing the row always opens the app's own detail view (AppImages
  // included, whether or not an update source is configured yet — that
  // page has its own "configure/edit source" button now) instead of the
  // collapse toggle — takes priority over `collapsible` when given.
  onRowPress?: () => void;
  onUpdate: () => void;
  onToggleExclude: () => void;
}

export const AppRow: React.FC<AppRowProps> = ({
  app,
  status,
  mode,
  collapsible = false,
  onRowPress,
  onUpdate,
  onToggleExclude,
}) => {
  const { t } = useTranslation("apps_view");
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCachedIcon(app.id);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_app_icon", app.id).then((url) => {
      setCachedIcon(app.id, url);
      if (url) setIcon(url);
    });
  }, [app.id]);

  return (
    <MediaRow
      color="transparent"
      bottomSeparator
      onPress={onRowPress}
      collapsedByDefault={collapsible}
      media={
        icon && (
          <img
            src={icon}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        )
      }
      title={app.name}
      details={
        <>
          <div style={{ fontSize: 11, color: "#9aa1a8" }}>{app.version ?? ""}</div>
          {app.has_update && (
            <div style={{ fontSize: 11, color: "#4caf50" }}>
              {/* A rolling/OCI remote (e.g. Anatase) can republish a new
                  build without bumping the app's own version string —
                  flatpak detects updates by commit, not by this string, so
                  "available" can legitimately equal "installed" here.
                  Showing the same number twice reads as a bug, so drop the
                  number in that case rather than repeat it. */}
              {app.available_version && app.available_version !== app.version
                ? t("available_version_label", { version: app.available_version })
                : t("update_available")}
            </div>
          )}
          {status === "error" && (
            <div style={{ fontSize: 10, color: "#ef4444" }}>
              {t("update_failed")}
            </div>
          )}
          {app.needs_update_source && mode === "list" && (
            <div style={{ fontSize: 10, color: "#f5a623" }}>
              {t("needs_update_source")}
            </div>
          )}
        </>
      }
      actions={
        <>
          {mode === "list" ? (
            <>
              <div style={{ flex: 1 }}>
                <ActionButton
                  size="small"
                  width="100%"
                  disabled={!app.has_update || status === "updating"}
                  onClick={onUpdate}
                >
                  {status === "updating" ? t("updating") : t("update")}
                </ActionButton>
              </div>
              <ActionButton size="small" onClick={onToggleExclude}>
                <FiEyeOff size={12} />
              </ActionButton>
            </>
          ) : (
            <div style={{ flex: 1 }}>
              <ActionButton size="small" width="100%" onClick={onToggleExclude}>
                <FiEye size={12} style={{ marginRight: 4 }} />
                {t("follow_button")}
              </ActionButton>
            </div>
          )}
        </>
      }
    />
  );
};
