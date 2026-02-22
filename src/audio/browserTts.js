const MONO_TO_SPEECH_LANG = {
  ko: "ko-KR",
  vi: "vi-VN",
  zh: "zh-CN",
  en: "en-US",
  ja: "ja-JP",
  th: "th-TH",
  km: "km-KH",
  my: "my-MM",
  id: "id-ID",
};

let voicesCache = [];
let voicesInitialized = false;
let activeToken = 0;
let active = false;

function getSynth() {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis || null;
}

function refreshVoices() {
  const synth = getSynth();
  if (!synth) return;
  voicesCache = synth.getVoices() || [];
}

export function initBrowserTts() {
  const synth = getSynth();
  if (!synth) return;
  if (!voicesInitialized) {
    refreshVoices();
    if (typeof synth.onvoiceschanged !== "undefined") {
      synth.onvoiceschanged = () => {
        refreshVoices();
      };
    }
    voicesInitialized = true;
  }
}

export function mapMonoLangToSpeechLang(monoLang) {
  const key = String(monoLang || "")
    .toLowerCase()
    .replace("_", "-");
  if (MONO_TO_SPEECH_LANG[key]) return MONO_TO_SPEECH_LANG[key];
  if (key.startsWith("ko")) return "ko-KR";
  if (key.startsWith("vi")) return "vi-VN";
  if (key.startsWith("zh")) return "zh-CN";
  if (key.startsWith("en")) return "en-US";
  if (key.startsWith("ja")) return "ja-JP";
  if (key.startsWith("th")) return "th-TH";
  if (key.startsWith("km")) return "km-KH";
  if (key.startsWith("my")) return "my-MM";
  if (key.startsWith("id")) return "id-ID";
  return "en-US";
}

function findVoiceByLang(langCode) {
  if (!voicesCache.length) refreshVoices();
  const base = (langCode || "en-US").split("-")[0].toLowerCase();
  return voicesCache.find((v) => (v.lang || "").toLowerCase().startsWith(base));
}

export function hasVoiceForMonoLang(monoLang) {
  const synth = getSynth();
  if (!synth) return false;
  const langCode = mapMonoLangToSpeechLang(monoLang);
  const voice = findVoiceByLang(langCode);
  return Boolean(voice);
}

function splitLongText(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.length <= 200) return [t];
  const rough = t.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  const chunks = [];
  let bucket = "";
  for (const seg of rough) {
    const next = bucket ? `${bucket} ${seg}` : seg;
    if (next.length <= 200) {
      bucket = next;
      continue;
    }
    if (bucket) chunks.push(bucket);
    if (seg.length <= 200) {
      bucket = seg;
      continue;
    }
    const words = seg.split(/\s+/);
    let acc = "";
    for (const w of words) {
      const cand = acc ? `${acc} ${w}` : w;
      if (cand.length <= 200) {
        acc = cand;
      } else {
        if (acc) chunks.push(acc);
        acc = w;
      }
    }
    bucket = acc;
  }
  if (bucket) chunks.push(bucket);
  return chunks.length ? chunks : [t.slice(0, 200)];
}

function speakChunk(chunk, langCode, token) {
  return new Promise((resolve, reject) => {
    const synth = getSynth();
    if (!synth) {
      reject(new Error("speechSynthesis not supported"));
      return;
    }
    if (token !== activeToken) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(chunk);
    utter.lang = langCode;
    utter.rate = 0.9;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    const voice = findVoiceByLang(langCode);
    if (voice) utter.voice = voice;
    utter.onend = () => resolve();
    utter.onerror = (e) => reject(e?.error || e);
    synth.speak(utter);
  });
}

export async function speakText(text, monoLang, callbacks = {}) {
  const synth = getSynth();
  if (!synth) {
    callbacks.onError?.(new Error("speechSynthesis not supported"));
    return false;
  }
  initBrowserTts();
  const langCode = mapMonoLangToSpeechLang(monoLang);
  if (!findVoiceByLang(langCode)) {
    callbacks.onError?.(new Error(`voice not found for ${langCode}`));
    return false;
  }
  const chunks = splitLongText(text);
  if (!chunks.length) return false;

  activeToken += 1;
  const token = activeToken;
  synth.cancel();
  active = true;
  callbacks.onStart?.();

  try {
    for (const chunk of chunks) {
      if (token !== activeToken) break;
      await speakChunk(chunk, langCode, token);
    }
    if (token === activeToken) {
      active = false;
      callbacks.onEnd?.();
    }
    return true;
  } catch (err) {
    if (token === activeToken) {
      active = false;
      callbacks.onError?.(err);
    }
    return false;
  }
}

export function cancelSpeech() {
  const synth = getSynth();
  activeToken += 1;
  active = false;
  if (synth) synth.cancel();
}

export function isSpeechActive() {
  return active;
}

