import React from "react";
import { Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { ActionButton, AnchoredDropdown, CollapsibleSection } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft } from "react-icons/fi";

import { WhatsNewCard } from "../components/WhatsNewCard";
import { PluginUpdateSection } from "../components/PluginUpdate";
import { usePluginUpdate } from "../context/PluginUpdateContext";
import { useApps } from "../context/AppsContext";

interface SettingsViewProps {
  onBack: () => void;
}

// 0 means "every time" — no throttling at all, the previous (only)
// behavior. Kept in sync with apps_service.py's own
// _DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES.
const UPDATE_CHECK_INTERVAL_OPTIONS = [0, 30, 60, 120, 240, 360, 720];
const labelKeyFor = (minutes: number) =>
  minutes === 0 ? "update_check_interval_always" : `update_check_interval_${minutes}`;

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const { t: tSettings } = useTranslation("settings_view");
  const [showWhatsNewHistory, setShowWhatsNewHistory] = React.useState(false);
  const [showPluginUpdate, setShowPluginUpdate] = React.useState(false);
  const {
    info: pluginUpdateInfo,
    checking: checkingPluginUpdate,
    checkNow: checkPluginUpdateNow,
  } = usePluginUpdate();
  const { updateCheckIntervalMinutes, setUpdateCheckIntervalMinutes } = useApps();

  return (
    <div>
      <PanelSection>
        <Focusable
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
          flow-children="horizontal"
        >
          <ActionButton onClick={onBack}>
            <FiArrowLeft size={16} />
          </ActionButton>
          <span style={{ fontWeight: 600 }}>{tSettings("settings")}</span>
        </Focusable>
      </PanelSection>

      {
        // One PanelSection, not three — each separate PanelSection
        // carries its own top/bottom spacing, which stacked into a much
        // bigger gap between these rows than the plain separator each
        // one already draws on its own (Field's/CollapsibleSection's own
        // bottomSeparator) — that's enough on its own to divide them.
      }
      <PanelSection>
        <PanelSectionRow>
          <div style={{ marginTop: 8 }}>
            <CollapsibleSection
              label={tSettings("whats_new_history")}
              expanded={showWhatsNewHistory}
              onToggle={() => setShowWhatsNewHistory((v) => !v)}
              // Only meaningful while expanded — a plain separator right
              // under the (now visible) content, same as the one Field's
              // own bottomSeparator already draws above the toggle row.
              contentBottomSeparator
            >
              {
                // Field's own bottomSeparator (drawn right after the
                // toggle row, right before this) sat flush against the
                // card with nothing between them.
              }
              <div style={{ marginTop: 8 }}>
                <WhatsNewCard />
              </div>
            </CollapsibleSection>
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <AnchoredDropdown
            label={tSettings("update_check_interval_label")}
            options={UPDATE_CHECK_INTERVAL_OPTIONS.map((minutes) => ({
              value: String(minutes),
              label: tSettings(labelKeyFor(minutes)),
            }))}
            selectedValue={String(updateCheckIntervalMinutes)}
            onChange={(value) => setUpdateCheckIntervalMinutes(Number(value))}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <PluginUpdateSection
            info={pluginUpdateInfo}
            checking={checkingPluginUpdate}
            expanded={showPluginUpdate}
            onToggle={() => setShowPluginUpdate((v) => !v)}
            onCheckNow={checkPluginUpdateNow}
          />
        </PanelSectionRow>
      </PanelSection>
    </div>
  );
};
