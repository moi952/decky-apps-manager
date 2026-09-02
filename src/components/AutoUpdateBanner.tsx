import React from "react";
import { ActionButton } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";

import { useApps } from "../context/AppsContext";

import { AutoUpdateAppRow } from "./AutoUpdateAppRow";
import { StatusCard } from "./StatusCard";

// Stays visible (across QAM close/reopen, across sessions) until the user
// actually dismisses it — a toast alone was the original way this got
// reported, but the background loop that triggers it runs whether or not
// the panel is open, so a toast that just times out unseen left no trace.
export const AutoUpdateBanner: React.FC = () => {
  const { t } = useTranslation("apps_view");
  const { autoUpdateHistory, hasUnseenAutoUpdate, markAutoUpdateHistorySeen } = useApps();

  if (!hasUnseenAutoUpdate || autoUpdateHistory.length === 0) return null;
  const latest = autoUpdateHistory[0];

  return (
    <div style={{ margin: "0 8px 8px" }}>
      <StatusCard
        variant={latest.ok ? "success" : "error"}
        // The per-app rows below already make it obvious at a glance
        // what happened — the big generic check/cross icon on top of
        // that was just extra vertical space for no extra information.
        hideIcon
        title={t(latest.ok ? "auto_update_banner_title" : "auto_update_banner_failed_title", {
          count: latest.apps.length,
        })}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginBottom: 10,
          }}
        >
          {latest.apps.map((a) => (
            <AutoUpdateAppRow key={a.id} id={a.id} name={a.name} kind={a.kind} color="transparent" />
          ))}
        </div>
        <ActionButton size="small" width="100%" onClick={markAutoUpdateHistorySeen}>
          {t("dismiss_understood")}
        </ActionButton>
      </StatusCard>
    </div>
  );
};
