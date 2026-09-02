import React from "react";

import { WhatsNewProvider } from "./WhatsNewContext";
import { OtherPluginsProvider } from "./OtherPluginsContext";
import { PluginUpdateProvider } from "./PluginUpdateContext";
import { AppsProvider } from "./AppsContext";

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <WhatsNewProvider>
    <OtherPluginsProvider>
      <PluginUpdateProvider>
        <AppsProvider>{children}</AppsProvider>
      </PluginUpdateProvider>
    </OtherPluginsProvider>
  </WhatsNewProvider>
);
