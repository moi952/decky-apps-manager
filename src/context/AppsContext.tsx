import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { addEventListener, call, removeEventListener, toaster } from "@decky/api";
import { useTranslation } from "react-i18next";

import {
  AppEntry,
  AppRowStatus,
  AppsListResponse,
  UpdateAppResult,
} from "../types/apps";

interface AppsContextValue {
  flatpakApps: AppEntry[];
  gearleverApps: AppEntry[];
  // null until the first list_apps response comes back — must not be
  // treated as "confirmed not installed" (see GearleverNotice).
  gearleverInstalled: boolean | null;
  loading: boolean;
  backgroundLoading: boolean;
  lastCheckedAt: number | null;
  // ms epoch, like lastCheckedAt — null once nothing is currently
  // rate-limited (either never was, or the reset time has passed).
  githubRateLimitedUntil: number | null;
  statuses: Record<string, AppRowStatus>;
  refresh: (force?: boolean) => Promise<void>;
  updateApp: (id: string) => Promise<boolean>;
  uninstallApp: (id: string) => Promise<boolean>;
  updateAll: () => Promise<void>;
  toggleExcluded: (id: string) => Promise<void>;
  // How long a cached result is trusted before merely opening/returning
  // to the panel is allowed to silently re-verify it in the background
  // (see refresh()'s own note) — 0 means "every time", matching the
  // backend's own get_update_check_interval_minutes default.
  updateCheckIntervalMinutes: number;
  setUpdateCheckIntervalMinutes: (minutes: number) => void;
}

const AppsContext = createContext<AppsContextValue | null>(null);

