import React, { useEffect, useRef, useState } from "react";
import { Focusable } from "@decky/ui";
import { call, toaster } from "@decky/api";
import { ActionButton, StatusCard } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";

import { useApps } from "../context/AppsContext";

// How often we poll "is an install still running?" — both to recover an
// install already in progress on mount, and (see the effect that starts
// it right after clicking Install below) as the one thing that reliably
// notices the install actually finished. Confirmed on-device: awaiting
// install_gearlever()'s own promise directly and refreshing off of that
// alone isn't reliable — it can go quiet even though the underlying
// flatpak transaction (confirmed independently, no hung/zombie process
// left anywhere) genuinely completed. Polling a separate, idempotent
// "is it still busy" query sidesteps whatever that promise's own issue is.
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
  const pollIdRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const unmountedRef = useRef(false);

  const refreshSeen = () => {
    call<[], boolean>("get_gearlever_notice_seen").then((s) => {
      if (!unmountedRef.current) setSeen(s);
    });
  };

  // Idempotent — safe to call again while an existing poll is already
  // running (the mount effect finding one in progress, then the user
  // also pressing Install, shouldn't ever end up with two intervals).
  const startInstallingPoll = () => {
    if (pollIdRef.current) return;
    pollIdRef.current = setInterval(async () => {
      const stillBusy = await call<[], boolean>("is_gearlever_installing");
      if (unmountedRef.current || stillBusy) return;
      clearInterval(pollIdRef.current);
      pollIdRef.current = undefined;
      setInstalling(false);
      await refreshRef.current();
      refreshSeen();
    }, INSTALLING_POLL_MS);
  };

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (pollIdRef.current) clearInterval(pollIdRef.current);
    };
  }, []);

  useEffect(() => {
    if (installed !== false) return;
    refreshSeen();
    call<[], boolean>("is_gearlever_installing").then((busy) => {
      if (unmountedRef.current) return;
      setInstalling(busy);
      if (busy) startInstallingPoll();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  if (installed !== false || seen) return null;

  const dismiss = () => {
    call<[], boolean>("set_gearlever_notice_seen");
    setSeen(true);
  };

  const install = () => {
    setInstalling(true);
    // Started immediately, in parallel with the call below rather than
    // chained after it — this is what actually guarantees a refresh
    // happens once the install is done, independent of whether that
    // call's own promise ever resolves.
    startInstallingPoll();
    call<[], boolean>("install_gearlever")
      .then((ok) => {
        toaster.toast({
          title: "Gearlever",
          body: ok ? t("install_gearlever_success") : t("install_gearlever_failed"),
        });
      })
      .catch((e) => {
        console.error("[GearleverNotice] install_gearlever failed", e);
        toaster.toast({ title: "Gearlever", body: t("install_gearlever_failed") });
      });
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <StatusCard
        variant="info"
        title={t("gearlever_notice_title")}
        description={t("gearlever_notice_body")}
      >
        {installing && (
          // Steam's own ProgressBarWithInfo turned out unreliable here
          // (overflowed its own card even once stretched) — a plain
          // hand-rolled indeterminate bar, same pattern as TopProgressBar
          // elsewhere in this plugin, sidesteps it entirely.
          <div style={{ marginBottom: 8, width: "100%", alignSelf: "stretch" }}>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>
              {t("installing")}
            </div>
            <style>{`
              @keyframes gearlever-install-progress {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(350%); }
              }
            `}</style>
            <div
              style={{
                width: "100%",
                height: 4,
                borderRadius: 2,
                overflow: "hidden",
                background: "rgba(255, 255, 255, 0.08)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "30%",
                  background: "#4caf50",
                  animation: "gearlever-install-progress 1.1s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        )}
        <Focusable
          style={{ display: "flex", gap: 8, width: "100%", alignSelf: "stretch" }}
          flow-children="horizontal"
        >
          {/* flex:1 1 auto on each wrapper, not the buttons themselves
              (ActionButton has no flex prop of its own, only `width` —
              adding one means auditing every other consumer of this
              shared decky-ui-kit component) — the wrapper's own hypothetical
              flex-basis still comes from the button's natural text width
              (width:100% on the button doesn't change that: max-content
              sizing looks at the content's own preferred size, not any
              width set on it), so a longer translation naturally claims
              more of the row and the other wrapper is left with less,
              while both together still fill it exactly. */}
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <ActionButton size="small" width="100%" onClick={install} disabled={installing}>
              {installing ? t("installing") : t("install_gearlever")}
            </ActionButton>
          </div>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <ActionButton size="small" width="100%" onClick={dismiss}>
              {t("dismiss_understood")}
            </ActionButton>
          </div>
        </Focusable>
      </StatusCard>
    </div>
  );
};
