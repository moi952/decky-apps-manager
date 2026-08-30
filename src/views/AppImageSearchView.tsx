import React, { useEffect, useRef, useState } from "react";
import { Focusable } from "@decky/ui";
import { call } from "@decky/api";
import { ActionButton } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FaSearch } from "react-icons/fa";
import { FiArrowLeft } from "react-icons/fi";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { SearchField } from "../components/SearchField";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { AppImageCatalogRow } from "../components/AppImageCatalogRow";
import { AppImageCatalogEntry } from "../types/appimageCatalog";
import { useApps } from "../context/AppsContext";

import { AppImageCatalogDetailView } from "./AppImageCatalogDetailView";
import { AppImageDetailView } from "./AppImageDetailView";

interface AppImageSearchViewProps {
  onBack: () => void;
}

// Debounced so typing doesn't re-search on every keystroke. Long enough
// for a gamepad's own on-screen keyboard, whose per-character cadence
// runs close to (sometimes past) a short debounce — 400ms still fired a
// real search after nearly every letter, each one spawning Gearlever
// itself (see search_appimage_catalog's own note) — not free like the
// feed's own in-memory array filter is on its own.
const SEARCH_DEBOUNCE_MS = 600;
// Below this, a search is nearly always a near-useless single/double
// letter scan against the whole feed — skip firing at all until there's
// enough to actually narrow anything down.
const MIN_QUERY_LENGTH = 2;

export const AppImageSearchView: React.FC<AppImageSearchViewProps> = ({ onBack }) => {
  const { t } = useTranslation("appimage_catalog_view");
  const { gearleverApps, updateApp, uninstallApp, toggleExcluded } = useApps();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AppImageCatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AppImageCatalogEntry | null>(null);
  const requestIdRef = useRef(0);

  // Also called straight from onInstalled (bypassing the debounce) — the
  // `results` array otherwise keeps holding the pre-install snapshot
  // (with `installed: false` baked into the entry just installed) until
  // the query itself changes, since the effect below only re-fetches
  // then. Same pattern FlatpakSearchView's own runSearch uses.
  const runSearch = (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setSearching(true);
    call<[string], AppImageCatalogEntry[]>("search_appimage_catalog", trimmed).then(
      (found) => {
        if (requestId !== requestIdRef.current) return;
        setResults(found);
        setSearching(false);
      }
    );
  };

  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (selected) {
    // Already installed — this is the exact same app the apps list
    // itself would show, so it gets the exact same page (Update/Remove/
    // Exclude and all), not a second, install-only view of it.
    // AppImageHub's catalog has no stable id to match Gearlever's own
    // installed list by (unlike Flatpak's app_id) — a repo match (exact,
    // whenever install() configured GithubUpdater for it) is checked
    // first, same precedence as the backend's own "installed" flag on
    // `selected`; a case-insensitive name match is the fallback for
    // apps installed some other way, since Gearlever's own name for an
    // app (from its embedded desktop entry) doesn't always match the
    // feed's own display name for that same project.
    const installedApp = selected.installed
      ? (selected.repo &&
          gearleverApps.find((a) => {
            const repo = a.update_manager_config?.repo;
            return (
              typeof repo === "string" &&
              repo.trim().toLowerCase() === selected.repo!.trim().toLowerCase()
            );
          })) ||
        gearleverApps.find(
          (a) => a.name.trim().toLowerCase() === selected.name.trim().toLowerCase()
        )
      : undefined;

    if (installedApp) {
      return (
        <AppImageDetailView
          app={installedApp}
          onBack={() => setSelected(null)}
          onSaved={() => setSelected(null)}
          onUpdate={() => updateApp(installedApp.id)}
          onUninstall={() => uninstallApp(installedApp.id)}
          onToggleExclude={() => toggleExcluded(installedApp.id)}
        />
      );
    }

    return (
      <AppImageCatalogDetailView
        entry={selected}
        onBack={() => setSelected(null)}
        onInstalled={() => {
          setSelected(null);
          runSearch(query);
        }}
      />
    );
  }

  return (
    <PanelSectionCustom>
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
        value={query}
        onChange={setQuery}
        size="small"
        highlightOnFocus={false}
        bottomSeparator={false}
        placeholder={t("search_placeholder")}
        iconEnd={<FaSearch size={12} color="#888" />}
      />

      <div style={{ marginTop: 8 }}>
        {searching ? (
          <LoadingIndicator label={t("searching")} />
        ) : query.trim().length < MIN_QUERY_LENGTH ? (
          <div style={{ fontSize: 12, color: "#9aa1a8", padding: "8px 0" }}>
            {t("search_hint")}
          </div>
        ) : results.length === 0 ? (
          <div style={{ fontSize: 12, color: "#9aa1a8", padding: "8px 0" }}>
            {t("no_results")}
          </div>
        ) : (
          results.map((entry) => (
            <AppImageCatalogRow
              key={entry.name + entry.download_url}
              entry={entry}
              onPress={() => setSelected(entry)}
            />
          ))
        )}
      </div>
    </PanelSectionCustom>
  );
};
