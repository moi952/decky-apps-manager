import React from "react";
import { Focusable, PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import { ActionButton, AnchoredDropdown, CollapsibleSection } from "@moi952/decky-ui-kit";
import { UpdateHistorySection, GitHubSection, SupportSection, getWhatsNewVersions } from "@moi952/decky-plugin-toolkit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft } from "react-icons/fi";

import { AutoUpdateHistoryList } from "../components/AutoUpdateHistoryList";
import { useApps } from "../context/AppsContext";
import { fetchPluginReleases } from "../utils/githubReleases";
import { BUG_REPORT_URL, FEATURE_REQUEST_URL } from "../utils/links";

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
  const [showAutoUpdateHistory, setShowAutoUpdateHistory] = React.useState(false);
  const {
    updateCheckIntervalMinutes,
    setUpdateCheckIntervalMinutes,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    autoUpdateIntervalMinutes,
    setAutoUpdateIntervalMinutes,
    showUpdateToasts,
    setShowUpdateToasts,
  } = useApps();

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

      <UpdateHistorySection versions={getWhatsNewVersions()} />

      <PanelSection title={tSettings("update_check_section_title")}>
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
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            {tSettings("update_check_interval_description")}
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={tSettings("auto_update_section_title")}>
        <PanelSectionRow>
          <ToggleField
            label={tSettings("auto_update_label")}
            description={tSettings("auto_update_description")}
            checked={autoUpdateEnabled}
            onChange={setAutoUpdateEnabled}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <AnchoredDropdown
            label={tSettings("auto_update_interval_label")}
            options={UPDATE_CHECK_INTERVAL_OPTIONS.map((minutes) => ({
              value: String(minutes),
              label: tSettings(labelKeyFor(minutes)),
            }))}
            selectedValue={String(autoUpdateIntervalMinutes)}
            onChange={(value) => setAutoUpdateIntervalMinutes(Number(value))}
          />
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            {tSettings("auto_update_interval_description")}
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <ToggleField
            label={tSettings("update_toast_label")}
            description={tSettings("update_toast_description")}
            checked={showUpdateToasts}
            onChange={setShowUpdateToasts}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <CollapsibleSection
            label={tSettings("auto_update_history_label")}
            expanded={showAutoUpdateHistory}
            onToggle={() => setShowAutoUpdateHistory((v) => !v)}
            contentBottomSeparator
          >
            <div style={{ marginTop: 8 }}>
              <AutoUpdateHistoryList />
            </div>
          </CollapsibleSection>
        </PanelSectionRow>
      </PanelSection>

      <GitHubSection
        fetchReleases={fetchPluginReleases}
        featureRequestUrl={FEATURE_REQUEST_URL}
        bugReportUrl={BUG_REPORT_URL}
      />
      <SupportSection />
    </div>
  );
};
