import { toaster } from "@decky/api";
import { AppEntry } from "../types/apps";

export type AppSortMode = "update_first" | "alpha_asc" | "alpha_desc";

// "update_first" (the default everywhere): apps with an update pending
// always float to the top regardless of scroll position, alphabetical
// within each of the two groups otherwise. The other two modes are a
// user-picked override (AllAppsView's own sort control) — plain
// alphabetical order, either direction, with no update-first grouping.
export const sortApps = (
  apps: AppEntry[],
  mode: AppSortMode = "update_first"
): AppEntry[] => {
  const byName = (a: AppEntry, b: AppEntry) => a.name.localeCompare(b.name);
  if (mode === "alpha_asc") return [...apps].sort(byName);
  if (mode === "alpha_desc") return [...apps].sort((a, b) => byName(b, a));
  return [...apps].sort((a, b) => {
    if (a.has_update !== b.has_update) return a.has_update ? -1 : 1;
    return byName(a, b);
  });
};

// Minutes remaining until `untilMs` (an epoch in ms), rounded up so a
// 10-second wait still reads as "1 min" rather than "0 min" — floored at
// 1 since this is only ever called once the caller has already checked
// untilMs is still in the future.
export const minutesUntil = (untilMs: number): number =>
  Math.max(1, Math.ceil((untilMs - Date.now()) / 60_000));

// Every date/time shown anywhere in the plugin goes through one of these
// two — always passed the caller's own resolved i18n.language (which
// already follows the system's, see i18n/translations.ts) rather than
// the JS engine's own implicit default locale, so 12h/24h and date
// order actually match the user's own language instead of a fixed
// fallback (see UpdateAllBar.tsx's original bug report on this).
export const formatTime = (ms: number, locale: string): string =>
  new Date(ms).toLocaleTimeString(locale);

export const formatDateTime = (ms: number, locale: string): string =>
  new Date(ms).toLocaleString(locale);

export const copy = async (text: string) => {
  try {
    const tempInput = document.createElement("input");
    tempInput.value = text;
    tempInput.style.position = "absolute";
    tempInput.style.left = "-9999px";

    document.body.appendChild(tempInput);
    tempInput.focus();
    tempInput.select();

    const success = document.execCommand("copy");

    document.body.removeChild(tempInput);

    if (success) {
      toaster.toast({
        title: "Copied",
        body: text,
      });
    } else {
      throw new Error("execCommand failed");
    }
  } catch (err) {
    toaster.toast({
      title: "Copy Failed",
      body: "Unable to copy to clipboard",
    });
  }
};
