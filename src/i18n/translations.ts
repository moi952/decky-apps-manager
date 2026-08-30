import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "./locales/en-US.json";
import frFR from "./locales/fr-FR.json";

// Add a new locale: drop a src/i18n/locales/xx-XX.json (copy en-US.json and
// translate every value — never remove a key, i18next silently falls back
// to fallbackLng for anything missing), then register it in both maps below.
const resources: Record<string, any> = {
  "en-US": enUS,
  "fr-FR": frFR,
};

// Native language names for display in a language picker.
export const LANGUAGE_NAMES: Record<string, string> = {
  "en-US": "English",
  "fr-FR": "Français",
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
    ns: Object.keys(enUS),
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
