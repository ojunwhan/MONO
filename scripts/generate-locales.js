/**
 * Generate locale JSON files by translating ko.json to 89 languages via OpenAI GPT-4o.
 * Skips existing: ko, en, ja, zh, vi, th, ru, ar, fr, es.
 * Processes in batches of 5 to avoid rate limits.
 * Usage: OPENAI_API_KEY in .env, then: node scripts/generate-locales.js
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const OpenAI = require("openai").default;

const ROOT = path.join(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "src", "locales");
const SOURCE_FILE = path.join(LOCALES_DIR, "ko.json");

const SKIP_CODES = new Set(["ko", "en", "ja", "zh", "vi", "th", "ru", "ar", "fr", "es"]);

const TARGET_LANGUAGES = {
  af: "Afrikaans",
  am: "Amharic",
  az: "Azerbaijani",
  be: "Belarusian",
  bg: "Bulgarian",
  bn: "Bengali",
  bs: "Bosnian",
  ca: "Catalan",
  cs: "Czech",
  cy: "Welsh",
  da: "Danish",
  de: "German",
  el: "Greek",
  et: "Estonian",
  eu: "Basque",
  fa: "Persian",
  fi: "Finnish",
  ga: "Irish",
  gl: "Galician",
  gu: "Gujarati",
  ha: "Hausa",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  hy: "Armenian",
  id: "Indonesian",
  is: "Icelandic",
  it: "Italian",
  jv: "Javanese",
  ka: "Georgian",
  kk: "Kazakh",
  km: "Khmer",
  kn: "Kannada",
  ku: "Kurdish",
  ky: "Kyrgyz",
  lo: "Lao",
  lt: "Lithuanian",
  lv: "Latvian",
  mk: "Macedonian",
  ml: "Malayalam",
  mn: "Mongolian",
  mr: "Marathi",
  ms: "Malay",
  mt: "Maltese",
  my: "Myanmar",
  ne: "Nepali",
  nl: "Dutch",
  no: "Norwegian",
  pa: "Punjabi",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  sd: "Sindhi",
  si: "Sinhala",
  sk: "Slovak",
  sl: "Slovenian",
  so: "Somali",
  sq: "Albanian",
  sr: "Serbian",
  su: "Sundanese",
  sv: "Swedish",
  sw: "Swahili",
  ta: "Tamil",
  te: "Telugu",
  tg: "Tajik",
  tl: "Filipino",
  tr: "Turkish",
  uk: "Ukrainian",
  ur: "Urdu",
  uz: "Uzbek",
  xh: "Xhosa",
  yi: "Yiddish",
  yo: "Yoruba",
  zu: "Zulu",
  mg: "Malagasy",
  ht: "Haitian Creole",
  ceb: "Cebuano",
  hmn: "Hmong",
  ig: "Igbo",
  mi: "Maori",
  ny: "Chichewa",
  ps: "Pashto",
  rw: "Kinyarwanda",
  sm: "Samoan",
  sn: "Shona",
  st: "Sesotho",
  tk: "Turkmen",
  tt: "Tatar",
  ug: "Uyghur",
  wo: "Wolof",
};

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateWithGPT4o(openai, sourceJson, languageName) {
  const prompt = `Translate the following JSON object from Korean to ${languageName}. Keep all JSON keys exactly the same. Only translate the string values. Return ONLY valid JSON, no markdown, no explanation.`;
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You output only valid JSON. No markdown code fences, no explanation." },
      { role: "user", content: `${prompt}\n\n${sourceJson}` },
    ],
    temperature: 0.3,
  });
  const content = response.choices?.[0]?.message?.content?.trim() || "";
  // Strip possible markdown code block
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY in .env");
    process.exit(1);
  }

  if (!fs.existsSync(SOURCE_FILE)) {
    console.error("Source file not found:", SOURCE_FILE);
    process.exit(1);
  }

  const sourceJson = fs.readFileSync(SOURCE_FILE, "utf8");
  const sourceObj = JSON.parse(sourceJson);

  const toProcess = Object.entries(TARGET_LANGUAGES).filter(([code]) => {
    if (SKIP_CODES.has(code)) return false;
    const outPath = path.join(LOCALES_DIR, `${code}.json`);
    if (fs.existsSync(outPath)) {
      console.log(`Skip (exists): ${code}`);
      return false;
    }
    return true;
  });

  console.log(`Translating ${toProcess.length} languages in batches of ${BATCH_SIZE}...`);
  const openai = new OpenAI({ apiKey });

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ([code, name]) => {
        try {
          const translated = await translateWithGPT4o(openai, sourceJson, name);
          const outPath = path.join(LOCALES_DIR, `${code}.json`);
          fs.writeFileSync(outPath, JSON.stringify(translated, null, 2), "utf8");
          console.log(`OK: ${code} (${name})`);
        } catch (err) {
          console.error(`FAIL: ${code} (${name})`, err.message);
        }
      })
    );
    if (i + BATCH_SIZE < toProcess.length) {
      console.log(`Waiting ${DELAY_BETWEEN_BATCHES_MS}ms before next batch...`);
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
