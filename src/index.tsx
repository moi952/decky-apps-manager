import React, { useState } from "react";
import {
  definePlugin,
  addEventListener,
  removeEventListener,
  toaster,
} from "@decky/api";
import i18n from "i18next";
import { Focusable, staticClasses } from "@decky/ui";
import { FiList, FiSettings, FiShoppingBag } from "react-icons/fi";
import { RiShoppingBag3Fill } from "react-icons/ri";
import { ActionButton } from "@moi952/decky-ui-kit";

import {
  usePluginUpdate,
  PluginUpdateBanner,
  WhatsNewBanner,
  OtherPluginsBanner,
  getWhatsNewVersions,
  pluginUpdateFocus,
  otherPluginsFocus,
  featureRequestFocus,
  PluginUpdateInfo,
} from "@moi952/decky-plugin-toolkit";

import { BackHandler } from "./components/BackHandler";
import { AppProvider } from "./context/AppProvider";
import { useApps } from "./context/AppsContext";
import { HomeView } from "./views/HomeView";
import { SettingsView } from "./views/SettingsView";
import { AllAppsView } from "./views/AllAppsView";
import { InstallChooserView } from "./views/InstallChooserView";
import { FlatpakSearchView } from "./views/FlatpakSearchView";
import { AppImageSearchView } from "./views/AppImageSearchView";
import { AppImageDetailView } from "./views/AppImageDetailView";
import { FlatpakDetailView } from "./views/FlatpakDetailView";
import { loadTranslations } from "./i18n";
import projectConfig from "./project.config.json";

type View = "home" | "settings" | "all" | "install" | "install-flatpak" | "install-appimage";

const App: React.FC = () => {
  const [view, setView] = useState<View>("home");
  // Lifted out of HomeView itself, unlike every other view's own detail
  // page: those all nest inside a BackHandler that already has a real
  // onBack (back to "home"), so a press this inner detail view's own
  // BackHandler doesn't fully stop still lands somewhere safe. Home's
  // own wrapping BackHandler below has none at all — on purpose, so B
  // falls through to Decky Loader's own "close the panel" default right
  // at the true top level — which meant a detail view opened from Home
  // had nothing else in the tree to safely catch a press that got past
  // its own BackHandler, and it exited the whole plugin instead of just
  // closing the detail view. Handling it here, under its own BackHandler
  // with a real onBack, matches every other view's own working pattern.
  // Only the id is kept here — the app object itself is looked up fresh
  // from AppsContext's own live arrays on every render (see
  // homeViewingApp below), instead of freezing whatever AppEntry
  // reference was current at the moment the page opened. That snapshot
  // approach silently broke any in-place toggle (exclude, auto-update
  // skip): AppsContext's own state moved on after a refresh(), but this
  // stale object never did, so the open detail page kept showing pre-
  // toggle values indefinitely.
  const [homeViewingId, setHomeViewingId] = useState<string | null>(null);
  const { info: pluginUpdateInfo } = usePluginUpdate();
  const {
    flatpakApps,
    gearleverApps,
    updateApp,
    uninstallApp,
    toggleExcluded,
    toggleAutoUpdateSkip,
    refresh,
  } = useApps();
  const homeViewingApp =
    (homeViewingId &&
      [...flatpakApps, ...gearleverApps].find((a) => a.id === homeViewingId)) ||
    null;

  if (view === "settings")
    return (
      <BackHandler onBack={() => setView("home")}>
        <SettingsView onBack={() => setView("home")} />
      </BackHandler>
    );

  if (view === "all")
    return (
      <BackHandler onBack={() => setView("home")}>
        <AllAppsView onBack={() => setView("home")} />
      </BackHandler>
    );

  if (view === "install")
    return (
      <BackHandler onBack={() => setView("home")}>
        <InstallChooserView
          onBack={() => setView("home")}
          onChooseFlatpak={() => setView("install-flatpak")}
          onChooseAppImage={() => setView("install-appimage")}
        />
      </BackHandler>
    );

  if (view === "install-flatpak")
    return (
      <BackHandler onBack={() => setView("install")}>
        <FlatpakSearchView onBack={() => setView("install")} />
      </BackHandler>
    );

  if (view === "install-appimage")
    return (
      <BackHandler onBack={() => setView("install")}>
        <AppImageSearchView onBack={() => setView("install")} />
      </BackHandler>
    );

  if (homeViewingApp?.kind === "appimage")
    return (
      <BackHandler onBack={() => setHomeViewingId(null)}>
        <AppImageDetailView
          app={homeViewingApp}
          onBack={() => setHomeViewingId(null)}
          onSaved={async () => {
            setHomeViewingId(null);
            await refresh(true);
          }}
          onUpdate={() => updateApp(homeViewingApp.id)}
          onUninstall={() => uninstallApp(homeViewingApp.id)}
          onToggleExclude={() => toggleExcluded(homeViewingApp.id)}
          onToggleAutoUpdateSkip={() => toggleAutoUpdateSkip(homeViewingApp.id)}
        />
      </BackHandler>
    );

  if (homeViewingApp?.kind === "flatpak")
    return (
      <BackHandler onBack={() => setHomeViewingId(null)}>
        <FlatpakDetailView
          app={homeViewingApp}
          onBack={() => setHomeViewingId(null)}
          onUpdate={() => updateApp(homeViewingApp.id)}
          onUninstall={() => uninstallApp(homeViewingApp.id)}
          onToggleExclude={() => toggleExcluded(homeViewingApp.id)}
          onToggleAutoUpdateSkip={() => toggleAutoUpdateSkip(homeViewingApp.id)}
        />
      </BackHandler>
    );

  return (
    <BackHandler>
      <PanelHeader
        onSettings={() => setView("settings")}
        onAllApps={() => setView("all")}
        onInstall={() => setView("install")}
      />
      <PluginUpdateBanner
        info={pluginUpdateInfo}
        onClick={() => {
          pluginUpdateFocus.markExpanded();
          setView("settings");
        }}
      />
      <WhatsNewBanner
        versions={getWhatsNewVersions()}
        onFeatureRequest={() => {
          featureRequestFocus.markExpanded();
          setView("settings");
        }}
      />
      <OtherPluginsBanner
        onOpenSettings={() => {
          otherPluginsFocus.markExpanded();
          setView("settings");
        }}
      />
      <HomeView
        onOpenApp={(app) => setHomeViewingId(app.id)}
        onOpenAllApps={() => setView("all")}
      />
    </BackHandler>
  );
};