export const AppsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { t } = useTranslation("apps_view");
  const [flatpakApps, setFlatpakApps] = useState<AppEntry[]>([]);
  const [gearleverApps, setGearleverApps] = useState<AppEntry[]>([]);
  const [gearleverInstalled, setGearleverInstalled] = useState<boolean | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [githubRateLimitedUntil, setGithubRateLimitedUntil] = useState<
    number | null
  >(null);
  const [statuses, setStatuses] = useState<Record<string, AppRowStatus>>({});
  // Backend's own default (apps_service.py's
  // _DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES) until the real stored value
  // comes back, right after mount.
  const [updateCheckIntervalMinutes, setUpdateCheckIntervalMinutesState] = useState(60);

  const setStatus = (id: string, status: AppRowStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  useEffect(() => {
    call<[], number>("get_update_check_interval_minutes").then(
      setUpdateCheckIntervalMinutesState
    );
  }, []);

  const setUpdateCheckIntervalMinutes = useCallback((minutes: number) => {
    setUpdateCheckIntervalMinutesState(minutes);
    call<[number], boolean>("set_update_check_interval_minutes", minutes);
  }, []);

  const applyData = (data: AppsListResponse) => {
    setFlatpakApps(data.flatpak_apps);
    setGearleverApps(data.gearlever_apps);
    setGearleverInstalled(data.gearlever_installed);
    setLastCheckedAt(data.checked_at * 1000);
    setGithubRateLimitedUntil(
      data.github_rate_limited_until ? data.github_rate_limited_until * 1000 : null
    );
  };

  // force=false: instant if the backend already has a cached result (the
  // periodic background check almost always does) — no need to re-run
  // every flatpak/gearlever subprocess just because the panel opened.
  // force=true: always re-checks (manual refresh, after an update).
  const refresh = useCallback(
    async (force = false) => {
      const isFirstLoad = lastCheckedAt === null;
      if (isFirstLoad) setLoading(true);
      else setBackgroundLoading(true);
      try {
        const data = await call<[boolean], AppsListResponse>(
          "list_apps",
          force
        );
        applyData(data);
        // Cached data may already be stale — verify silently in the
        // background instead of leaving it unconfirmed indefinitely.
        // Without updateCheckIntervalMinutes gating this, though, this
        // ran unconditionally every time — the backend's own cache has
        // no TTL of its own, so simply opening the panel (or returning
        // to its home page after the provider re-mounts) re-ran every
        // flatpak/gearlever subprocess, and every GitHub API call an
        // AppImage's version check makes, regardless of how recently the
        // last real check had already happened. 0 means "every time",
        // same as before this existed.
        const checkedAtMs = data.checked_at * 1000;
        const staleEnough =
          updateCheckIntervalMinutes === 0 ||
          Date.now() - checkedAtMs >= updateCheckIntervalMinutes * 60_000;
        if (data.from_cache && !force && staleEnough) {
          setBackgroundLoading(true);
          try {
            const fresh = await call<[boolean], AppsListResponse>(
              "list_apps",
              true
            );
            applyData(fresh);
          } catch {
            // best-effort — the cached data shown a moment ago still stands
          }
        }
      } catch {
        toaster.toast({ title: t("error_title"), body: t("refresh_failed") });
      } finally {
        setLoading(false);
        setBackgroundLoading(false);
      }
    },
    [t, lastCheckedAt, updateCheckIntervalMinutes]
  );

  useEffect(() => {
    refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fired periodically by Plugin._apps_update_check_loop() on the Python
  // side — surfaces even if the user never opens the panel. That loop
  // already just ran its own forced list_apps() and cached the result,
  // so a plain (non-forced) refresh here picks it up instantly instead
  // of re-running every flatpak/gearlever subprocess a second time. This
  // has to live here (inside the provider), not in index.tsx's own
  // top-level addEventListener — that one runs outside the React tree
  // entirely, so it could only ever show the toast, never update this
  // context's own state, which was exactly what left the panel showing
  // "up to date" even while the toast it just fired said otherwise.
  useEffect(() => {
    const listener = addEventListener(
      "apps_update_available",
      (info: { count: number }) => {
        toaster.toast({
          title: t("section_label"),
          body: t("updates_available_toast", { count: info?.count }),
        });
        refresh(false);
      }
    );
    return () => removeEventListener("apps_update_available", listener);
  }, [t, refresh]);

  // Returns whether the app ended up in a good state (updated, or was
  // already current) — callers that navigate away on success (e.g. a
  // detail page returning to its list) need this instead of inferring it
  // from `statuses`, which can be stale in a closure by the time this
  // resolves.
  const updateApp = useCallback(
    async (id: string): Promise<boolean> => {
      setStatus(id, "updating");
      try {
        const result = await call<[string], UpdateAppResult>(
          "update_app",
          id
        );
        if (result === "updated") {
          setStatus(id, "done");
          toaster.toast({ title: t("section_label"), body: t("update_done") });
        } else if (result === "already_up_to_date") {
          setStatus(id, "idle");
          toaster.toast({
            title: t("section_label"),
            body: t("already_up_to_date"),
          });
        } else {
          setStatus(id, "error");
          toaster.toast({ title: t("error_title"), body: t("update_failed") });
        }
        await refresh(false);
        return result !== "error";
      } catch {
        setStatus(id, "error");
        toaster.toast({ title: t("error_title"), body: t("update_failed") });
        return false;
      }
    },
    [refresh, t]
  );

  const uninstallApp = useCallback(
    async (id: string): Promise<boolean> => {
      setStatus(id, "updating");
      try {
        const ok = await call<[string], boolean>("uninstall_app", id);
        if (!ok) {
          setStatus(id, "error");
          toaster.toast({ title: t("error_title"), body: t("uninstall_failed") });
        }
        await refresh(false);
        return ok;
      } catch {
        setStatus(id, "error");
        toaster.toast({ title: t("error_title"), body: t("uninstall_failed") });
        return false;
      }
    },
    [refresh, t]
  );

  const updateAll = useCallback(async () => {
    const ids = [...flatpakApps, ...gearleverApps]
      .filter((a) => a.has_update && !a.excluded)
      .map((a) => a.id);
    ids.forEach((id) => setStatus(id, "updating"));
    try {
      const ok = await call<[], boolean>("update_all_apps");
      if (!ok) {
        toaster.toast({
          title: t("error_title"),
          body: t("update_all_failed"),
        });
      }
      await refresh(false);
    } catch {
      toaster.toast({ title: t("error_title"), body: t("update_all_failed") });
    } finally {
      ids.forEach((id) => setStatus(id, "idle"));
    }
  }, [flatpakApps, gearleverApps, refresh, t]);

  const toggleExcluded = useCallback(
    async (id: string) => {
      const current = await call<[], string[]>("get_excluded_apps");
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      await call<[string[]], boolean>("set_excluded_apps", next);
      // The backend patches exclusion flags on its cache in place — a
      // plain (non-forced) refresh gets that update instantly, no need
      // to re-run every subprocess just to flip one local flag.
      await refresh(false);
    },
    [refresh]
  );

  return (
    <AppsContext.Provider
      value={{
        flatpakApps,
        gearleverApps,
        gearleverInstalled,
        loading,
        backgroundLoading,
        lastCheckedAt,
        githubRateLimitedUntil,
        statuses,
        refresh,
        updateApp,
        uninstallApp,
        updateAll,
        toggleExcluded,
        updateCheckIntervalMinutes,
        setUpdateCheckIntervalMinutes,
      }}
    >
      {children}
    </AppsContext.Provider>
  );
};

export const useApps = () => {
  const ctx = useContext(AppsContext);
  if (!ctx) throw new Error("useApps must be used within AppProvider");
  return ctx;
};
