import React from "react";
import { Focusable, PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import {
  ActionButton,
  AnchoredDropdown,
  CollapsibleSection,
  QrCodeButton,
} from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiArrowLeft } from "react-icons/fi";

import { WhatsNewCard } from "../components/WhatsNewCard";
import { AutoUpdateHistoryList } from "../components/AutoUpdateHistoryList";
import { PluginUpdateSection } from "../components/PluginUpdate";
import { OtherPluginRow } from "../components/OtherPluginRow";
import { usePluginUpdate } from "../context/PluginUpdateContext";
import { useOtherPlugins } from "../context/OtherPluginsContext";
import {
  markOtherPluginsExpanded,
  isOtherPluginsExpansionFresh,
} from "../utils/otherPluginsFocus";
import { isFeatureRequestFocusFresh } from "../utils/featureRequestFocus";
import { useApps } from "../context/AppsContext";
import { BUG_REPORT_URL, FEATURE_REQUEST_URL, KOFI_URL } from "../utils/links";

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
  const { others: otherPlugins } = useOtherPlugins();
  const [showWhatsNewHistory, setShowWhatsNewHistory] = React.useState(false);
  const [showAutoUpdateHistory, setShowAutoUpdateHistory] = React.useState(false);
  const [showPluginUpdate, setShowPluginUpdate] = React.useState(false);
  const [showOtherPlugins, setShowOtherPluginsState] = React.useState(
    isOtherPluginsExpansionFresh,
  );
  const setShowOtherPlugins = (v: boolean) => {
    if (v) markOtherPluginsExpanded();
    setShowOtherPluginsState(v);
  };
  // Keeps the restore window alive the whole time it's expanded, not just
  // at the moment it was toggled.
  React.useEffect(() => {
    if (!showOtherPlugins) return;
    const heartbeat = setInterval(markOtherPluginsExpanded, 1000);
    return () => clearInterval(heartbeat);
  }, [showOtherPlugins]);
  // True only when this mount restored an already-expanded section (the
  // banner's "Aller aux paramètres" button), never on a normal fresh visit.
  const wasOtherPluginsRestoredExpanded = React.useRef(showOtherPlugins).current;
  const otherPluginsSectionRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!wasOtherPluginsRestoredExpanded) return;
    const focusAndScrollToFirst = () => {
      const container = otherPluginsSectionRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(
        'button:not([disabled]):not([aria-disabled="true"]), [tabindex]:not([disabled]):not([aria-disabled="true"]), a[href]',
      );
      if (!target) return;
      target.focus();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          target.scrollIntoView({ block: "center" });
        });
      });
    };

    focusAndScrollToFirst();
    const retries = [300, 700, 1200].map((delay) =>
      setTimeout(focusAndScrollToFirst, delay),
    );
    return () => retries.forEach(clearTimeout);
  }, [wasOtherPluginsRestoredExpanded]);
  // Same restore-and-land pattern, for the What's New banner's own
  // "Suggest a feature" button — lands right on the real feature-request
  // QR code in the GitHub section below instead of just the top of the
  // page. No expand/collapse involved here (unlike the one above), so
  // just a one-shot scroll+focus on a fresh landing.
  const featureRequestFresh = React.useRef(isFeatureRequestFocusFresh()).current;
  const featureRequestSectionRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!featureRequestFresh) return;
    const focusAndScrollToFirst = () => {
      const container = featureRequestSectionRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(
        'button:not([disabled]):not([aria-disabled="true"]), [tabindex]:not([disabled]):not([aria-disabled="true"]), a[href]',
      );
      if (!target) return;
      target.focus();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          target.scrollIntoView({ block: "center" });
        });
      });
    };

    focusAndScrollToFirst();
    const retries = [300, 700, 1200].map((delay) =>
      setTimeout(focusAndScrollToFirst, delay),
    );
    return () => retries.forEach(clearTimeout);
  }, [featureRequestFresh]);
  const {
    info: pluginUpdateInfo,
    checking: checkingPluginUpdate,
    checkNow: checkPluginUpdateNow,
  } = usePluginUpdate();
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
      </PanelSection>

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

      <PanelSection title={tSettings("github_section_title")}>
        <PanelSectionRow>
          <PluginUpdateSection
            info={pluginUpdateInfo}
            checking={checkingPluginUpdate}
            expanded={showPluginUpdate}
            onToggle={() => setShowPluginUpdate((v) => !v)}
            onCheckNow={checkPluginUpdateNow}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div ref={featureRequestSectionRef}>
            <QrCodeButton
              value={FEATURE_REQUEST_URL}
              label={tSettings("feature_request_button")}
              hint={tSettings("feature_request_hint")}
            />
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <QrCodeButton
            value={BUG_REPORT_URL}
            label={tSettings("bug_report_button")}
            hint={tSettings("bug_report_hint")}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={tSettings("support_section_title")}>
        <PanelSectionRow>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
            {tSettings("kofi_description")}
          </div>
          <QrCodeButton
            value={KOFI_URL}
            label={tSettings("kofi_button")}
            hint={tSettings("kofi_hint")}
          />
        </PanelSectionRow>
        {otherPlugins.length > 0 && (
          <PanelSectionRow>
            <div ref={otherPluginsSectionRef}>
              <CollapsibleSection
                label={tSettings("other_plugins_section_title")}
                expanded={showOtherPlugins}
                onToggle={() => setShowOtherPlugins(!showOtherPlugins)}
              >
                <div style={{ marginTop: 8, marginLeft: 16 }}>
                  {otherPlugins.map((plugin) => (
                    <OtherPluginRow key={plugin.id} plugin={plugin} />
                  ))}
                </div>
              </CollapsibleSection>
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
    </div>
  );
};
