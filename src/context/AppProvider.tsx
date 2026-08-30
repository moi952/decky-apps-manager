import React from "react";

import { WhatsNewProvider } from "./WhatsNewContext";
import { PluginUpdateProvider } from "./PluginUpdateContext";
import { AppsProvider } from "./AppsContext";

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <WhatsNewProvider>
    <PluginUpdateProvider>
      <AppsProvider>{children}</AppsProvider>
    </PluginUpdateProvider>
  </WhatsNewProvider>
);
