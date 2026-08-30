import React, { useEffect, useState } from "react";
import { call } from "@decky/api";
import { MediaRow } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";

import { FlatpakCatalogEntry } from "../types/flatpakCatalog";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { htmlToPlainText } from "../utils/sanitizeHtml";

interface FlatpakCatalogRowProps {
  entry: FlatpakCatalogEntry;
  onPress: () => void;
}

// No `actions` — pressing this row always opens the detail view, there's
// nothing to expand into (unlike AppRow, which has inline Update/Exclude
// buttons of its own).
export const FlatpakCatalogRow: React.FC<FlatpakCatalogRowProps> = ({
  entry,
  onPress,
}) => {
  const { t } = useTranslation("flatpak_catalog_view");
  const [icon, setIcon] = useState<string | null>(null);
  const cacheKey = `catalog:${entry.app_id}`;

  useEffect(() => {
    const cached = getCachedIcon(cacheKey);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_flatpak_catalog_icon", entry.app_id).then((url) => {
      setCachedIcon(cacheKey, url);
      if (url) setIcon(url);
    });
  }, [cacheKey, entry.app_id]);

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
