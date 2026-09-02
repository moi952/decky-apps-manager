import React, { useEffect, useState } from "react";
import { call } from "@decky/api";
import { MediaRow } from "@moi952/decky-ui-kit";

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
}) => {
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
    <MediaRow
      color={color}
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
        <div style={{ fontSize: 11, opacity: 0.75 }}>
          {kind === "flatpak" ? "Flatpak" : "AppImage"}
        </div>
      }
    />
  );
};
