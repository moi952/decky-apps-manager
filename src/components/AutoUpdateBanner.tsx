import React from "react";
import { ActionButton } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FaCheckCircle } from "react-icons/fa";

import { useApps } from "../context/AppsContext";
import { AppEntry } from "../types/apps";

import { AutoUpdateAppRow } from "./AutoUpdateAppRow";
import { StatusCard } from "./StatusCard";

interface AutoUpdateBannerProps {
  // True when there's nothing else left needing an update right now —
  // HomeView passes this instead of also rendering its own separate
  // "everything is up to date" card underneath, which would just repeat
  // this one's own news a second time.
  alsoUpToDate?: boolean;
  // True when the AppImage side couldn't actually be checked this cycle
  // (GitHub rate limit) — "everything is up to date" would be a claim we
  // can't back for those, so alsoUpToDate's note narrows to Flatpaks only
  // instead, same wording HomeView's own rate-limited card would've used.
  flatpakOnly?: boolean;
  // Omit to leave the rows non-navigating.
  onOpenApp?: (app: AppEntry) => void;
}

// Stays visible (across QAM close/reopen, across sessions) until the user
// actually dismisses it — a toast alone was the original way this got
// reported, but the background loop that triggers it runs whether or not
// the panel is open, so a toast that just times out unseen left no trace.
export const AutoUpdateBanner: React.FC<AutoUpdateBannerProps> = ({
  alsoUpToDate = false,
  flatpakOnly = false,
  onOpenApp,
}) => {
  const { t } = useTranslation("apps_view");
  const {
    autoUpdateHistory,
    hasUnseenAutoUpdate,
    markAutoUpdateHistorySeen,
    flatpakApps,
    gearleverApps,
  } = useApps();

  if (!hasUnseenAutoUpdate || autoUpdateHistory.length === 0) return null;
  const latest = autoUpdateHistory[0];

  return (
    <div style={{ marginBottom: 8 }}>
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
          {latest.apps.map((a) => {
            // Looked up fresh — the app may have moved on since this run.
            const liveApp = [...flatpakApps, ...gearleverApps].find((x) => x.id === a.id);
            return (
              <AutoUpdateAppRow
                key={a.id}
                id={a.id}
                name={a.name}
                kind={a.kind}
                color="transparent"
                onPress={liveApp && onOpenApp ? () => onOpenApp(liveApp) : undefined}
              />
            );
          })}
        </div>
        {alsoUpToDate && (
          // Same icon + same wording as the plain "up to date" card this
          // replaces (see HomeView's showingAutoUpdateBanner) — the point
          // is to say the exact same thing, not a reworded "the rest is
          // up to date" that reads as if something were left out.
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "#5fdb6a",
              marginBottom: 10,
            }}
          >
            <FaCheckCircle size={16} />
            {t(flatpakOnly ? "up_to_date_flatpak_only" : "up_to_date")}
          </div>
        )}
        <ActionButton size="small" width="100%" onClick={markAutoUpdateHistorySeen}>
          {t("dismiss_understood")}
        </ActionButton>
      </StatusCard>
    </div>
  );
};
