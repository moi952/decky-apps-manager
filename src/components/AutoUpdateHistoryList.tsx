import React from "react";
import { useTranslation } from "react-i18next";

import { useApps } from "../context/AppsContext";
import { formatDateTime } from "../utils/functions";

import { AutoUpdateAppRow } from "./AutoUpdateAppRow";

// Browsable, permanent log of past auto-update runs — separate from
// AutoUpdateBanner's own "have you seen the latest one yet" notice, this
// stays available regardless of whether that's already been dismissed.
export const AutoUpdateHistoryList: React.FC = () => {
  const { t, i18n } = useTranslation("settings_view");
  const { autoUpdateHistory } = useApps();

  if (autoUpdateHistory.length === 0) {
    return (
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {t("auto_update_history_empty")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {autoUpdateHistory.map((entry, i) => (
        <div key={i}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
            {formatDateTime(entry.timestamp * 1000, i18n.language)}
            {" — "}
            <span style={{ color: entry.ok ? "#5fdb6a" : "#ff6b6b" }}>
              {t(entry.ok ? "auto_update_history_ok" : "auto_update_history_failed")}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {entry.apps.map((a, j) => (
              <AutoUpdateAppRow key={j} id={a.id} name={a.name} kind={a.kind} color="dark" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
