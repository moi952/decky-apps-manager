import React, { useEffect, useState } from "react";
import { Focusable } from "@decky/ui";
import { call, toaster } from "@decky/api";
import {
  ActionButton,
  InfoTable,
  InfoTableRow,
  ScreenshotCarousel,
  StatusCard,
} from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft, FiCheckCircle, FiGitBranch, FiServer, FiTag } from "react-icons/fi";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { BackHandler } from "../components/BackHandler";
import { SafeHtml } from "../components/SafeHtml";
import { TopProgressBar } from "../components/TopProgressBar";
import { useApps } from "../context/AppsContext";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { FlatpakCatalogEntry } from "../types/flatpakCatalog";

interface FlatpakCatalogDetailViewProps {
  entry: FlatpakCatalogEntry;
  onBack: () => void;
  onInstalled: () => void;
}

// Long enough to actually read the success message before this page
// closes itself and returns to the search results.
const SUCCESS_AUTOCLOSE_MS = 1500;

export const FlatpakCatalogDetailView: React.FC<FlatpakCatalogDetailViewProps> = ({
  entry,
  onBack,
  onInstalled,
}) => {
  const { t } = useTranslation("flatpak_catalog_view");
  const { refresh } = useApps();
  const [icon, setIcon] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  // null: idle. true/false shown as a StatusCard below the button — true
  // auto-closes this page after a moment (long enough to actually read
  // it), false stays so the user can retry.
  const [installResult, setInstallResult] = useState<boolean | null>(null);
  // Own local flag, separate from `entry.installed` (a snapshot from
  // before this page ever opened, never updated by installing) — once a
  // successful install flips this true it never goes back, regardless
  // of how long the background refresh below takes.
  const [installed, setInstalled] = useState(entry.installed);

  useEffect(() => {
    const cacheKey = `catalog:${entry.app_id}`;
    const cached = getCachedIcon(cacheKey);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_flatpak_catalog_icon", entry.app_id).then((url) => {
      setCachedIcon(cacheKey, url);
      if (url) setIcon(url);
    });
  }, [entry.app_id]);

  useEffect(() => {
    // Flathub-specific (see flatpak.get_screenshots's own note) — an app
    // from another remote (e.g. Anatase) just gets an empty list here,
    // and ScreenshotCarousel already renders nothing for that.
    call<[string], string[]>("get_flatpak_screenshots", entry.app_id).then(setScreenshots);
  }, [entry.app_id]);

  const install = async () => {
    setInstalling(true);
    setInstallResult(null);
    try {
      const ok = await call<[string, string], boolean>(
        "install_flatpak_catalog_app",
        entry.app_id,
        entry.remote
      );
      toaster.toast({
        title: entry.name,
        body: ok ? t("install_success") : t("install_failed"),
      });
      setInstallResult(ok);
      if (ok) {
        setInstalled(true);
        // Fire-and-forget — the definitive result is already known, so
        // the button/progress bar/StatusCard here don't need to wait on
        // this to move on together. It just keeps the app list's own
        // cache current for whenever the user navigates back to it (see
        // apps_service.install_flatpak_catalog_app, which the backend
        // already re-checked during the install itself).
        refresh(false);
        setTimeout(onInstalled, SUCCESS_AUTOCLOSE_MS);
      }
    } catch {
      setInstallResult(false);
    } finally {
      setInstalling(false);
    }
  };

  const infoRows: InfoTableRow[] = [
    { icon: <FiTag size={13} />, label: t("info_version"), value: entry.version || "—" },
    { icon: <FiGitBranch size={13} />, label: t("info_branch"), value: entry.branch || "—" },
    {
      icon: <FiServer size={13} />,
      label: t("info_remote"),
      value: entry.remotes.join(", ") || "—",
    },
    ...(installed
      ? [
          {
            icon: <FiCheckCircle size={13} />,
            label: t("info_status"),
            value: t("already_installed"),
            accent: "#4caf50",
          },
        ]
      : []),
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
          <div
            style={{
              marginTop: 8,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <img
              src={icon}
              alt=""
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            fontWeight: 600,
            fontSize: 14,
            textAlign: "center",
          }}
        >
          {entry.name}
        </div>
        <div style={{ fontSize: 10, color: "#9aa1a8", textAlign: "center" }}>
          {entry.app_id}
        </div>

        {entry.description && (
          <SafeHtml
            html={entry.description}
            style={{ marginTop: 12, fontSize: 12, color: "#9aa1a8" }}
          />
        )}

        {screenshots.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <ScreenshotCarousel screenshots={screenshots} zoomEnabled={false} />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <InfoTable rows={infoRows} />
        </div>

        {/* flatpak's own CLI only prints real %/speed when its stdout is a
            real terminal — confirmed on-device: piped the way this backend
            necessarily runs it (to read the result), it only ever prints
            "Installing…" once, then nothing until it's done. An
            indeterminate bar is the honest option here, not a fabricated
            percentage — the button's own label below already says
            "Installing…". */}
        {installing && (
          <div style={{ marginTop: 16 }}>
            <TopProgressBar />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <ActionButton
            width="100%"
            onClick={install}
            disabled={installing || installed}
          >
            {installing
              ? t("installing")
              : installed
                ? t("already_installed")
                : t("install")}
          </ActionButton>
        </div>

        {installResult !== null && (
          <div style={{ marginTop: 12 }}>
            {installResult ? (
              <StatusCard variant="success" title={t("install_success")} />
            ) : (
              <StatusCard
                variant="error"
                title={t("install_error_title")}
                description={t("install_error_description")}
              />
            )}
          </div>
        )}
      </PanelSectionCustom>
    </BackHandler>
  );
};
