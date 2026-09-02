import React, { useState } from "react";
import { Focusable } from "@decky/ui";
import { ActionButton } from "@moi952/decky-ui-kit";
import { FiRefreshCw } from "react-icons/fi";
import { useTranslation } from "react-i18next";

import { useApps } from "../context/AppsContext";
import { formatTime } from "../utils/functions";

import { InlineConfirm } from "./InlineConfirm";

export const UpdateAllBar: React.FC = () => {
  const { t, i18n } = useTranslation("apps_view");
  const {
    flatpakApps,
    gearleverApps,
    lastCheckedAt,
    loading,
    backgroundLoading,
    refresh,
    updateAll,
  } = useApps();

  const [confirming, setConfirming] = useState(false);

  const updatableCount = [...flatpakApps, ...gearleverApps].filter(
    (a) => a.has_update && !a.excluded
  ).length;

  const lastCheckedLabel = lastCheckedAt
    ? formatTime(lastCheckedAt, i18n.language)
    : t("never_checked");

  return (
    <div style={{ width: "100%", boxSizing: "border-box", paddingBottom: 8 }}>
      {confirming ? (
        <InlineConfirm
          description={t("update_all_confirm_description", {
            count: updatableCount,
          })}
          confirmLabel={t("update_all")}
          variant="primary"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            updateAll();
          }}
        />
      ) : (
        <Focusable
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}
          flow-children="horizontal"
        >
          <div style={{ flex: 1 }}>
            <ActionButton
              width="100%"
              disabled={updatableCount === 0}
              onClick={() => setConfirming(true)}
            >
              {t("update_all")} {updatableCount > 0 ? `(${updatableCount})` : ""}
            </ActionButton>
          </div>
          <ActionButton
            onClick={() => refresh(true)}
            disabled={loading || backgroundLoading}
          >
            <FiRefreshCw size={14} />
          </ActionButton>
        </Focusable>
      )}
      <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>
        {t("last_checked", { time: lastCheckedLabel })}
      </div>
    </div>
  );
};
