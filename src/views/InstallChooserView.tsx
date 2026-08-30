import React from "react";
import { Focusable } from "@decky/ui";
import { ActionButton, MediaRow } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft, FiBox, FiPackage } from "react-icons/fi";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { useApps } from "../context/AppsContext";

interface InstallChooserViewProps {
  onBack: () => void;
  onChooseFlatpak: () => void;
  onChooseAppImage: () => void;
}

// The landing page behind the header's shopping-bag icon — Flatpak and
// AppImage each have their own search/install flow (different catalogs,
// different backends), so this just picks which one to open.
export const InstallChooserView: React.FC<InstallChooserViewProps> = ({
  onBack,
  onChooseFlatpak,
  onChooseAppImage,
}) => {
  const { t } = useTranslation("install_chooser_view");
  const { gearleverInstalled } = useApps();
  // null (not checked yet) is treated the same as installed — same rule
  // GearleverNotice follows — so this option isn't wrongly disabled while
  // the first list_apps response is still in flight.
  const appImageAvailable = gearleverInstalled !== false;

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

      <MediaRow
        color="transparent"
        bottomSeparator
        onPress={onChooseFlatpak}
        // A fixed color, not react-icons' own default currentColor —
        // without one, the icon inherits whatever `color` the native
        // DialogButton chrome underneath happens to use on focus (its
        // own default swaps to a dark focus-state color, meant for
        // native text against a white highlight), while MediaRow's own
        // title text stays hardcoded white regardless of focus — the
        // combination read as "icon goes gray/black, text stays white"
        // on focus, an inconsistency the icon's own color has no reason
        // to follow in the first place.
        media={<FiPackage size={18} color="#fff" />}
        title={t("flatpak_title")}
        details={
          <div style={{ fontSize: 11, color: "#9aa1a8" }}>
            {t("flatpak_description")}
          </div>
        }
      />

      <MediaRow
        color="transparent"
        bottomSeparator
        onPress={appImageAvailable ? onChooseAppImage : undefined}
        media={<FiBox size={18} color="#fff" />}
        title={t("appimage_title")}
        details={
          <div style={{ fontSize: 11, color: "#9aa1a8" }}>
            {appImageAvailable
              ? t("appimage_description")
              : t("appimage_requires_gearlever")}
          </div>
        }
      />
    </PanelSectionCustom>
  );
};
