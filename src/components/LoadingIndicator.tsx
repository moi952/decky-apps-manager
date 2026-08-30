import React from "react";
import { Spinner } from "@decky/ui";
import { useTranslation } from "react-i18next";

interface LoadingIndicatorProps {
  label?: React.ReactNode;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ label }) => {
  const { t } = useTranslation("apps_view");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "24px 0",
      }}
    >
      <Spinner style={{ width: 32, height: 32 }} />
      <div style={{ fontSize: 12, color: "#9aa1a8" }}>
        {label ?? t("checking_updates")}
      </div>
    </div>
  );
};
