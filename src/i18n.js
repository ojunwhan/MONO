import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const localeModules = import.meta.glob("./locales/*.json", { eager: true });
const resources = {};
for (const path in localeModules) {
  const lang = path.match(/\.\/locales\/(.+)\.json/)?.[1];
  if (lang) {
    const mod = localeModules[path];
    resources[lang] = { translation: mod.default ?? mod };
  }
}

const SUPPORTED_LANGS = Object.keys(resources);
const normalizeLang = (lng) => {
  const raw = String(lng || "").toLowerCase().split("-")[0];
  if (SUPPORTED_LANGS.includes(raw)) return raw;
  if (raw.startsWith("ko")) return "ko";
  if (raw.startsWith("ja")) return "ja";
  if (raw.startsWith("zh")) return "zh";
  if (raw.startsWith("vi")) return "vi";
  if (raw.startsWith("th")) return "th";
  if (raw.startsWith("ru")) return "ru";
  if (raw.startsWith("ar")) return "ar";
  if (raw.startsWith("fr")) return "fr";
  if (raw.startsWith("es")) return "es";
  return "en";
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGS.length ? SUPPORTED_LANGS : ["en"],
    nonExplicitSupportedLngs: true,
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      convertDetectedLanguage: (lng) => normalizeLang(lng),
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
