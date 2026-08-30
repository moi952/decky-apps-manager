export type AppKind = "flatpak" | "appimage";

export interface AppEntry {
  id: string;
  kind: AppKind;
  name: string;
  version: string | null;
  available_version: string | null;
  has_update: boolean;
  excluded: boolean;
  // flatpak only
  app_id?: string;
  scope?: "system" | "user";
  // appimage only
  file_path?: string;
  needs_update_source?: boolean;
  update_manager?: string | null;
  update_manager_config?: Record<string, string | boolean>;
  desktop_id?: string | null;
  running?: boolean | null;
  embedded_source?: boolean;
  // appimage only — set instead of available_version when this app's
  // GitHub-hosted update source couldn't be checked because the
  // anonymous API quota is exhausted. Unix seconds; in the past once
  // the quota has recovered.
  github_rate_limited_until?: number | null;
  // appimage only — the pending update's own release notes/page, when
  // the update source's API provides them (GitHub/GitLab/Codeberg/
  // Forgejo releases). Both null whenever available_version itself is.
  release_notes?: string | null;
  release_url?: string | null;
}

export interface AppsListResponse {
  flatpak_apps: AppEntry[];
  gearlever_apps: AppEntry[];
  gearlever_installed: boolean;
  // Latest reset time across every AppImage hit by the GitHub rate limit
  // this cycle, or null if none were. Unix seconds.
  github_rate_limited_until: number | null;
  checked_at: number; // unix seconds
  from_cache: boolean;
}

export type AppRowStatus = "idle" | "updating" | "done" | "error";

export type UpdateAppResult = "updated" | "already_up_to_date" | "error";
