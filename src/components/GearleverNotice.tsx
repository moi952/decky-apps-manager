import React, { useEffect, useRef, useState } from "react";
import { ProgressBarWithInfo } from "@decky/ui";
import { call, toaster } from "@decky/api";
import { ActionButton } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";

import { useApps } from "../context/AppsContext";

// How often we poll the backend for "is an install still running?" after
// finding one already in progress on mount (see the effect below) — no
// push event exists for this, so a plain poll is the simplest option for
// a rare, bounded-duration situation (install_gearlever() times out well
// under a minute either way).
const INSTALLING_POLL_MS = 2000;

interface GearleverNoticeProps {
  // null = not checked yet — must be treated the same as "installed",
  // never as "confirmed missing", or the notice flashes on every load
  // until the real (slower) list_apps check comes back.
  installed: boolean | null;
}

export const GearleverNotice: React.FC<GearleverNoticeProps> = ({
  installed,
}) => {
  const { t } = useTranslation("apps_view");
  const { refresh } = useApps();
  const [seen, setSeen] = useState(true);
  const [installing, setInstalling] = useState(false);
  // Closing/reopening the QAM tears down and recreates this whole
  // component — `installing` above would silently reset to false even
  // though a backend install can still be running underneath. `refresh`
  // itself is recreated on every check (see AppsContext), so it's read
  // through a ref rather than added to the mount effect's own deps below,
  // which would otherwise re-run (and restart the poll) constantly.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (installed !== false) return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;

    call<[], boolean>("get_gearlever_notice_seen").then((s) => {
      if (!cancelled) setSeen(s);
    });

    call<[], boolean>("is_gearlever_installing").then((busy) => {
      if (cancelled) return;
      setInstalling(busy);
      if (!busy) return;
      pollId = setInterval(async () => {
        const stillBusy = await call<[], boolean>("is_gearlever_installing");
        if (cancelled || stillBusy) return;
        if (pollId) clearInterval(pollId);
        setInstalling(false);
        await refreshRef.current();
        call<[], boolean>("get_gearlever_notice_seen").then((s) => {
          if (!cancelled) setSeen(s);
        });
      }, INSTALLING_POLL_MS);
    });

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, [installed]);

  if (installed !== false || seen) return null;

  const dismiss = () => {
    call<[], boolean>("set_gearlever_notice_seen");
    setSeen(true);
  };

  const install = async () => {
    setInstalling(true);
    try {
      const ok = await call<[], boolean>("install_gearlever");
      toaster.toast({
        title: t("gearlever_notice_title"),
        body: ok
          ? t("install_gearlever_success")
          : t("install_gearlever_failed"),
      });
      if (ok) await refresh();
    } finally {
      setInstalling(false);
      dismiss();
    }
  };

  return (
    <div
      style={{
        padding: 10,
        margin: "0 8px 8px",
        background: "#22242c",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {t("gearlever_notice_title")}
      </div>
      <div style={{ marginBottom: 8, color: "#9aa1a8" }}>
        {t("gearlever_notice_body")}
      </div>
      {installing && (
        <div style={{ marginBottom: 8 }}>
          <ProgressBarWithInfo
            layout="inline"
            bottomSeparator="none"
            indeterminate
            nProgress={0}
            sOperationText={t("installing")}
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton size="small" onClick={install} disabled={installing}>
          {installing ? t("installing") : t("install_gearlever")}
        </ActionButton>
        <ActionButton size="small" onClick={dismiss}>
          {t("dismiss_understood")}
        </ActionButton>
      </div>
    </div>
  );
};
