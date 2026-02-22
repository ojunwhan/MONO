const LABEL_MAP = {
  ko: "KOR", vi: "VNM", zh: "CHN", en: "ENG", ja: "JPN",
  th: "THA", km: "KHM", my: "MMR", id: "IDN", mn: "MNG",
  uz: "UZB", ne: "NPL", tl: "PHL", ms: "MYS", lo: "LAO",
  bn: "BGD", hi: "IND", ur: "PAK", ru: "RUS", uk: "UKR",
  ar: "ARA", tr: "TUR", de: "DEU", fr: "FRA", es: "ESP",
  pt: "PRT", it: "ITA", nl: "NLD", pl: "POL", el: "GRC",
  sv: "SWE", da: "DNK", fi: "FIN", hu: "HUN", ro: "ROU",
  cs: "CZE", sk: "SVK", bg: "BGR", hr: "HRV", sr: "SRB",
  sw: "SWA", am: "ETH", fa: "IRN", he: "ISR", ka: "GEO",
  hy: "ARM", az: "AZE", kk: "KAZ", ky: "KGZ", tg: "TJK",
  tk: "TKM", ps: "AFG", ta: "TAM", si: "SIN", ku: "KUR",
  et: "EST", lv: "LVA", lt: "LTU", nb: "NOR", zu: "ZUL",
  ha: "HAU", yo: "YOR", so: "SOM",
};

const COUNTRY_MAP = {
  ko: "kr", vi: "vn", zh: "cn", en: "us", ja: "jp",
  th: "th", km: "kh", my: "mm", id: "id", mn: "mn",
  uz: "uz", ne: "np", tl: "ph", ms: "my", lo: "la",
  bn: "bd", hi: "in", ur: "pk", ta: "lk", si: "lk",
  ka: "ge", hy: "am", az: "az", kk: "kz", ky: "kg",
  tk: "tm", tg: "tj", ps: "af", fa: "ir", ar: "sa",
  he: "il", tr: "tr", ku: "iq", ru: "ru", uk: "ua",
  pl: "pl", cs: "cz", sk: "sk", hu: "hu", ro: "ro",
  bg: "bg", hr: "hr", sr: "rs", el: "gr", de: "de",
  fr: "fr", es: "es", pt: "pt", it: "it", nl: "nl",
  da: "dk", sv: "se", nb: "no", fi: "fi", et: "ee",
  lv: "lv", lt: "lt", sw: "ke", am: "et", zu: "za",
  ha: "ng", yo: "ng", so: "so",
};

