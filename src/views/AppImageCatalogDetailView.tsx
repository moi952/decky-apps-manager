import React, { useEffect, useState } from "react";
import { Focusable, Navigation } from "@decky/ui";
import { call, toaster } from "@decky/api";
import {
  ActionButton,
  InfoTable,
  InfoTableRow,
  ScreenshotCarousel,
  StatusCard,
} from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft, FiCheckCircle, FiShield, FiTag } from "react-icons/fi";
import { FaGithub } from "react-icons/fa";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { BackHandler } from "../components/BackHandler";
import { SafeHtml } from "../components/SafeHtml";
import { TopProgressBar } from "../components/TopProgressBar";
import { useApps } from "../context/AppsContext";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { AppImageCatalogEntry } from "../types/appimageCatalog";

interface AppImageCatalogDetailViewProps {
  entry: AppImageCatalogEntry;
  onBack: () => void;
  onInstalled: () => void;
}

// Long enough to actually read the success message before this page
// closes itself and returns to the search results.
const SUCCESS_AUTOCLOSE_MS = 1500;

export const AppImageCatalogDetailView: React.FC<AppImageCatalogDetailViewProps> = ({
  entry,
  onBack,
  onInstalled,
}) => {
  const { t } = useTranslation("appimage_catalog_view");
  const { refresh } = useApps();
  const [icon, setIcon] = useState<string | null>(null);
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
    if (!entry.icon_url) return;
    const cacheKey = `appimage-catalog:${entry.icon_url}`;
    const cached = getCachedIcon(cacheKey);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_appimage_catalog_icon", entry.icon_url).then((url) => {
      setCachedIcon(cacheKey, url);
      if (url) setIcon(url);
    });
  }, [entry.icon_url]);

  const install = async () => {
    setInstalling(true);
    setInstallResult(null);
    try {
      const ok = await call<[string, string, string | null], boolean>(
        "install_appimage_catalog_app",
        entry.name,
        entry.download_url,
        entry.repo
      );
      toaster.toast({
        title: entry.name,
        body: ok ? t("install_success") : t("install_failed"),
      });
      setInstallResult(ok);
      if (ok) {
        setInstalled(true);
        // Fire-and-forget — the definitive result is already known, so
        // the button/progress bar/StatusCard don't need to wait on this
        // to move on together. It just keeps the app list's own cache
        // current for whenever the user navigates back to it.
        refresh(false);
        setTimeout(onInstalled, SUCCESS_AUTOCLOSE_MS);
      }
    } catch {
      setInstallResult(false);
    } finally {
      setInstalling(false);
    }
  };

  const onViewGithub = () => {
    if (entry.repo) Navigation.NavigateToExternalWeb(`https://github.com/${entry.repo}`);
  };

  const infoRows: InfoTableRow[] = [
    {
      icon: <FiTag size={13} />,
      label: t("info_categories"),
      value: entry.categories.join(", ") || "—",
    },
    { icon: <FiShield size={13} />, label: t("info_license"), value: entry.license || "—" },
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
          {entry.name}
        </div>

        {entry.description && (
          <SafeHtml
            html={entry.description}
            style={{ marginTop: 12, fontSize: 12, color: "#9aa1a8" }}
          />
        )}

        {entry.screenshots.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <ScreenshotCarousel screenshots={entry.screenshots} zoomEnabled={false} />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <InfoTable rows={infoRows} />
        </div>

        {entry.repo && (
          <div style={{ marginTop: 8 }}>
            <ActionButton width="100%" onClick={onViewGithub}>
              <FaGithub size={14} style={{ marginRight: 6 }} />
              {t("view_github")}
            </ActionButton>
          </div>
        )}

        {/* Same honest-indeterminate-progress convention as the Flatpak
            catalog install: Gearlever's own CLI only prints real progress
            when its stdout is a real terminal, not piped. */}
        {installing && (
          <div style={{ marginTop: 16 }}>
            <TopProgressBar />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <ActionButton width="100%" onClick={install} disabled={installing || installed}>
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
