import React, { useEffect, useState } from "react";
import { Focusable, Navigation, PanelSectionRow, ToggleField } from "@decky/ui";
import { call, toaster } from "@decky/api";
import {
  ActionButton,
  AnchoredDropdown,
  FieldTextInput,
  InfoTable,
  InfoTableRow,
  StatusCard,
} from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import {
  FiArrowLeft,
  FiCheckCircle,
  FiClock,
  FiEye,
  FiEyeOff,
  FiFile,
  FiFileText,
  FiPlay,
  FiSettings,
  FiTag,
  FiTrash2,
  FiUpload,
} from "react-icons/fi";
import { FaGithub } from "react-icons/fa";

import PanelSectionCustom from "../components/PanelSectionCustom";
import { BackHandler } from "../components/BackHandler";
import { InlineConfirm } from "../components/InlineConfirm";
import { TopProgressBar } from "../components/TopProgressBar";
import { getCachedIcon, setCachedIcon } from "../utils/iconCache";
import { minutesUntil } from "../utils/functions";
import { AppEntry } from "../types/apps";

interface ManagerField {
  key: string;
  // A key into the update_source_view namespace, resolved with t() at
  // render time — this whole array is a module-level constant (outside
  // any component), so it can't call the translation hook itself.
  labelKey: string;
  boolean?: boolean;
}

interface ManagerDef {
  value: string;
  // Not translated on purpose — GitHub/GitLab/Codeberg/Forgejo are
  // proper service names, not description text.
  label: string;
  fields: ManagerField[];
}

// One definition per Gearlever update manager — shared by both the
// "edit an existing source" and "set one up from scratch" cases (the
// same form serves both: it's only the initial values that differ).
const MANAGERS: ManagerDef[] = [
  {
    value: "GithubUpdater",
    label: "GitHub",
    fields: [
      { key: "allow_prereleases", labelKey: "allow_prereleases", boolean: true },
      { key: "repo", labelKey: "field_repo" },
      { key: "repo_filename", labelKey: "field_repo_filename" },
    ],
  },
  {
    value: "GitlabUpdater",
    label: "GitLab",
    fields: [
      { key: "repo_url", labelKey: "field_repo_url" },
      { key: "repo_filename", labelKey: "field_repo_filename" },
    ],
  },
  {
    value: "CodebergUpdater",
    label: "Codeberg",
    fields: [
      { key: "repo_url", labelKey: "field_repo_url" },
      { key: "repo_filename", labelKey: "field_repo_filename" },
    ],
  },
  {
    value: "ForgejoUpdater",
    label: "Forgejo",
    fields: [
      { key: "allow_prereleases", labelKey: "allow_prereleases", boolean: true },
      { key: "repo_url", labelKey: "field_repo_url" },
      { key: "repo_filename", labelKey: "field_repo_filename" },
    ],
  },
  {
    value: "StaticFileUpdater",
    label: "Static URL",
    fields: [{ key: "url", labelKey: "field_url" }],
  },
];

interface AppImageDetailViewProps {
  app: AppEntry;
  onBack: () => void;
  onSaved: () => void;
  // Both return whether the operation actually succeeded — same
  // busy/result pattern as FlatpakDetailView, for the same reason: the
  // caller's own `statuses` map can flip well before its list has
  // actually refreshed, which is what made the button flash back before.
  onUpdate: () => Promise<boolean>;
  onUninstall: () => Promise<boolean>;
  onToggleExclude: () => void;
}

type Busy = "updating" | "removing" | null;
type Result = { kind: "update" | "remove"; ok: boolean } | null;

// Long enough to actually read the success message before this page
// closes itself and returns to the (now-refreshed) list.
const SUCCESS_AUTOCLOSE_MS = 1500;

const fieldValuesFor = (
  manager: ManagerDef,
  config: Record<string, string | boolean>
): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const f of manager.fields) {
    const raw = config[f.key];
    values[f.key] = raw !== undefined ? String(raw) : f.boolean ? "false" : "";
  }
  return values;
};

