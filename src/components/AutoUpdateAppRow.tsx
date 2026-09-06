import React, { useEffect, useState } from "react";
import { call } from "@decky/api";
import { MediaRow } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowRight } from "react-icons/fi";

import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { AppKind } from "../types/apps";

interface AutoUpdateAppRowProps {
  id: string;
  name: string;
  kind: AppKind;
  // "transparent" for use inside a colored card (StatusCard's own green/
  // red background would otherwise clash with a solid row background);
  // a real color for standalone use (Settings' own history list).
  color?: "light" | "dark" | "transparent" | "success" | "danger" | "info" | "warning";
  // Omit to leave the row a plain (non-navigating) display, e.g. when the
  // caller couldn't resolve this id back to a still-installed app.
  onPress?: () => void;
  // Both needed to show the "old → new" line — an older history entry
  // recorded before this field existed, or a version-less flatpak, omits
  // one or both and the line is simply skipped.
  oldVersion?: string | null;
  newVersion?: string | null;
}

// One row of a past (or just-applied) auto-update: the app's own icon,
// its name, and which kind it is — shared by AutoUpdateBanner (inside a
// StatusCard) and AutoUpdateHistoryList (Settings), which only ever
// showed a plain comma-joined name string before.
export const AutoUpdateAppRow: React.FC<AutoUpdateAppRowProps> = ({
  id,
  name,
  kind,
  color = "dark",
  onPress,
  oldVersion,
  newVersion,
}) => {
  const { t } = useTranslation("apps_view");
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCachedIcon(id);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    // Best-effort: an app removed since this history entry was recorded
    // just comes back empty, same as MediaRow already handles elsewhere.
    call<[string], string>("get_app_icon", id).then((url) => {
      setCachedIcon(id, url);
      if (url) setIcon(url);
    });
  }, [id]);

  return (
    // Forces the kind label back to its own color on focus/hover —
    // Steam's native chrome otherwise dims it.
    <div className="dck-au-row">
      <style>{`
        .dck-au-row:hover .dck-au-row-kind,
        .dck-au-row:focus-within .dck-au-row-kind {
          color: #9aa1a8 !important;
        }
      `}</style>
      <MediaRow
        color={color}
        onPress={onPress}
        onOKActionDescription={onPress ? t("open_app_detail") : undefined}
        highlightOnFocus={false}
        media={
          icon && (
            <img
              src={icon}
              alt=""
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          )
        }
        title={name}
        details={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="dck-au-row-kind" style={{ fontSize: 11, color: "#9aa1a8" }}>
              {kind === "flatpak" ? "Flatpak" : "AppImage"}
            </div>
            {oldVersion && newVersion && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {oldVersion}
                <FiArrowRight size={10} />
                {newVersion}
              </div>
            )}
          </div>
        }
      />
    </div>
  );
};
