import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import ko from "./locales/ko.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";
import vi from "./locales/vi.json";
import th from "./locales/th.json";
import ru from "./locales/ru.json";
import ar from "./locales/ar.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";

const SUPPORTED_LANGS = ["ko", "en", "ja", "zh", "vi", "th", "ru", "ar", "fr", "es"];
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
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      ja: { translation: ja },
      zh: { translation: zh },
      vi: { translation: vi },
      th: { translation: th },
      ru: { translation: ru },
      ar: { translation: ar },
      fr: { translation: fr },
      es: { translation: es },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGS,
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
