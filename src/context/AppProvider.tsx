import React from "react";
import { WhatsNewProvider, OtherPluginsProvider, PluginUpdateProvider } from "@moi952/decky-plugin-toolkit";

import { SELF_PLUGIN_ID } from "../utils/otherPlugins";
import { CURRENT_VERSION } from "../utils/githubReleases";

import { AppsProvider } from "./AppsContext";

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <WhatsNewProvider currentVersion={CURRENT_VERSION}>
    <OtherPluginsProvider selfPluginId={SELF_PLUGIN_ID}>
      <PluginUpdateProvider>
        <AppsProvider>{children}</AppsProvider>
      </PluginUpdateProvider>
    </OtherPluginsProvider>
  </WhatsNewProvider>
);