export const LANGUAGE_PROFILES = [
  // Korea + SEA/East Asia
  { code: "ko", name: "Korean", startLabel: "시작", otherText: "다른 언어 →" },
  { code: "vi", name: "Vietnamese", startLabel: "Bắt đầu", otherText: "Ngôn ngữ khác →" },
  { code: "zh", name: "Chinese", startLabel: "开始", otherText: "其他语言 →" },
  { code: "en", name: "English", startLabel: "Start", otherText: "Other language →" },
  { code: "ja", name: "Japanese", startLabel: "スタート", otherText: "他の言語 →" },
  { code: "th", name: "Thai", startLabel: "เริ่ม", otherText: "ภาษาอื่น →" },
  { code: "km", name: "Khmer", startLabel: "ចាប់ផ្តើម", otherText: "ភាសាផ្សេង →" },
  { code: "my", name: "Myanmar", startLabel: "စတင်ပါ", otherText: "အခြားဘာသာ →" },
  { code: "id", name: "Indonesian", startLabel: "Mulai", otherText: "Bahasa lain →" },
  { code: "ms", name: "Malay", startLabel: "Start", otherText: "Other language →" },
  { code: "tl", name: "Filipino", startLabel: "Start", otherText: "Other language →" },
  { code: "lo", name: "Lao", startLabel: "Start", otherText: "Other language →" },

  // Central Asia
  { code: "mn", name: "Mongolian", startLabel: "Эхлэх", otherText: "Өөр хэл →" },
  { code: "uz", name: "Uzbek", startLabel: "Boshlash", otherText: "Boshqa til →" },
  { code: "kk", name: "Kazakh", startLabel: "Start", otherText: "Other language →" },
  { code: "ky", name: "Kyrgyz", startLabel: "Start", otherText: "Other language →" },
  { code: "tg", name: "Tajik", startLabel: "Start", otherText: "Other language →" },
  { code: "tk", name: "Turkmen", startLabel: "Start", otherText: "Other language →" },

  // South Asia
  { code: "ne", name: "Nepali", startLabel: "सुरु", otherText: "अर्को भाषा →" },
  { code: "bn", name: "Bengali", startLabel: "Start", otherText: "Other language →" },
  { code: "hi", name: "Hindi", startLabel: "Start", otherText: "Other language →" },
  { code: "ur", name: "Urdu", startLabel: "Start", otherText: "Other language →" },
  { code: "ta", name: "Tamil", startLabel: "Start", otherText: "Other language →" },
  { code: "si", name: "Sinhala", startLabel: "Start", otherText: "Other language →" },

  // West Asia / Middle East
  { code: "ar", name: "Arabic", startLabel: "Start", otherText: "Other language →" },
  { code: "fa", name: "Persian", startLabel: "Start", otherText: "Other language →" },
  { code: "tr", name: "Turkish", startLabel: "Start", otherText: "Other language →" },
  { code: "he", name: "Hebrew", startLabel: "Start", otherText: "Other language →" },
  { code: "ku", name: "Kurdish", startLabel: "Start", otherText: "Other language →" },
  { code: "ps", name: "Pashto", startLabel: "Start", otherText: "Other language →" },

  // Caucasus
  { code: "ka", name: "Georgian", startLabel: "Start", otherText: "Other language →" },
  { code: "hy", name: "Armenian", startLabel: "Start", otherText: "Other language →" },
  { code: "az", name: "Azerbaijani", startLabel: "Start", otherText: "Other language →" },

  // Europe
  { code: "ru", name: "Russian", startLabel: "Start", otherText: "Other language →" },
  { code: "uk", name: "Ukrainian", startLabel: "Start", otherText: "Other language →" },
  { code: "de", name: "German", startLabel: "Start", otherText: "Other language →" },
  { code: "fr", name: "French", startLabel: "Start", otherText: "Other language →" },
  { code: "es", name: "Spanish", startLabel: "Start", otherText: "Other language →" },
  { code: "pt", name: "Portuguese", startLabel: "Start", otherText: "Other language →" },
  { code: "it", name: "Italian", startLabel: "Start", otherText: "Other language →" },
  { code: "nl", name: "Dutch", startLabel: "Start", otherText: "Other language →" },
  { code: "pl", name: "Polish", startLabel: "Start", otherText: "Other language →" },
  { code: "el", name: "Greek", startLabel: "Start", otherText: "Other language →" },
  { code: "ro", name: "Romanian", startLabel: "Start", otherText: "Other language →" },
  { code: "hu", name: "Hungarian", startLabel: "Start", otherText: "Other language →" },
  { code: "cs", name: "Czech", startLabel: "Start", otherText: "Other language →" },
  { code: "sk", name: "Slovak", startLabel: "Start", otherText: "Other language →" },
  { code: "bg", name: "Bulgarian", startLabel: "Start", otherText: "Other language →" },
  { code: "hr", name: "Croatian", startLabel: "Start", otherText: "Other language →" },
  { code: "sr", name: "Serbian", startLabel: "Start", otherText: "Other language →" },

  // Nordics + Baltics
  { code: "sv", name: "Swedish", startLabel: "Start", otherText: "Other language →" },
  { code: "da", name: "Danish", startLabel: "Start", otherText: "Other language →" },
  { code: "nb", name: "Norwegian", startLabel: "Start", otherText: "Other language →" },
  { code: "fi", name: "Finnish", startLabel: "Start", otherText: "Other language →" },
  { code: "et", name: "Estonian", startLabel: "Start", otherText: "Other language →" },
  { code: "lv", name: "Latvian", startLabel: "Start", otherText: "Other language →" },
  { code: "lt", name: "Lithuanian", startLabel: "Start", otherText: "Other language →" },

  // Africa
  { code: "sw", name: "Swahili", startLabel: "Start", otherText: "Other language →" },
  { code: "am", name: "Amharic", startLabel: "Start", otherText: "Other language →" },
  { code: "zu", name: "Zulu", startLabel: "Start", otherText: "Other language →" },
  { code: "ha", name: "Hausa", startLabel: "Start", otherText: "Other language →" },
  { code: "yo", name: "Yoruba", startLabel: "Start", otherText: "Other language →" },
  { code: "so", name: "Somali", startLabel: "Start", otherText: "Other language →" },
].map((l) => {
  const cc = COUNTRY_MAP[l.code] || "un";
  return {
    ...l,
    countryCode: cc,
    flagUrl: `https://flagcdn.com/w40/${cc}.png`,
    shortLabel: LABEL_MAP[l.code] || String(l.code).toUpperCase(),
    flag: "",
  };
});

const PROFILE_MAP = LANGUAGE_PROFILES.reduce((acc, p) => {
  acc[p.code] = p;
  return acc;
}, {});

export function getLanguageProfileByCode(code) {
  const key = String(code || "").toLowerCase().split("-")[0];
  return PROFILE_MAP[key] || null;
}

export function getFlagUrlByLang(code) {
  const key = String(code || "").toLowerCase().split("-")[0];
  const cc = COUNTRY_MAP[key] || "un";
  return `https://flagcdn.com/w40/${cc}.png`;
}

export function getLabelFromCode(code) {
  const key = String(code || "").toLowerCase().split("-")[0];
  return LABEL_MAP[key] || key.toUpperCase();
}

export function detectUserLanguage() {
  const browserLang = String(navigator.language || navigator.userLanguage || "ko").toLowerCase();
  return getLanguageProfileByCode(browserLang);
}