export const AppImageDetailView: React.FC<AppImageDetailViewProps> = ({
  app,
  onBack,
  onSaved,
  onUpdate,
  onUninstall,
  onToggleExclude,
}) => {
  const { t } = useTranslation("update_source_view");
  const { t: tApps } = useTranslation("apps_view");
  const manager = app.update_manager ?? "";
  const config = app.update_manager_config ?? {};
  const currentManagerLabel = MANAGERS.find((m) => m.value === manager)?.label;

  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<Result>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // The config editor is collapsed until explicitly opened — the app's
  // own info/Update/Remove are always front and center, editing the
  // update source is a deliberate extra step so pressing the row never
  // risks accidentally changing it.
  const [editingConfig, setEditingConfig] = useState(false);
  const [managerIndex, setManagerIndex] = useState(
    Math.max(0, MANAGERS.findIndex((m) => m.value === manager))
  );
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const selectedManager = MANAGERS[managerIndex];

  useEffect(() => {
    const cached = getCachedIcon(app.id);
    if (cached !== undefined) {
      if (cached) setIcon(cached);
      return;
    }
    call<[string], string>("get_app_icon", app.id).then((url) => {
      setCachedIcon(app.id, url);
      if (url) setIcon(url);
    });
  }, [app.id]);

  const openEditConfig = () => {
    const idx = Math.max(0, MANAGERS.findIndex((m) => m.value === manager));
    setManagerIndex(idx);
    setFieldValues(fieldValuesFor(MANAGERS[idx], config));
    setEditingConfig(true);
  };

  const setField = (key: string, value: string) =>
    setFieldValues((prev) => ({ ...prev, [key]: value }));

  const runUpdate = async () => {
    setResult(null);
    setBusy("updating");
    const ok = await onUpdate();
    setBusy(null);
    setResult({ kind: "update", ok });
    if (ok) setTimeout(onBack, SUCCESS_AUTOCLOSE_MS);
  };

  const runUninstall = async () => {
    setConfirmingRemove(false);
    setResult(null);
    setBusy("removing");
    const ok = await onUninstall();
    setBusy(null);
    setResult({ kind: "remove", ok });
    if (ok) setTimeout(onBack, SUCCESS_AUTOCLOSE_MS);
  };

  const onViewRelease = () => {
    if (app.release_url) Navigation.NavigateToExternalWeb(app.release_url);
  };

  const githubUrl =
    manager === "GithubUpdater" && config.repo
      ? `https://github.com/${config.repo}`
      : null;
  const onViewGithub = () => {
    if (githubUrl) Navigation.NavigateToExternalWeb(githubUrl);
  };

  const save = async () => {
    if (!app.file_path) return;
    setSaving(true);
    try {
      const nextConfig: Record<string, string> = {};
      for (const f of selectedManager.fields) {
        nextConfig[f.key] = fieldValues[f.key] ?? (f.boolean ? "false" : "");
      }
      const ok = await call<[string, string, Record<string, string>], boolean>(
        "set_gearlever_update_source",
        app.file_path,
        selectedManager.value,
        nextConfig
      );
      if (ok) {
        toaster.toast({ title: app.name, body: t("saved") });
        setEditingConfig(false);
        // Something about the source changed — recheck this app for
        // updates rather than leaving the pre-change state on screen.
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  // Backend sends this in seconds (GitHub's own convention); everywhere
  // else in the frontend (lastCheckedAt, minutesUntil) works in ms.
  const rateLimitedUntilMs = app.github_rate_limited_until
    ? app.github_rate_limited_until * 1000
    : null;

  const infoRows: InfoTableRow[] = [
    { icon: <FiTag size={13} />, label: t("info_version"), value: app.version ?? "—" },
    ...(app.has_update
      ? [
          {
            icon: <FiUpload size={13} />,
            label: t("info_available_version"),
            // A same-looking version can still mean "an update exists" —
            // e.g. the update source republished the same tag with a
            // rebuilt asset — so a value that matches the current version
            // is shown as a neutral "update available" instead of
            // repeating the same number (see AppRow.tsx's own note).
            value:
              app.available_version && app.available_version !== app.version
                ? app.available_version
                : t("update_available"),
            accent: "#4caf50",
          },
        ]
      : []),
    {
      icon: <FiCheckCircle size={13} />,
      label: t("info_source"),
      // The actual configured source (repo, repo URL, or static URL) —
      // not a generic "custom" placeholder, which told the user nothing
      // they didn't already know from the manager name above.
      value: app.embedded_source
        ? t("info_source_embedded")
        : manager
          ? [currentManagerLabel, config.repo || config.repo_url || config.url]
              .filter(Boolean)
              .join(" — ")
          : t("info_source_none"),
    },
    ...(app.running != null
      ? [
          {
            icon: <FiPlay size={13} />,
            label: t("info_running"),
            value: app.running ? t("yes") : t("no"),
          },
        ]
      : []),
    ...(app.desktop_id
      ? [
          {
            icon: <FiFileText size={13} />,
            label: t("info_desktop_file"),
            value: app.desktop_id,
          },
        ]
      : []),
    { icon: <FiFile size={13} />, label: t("info_file_path"), value: app.file_path ?? "—" },
  ];

  return (
    <BackHandler onBack={onBack}>
      <PanelSectionCustom>
        <Focusable style={{ display: "flex" }} flow-children="horizontal">
          <ActionButton onClick={onBack}>
            <FiArrowLeft size={16} />
          </ActionButton>
        </Focusable>

        {icon && (
          <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
            <img
              src={icon}
              alt=""
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
          </div>
        )}

        <div
          style={{ marginTop: 8, fontWeight: 600, fontSize: 14, textAlign: "center" }}
        >
          {app.name}
        </div>
        <div style={{ fontSize: 10, color: "#9aa1a8", textAlign: "center" }}>
          {currentManagerLabel ?? t("not_configured")}
        </div>

        <div style={{ marginTop: 16 }}>
          <InfoTable rows={infoRows} />
        </div>

        {githubUrl && (
          <div style={{ marginTop: 8 }}>
            <ActionButton width="100%" onClick={onViewGithub}>
              <FaGithub size={14} style={{ marginRight: 6 }} />
              {t("view_github")}
            </ActionButton>
          </div>
        )}

        {app.has_update && app.release_notes && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
              {t("release_notes_title")}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#9aa1a8",
                whiteSpace: "pre-wrap",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 6,
                WebkitBoxOrient: "vertical" as const,
              }}
            >
              {app.release_notes}
            </div>
            {app.release_url && (
              <div style={{ marginTop: 8 }}>
                <ActionButton width="100%" onClick={onViewRelease}>
                  {t("view_release")}
                </ActionButton>
              </div>
            )}
          </div>
        )}

        {editingConfig ? (
          <>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "#9aa1a8", marginBottom: 4 }}>
                {t("manager_label")}
              </div>
              <AnchoredDropdown
                variant="boxed"
                size="small"
                options={MANAGERS.map((m) => ({ value: m.value, label: m.label }))}
                selectedValue={selectedManager.value}
                onChange={(value) => {
                  const idx = Math.max(0, MANAGERS.findIndex((m) => m.value === value));
                  setManagerIndex(idx);
                  setFieldValues(fieldValuesFor(MANAGERS[idx], {}));
                }}
              />
            </div>

            <div style={{ marginTop: 8 }}>
              {selectedManager.fields.map((f) =>
                f.boolean ? (
                  <PanelSectionRow key={f.key}>
                    <ToggleField
                      label={t(f.labelKey)}
                      checked={fieldValues[f.key] === "true"}
                      onChange={(v) => setField(f.key, v ? "true" : "false")}
                    />
                  </PanelSectionRow>
                ) : (
                  <PanelSectionRow key={f.key}>
                    <FieldTextInput
                      label={t(f.labelKey)}
                      size="small"
                      labelPosition="top"
                      value={fieldValues[f.key] ?? ""}
                      onChange={(value) => setField(f.key, value)}
                    />
                  </PanelSectionRow>
                )
              )}
            </div>

            <Focusable
              style={{ display: "flex", gap: 8, width: "100%", marginTop: 16 }}
              flow-children="horizontal"
            >
              <div style={{ flex: 1 }}>
                <ActionButton width="100%" onClick={save} disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </ActionButton>
              </div>
              <ActionButton onClick={() => setEditingConfig(false)} disabled={saving}>
                {t("cancel")}
              </ActionButton>
            </Focusable>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            <ActionButton width="100%" onClick={openEditConfig} disabled={!!busy}>
              <FiSettings size={14} style={{ marginRight: 6 }} />
              {manager ? t("edit_source") : t("configure_source")}
            </ActionButton>
          </div>
        )}

        {rateLimitedUntilMs && rateLimitedUntilMs > Date.now() && (
          <div style={{ marginTop: 12 }}>
            <StatusCard
              variant="error"
              icon={<FiClock />}
              title={t("github_rate_limit_title")}
              description={t("github_rate_limit_description", {
                minutes: minutesUntil(rateLimitedUntilMs),
              })}
            />
          </div>
        )}

        {/* Gearlever's own CLI only prints real %/speed to a real
            terminal, not to the pipe this backend necessarily reads
            from — an indeterminate bar is the honest option, the button
            label already says what's going on. */}
        {busy && (
          <div style={{ marginTop: 16 }}>
            <TopProgressBar />
          </div>
        )}

        {confirmingRemove ? (
          <div style={{ marginTop: 16 }}>
            <InlineConfirm
              description={t("remove_confirm_description", { name: app.name })}
              confirmLabel={t("remove")}
              variant="danger"
              onCancel={() => setConfirmingRemove(false)}
              onConfirm={runUninstall}
            />
          </div>
        ) : (
          !editingConfig && (
            <Focusable
              style={{ display: "flex", gap: 8, width: "100%", marginTop: 16 }}
              flow-children="horizontal"
            >
              <div style={{ flex: 1 }}>
                <ActionButton
                  width="100%"
                  disabled={!app.has_update || !!busy || saving}
                  onClick={runUpdate}
                >
                  {busy === "updating"
                    ? tApps("updating")
                    : app.has_update
                      ? tApps("update")
                      : tApps("already_up_to_date")}
                </ActionButton>
              </div>
              <ActionButton onClick={onToggleExclude} disabled={!!busy || saving}>
                {app.excluded ? <FiEye size={14} /> : <FiEyeOff size={14} />}
              </ActionButton>
              <ActionButton
                variant="danger"
                disabled={!!busy || saving}
                onClick={() => setConfirmingRemove(true)}
              >
                {busy === "removing" ? t("removing") : <FiTrash2 size={14} />}
              </ActionButton>
            </Focusable>
          )
        )}

        {result && (
          <div style={{ marginTop: 12 }}>
            {result.ok ? (
              <StatusCard
                variant="success"
                title={
                  result.kind === "update"
                    ? t("update_success_title")
                    : t("remove_success_title")
                }
              />
            ) : (
              <StatusCard
                variant="error"
                title={
                  result.kind === "update"
                    ? t("update_error_title")
                    : t("remove_error_title")
                }
                description={
                  result.kind === "update"
                    ? t("update_error_description")
                    : t("remove_error_description")
                }
              />
            )}
          </div>
        )}
      </PanelSectionCustom>
    </BackHandler>
  );
};
