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
import { FlatpakCatalogRow } from "../components/FlatpakCatalogRow";
import { FlatpakCatalogEntry } from "../types/flatpakCatalog";
import { useApps } from "../context/AppsContext";

import { FlatpakCatalogDetailView } from "./FlatpakCatalogDetailView";
import { FlatpakDetailView } from "./FlatpakDetailView";

interface FlatpakSearchViewProps {
  onBack: () => void;
}

// Debounced so typing doesn't fire a `flatpak search` subprocess on every
// keystroke — only once the query has settled for a moment. `flatpak
// search` isn't a cheap local lookup either: flatpak's own search
// builtin refreshes every configured remote's appstream data first and
// only then searches (see flatpak.py's own search() docstring) — a real
// operation, not a cache read, and 400ms is short enough that a
// gamepad's own on-screen keyboard (whose per-character cadence often
// runs close to or past that) still fired one after nearly every letter.
const SEARCH_DEBOUNCE_MS = 600;
// Below this, a search barely narrows anything down across every
// configured remote — skip firing at all until there's enough to.
const MIN_QUERY_LENGTH = 2;

export const FlatpakSearchView: React.FC<FlatpakSearchViewProps> = ({ onBack }) => {
  const { t } = useTranslation("flatpak_catalog_view");
  const { flatpakApps, updateApp, uninstallApp, toggleExcluded } = useApps();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FlatpakCatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FlatpakCatalogEntry | null>(null);
  const requestIdRef = useRef(0);

  // Also called straight from onInstalled (bypassing the debounce) — the
  // `results` array otherwise keeps holding the pre-install snapshot (with
  // `installed: false` baked into the entry just installed) until the
  // query itself changes, since the effect below only re-fetches then.
  const runSearch = (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setSearching(true);
    call<[string], FlatpakCatalogEntry[]>("search_flatpak_catalog", trimmed).then(
      (found) => {
        // A later keystroke may have already started a newer request — an
        // out-of-order response landing here would otherwise briefly show
        // stale results for the current query.
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
    const installedApp = selected.installed
      ? flatpakApps.find((a) => a.app_id === selected.app_id)
      : undefined;

    if (installedApp) {
      return (
        <FlatpakDetailView
          app={installedApp}
          onBack={() => setSelected(null)}
          onUpdate={() => updateApp(installedApp.id)}
          onUninstall={() => uninstallApp(installedApp.id)}
          onToggleExclude={() => toggleExcluded(installedApp.id)}
        />
      );
    }

    return (
      <FlatpakCatalogDetailView
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
            <FlatpakCatalogRow
              key={entry.app_id}
              entry={entry}
              onPress={() => setSelected(entry)}
            />
          ))
        )}
      </div>
    </PanelSectionCustom>
  );
};
