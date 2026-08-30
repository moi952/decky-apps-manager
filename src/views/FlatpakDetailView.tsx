import React, { useEffect, useState } from "react";
import { Focusable } from "@decky/ui";
import { call } from "@decky/api";
import {
  ActionButton,
  InfoTable,
  InfoTableRow,
  ScreenshotCarousel,
  StatusCard,
} from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import {
  FiArrowLeft,
  FiEye,
  FiEyeOff,
  FiHash,
  FiServer,
  FiTag,
  FiTrash2,
  FiUpload,
} from "react-icons/fi";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { BackHandler } from "../components/BackHandler";
import { InlineConfirm } from "../components/InlineConfirm";
import { TopProgressBar } from "../components/TopProgressBar";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { AppEntry } from "../types/apps";

interface FlatpakDetailViewProps {
  app: AppEntry;
  onBack: () => void;
  // Both return whether the operation actually succeeded — this view
  // drives its own busy/result state from that return value rather than
  // the caller's `statuses` map, which can flip (and this page navigate
  // away) well before the surrounding app list has actually refreshed —
  // that gap was exactly what made the button flash back to "Update"
  // right after a real success.
  onUpdate: () => Promise<boolean>;
  onUninstall: () => Promise<boolean>;
  onToggleExclude: () => void;
}

type Busy = "updating" | "removing" | null;
type Result = { kind: "update" | "remove"; ok: boolean } | null;

// Long enough to actually read the success message before this page
// closes itself and returns to the (now-refreshed) list.
const SUCCESS_AUTOCLOSE_MS = 1500;

// The already-installed counterpart to FlatpakCatalogDetailView (which
// only ever handles apps *not yet* installed, found via search) — same
// InfoTable-based layout, but the action button offers "Update" (or
// "up to date") instead of "Install", plus a Remove action of its own.
export const FlatpakDetailView: React.FC<FlatpakDetailViewProps> = ({
  app,
  onBack,
  onUpdate,
  onUninstall,
  onToggleExclude,
}) => {
  const { t } = useTranslation("flatpak_detail_view");
  const { t: tApps } = useTranslation("apps_view");
  const [icon, setIcon] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<Result>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    const cached = getCachedIcon(app.id);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_app_icon", app.id).then((url) => {
      setCachedIcon(app.id, url);
      if (url) setIcon(url);
    });
  }, [app.id]);

  useEffect(() => {
    // Flathub-specific (see flatpak.get_screenshots's own note) — an app
    // from another remote (e.g. Anatase) just gets an empty list here,
    // and ScreenshotCarousel already renders nothing for that.
    if (app.app_id) {
      call<[string], string[]>("get_flatpak_screenshots", app.app_id).then(setScreenshots);
    }
  }, [app.app_id]);

  const runUpdate = async () => {
    setResult(null);
    setBusy("updating");
    const ok = await onUpdate();
    setBusy(null);
    setResult({ kind: "update", ok });
    if (ok) setTimeout(onBack, SUCCESS_AUTOCLOSE_MS);
  };

  const runUninstall = async () => {
    setConfirmingRemove(false);
    setResult(null);
    setBusy("removing");
    const ok = await onUninstall();
    setBusy(null);
    setResult({ kind: "remove", ok });
    if (ok) setTimeout(onBack, SUCCESS_AUTOCLOSE_MS);
  };

  const infoRows: InfoTableRow[] = [
    { icon: <FiTag size={13} />, label: t("info_version"), value: app.version ?? "—" },
    ...(app.has_update
      ? [
          {
            icon: <FiUpload size={13} />,
            label: t("info_available_version"),
            // See AppRow.tsx's own note — a same-looking version can still
            // mean "an update exists" (commit-level change only).
            value:
              app.available_version && app.available_version !== app.version
                ? app.available_version
                : tApps("update_available"),
            accent: "#4caf50",
          },
        ]
      : []),
    {
      icon: <FiServer size={13} />,
      label: t("info_scope"),
      value: app.scope === "system" ? t("scope_system") : t("scope_user"),
    },
    { icon: <FiHash size={13} />, label: t("info_app_id"), value: app.app_id ?? "—" },
  ];

  return (
    <BackHandler onBack={onBack}>
      <PanelSectionCustom>
        <Focusable style={{ display: "flex" }} flow-children="horizontal">
          <ActionButton onClick={onBack}>
            <FiArrowLeft size={16} />
          </ActionButton>
        </Focusable>

        {icon && (
          <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
            <img
              src={icon}
              alt=""
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
          </div>
        )}

        <div
          style={{ marginTop: 8, fontWeight: 600, fontSize: 14, textAlign: "center" }}
        >
          {app.name}
        </div>
        <div style={{ fontSize: 10, color: "#9aa1a8", textAlign: "center" }}>
          Flatpak
        </div>

        {screenshots.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <ScreenshotCarousel screenshots={screenshots} zoomEnabled={false} />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <InfoTable rows={infoRows} />
        </div>

        {/* flatpak only prints real %/speed to a real terminal, not to the
            pipe this backend necessarily reads from — an indeterminate bar
            is the honest option, the button label already says what's
            going on. */}
        {busy && (
          <div style={{ marginTop: 16 }}>
            <TopProgressBar />
          </div>
        )}

        {confirmingRemove ? (
          <div style={{ marginTop: 16 }}>
            <InlineConfirm
              description={t("remove_confirm_description", { name: app.name })}
              confirmLabel={t("remove")}
              variant="danger"
              onCancel={() => setConfirmingRemove(false)}
              onConfirm={runUninstall}
            />
          </div>
        ) : (
          <Focusable
            style={{ display: "flex", gap: 8, width: "100%", marginTop: 16 }}
            flow-children="horizontal"
          >
            <div style={{ flex: 1 }}>
              <ActionButton
                width="100%"
                disabled={!app.has_update || !!busy}
                onClick={runUpdate}
              >
                {busy === "updating"
                  ? tApps("updating")
                  : app.has_update
                    ? tApps("update")
                    : tApps("already_up_to_date")}
              </ActionButton>
            </div>
            <ActionButton onClick={onToggleExclude} disabled={!!busy}>
              {app.excluded ? <FiEye size={14} /> : <FiEyeOff size={14} />}
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={!!busy}
              onClick={() => setConfirmingRemove(true)}
            >
              {busy === "removing" ? t("removing") : <FiTrash2 size={14} />}
            </ActionButton>
          </Focusable>
        )}

        {result && (
          <div style={{ marginTop: 12 }}>
            {result.ok ? (
              <StatusCard
                variant="success"
                title={
                  result.kind === "update"
                    ? t("update_success_title")
                    : t("remove_success_title")
                }
              />
            ) : (
              <StatusCard
                variant="error"
                title={
                  result.kind === "update"
                    ? t("update_error_title")
                    : t("remove_error_title")
                }
                description={
                  result.kind === "update"
                    ? t("update_error_description")
                    : t("remove_error_description")
                }
              />
            )}
          </div>
        )}
      </PanelSectionCustom>
    </BackHandler>
  );
};
