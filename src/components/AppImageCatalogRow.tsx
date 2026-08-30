import React, { useEffect, useState } from "react";
import { call } from "@decky/api";
import { MediaRow } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";

import { AppImageCatalogEntry } from "../types/appimageCatalog";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { htmlToPlainText } from "../utils/sanitizeHtml";

interface AppImageCatalogRowProps {
  entry: AppImageCatalogEntry;
  onPress: () => void;
}

// No `actions` — pressing this row always opens the detail view, same
// shape as FlatpakCatalogRow. AppImageHub entries have no stable id to
// cache icons by (unlike a Flatpak's app_id), so the icon URL itself is
// the cache key.
export const AppImageCatalogRow: React.FC<AppImageCatalogRowProps> = ({
  entry,
  onPress,
}) => {
  const { t } = useTranslation("appimage_catalog_view");
  const [icon, setIcon] = useState<string | null>(null);
  const cacheKey = `appimage-catalog:${entry.icon_url ?? entry.name}`;

  useEffect(() => {
    if (!entry.icon_url) return;
    const cached = getCachedIcon(cacheKey);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_appimage_catalog_icon", entry.icon_url).then((url) => {
      setCachedIcon(cacheKey, url);
      if (url) setIcon(url);
    });
  }, [cacheKey, entry.icon_url]);

  return (
    <MediaRow
      color="transparent"
      bottomSeparator
      onPress={onPress}
      media={
        icon && (
          <img
            src={icon}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        )
      }
      title={entry.name}
      details={
        <>
          {entry.description && (
            <div
              style={{
                fontSize: 11,
                color: "#9aa1a8",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {htmlToPlainText(entry.description)}
            </div>
          )}
          {entry.installed && (
            <div style={{ fontSize: 10, color: "#4caf50" }}>{t("already_installed")}</div>
          )}
        </>
      }
    />
  );
};
