import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import ko from "./locales/ko.json";
import en from "./locales/en.json";

const normalizeLang = (lng) => {
  const raw = String(lng || "").toLowerCase();
  if (raw.startsWith("ko")) return "ko";
  return "en";
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
    },
    fallbackLng: "en",
    supportedLngs: ["ko", "en"],
    nonExplicitSupportedLngs: true,
    detection: {
      order: ["navigator", "localStorage", "htmlTag"],
      caches: ["localStorage"],
      convertDetectedLanguage: (lng) => normalizeLang(lng),
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
