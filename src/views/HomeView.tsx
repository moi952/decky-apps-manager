import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { FaSearch } from "react-icons/fa";
import { FiClock } from "react-icons/fi";
import { StatusCard } from "@moi952/decky-ui-kit";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { UpdateAllBar } from "../components/UpdateAllBar";
import { GearleverNotice } from "../components/GearleverNotice";
import { AutoUpdateBanner } from "../components/AutoUpdateBanner";
import { SearchField } from "../components/SearchField";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { TopProgressBar } from "../components/TopProgressBar";
import {
  AppSectionHeader,
  APP_SECTION_HEADER_STYLES,
} from "../components/AppSectionHeader";
import { AppRow } from "../components/AppRow";
import { useApps } from "../context/AppsContext";
import { AppEntry } from "../types/apps";
import { minutesUntil, sortApps } from "../utils/functions";

interface HomeViewProps {
  // Detail-view routing itself lives in index.tsx's own App component,
  // not here — see its own note on why (a nested BackHandler here had
  // nothing above it with a real onBack to safely fall back to, unlike
  // every other view's own detail page).
  onOpenApp: (app: AppEntry) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onOpenApp }) => {
  const { t } = useTranslation("apps_view");
  const {
    flatpakApps,
    gearleverApps,
    gearleverInstalled,
    statuses,
    loading,
    backgroundLoading,
    lastCheckedAt,
    githubRateLimitedUntil,
    updateApp,
    toggleExcluded,
  } = useApps();

  const [collapsedFlatpak, setCollapsedFlatpak] = useState(false);
  const [collapsedGearlever, setCollapsedGearlever] = useState(false);
  const [search, setSearch] = useState("");

  const needsUpdate = (a: AppEntry) => a.has_update && !a.excluded;
  const totalUpdatableUnfiltered =
    flatpakApps.filter(needsUpdate).length +
    gearleverApps.filter(needsUpdate).length;

  const q = search.toLowerCase();
  const updatable = (apps: AppEntry[]) =>
    apps.filter((a) => needsUpdate(a) && a.name.toLowerCase().includes(q));

  const updatableFlatpak = sortApps(updatable(flatpakApps));
  const updatableGearlever = sortApps(updatable(gearleverApps));
  const totalUpdatable = updatableFlatpak.length + updatableGearlever.length;
  const initialLoading = loading && lastCheckedAt === null;
  const rateLimited =
    githubRateLimitedUntil !== null && githubRateLimitedUntil > Date.now();

  return (
    <PanelSectionCustom>
      <style>{APP_SECTION_HEADER_STYLES}</style>

      {backgroundLoading && (
        <div style={{ marginBottom: 8 }}>
          <TopProgressBar />
        </div>
      )}

      <UpdateAllBar />
      <AutoUpdateBanner />
      <GearleverNotice installed={gearleverInstalled} />

      {totalUpdatableUnfiltered > 2 && (
        <SearchField
          value={search}
          onChange={setSearch}
          size="small"
          highlightOnFocus={false}
          bottomSeparator={false}
          placeholder={t("search")}
          iconEnd={<FaSearch size={12} color="#888" />}
        />
      )}

      {initialLoading ? (
        <LoadingIndicator />
      ) : totalUpdatable === 0 ? (
        // A cached result can land here showing zero updates while the
        // silent background recheck it triggered (see AppsContext's own
        // refresh()) is still running — don't call that "up to date"
        // until that recheck actually settles, or a real update sitting
        // just behind it flashes "up to date" for a moment first.
        backgroundLoading ? (
          <LoadingIndicator label={t("checking_updates")} />
        ) : rateLimited ? (
          // Nothing came back flagged as needing an update, but the
          // GitHub-sourced AppImage checks were skipped this cycle (see
          // gearlever.py's own rate-limit-marker note) — "everything is
          // up to date" would be a claim we can't actually back for
          // those, so this splits into what was genuinely verified
          // (Flatpaks) and what's actually paused (AppImages), rather
          // than one merged claim glossing over the difference.
          <>
            <div style={{ marginBottom: 12 }}>
              <StatusCard variant="success" title={t("up_to_date_flatpak_only")} />
            </div>
            <StatusCard
              variant="error"
              icon={<FiClock />}
              title={t("github_rate_limit_title")}
              description={t("github_rate_limit_description", {
                minutes: minutesUntil(githubRateLimitedUntil!),
              })}
            />
          </>
        ) : (
          <StatusCard variant="success" title={t("up_to_date")} />
        )
      ) : (
        <>
          {updatableFlatpak.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <AppSectionHeader
                title={t("flatpak_section")}
                count={updatableFlatpak.length}
                collapsed={collapsedFlatpak}
                onToggle={() => setCollapsedFlatpak((v) => !v)}
              />
              {!collapsedFlatpak &&
                updatableFlatpak.map((app) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    mode="list"
                    status={statuses[app.id] ?? "idle"}
                    onUpdate={() => updateApp(app.id)}
                    onToggleExclude={() => toggleExcluded(app.id)}
                    onRowPress={() => onOpenApp(app)}
                  />
                ))}
            </div>
          )}

          {gearleverInstalled && updatableGearlever.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <AppSectionHeader
                title={t("appimage_section")}
                count={updatableGearlever.length}
                collapsed={collapsedGearlever}
                onToggle={() => setCollapsedGearlever((v) => !v)}
              />
              {!collapsedGearlever &&
                updatableGearlever.map((app) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    mode="list"
                    status={statuses[app.id] ?? "idle"}
                    onUpdate={() => updateApp(app.id)}
                    onToggleExclude={() => toggleExcluded(app.id)}
                    onRowPress={() => onOpenApp(app)}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </PanelSectionCustom>
  );
};
