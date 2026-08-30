import React, { useEffect, useRef, useState } from "react";
import { Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { ActionButton, AnchoredDropdown } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft } from "react-icons/fi";
import { FaSearch } from "react-icons/fa";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { SearchField } from "../components/SearchField";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { TopProgressBar } from "../components/TopProgressBar";
import { AppRow } from "../components/AppRow";
import {
  AppSectionHeader,
  APP_SECTION_HEADER_STYLES,
} from "../components/AppSectionHeader";
import { useApps } from "../context/AppsContext";
import { AppEntry } from "../types/apps";
import { AppSortMode, sortApps } from "../utils/functions";

import { AppImageDetailView } from "./AppImageDetailView";
import { FlatpakDetailView } from "./FlatpakDetailView";

interface AllAppsViewProps {
  onBack: () => void;
}

export const AllAppsView: React.FC<AllAppsViewProps> = ({ onBack }) => {
  const { t } = useTranslation("all_apps_view");
  const { t: tApps } = useTranslation("apps_view");
  const {
    flatpakApps,
    gearleverApps,
    gearleverInstalled,
    statuses,
    loading,
    backgroundLoading,
    lastCheckedAt,
    updateApp,
    uninstallApp,
    toggleExcluded,
    refresh,
  } = useApps();

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<AppSortMode>("update_first");
  const [collapsedExcluded, setCollapsedExcluded] = useState(true);
  const [collapsedFlatpak, setCollapsedFlatpak] = useState(true);
  const [collapsedGearlever, setCollapsedGearlever] = useState(true);
  const [viewingApp, setViewingApp] = useState<AppEntry | null>(null);

  // A section with a pending update auto-expands once so it's not missed
  // — but only until the user explicitly touches it. Applying that as a
  // permanent override on every render (the previous approach) instead
  // meant the section could never actually be collapsed at all for as
  // long as it kept having an update, since a manual toggle changed the
  // state but the render expression discarded it right back.
  const userToggledFlatpakRef = useRef(false);
  const userToggledGearleverRef = useRef(false);

  const toggleCollapsedFlatpak = () => {
    userToggledFlatpakRef.current = true;
    setCollapsedFlatpak((v) => !v);
  };
  const toggleCollapsedGearlever = () => {
    userToggledGearleverRef.current = true;
    setCollapsedGearlever((v) => !v);
  };

  const searching = search.trim().length > 0;
  const q = search.toLowerCase();
  const all = [...flatpakApps, ...gearleverApps].filter((a) =>
    a.name.toLowerCase().includes(q)
  );

  const excluded = sortApps(all.filter((a) => a.excluded), sortMode);
  const flatpakRest = sortApps(
    all.filter((a) => !a.excluded && a.kind === "flatpak"),
    sortMode
  );
  const gearleverRest = sortApps(
    all.filter((a) => !a.excluded && a.kind === "appimage"),
    sortMode
  );
  const initialLoading = loading && lastCheckedAt === null;
  const flatpakHasUpdate = flatpakRest.some((a) => a.has_update);
  const gearleverHasUpdate = gearleverRest.some(
    (a) => a.has_update || a.needs_update_source
  );

  // Hooks must run unconditionally on every render — computed and
  // registered here, before the early returns below, not further down
  // alongside the rest of the list-derived values they depend on.
  useEffect(() => {
    if (flatpakHasUpdate && !userToggledFlatpakRef.current) setCollapsedFlatpak(false);
  }, [flatpakHasUpdate]);
  useEffect(() => {
    if (gearleverHasUpdate && !userToggledGearleverRef.current) setCollapsedGearlever(false);
  }, [gearleverHasUpdate]);

  if (viewingApp?.kind === "appimage") {
    return (
      <AppImageDetailView
        app={viewingApp}
        onBack={() => setViewingApp(null)}
        onSaved={async () => {
          setViewingApp(null);
          await refresh(true);
        }}
        onUpdate={() => updateApp(viewingApp.id)}
        onUninstall={() => uninstallApp(viewingApp.id)}
        onToggleExclude={() => toggleExcluded(viewingApp.id)}
      />
    );
  }

  if (viewingApp?.kind === "flatpak") {
    return (
      <FlatpakDetailView
        app={viewingApp}
        onBack={() => setViewingApp(null)}
        onUpdate={() => updateApp(viewingApp.id)}
        onUninstall={() => uninstallApp(viewingApp.id)}
        onToggleExclude={() => toggleExcluded(viewingApp.id)}
      />
    );
  }

  return (
    <PanelSectionCustom>
      <style>{APP_SECTION_HEADER_STYLES}</style>

      {backgroundLoading && (
        <div style={{ marginBottom: 8 }}>
          <TopProgressBar />
        </div>
      )}

      <Focusable
        style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: 8 }}
        flow-children="horizontal"
      >
        <ActionButton onClick={onBack}>
          <FiArrowLeft size={16} />
        </ActionButton>
        <span style={{ fontWeight: 600 }}>{t("title")}</span>
      </Focusable>

      <SearchField
        value={search}
        onChange={setSearch}
        size="small"
        highlightOnFocus={false}
        bottomSeparator={false}
        placeholder={t("search")}
        iconEnd={<FaSearch size={12} color="#888" />}
      />

      {
        // Same PanelSection > PanelSectionRow parent as SettingsView's
        // own interval dropdown — the -16px margin cancels out
        // PanelSectionCustom's own left/right padding (this whole view
        // sits inside one, unlike SettingsView's plain div), so the two
        // stay visually identical instead of nesting two paddings.
      }
      <div style={{ marginLeft: -16, marginRight: -16 }}>
        <PanelSection>
          <PanelSectionRow>
            <AnchoredDropdown
              label={t("sort_label")}
              size="small"
              highlightOnFocus={false}
              options={[
                { value: "update_first", label: t("sort_update_first") },
                { value: "alpha_asc", label: t("sort_alpha_asc") },
                { value: "alpha_desc", label: t("sort_alpha_desc") },
              ]}
              selectedValue={sortMode}
              onChange={(v) => setSortMode(v as AppSortMode)}
            />
          </PanelSectionRow>
        </PanelSection>
      </div>

      {initialLoading ? (
        <LoadingIndicator />
      ) : (
        <>
          {excluded.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <AppSectionHeader
                title={t("excluded_section")}
                count={excluded.length}
                collapsed={collapsedExcluded && !searching}
                onToggle={() => setCollapsedExcluded((v) => !v)}
              />
              {!(collapsedExcluded && !searching) &&
                excluded.map((app) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    mode="excluded"
                    collapsible
                    status="idle"
                    onUpdate={() => {}}
                    onToggleExclude={() => toggleExcluded(app.id)}
                  />
                ))}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <AppSectionHeader
              title={tApps("flatpak_section")}
              count={flatpakRest.length}
              collapsed={collapsedFlatpak && !searching}
              onToggle={toggleCollapsedFlatpak}
            />
            {!(collapsedFlatpak && !searching) &&
              flatpakRest.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  mode="list"
                  // Leave a row collapsed (no Update/Exclude row) unless
                  // it actually has something to act on — otherwise
                  // scrolling through a long list lands on a disabled
                  // Update button for every single app, one wasted press
                  // each time.
                  collapsible={!app.has_update}
                  status={statuses[app.id] ?? "idle"}
                  onUpdate={() => updateApp(app.id)}
                  onToggleExclude={() => toggleExcluded(app.id)}
                  onRowPress={() => setViewingApp(app)}
                />
              ))}
            {flatpakRest.length === 0 && (
              <div style={{ fontSize: 12, color: "#9aa1a8" }}>
                {tApps("no_flatpak_apps")}
              </div>
            )}
          </div>

          {gearleverInstalled && (
            <div style={{ marginBottom: 12 }}>
              <AppSectionHeader
                title={tApps("appimage_section")}
                count={gearleverRest.length}
                collapsed={collapsedGearlever && !searching}
                onToggle={toggleCollapsedGearlever}
              />
              {!(collapsedGearlever && !searching) &&
                gearleverRest.map((app) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    mode="list"
                    collapsible={!app.has_update && !app.needs_update_source}
                    status={statuses[app.id] ?? "idle"}
                    onUpdate={() => updateApp(app.id)}
                    onToggleExclude={() => toggleExcluded(app.id)}
                    onRowPress={() => setViewingApp(app)}
                  />
                ))}
              {gearleverRest.length === 0 && (
                <div style={{ fontSize: 12, color: "#9aa1a8" }}>
                  {tApps("no_appimages")}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </PanelSectionCustom>
  );
};
