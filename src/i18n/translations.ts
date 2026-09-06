import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { pluginToolkitTranslations } from "@moi952/decky-plugin-toolkit";

import enUS from "./locales/en-US.json";
import frFR from "./locales/fr-FR.json";
import deDE from "./locales/de-DE.json";
import esES from "./locales/es-ES.json";
import itIT from "./locales/it-IT.json";
import jaJP from "./locales/ja-JP.json";
import koKR from "./locales/ko-KR.json";
import nlNL from "./locales/nl-NL.json";
import plPL from "./locales/pl-PL.json";
import ptBR from "./locales/pt-BR.json";
import ptPT from "./locales/pt-PT.json";
import ruRU from "./locales/ru-RU.json";
import trTR from "./locales/tr-TR.json";
import ukUA from "./locales/uk-UA.json";
import zhCN from "./locales/zh-CN.json";

// The toolkit's own namespaces (plugin_update/other_plugins/settings_common,
// and whats_new's own fixed strings) merged in first — this plugin's own
// locale files only ever add to them (its own "whats_new" changelog
// entries), never duplicate them. whats_new needs its own nested merge: a
// shallow spread would let this plugin's own `whats_new` key (its own
// version entries) silently replace the toolkit's older/newer/support_note
// instead of adding to them.
const mergeLocale = (toolkit: any, own: any) => ({
  ...toolkit,
  ...own,
  whats_new: { ...toolkit.whats_new, ...own.whats_new },
});

// This plugin only has its own translations for en-US/fr-FR — but the
// toolkit ships 15 locales, so every one of those still needs registering
// here, or i18next would never know e.g. "de-DE" is a real option and
// would silently fall back to English even for the toolkit's own
// (already-translated) strings. Add a new locale: drop a
// src/i18n/locales/xx-XX.json (copy en-US.json and translate every value),
// then register it in ownByLocale and LANGUAGE_NAMES below.
const ownByLocale: Record<string, any> = {
  "en-US": enUS,
  "fr-FR": frFR,
  "de-DE": deDE,
  "es-ES": esES,
  "it-IT": itIT,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "nl-NL": nlNL,
  "pl-PL": plPL,
  "pt-BR": ptBR,
  "pt-PT": ptPT,
  "ru-RU": ruRU,
  "tr-TR": trTR,
  "uk-UA": ukUA,
  "zh-CN": zhCN,
};

const resources: Record<string, any> = Object.fromEntries(
  Object.entries(pluginToolkitTranslations).map(([locale, toolkit]) => [
    locale,
    mergeLocale(toolkit, ownByLocale[locale] ?? {}),
  ]),
);

// Native language names for display in a language picker.
export const LANGUAGE_NAMES: Record<string, string> = {
  "en-US": "English",
  "fr-FR": "Français",
  "de-DE": "Deutsch",
  "es-ES": "Español",
  "it-IT": "Italiano",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
  "nl-NL": "Nederlands",
  "pl-PL": "Polski",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  "ru-RU": "Русский",
  "tr-TR": "Türkçe",
  "uk-UA": "Українська",
  "zh-CN": "简体中文",
};

export const loadTranslations = (savedLanguage?: string) => {
  // Use saved language if provided, otherwise use browser language.
  const initialLanguage =
    savedLanguage && savedLanguage !== "auto"
      ? savedLanguage
      : navigator.language;

  i18n.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: {
      fr: ["fr-FR"],
      en: ["en-US"],
      default: ["en-US"],
    },
    load: "languageOnly",
    defaultNS: "common",
    ns: Object.keys(resources["en-US"]),
    interpolation: { escapeValue: false },
  });
};

// Change language at runtime.
export const changeLanguage = async (langCode: string): Promise<void> => {
  await i18n.changeLanguage(langCode);
};

// Get list of supported language codes.
export const getSupportedLanguages = (): string[] => {
  return Object.keys(resources);
};

// Get current language.
export const getCurrentLanguage = (): string => {
  return i18n.language || "en-US";
};