const PanelHeader: React.FC<{
  onSettings: () => void;
  onAllApps: () => void;
  onInstall: () => void;
}> = ({ onSettings, onAllApps, onInstall }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      // The plugin's own name used to sit to the left of these icons —
      // removed, Decky's own panel header above already shows it. "Space
      // between" a label and this icon group no longer means anything
      // with just the group left, so this keeps it right-aligned (where
      // it already visually sat) instead of collapsing to flex-start.
      justifyContent: "flex-end",
      padding: "0 16px 8px",
    }}
  >
    <Focusable style={{ display: "flex", gap: 4 }} flow-children="horizontal">
      <ActionButton onClick={onInstall}>
        <FiShoppingBag size={14} />
      </ActionButton>
      <ActionButton onClick={onAllApps}>
        <FiList size={14} />
      </ActionButton>
      <ActionButton onClick={onSettings}>
        <FiSettings size={14} />
      </ActionButton>
    </Focusable>
  </div>
);

export default definePlugin(() => {
  loadTranslations();

  // Fired by Plugin._main() on the Python side (decky_plugin_toolkit's
  // PluginUpdaterMixin) as
  // soon as Decky loads this plugin — not gated behind the user ever
  // opening its panel, unlike the frontend's own on-mount check.
  const updateListener = addEventListener(
    "plugin_update_available",
    (info: PluginUpdateInfo) => {
      toaster.toast({
        title: i18n.t("plugin_update:section_label"),
        body: i18n.t("plugin_update:banner", { version: info?.latest_version }),
      });
    }
  );

  // apps_update_available is handled inside AppsContext itself (see its
  // own note) — that's the only place that can both show the toast and
  // actually refresh the panel's own state, not just this top-level
  // listener (which runs outside the React tree, so it could only ever
  // toast).

  return {
    name: projectConfig.pluginName,
    titleView: (
      <div className={staticClasses.Title}>{projectConfig.displayName}</div>
    ),
    content: (
      <AppProvider>
        <App />
      </AppProvider>
    ),
    icon: <RiShoppingBag3Fill />,
    onDismount() {
      removeEventListener("plugin_update_available", updateListener);
    },
  };
});
