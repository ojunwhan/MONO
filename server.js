// server.js — dist 서빙 + Socket.IO + 맥락기반 2패스 번역 (무기록 정책: memory만 + 투자자용 메타데이터)
require('dotenv').config({ path: require('path').join(__dirname, '.env') }); // .env 파일 경로 지정하여 로드
console.log('[env] JWT_SECRET set:', !!process.env.JWT_SECRET); // JWT_SECRET 설정 여부 로그
console.log('[env] PORT raw value:', process.env.PORT);

// 보장: process.env가 없다면 기본 3174 (MRO4 전용)
const START_PORT = Number(process.env.PORT) || 3174;
const IS_DEV = process.env.NODE_ENV !== 'production';
// Dev에서는 .env에 PORT가 있어도 충돌 시 자동 회피 (필요 시 PORT_AUTO_FALLBACK=0으로 비활성화)
const ENABLE_AUTO_PORT_FALLBACK = IS_DEV && process.env.PORT_AUTO_FALLBACK !== '0';

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const fs = require('fs');
const multer = require('multer');
const ffmpegPath = require("ffmpeg-static");
const Ffmpeg = require("fluent-ffmpeg");
Ffmpeg.setFfmpegPath(ffmpegPath);

// Google 및 Kakao 인증 라우트 모듈 불러오기
const attachGoogleAuth = require('./server/routes/auth_google');
const attachKakaoAuth = require('./server/routes/auth_kakao');
const attachAuthApi = require('./server/routes/auth_api');

// --- lang detect & map ---
const LANG_ALIAS = {
  'en': 'en','en-US':'en','en-GB':'en',
  'ko':'ko','ko-KR':'ko',
  'ja':'ja','ja-JP':'ja',
  'zh':'zh','zh-CN':'zh','zh-TW':'zh',
  'es':'es','es-ES':'es','es-MX':'es',
  'fr':'fr','fr-FR':'fr',
  'de':'de','de-DE':'de',
  'pt':'pt','pt-BR':'pt',
  'ru':'ru','ru-RU':'ru',
  'vi':'vi','vi-VN':'vi',
  'th':'th','th-TH':'th',
  'id':'id','id-ID':'id',
  // 필요 시 계속 추가
};
function mapLang(tag='') {
  const k = String(tag||'').trim();
  if (!k) return 'en';
  if (LANG_ALIAS[k]) return LANG_ALIAS[k];
  const base = k.split('-')[0];
  return LANG_ALIAS[base] || base || 'en';
}
function detectFromAcceptLang(accept='') {
  // 예: "ja-JP,ja;q=0.9,en;q=0.8"
  const first = String(accept||'').split(',')[0].trim();
  return mapLang(first || 'en');
}

/* ────────────────────────────────────────────────
   DIAG: 켜고 도는 측정/로그 (원본 불가침)
   - 켜기:  PowerShell →  $env:DIAG="1"; node server.js
   - 도기:  PowerShell →  Remove-Item Env:\DIAG; node server.js
   ──────────────────────────────────────────────── */
const __DIAG_ON__ = process.env.DIAG === "1";
function dlog(...a){ if(__DIAG_ON__) console.log("[DIAG]", ...a); }
function dt(label){
  if(!__DIAG_ON__) return ()=>{};
  const t0 = Date.now();
  return ()=>console.log("[DIAG]", label, (Date.now()-t0)+"ms");
}
/* ──────────────────────────────────────────────── */

// ───────────────── 반복 제거 유틸 (문장 내 반복 멍어리만 정리) ─────────────────
function _dedupeWordRuns(s) {
  // 단어 단위 3회 이상 연속 반복 → 1회로
  // 예: "hello hello hello" -> "hello"
  return s.replace(/\b([\p{L}\p{N}]{1,24})(?:\s+\1){2,}\b/giu, '$1');
}

function _dedupePhraseRuns(s) {
  // 구(phrase) 반복(2~12단어)을 탐지해 1회만 남김
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 6) return s;
  const out = [];
  let i = 0;
  while (i < words.length) {
    let used = false;
    const maxK = Math.min(12, Math.floor((words.length - i) / 2));
    for (let k = 12; k >= 2; k--) {
      if (k > maxK) continue;
      const a = words.slice(i, i + k).join(' ');
      const b = words.slice(i + k, i + 2 * k).join(' ');
      if (a === b) {
        // 몇 번 반복되는지 끝까지 카운트
        let cnt = 2, j = i + 2 * k;
        while (j + k <= words.length &&
               words.slice(i, i + k).join(' ') === words.slice(j, j + k).join(' ')) {
          cnt++; j += k;
        }
        out.push(a);
        i += k * cnt;
        used = true;
        break;
      }
    }
    if (!used) { out.push(words[i]); i++; }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeRepeats(text) {
  let s = (text || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  s = _dedupeWordRuns(s);
  s = _dedupePhraseRuns(s);
  return s;
}
// ──────────────────────────────────────────────────────────────────────────

function isGarbageText(text) {
  const s = (text || "").trim();
  if (!s) return true;
  if (s.length <= 2) return true;
  const lower = s.toLowerCase();
  const metaPhrases = [
    "i'm sorry",
    "i am sorry",
    "please provide more context",
    "could you please provide more context",
    "message is incomplete",
    "as an ai",
  ];
  if (metaPhrases.some((p) => lower.includes(p))) return true;
  // ✅ 수정: Unicode 속성을 사용하여 한글/CJK 등 비-ASCII 문자를 정상 처리
  // 문자(\p{L})나 숫자(\p{N})가 하나도 없는 경우에만 garbage 처리
  if (/^[^\p{L}\p{N}]+$/u.test(s)) return true;
  return false;
}

// ───────────────── DETECT ACTUAL LANGUAGE FROM TEXT ─────────────────
function detectTextLang(text) {
  if (!text || text.length < 2) return null;
  // Korean (Hangul)
  if (/[\uAC00-\uD7AF\u3130-\u318F]/.test(text)) return 'ko';
  // Japanese (Hiragana / Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
  // Chinese (CJK ideographs, but no Korean/Japanese)
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  // Thai
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  // Vietnamese (special diacritics)
  if (/[ăắằặẳẵđêếềệểễôốồộổỗơớờợởỡưứừựửữ]/i.test(text)) return 'vi';
  // Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Cyrillic (Russian etc)
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // Hindi/Devanagari
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  // Latin script → return null (use registered language)
  return null;
}

function sttBufferKey(roomId, participantId) {
  return `${roomId}:${participantId}`;
}

// ───────────────── SITE CONTEXT DOMAIN PROMPTS ─────────────────
const SITE_CONTEXT_PROMPTS = {
  construction: `Domain: Construction site. Use construction terminology. Safety-critical phrasing. Imperative tone for commands. Preserve measurement units. Terms: scaffolding, concrete, rebar, crane, PPE, hard hat, safety line, excavation, load-bearing.`,
  manufacturing: `Domain: Manufacturing facility. Use production terminology. Precision in technical instructions. Terms: assembly line, quality control, defect rate, tolerance, batch, shift, maintenance, calibration.`,
  logistics: `Domain: Logistics/Warehouse. Use logistics terminology. Accuracy in locations and quantities. Terms: pallet, forklift, dock, inventory, dispatch, rack, manifest, loading bay, SKU.`,
  medical: `Domain: Medical/Healthcare. Use medical terminology accurately. Patient safety is absolute priority. Terms: vital signs, medication, dosage, triage, sterilize, patient ID, ward, IV, stat.`,
  airport_event: `Domain: Airport/Event venue. Use aviation/event terminology. Crowd safety phrases. Terms: gate, boarding, security checkpoint, terminal, VIP, evacuation route, crowd control, PA.`,
  general: `Domain: General workplace. Clear, professional, direct language.`,
};

// ───────────────── CALL SIGN SYSTEM (DETERMINISTIC — NO GPT) ─────────────────
const SITE_ROLES = {
  construction: ["Manager", "Lead", "Tech", "Operator", "Safety", "Driver"],
  manufacturing: ["Manager", "Lead", "Tech", "Operator", "QC", "Maintenance"],
  logistics: ["Manager", "Lead", "Operator", "Driver", "Picker", "Loader"],
  medical: ["Doctor", "Nurse", "Tech", "Admin", "Paramedic"],
  airport_event: ["Manager", "Lead", "Security", "Operator", "Guide"],
  general: ["Manager", "Lead", "Tech", "Operator", "Staff"],
};

const ROLE_PHONETICS = {
  manager:     ["manager", "매니저", "마나저", "meneja", "menijo", "매니쩌"],
  lead:        ["lead", "리드", "lid", "리더", "rido"],
  tech:        ["tech", "테크", "tek", "텍", "teku"],
  operator:    ["operator", "오퍼레이터", "opereta", "오퍼레터"],
  safety:      ["safety", "세이프티", "세이프디", "seifuti"],
  driver:      ["driver", "드라이버", "draiba", "드라이바"],
  qc:          ["qc", "큐씨", "kyusi", "큐시"],
  maintenance: ["maintenance", "메인터넌스", "메인테넌스"],
  doctor:      ["doctor", "닥터", "독터", "dakuta"],
  nurse:       ["nurse", "너스", "나스", "nasu"],
  admin:       ["admin", "어드민", "아드민"],
  paramedic:   ["paramedic", "파라메딕"],
  security:    ["security", "시큐리티", "세큐리티"],
  guide:       ["guide", "가이드", "gaido"],
  picker:      ["picker", "피커", "pika"],
  loader:      ["loader", "로더", "roda"],
  staff:       ["staff", "스태프", "스텝", "sutafu"],
};

const NUMBER_PHONETICS = {
  "1":  ["1", "one", "원", "won", "wan"],
  "2":  ["2", "two", "투", "tu", "to"],
  "3":  ["3", "three", "쓰리", "tri", "스리"],
  "4":  ["4", "four", "포", "po", "fo"],
  "5":  ["5", "five", "파이브", "faib"],
  "6":  ["6", "six", "식스", "siks"],
  "7":  ["7", "seven", "세븐", "sebun"],
  "8":  ["8", "eight", "에이트", "eito"],
  "9":  ["9", "nine", "나인", "nain"],
  "10": ["10", "ten", "텐"],
};

function generateCallSignPhonetics(callSign) {
  if (!callSign) return [];
  const parts = callSign.split("-");
  if (parts.length !== 2) return [callSign.toLowerCase()];
  const [role, numStr] = parts;
  const roleLower = role.toLowerCase();
  const roleVars = ROLE_PHONETICS[roleLower] || [roleLower];
  const numVars = NUMBER_PHONETICS[numStr] || [numStr];

  const variants = new Set();
  variants.add(callSign.toLowerCase());
  for (const r of roleVars) {
    for (const n of numVars) {
      variants.add(`${r}-${n}`);
      variants.add(`${r} ${n}`);
      variants.add(`${r}${n}`);
    }
  }
  return [...variants].filter(v => v.length >= 3);
}

function assignCallSign(meta, role) {
  if (!meta.callSignCounters) meta.callSignCounters = {};
  const count = (meta.callSignCounters[role] || 0) + 1;
  meta.callSignCounters[role] = count;
  return `${role}-${count}`;
}

// ───────────────── CALL SIGN MATCHING IN STT TEXT ─────────────────
function matchCallSign(sttText, participants, senderPid) {
  if (!sttText || !participants) return null;
  const text = sttText.toLowerCase()
    .replace(/[,.:!?;，。！？]/g, ' ')
    .replace(/[-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let bestMatch = null;
  let bestLen = 0;
  let bestVariant = "";

  for (const [pid, p] of Object.entries(participants)) {
    if (pid === senderPid) continue;
    if (!p.phoneticVariants?.length) continue;

    for (const variant of p.phoneticVariants) {
      const v = variant.toLowerCase().replace(/[-]/g, ' ');
      if (v.length < 3) continue;

      if (text.includes(v)) {
        if (v.length > bestLen) {
          bestLen = v.length;
          bestMatch = pid;
          bestVariant = variant;
        }
      }
    }
  }
  // Require at least 4 chars match (e.g. "tech 2" = 6 chars)
  if (bestLen < 4) return null;
  return { targetPid: bestMatch, confidence: Math.min(bestLen / 8, 1.0), matchedVariant: bestVariant };
}

// ───────────────── STRIP CALL SIGN FROM TEXT ─────────────────
function stripCallSign(text, matchedVariant) {
  if (!text || !matchedVariant) return text;
  // Build a regex that handles hyphens/spaces/no-separator flexibly
  const escaped = matchedVariant
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // escape regex chars
    .replace(/[-]/g, '[-\\s]?')               // hyphen can be hyphen, space, or nothing
    .replace(/\s+/g, '\\s+');                 // normalize spaces
  const regex = new RegExp(escaped + '[,\\s:;.!?]*', 'gi');
  let result = text.replace(regex, '').trim();
  // Clean up leading/trailing punctuation left over
  result = result.replace(/^[,.\s:;!?]+/, '').replace(/[,\s]+$/, '').trim();
  return result || text; // fallback to original if stripping removes everything
}

// ───────────────── TTS PREPROCESSING (sentence segmentation) ─────────────────
function preprocessForTTS(text) {
  if (!text) return "";
  let sentences = text.split(/(?<=[.!?。！？])\s*/u).filter(s => s.trim());
  const result = [];
  for (const s of sentences) {
    const words = s.split(/\s+/);
    if (words.length <= 10) {
      result.push(s.trim());
    } else {
      let remaining = s;
      while (remaining.trim()) {
        const rWords = remaining.split(/\s+/);
        if (rWords.length <= 10) { result.push(remaining.trim()); break; }
        const first10 = rWords.slice(0, 10).join(" ");
        const commaIdx = first10.lastIndexOf(",");
        if (commaIdx > 0) {
          result.push(remaining.slice(0, commaIdx + 1).trim());
          remaining = remaining.slice(commaIdx + 1).trim();
        } else {
          result.push(rWords.slice(0, 8).join(" ") + ".");
          remaining = rWords.slice(8).join(" ");
        }
      }
    }
  }
  return result.filter(s => s.length > 0).join("\n");
}

// ───────────────── EMIT PARTICIPANT LIST (CALL SIGNS ONLY) ─────────────────
function emitParticipants(roomId) {
  const meta = ROOMS.get(roomId);
  if (!meta?.participants) return;
  const isOnlineSocket = (sid) => !!(sid && io?.sockets?.sockets?.get(sid));
  const list = Object.entries(meta.participants).map(([pid, p]) => ({
    pid,
    callSign: p.callSign || "",
    nativeName: p.nativeName || "",
    lang: p.lang,
    online: isOnlineSocket(p.socketId),
  }));
  io.to(roomId).emit("participants", list);
}

function pcm16ToWavBuffer(pcmBuffer, sampleRateHz = 16000, channels = 1) {
  const byteRate = sampleRateHz * channels * 2;
  const blockAlign = channels * 2;
  const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);
  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRateHz, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(16, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);
  return wavBuffer;
}

// OpenAI quota circuit breaker: avoid spamming failing API calls when quota is exhausted.
let OPENAI_QUOTA_BLOCK_UNTIL = 0;
const OPENAI_QUOTA_BLOCK_MS = 5 * 60 * 1000;

function isQuotaExceededError(err) {
  const msg = String(err?.message || "");
  return msg.includes("429") && msg.toLowerCase().includes("quota");
}

function isOpenAIBlocked() {
  return Date.now() < OPENAI_QUOTA_BLOCK_UNTIL;
}

function markOpenAIQuotaBlocked(err) {
  if (!isQuotaExceededError(err)) return false;
  OPENAI_QUOTA_BLOCK_UNTIL = Date.now() + OPENAI_QUOTA_BLOCK_MS;
  return true;
}

function emitQuotaWarning(socket) {
  if (!socket) return;
  const now = Date.now();
  if (socket.data?.lastQuotaWarnAt && now - socket.data.lastQuotaWarnAt < 15000) return;
  socket.data.lastQuotaWarnAt = now;
  socket.emit("server-warning", {
    code: "OPENAI_QUOTA",
    message: "OpenAI quota exceeded. STT/translation/TTS is temporarily unavailable.",
  });
}

async function transcribePcm16(pcmBuffer, lang, sampleRateHz = 16000) {
  if (!openai || isOpenAIBlocked()) return "";
  const wavBuffer = pcm16ToWavBuffer(pcmBuffer, sampleRateHz, 1);
  const tmpFile = path.join(os.tmpdir(), `${uuidv4()}.wav`);
  fs.writeFileSync(tmpFile, wavBuffer);
  try {
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "gpt-4o-mini-transcribe",
      ...(lang ? { language: lang } : {}),
    });
    return (result.text || "").trim();
  } catch (e) {
    markOpenAIQuotaBlocked(e);
    throw e;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ───────────────── TTS VOICE + INSTRUCTION ─────────────────
const TTS_INSTRUCTION = `Speak clearly and calmly, like a human supervisor on a work site. Do not sound cheerful or robotic. Use a neutral command tone. Pause slightly between sentences.`;
const TTS_DEFAULT_VOICE = "echo"; // neutral, steady, mid-range

async function synthesizeSpeech(text, targetLang = "en") {
  if (!openai || !text || isOpenAIBlocked()) return null;
  const processedText = preprocessForTTS(text);
  if (!processedText) return null;
  try {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: TTS_DEFAULT_VOICE,
      input: processedText,
      instructions: TTS_INSTRUCTION,
      format: "mp3",
    });
    return Buffer.from(await speech.arrayBuffer());
  } catch (err) {
    markOpenAIQuotaBlocked(err);
    // Fallback to tts-1 (no instructions support)
    try {
      const speech = await openai.audio.speech.create({
        model: "tts-1",
        voice: TTS_DEFAULT_VOICE,
        input: processedText,
        format: "mp3",
      });
      return Buffer.from(await speech.arrayBuffer());
    } catch (err2) {
      markOpenAIQuotaBlocked(err2);
      console.warn("[tts] all models failed:", err2?.message);
      return null;
    }
  }
}

const TMP_DIR = path.join(__dirname, 'tmp');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) { console.warn('Failed to create tmp directory:', e.message); }
const upload = multer(); // memoryStorage

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: true,
  transports: ["websocket"],
  allowUpgrades: false,
  pingInterval: 25000,
  pingTimeout: 10000,
  connectTimeout: 20000,
  maxHttpBufferSize: 5e6,
  path: "/socket.io/",
});

// ✅ 프록시 뒤(Cloudflared)에서 프로토콜/헤더 신뢰
app.set("trust proxy", true);

const { bindGoogleSTT } = require("./server/stt_google_stream.js");
if (process.env.STT_PROVIDER === "google") {
  bindGoogleSTT(io);
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ═══════════════════════════════════════════════════════════════
// WEB PUSH — VAPID configuration + subscription store + send API
// ═══════════════════════════════════════════════════════════════
const webpush = require('web-push');

// ✅ Windows CRLF 대응: trim()으로 \r\n 제거 (VAPID 65-byte 오류 원인)
const VAPID_SUBJECT  = (process.env.VAPID_SUBJECT   || '').trim();
const VAPID_PUB_KEY  = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIV_KEY = (process.env.VAPID_PRIVATE_KEY|| '').trim();

// ── Debug: VAPID 키 로딩 상태 출력 ──
console.log('[web-push:debug] VAPID_SUBJECT:', VAPID_SUBJECT ? `"${VAPID_SUBJECT}"` : '(empty)');
console.log('[web-push:debug] VAPID_PUBLIC_KEY length:', VAPID_PUB_KEY.length, '| value:', VAPID_PUB_KEY ? `"${VAPID_PUB_KEY.slice(0, 20)}..."` : '(empty)');
console.log('[web-push:debug] VAPID_PRIVATE_KEY length:', VAPID_PRIV_KEY.length);

if (VAPID_SUBJECT && VAPID_PUB_KEY && VAPID_PRIV_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB_KEY, VAPID_PRIV_KEY);
    console.log('[web-push] ✅ VAPID configured successfully');
  } catch (err) {
    console.error('[web-push] ❌ setVapidDetails failed:', err.message);
    console.error('[web-push] ❌ PUB_KEY decoded bytes (expected 65):', Buffer.from(VAPID_PUB_KEY, 'base64').length);
    console.error('[web-push] ❌ PRIV_KEY decoded bytes (expected 32):', Buffer.from(VAPID_PRIV_KEY, 'base64').length);
  }
} else {
  console.warn('[web-push] ⚠ VAPID keys missing — push disabled');
  if (!VAPID_SUBJECT) console.warn('[web-push]   → VAPID_SUBJECT is empty');
  if (!VAPID_PUB_KEY) console.warn('[web-push]   → VAPID_PUBLIC_KEY is empty');
  if (!VAPID_PRIV_KEY) console.warn('[web-push]   → VAPID_PRIVATE_KEY is empty');
}

// In-memory subscription store: userId → Set<PushSubscription>
// One user can have multiple subscriptions (multi-device)
const PUSH_SUBSCRIPTIONS = new Map(); // userId → Map<endpoint, subscription>
const PUSH_STATE_DIR = path.join(__dirname, 'state');
const PUSH_STATE_FILE = path.join(PUSH_STATE_DIR, 'push_subscriptions.json');
let pushPersistTimer = null;

function serializePushSubscriptions() {
  const out = {};
  for (const [userId, endpointMap] of PUSH_SUBSCRIPTIONS.entries()) {
    out[userId] = Array.from(endpointMap.values());
  }
  return out;
}

function persistPushSubscriptionsNow() {
  try {
    fs.mkdirSync(PUSH_STATE_DIR, { recursive: true });
    const payload = JSON.stringify(serializePushSubscriptions());
    fs.writeFileSync(PUSH_STATE_FILE, payload, 'utf8');
  } catch (e) {
    console.warn('[push] persist failed:', e?.message);
  }
}

function schedulePersistPushSubscriptions() {
  if (pushPersistTimer) clearTimeout(pushPersistTimer);
  pushPersistTimer = setTimeout(() => {
    pushPersistTimer = null;
    persistPushSubscriptionsNow();
  }, 500);
}

function loadPushSubscriptionsFromDisk() {
  try {
    if (!fs.existsSync(PUSH_STATE_FILE)) return;
    const raw = fs.readFileSync(PUSH_STATE_FILE, 'utf8');
    if (!raw?.trim()) return;
    const parsed = JSON.parse(raw);
    for (const [userId, subscriptions] of Object.entries(parsed || {})) {
      const endpointMap = new Map();
      for (const sub of subscriptions || []) {
        if (sub?.endpoint) endpointMap.set(sub.endpoint, sub);
      }
      if (endpointMap.size > 0) {
        PUSH_SUBSCRIPTIONS.set(userId, endpointMap);
      }
    }
    let total = 0;
    for (const v of PUSH_SUBSCRIPTIONS.values()) total += v.size;
    console.log(`[push] 🔁 restored ${total} subscription(s) from disk`);
  } catch (e) {
    console.warn('[push] restore failed:', e?.message);
  }
}

loadPushSubscriptionsFromDisk();

function countPushSubscriptions() {
  let users = 0;
  let devices = 0;
  for (const endpointMap of PUSH_SUBSCRIPTIONS.values()) {
    users += 1;
    devices += endpointMap.size;
  }
  return { users, devices };
}

function savePushSubscription(userId, subscription) {
  if (!userId || !subscription?.endpoint) return false;
  if (!PUSH_SUBSCRIPTIONS.has(userId)) {
    PUSH_SUBSCRIPTIONS.set(userId, new Map());
  }
  PUSH_SUBSCRIPTIONS.get(userId).set(subscription.endpoint, subscription);
  console.log(`[push] 📥 Saved subscription for ${userId} (${PUSH_SUBSCRIPTIONS.get(userId).size} device(s))`);
  schedulePersistPushSubscriptions();
  return true;
}

function removePushSubscription(userId, endpoint) {
  const subs = PUSH_SUBSCRIPTIONS.get(userId);
  if (!subs) return;
  subs.delete(endpoint);
  if (subs.size === 0) PUSH_SUBSCRIPTIONS.delete(userId);
  schedulePersistPushSubscriptions();
}

/**
 * Send push notification to a specific user (all their devices).
 * @param {string} targetUserId
 * @param {Object} payload - { title, body, roomId, url, ... }
 */
async function sendPushToUser(targetUserId, payload) {
  if (!VAPID_PUB_KEY || !VAPID_PRIV_KEY) return;
  const subs = PUSH_SUBSCRIPTIONS.get(targetUserId);
  if (!subs || subs.size === 0) return;

  const payloadStr = JSON.stringify({
    title: payload.title || 'MONO',
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      roomId: payload.roomId || '',
      url: payload.url || (payload.roomId ? `/room/${payload.roomId}` : '/'),
      senderName: payload.senderName || '',
    },
    tag: payload.tag || `mono-${payload.roomId || 'msg'}`,
  });

  const stale = [];
  for (const [endpoint, sub] of subs.entries()) {
    try {
      await webpush.sendNotification(sub, payloadStr);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription expired or invalid — remove it
        stale.push(endpoint);
        console.log(`[push] 🗑 Removed stale subscription for ${targetUserId}`);
      } else {
        console.warn(`[push] ❌ Error sending to ${targetUserId}:`, err?.message);
      }
    }
  }
  // Clean up stale subscriptions
  for (const ep of stale) {
    subs.delete(ep);
  }
  if (subs.size === 0) PUSH_SUBSCRIPTIONS.delete(targetUserId);
  if (stale.length > 0) schedulePersistPushSubscriptions();
}

// ── REST API: Push subscription management ──

// GET /api/push/vapid-key — return public VAPID key for client
app.get('/api/push/vapid-key', (req, res) => {
  if (!VAPID_PUB_KEY) {
    return res.status(503).json({ error: 'push_not_configured' });
  }
  res.json({ publicKey: VAPID_PUB_KEY });
});

// POST /api/push/subscribe — save subscription
app.post('/api/push/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription?.endpoint) {
    return res.status(400).json({ error: 'userId and subscription required' });
  }
  const ok = savePushSubscription(userId, subscription);
  res.json({ success: ok });
});

// POST /api/push/unsubscribe — remove subscription
app.post('/api/push/unsubscribe', (req, res) => {
  const { userId, endpoint } = req.body;
  if (!userId || !endpoint) {
    return res.status(400).json({ error: 'userId and endpoint required' });
  }
  removePushSubscription(userId, endpoint);
  res.json({ success: true });
});

// POST /api/push/send — admin/debug: send push to a user
app.post('/api/push/send', async (req, res) => {
  const { targetUserId, title, body, roomId } = req.body;
  if (!targetUserId) {
    return res.status(400).json({ error: 'targetUserId required' });
  }
  await sendPushToUser(targetUserId, { title, body, roomId });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
if (!openai) console.warn("[OpenAI] API key missing — translation/STT disabled");

const LANG_LABEL = Object.fromEntries([
  ['auto','Auto Detect'],
  ['af','Afrikaans'], ['ar','Arabic'], ['bg','Bulgarian'], ['bn','Bengali'],
  ['ca','Catalan'], ['cs','Czech'], ['da','Danish'], ['de','German'],
  ['el','Greek'], ['en','English'], ['es','Spanish'], ['et','Estonian'],
  ['fa','Persian (Farsi)'], ['fi','Finnish'], ['fr','French'],
  ['gu','Gujarati'], ['he','Hebrew'], ['hi','Hindi'], ['hr','Croatian'],
  ['hu','Hungarian'], ['hy','Armenian'], ['id','Indonesian'], ['is','Icelandic'],
  ['it','Italian'], ['ja','Japanese'], ['jv','Javanese'], ['ka','Georgian'],
  ['kk','Kazakh'], ['km','Khmer'], ['kn','Kannada'], ['ko','Korean'],
  ['lo','Lao'], ['lt','Lithuanian'], ['lv','Latvian'], ['ml','Malayalam'],
  ['mr','Marathi'], ['ms','Malay'], ['my','Burmese'], ['ne','Nepali'],
  ['nl','Dutch'], ['no','Norwegian'], ['pl','Polish'], ['pt','Portuguese'],
  ['ro','Romanian'], ['ru','Russian'], ['si','Sinhala'], ['sk','Slovak'],
  ['sl','Slovenian'], ['sq','Albanian'], ['sr','Serbian'], ['sv','Swedish'],
  ['sw','Swahili'], ['ta','Tamil'], ['te','Telugu'], ['th','Thai'],
  ['tl','Tagalog'], ['tr','Turkish'], ['uk','Ukrainian'], ['ur','Urdu'],
  ['vi','Vietnamese'], ['zh','Chinese']
]);
const label = (code) => LANG_LABEL[code] || code || 'auto';

// ── In-Memory State
const ROOMS = new Map();
const SOCKET_ROLES = new Map();
const messageBuffer = {}; // { roomId: [ { id, text, senderPid, time } ] }
const STT_SESSIONS = new Map();
const STT_TEXT_BUFFER = new Map();
const RECENT_MESSAGE_IDS = new Map(); // roomId -> Map<msgId, ts>
const RATE_BUCKETS = new Map(); // key(socketId:event) -> { count, resetAt }

const LIMITS = {
  MAX_MESSAGE_CHARS: 500,
  MAX_AUDIO_BASE64_CHARS: 360000, // ~270KB base64 payload cap per chunk
  SEND_MESSAGE_PER_10S: 60,
  STT_AUDIO_PER_10S: 300,
  STT_SEGMENT_END_PER_30S: 60,
};

function consumeRate(socketId, eventName, limit, windowMs) {
  const now = Date.now();
  const key = `${socketId}:${eventName}`;
  const prev = RATE_BUCKETS.get(key);
  if (!prev || now > prev.resetAt) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (prev.count >= limit) return false;
  prev.count += 1;
  RATE_BUCKETS.set(key, prev);
  return true;
}

function isRecentDuplicateMessage(roomId, msgId, ttlMs = 120000) {
  if (!roomId || !msgId) return false;
  const now = Date.now();
  let roomMap = RECENT_MESSAGE_IDS.get(roomId);
  if (!roomMap) {
    roomMap = new Map();
    RECENT_MESSAGE_IDS.set(roomId, roomMap);
  }
  const existing = roomMap.get(msgId);
  if (existing && now - existing < ttlMs) return true;
  roomMap.set(msgId, now);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of RATE_BUCKETS.entries()) {
    if (now > v.resetAt) RATE_BUCKETS.delete(k);
  }
  for (const [roomId, roomMap] of RECENT_MESSAGE_IDS.entries()) {
    for (const [msgId, ts] of roomMap.entries()) {
      if (now - ts > 180000) roomMap.delete(msgId);
    }
    if (roomMap.size === 0) RECENT_MESSAGE_IDS.delete(roomId);
  }
}, 30000).unref?.();

// ═══════════════════════════════════════════════════════════════
// USER REGISTRY — global user identity store (in-memory, ephemeral)
// Each user has: userId, canonicalName, lang, socketId, aliases
// ═══════════════════════════════════════════════════════════════
const USER_REGISTRY = new Map(); // userId -> { canonicalName, lang, socketId, aliases: { [lang]: string }, rooms: Set }

function getOrCreateUser(userId, { canonicalName, lang, socketId } = {}) {
  let u = USER_REGISTRY.get(userId);
  if (!u) {
    u = { canonicalName: canonicalName || "", lang: lang || "en", socketId: null, aliases: {}, rooms: new Set() };
    USER_REGISTRY.set(userId, u);
  }
  if (canonicalName) u.canonicalName = canonicalName;
  if (lang) u.lang = lang;
  if (socketId) u.socketId = socketId;
  return u;
}

/**
 * Generate pronunciation aliases for a user's canonical name.
 * Produces aliases in each target language using GPT transliteration.
 * @param {string} userId
 * @param {string[]} targetLangs - list of lang codes to generate aliases for
 */
async function generatePronunciationAliases(userId, targetLangs) {
  const user = USER_REGISTRY.get(userId);
  if (!user?.canonicalName || !openai) return;
  const name = user.canonicalName;
  const fromLang = user.lang || "en";

  const needed = targetLangs.filter(tl => tl !== fromLang && !user.aliases[tl]);
  if (!needed.length) return;

  const fromLabel = LANG_LABEL[fromLang] || fromLang;
  const results = await Promise.allSettled(needed.map(async (tl) => {
    const toLabel = LANG_LABEL[tl] || tl;
    try {
      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 80,
        messages: [
          { role: "system", content: `You are a name transliteration expert. Convert the personal name from ${fromLabel} to the writing system of ${toLabel}. Return ONLY the transliterated name and up to 2 phonetic variants (comma-separated). No explanations.` },
          { role: "user", content: name },
        ],
      });
      return { lang: tl, alias: r.choices?.[0]?.message?.content?.trim() || name };
    } catch (e) {
      console.warn(`[alias] ${name} → ${tl}: ${e?.message}`);
      return { lang: tl, alias: name };
    }
  }));

  for (const r of results) {
    if (r.status === "fulfilled") {
      user.aliases[r.value.lang] = r.value.alias;
    }
  }
  // Always include own name as self-alias
  user.aliases[fromLang] = name;
  console.log(`[aliases] ${name}: ${JSON.stringify(user.aliases)}`);
}

/**
 * Get the display name for a userId as seen by a viewer in targetLang.
 * Returns adapted alias or falls back to canonical name.
 */
function getDisplayName(userId, targetLang) {
  const u = USER_REGISTRY.get(userId);
  if (!u) return "";
  return u.aliases[targetLang] || u.canonicalName || "";
}

/**
 * Get all users visible to a given userId (in the same rooms).
 * Returns array of { userId, displayName } in the viewer's language.
 */
function getVisibleUsers(viewerUserId) {
  const viewer = USER_REGISTRY.get(viewerUserId);
  if (!viewer) return [];
  const viewerLang = viewer.lang || "en";
  const result = [];
  for (const [uid, u] of USER_REGISTRY.entries()) {
    if (uid === viewerUserId) continue;
    // Check if they share any room
    const shared = [...viewer.rooms].some(r => u.rooms.has(r));
    if (!shared && u.rooms.size > 0 && viewer.rooms.size > 0) continue;
    result.push({
      userId: uid,
      displayName: getDisplayName(uid, viewerLang),
      canonicalName: u.canonicalName,
      lang: u.lang,
      online: !!u.socketId,
    });
  }
  return result;
}


function ensureRoomMeta(roomId){
  let m = ROOMS.get(roomId);
  if(!m){
    m = { roomType:'oneToOne', ownerLang:'auto', guestLang:'auto', siteContext:'general', locked:false, ownerPid:null, participants:{}, callSignCounters:{} };
    ROOMS.set(roomId, m);
  }
  if (!m.participants) m.participants = {};
  if (!m.callSignCounters) m.callSignCounters = {};
  if (!m.roomType) m.roomType = 'oneToOne';
  return m;
}

function isAuthorizedParticipant(socket, roomId, participantId) {
  if (!roomId || !participantId) return false;
  const meta = ROOMS.get(roomId);
  if (!meta || !meta.participants) return false;
  const p = meta.participants[participantId];
  if (!p) return false;
  // Same participant ID from a different socket is rejected unless socketId is empty.
  if (p.socketId && p.socketId !== socket.id) return false;
  return true;
}

function speakerMicroCtx(hist = [], role) {
  const last = hist.filter(m => m.role === role).slice(-3);
  return last.map(m => `- (${m.role === 'owner' ? 'A' : 'B'}:${label(m.lang)}) ${m.text}`).join('\n');
}

function buildSystemPrompt(from, to, ctx, siteContext) {
  const siteDomain = SITE_CONTEXT_PROMPTS[siteContext] || SITE_CONTEXT_PROMPTS.general;
  return [
    `You are a real-time industrial translator for work sites.`,
    siteDomain,
    `Translation style: Direct, imperative, safety-first. Short sentences.`,
    `Do NOT use casual tone, abbreviations, slang, or emojis.`,
    `Preserve names, numbers, measurement units, and safety-critical terms exactly.`,
    ctx ? `Speaker context:\n${ctx}` : '',
    `Translate from ${label(from)} to ${label(to)}.`,
    `Return ONLY the translated text. No explanations, no commentary.`,
  ].filter(Boolean).join('\n');
}

// ───────────────── NAME TRANSLITERATION (1:1 rooms) ─────────────────
async function adaptName(name, fromLang, toLang) {
  if (!name) return "";
  if (fromLang === toLang) return name;
  if (!openai) return name;
  const fromLabel = LANG_LABEL[fromLang] || fromLang;
  const toLabel = LANG_LABEL[toLang] || toLang;
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 60,
      messages: [
        { role: "system", content: `You are a name transliteration expert. Convert the personal name from ${fromLabel} to ${toLabel} writing system. Return ONLY the transliterated name. Keep it natural and phonetically accurate for the target language. No honorifics, no explanation.` },
        { role: "user", content: name },
      ],
    });
    return r.choices?.[0]?.message?.content?.trim() || name;
  } catch (e) {
    console.warn("[adaptName]:", e?.message);
    return name;
  }
}

async function generateNameAdaptations(roomId) {
  const meta = ROOMS.get(roomId);
  if (!meta || meta.roomType !== "oneToOne") return;
  const pids = Object.keys(meta.participants);
  if (pids.length !== 2) return;

  const [pidA, pidB] = pids;
  const pA = meta.participants[pidA];
  const pB = meta.participants[pidB];
  if (!pA?.nativeName || !pB?.nativeName) return;

  const [aForB, bForA] = await Promise.all([
    adaptName(pA.nativeName, pA.lang, pB.lang),
    adaptName(pB.nativeName, pB.lang, pA.lang),
  ]);

  if (!pA.adaptedNames) pA.adaptedNames = {};
  if (!pB.adaptedNames) pB.adaptedNames = {};
  pA.adaptedNames[pB.lang] = aForB;
  pB.adaptedNames[pA.lang] = bForA;
  ROOMS.set(roomId, meta);

  // Send partner info to each client
  if (pA.socketId) {
    io.to(pA.socketId).emit("partner-info", {
      roomId,
      peerUserId: pidB,
      peerCanonicalName: pB.nativeName,
      peerLocalizedName: bForA || pB.nativeName,
      partnerName: bForA || pB.nativeName,
      partnerNativeName: pB.nativeName,
      peerLang: pB.lang || "en",
    });
  }
  if (pB.socketId) {
    io.to(pB.socketId).emit("partner-info", {
      roomId,
      peerUserId: pidA,
      peerCanonicalName: pA.nativeName,
      peerLocalizedName: aForB || pA.nativeName,
      partnerName: aForB || pA.nativeName,
      partnerNativeName: pA.nativeName,
      peerLang: pA.lang || "en",
    });
  }
  console.log(`[1:1:names] ${pA.nativeName} → "${aForB}" (for ${pB.lang}), ${pB.nativeName} → "${bForA}" (for ${pA.lang})`);
}

// ─────────────────────────────────────────────────────────────────────

async function fastTranslate(text, from, to, ctx, siteContext) {
  if (!openai || !text || !to || to === 'auto' || from === to || isOpenAIBlocked()) return text;
  const sys = buildSystemPrompt(from, to, ctx, siteContext || 'general');
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
    });
    return r.choices?.[0]?.message?.content?.trim() || text;
  } catch (e) {
    markOpenAIQuotaBlocked(e);
    throw e;
  }
}

async function hqTranslate(text, from, to, ctx, siteContext) {
  if (!openai || !text || !to || to === 'auto' || from === to || isOpenAIBlocked()) return text;
  const sys = buildSystemPrompt(from, to, ctx, siteContext || 'general')
    + `\nPolish wording to native fluency *without changing tone or meaning*. Keep it short and imperative.`;
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
    });
    return r.choices?.[0]?.message?.content?.trim() || text;
  } catch (e) {
    markOpenAIQuotaBlocked(e);
    throw e;
  }
}

async function emitRoutes(roomId) {
  const meta = ROOMS.get(roomId) || {};
  const sockets = await io.in(roomId).fetchSockets();
  for (const s of sockets) {
    const rec = SOCKET_ROLES.get(s.id);
    if (!rec) continue;
    const fromCode = rec.role === 'owner' ? meta.ownerLang : meta.guestLang;
    const toCode   = rec.role === 'owner' ? meta.guestLang : meta.ownerLang;
    io.to(s.id).emit('route-ready', {
      from: label(fromCode) || 'auto',
      to:   label(toCode)   || 'auto',
      fromCode: fromCode || 'auto',
      toCode:   toCode   || 'auto',
    });
  }
}

io.on('connection', (socket) => {
  console.log('🟢 New client connected:', socket.id);

  // ═══════════════════════════════════════════════════════
  // REGISTER USER — global identity registration
  // ═══════════════════════════════════════════════════════
  socket.on("register-user", ({ userId, canonicalName, lang }) => {
    if (!userId || !canonicalName) return;
    if (typeof userId !== 'string' || userId.length > 128) return;
    if (typeof canonicalName !== 'string' || !canonicalName.trim() || canonicalName.length > 60) return;
    const user = getOrCreateUser(userId, { canonicalName, lang, socketId: socket.id });
    socket.data.userId = userId;
    console.log(`[REGISTER] ${socket.id} → ${userId} "${canonicalName}" (${lang})`);

    // Send back confirmation
    socket.emit("user-registered", {
      userId,
      canonicalName: user.canonicalName,
      lang: user.lang,
      aliases: user.aliases,
    });
  });

  // ── Push subscription via Socket ──
  socket.on("push-subscribe", ({ userId, subscription }) => {
    if (!userId || !subscription?.endpoint) return;
    savePushSubscription(userId, subscription);
  });

  socket.on("push-unsubscribe", ({ userId, endpoint }) => {
    if (!userId || !endpoint) return;
    removePushSubscription(userId, endpoint);
  });

  // ═══════════════════════════════════════════════════════
  // AUTO-CREATE 1:1 ROOM — select a user to chat with
  // ═══════════════════════════════════════════════════════
  socket.on("create-1to1", async ({ myUserId, peerUserId, siteContext }) => {
    if (!myUserId || !peerUserId) return;
    const myUser = USER_REGISTRY.get(myUserId);
    const peerUser = USER_REGISTRY.get(peerUserId);
    if (!myUser || !peerUser) {
      socket.emit("error", { message: "User not found" });
      return;
    }

    // Deterministic roomId: sorted pair
    const pair = [myUserId, peerUserId].sort();
    const roomId = `1to1_${pair[0]}_${pair[1]}`;

    const meta = ensureRoomMeta(roomId);
    meta.roomType = "oneToOne";
    meta.siteContext = siteContext || "general";
    meta.locked = true;

    // Register both users in room
    myUser.rooms.add(roomId);
    peerUser.rooms.add(roomId);

    // Set participants
    meta.participants[myUserId] = {
      nativeName: myUser.canonicalName,
      lang: myUser.lang,
      socketId: socket.id,
      adaptedNames: {},
    };
    if (!meta.participants[peerUserId]) {
      meta.participants[peerUserId] = {
        nativeName: peerUser.canonicalName,
        lang: peerUser.lang,
        socketId: peerUser.socketId,
        adaptedNames: {},
      };
    }
    meta.ownerPid = myUserId;
    ROOMS.set(roomId, meta);

    // Join socket room
    socket.join(roomId);
    socket.roomId = roomId;
    socket.data.participantId = myUserId;
    SOCKET_ROLES.set(socket.id, { role: "owner" });

    // Generate pronunciation aliases for both users
    const targetLangs = [myUser.lang, peerUser.lang].filter(Boolean);
    await Promise.all([
      generatePronunciationAliases(myUserId, targetLangs),
      generatePronunciationAliases(peerUserId, targetLangs),
    ]).catch(e => console.warn("[aliases]", e?.message));

    // Build adapted names
    const myNameForPeer = getDisplayName(myUserId, peerUser.lang);
    const peerNameForMe = getDisplayName(peerUserId, myUser.lang);

    // Emit room created
    socket.emit("room-created", {
      roomId,
      roomType: "oneToOne",
      peerUserId,
      peerDisplayName: peerNameForMe,
      peerCanonicalName: peerUser.canonicalName,
      peerLang: peerUser.lang,
    });

    // Notify peer if online
    if (peerUser.socketId) {
      io.to(peerUser.socketId).emit("room-created", {
        roomId,
        roomType: "oneToOne",
        peerUserId: myUserId,
        peerDisplayName: myNameForPeer,
        peerCanonicalName: myUser.canonicalName,
        peerLang: myUser.lang,
      });
    }

    console.log(`[1to1:CREATE] ${roomId} "${myUser.canonicalName}" ↔ "${peerUser.canonicalName}"`);
  });

  // ═══════════════════════════════════════════════════════
  // GET VISIBLE USERS — for user selection UI
  // ═══════════════════════════════════════════════════════
  socket.on("get-users", ({ userId }) => {
    if (!userId) return;
    const users = getVisibleUsers(userId);
    socket.emit("user-list", users);
  });

  // ======================================================
  // ✅ [수정됨] 호스트 방 생성 + 즉시 조인 (증발 방지 핵심)
  // ======================================================
  socket.on("create-room", ({ roomId, fromLang, participantId, siteContext, role, localName, roomType }) => {
    if (!roomId) return;

    const hostLangCode = mapLang(fromLang);
    const ctx = siteContext || "general";
    const hostRole = role || "Manager";
    const rType = roomType === "broadcast" ? "broadcast" : "oneToOne";
    const meta = {
      roomType: rType,
      ownerLang: hostLangCode,
      guestLang: "auto",
      siteContext: ctx,
      locked: true,
      ownerPid: participantId || null,
      participants: {},
      callSignCounters: {},
    };

    if (participantId) {
      const callSign = assignCallSign(meta, hostRole);
      meta.participants[participantId] = {
        callSign,
        localName: localName || "",
        role: hostRole,
        lang: hostLangCode,
        socketId: socket.id,
        phoneticVariants: generateCallSignPhonetics(callSign),
      };
      socket.join(roomId);
      socket.roomId = roomId;
      socket.data.participantId = participantId;
      SOCKET_ROLES.set(socket.id, { role: "owner" });
      console.log(`🏠 Host ${socket.id} [${callSign}] created room: ${roomId} [${hostLangCode}] [${ctx}]`);
      socket.emit("call-sign-assigned", { callSign, siteContext: ctx });
    }

    ROOMS.set(roomId, meta);
    socket.emit("room-created-ack", { roomId, siteContext: ctx });
  });

  // Ensure a shared global broadcast room exists without resetting existing participants.
  socket.on("ensure-global-room", ({ roomId, participantId, fromLang } = {}, ack) => {
    const ackReply = (payload) => {
      if (typeof ack === "function") {
        try { ack(payload); } catch {}
      }
    };
    const rid = String(roomId || "global-lobby").trim().slice(0, 120) || "global-lobby";
    let meta = ROOMS.get(rid);
    let created = false;
    if (!meta) {
      created = true;
      meta = {
        roomType: "broadcast",
        ownerLang: mapLang(fromLang || "en"),
        guestLang: "auto",
        siteContext: "general",
        locked: true,
        ownerPid: null,
        participants: {},
        callSignCounters: {},
      };
    }
    const isOwner = !!participantId && !meta.ownerPid;
    if (isOwner) {
      meta.ownerPid = participantId;
      meta.ownerLang = mapLang(fromLang || meta.ownerLang || "en");
    }
    ROOMS.set(rid, meta);
    ackReply({ ok: true, roomId: rid, created, isOwner });
    socket.emit("global-room-ready", { roomId: rid, created, isOwner });
  });

  // Atomic global join: avoid race between room ensure and join/auth checks.
  socket.on("join-global", ({ roomId, participantId, fromLang, localName } = {}, ack) => {
    const ackReply = (payload) => {
      if (typeof ack === "function") {
        try { ack(payload); } catch {}
      }
    };
    if (!participantId || typeof participantId !== "string") {
      ackReply({ ok: false, error: "participant_id_required" });
      return;
    }
    const rid = String(roomId || "global-lobby").trim().slice(0, 120) || "global-lobby";
    let meta = ROOMS.get(rid);
    if (!meta) {
      meta = {
        roomType: "broadcast",
        ownerLang: mapLang(fromLang || "en"),
        guestLang: "auto",
        siteContext: "general",
        locked: true,
        ownerPid: null,
        participants: {},
        callSignCounters: {},
      };
    }

    const isOwner = !meta.ownerPid || meta.ownerPid === participantId;
    if (isOwner) meta.ownerPid = participantId;
    const role = isOwner ? "owner" : "guest";
    const roleName = isOwner ? "Manager" : "Tech";
    const langCode = mapLang(fromLang || "en");

    socket.join(rid);
    socket.roomId = rid;
    socket.data.participantId = participantId;
    SOCKET_ROLES.set(socket.id, { role });

    const existing = meta.participants[participantId];
    const callSign = existing?.callSign || assignCallSign(meta, roleName);
    meta.participants[participantId] = {
      callSign,
      localName: localName || existing?.localName || "",
      role: existing?.role || roleName,
      lang: langCode || existing?.lang || "en",
      socketId: socket.id,
      phoneticVariants: existing?.phoneticVariants || generateCallSignPhonetics(callSign),
    };
    if (isOwner) meta.ownerLang = langCode || meta.ownerLang;
    ROOMS.set(rid, meta);
    emitParticipants(rid);
    emitRoutes(rid);

    socket.emit("call-sign-assigned", { callSign, siteContext: meta.siteContext });
    socket.emit("room-context", {
      siteContext: meta.siteContext,
      locked: meta.locked,
      roomType: meta.roomType,
      roles: SITE_ROLES[meta.siteContext] || SITE_ROLES.general,
    });
    ackReply({ ok: true, roomId: rid, roleHint: role, callSign });
  });

  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`👥 ${socket.id} joined room ${roomId}`);
  });

  // Rejoin helper for unstable network transitions (Cloudflare tunnel / mobile handover)
  socket.on("rejoin-room", ({ roomId, userId, language, isHost } = {}) => {
    if (!roomId || !userId) {
      socket.emit("room-status", { status: "room-gone", roomId: roomId || "" });
      return;
    }
    const meta = ROOMS.get(roomId);
    if (!meta) {
      socket.emit("room-status", { status: "room-gone", roomId });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.data.participantId = userId;

    const normalizedLang = mapLang(language || "en");
    const existing = meta.participants?.[userId];
    if (existing) {
      existing.socketId = socket.id;
      if (normalizedLang) existing.lang = normalizedLang;
    } else if (meta.roomType === "oneToOne") {
      meta.participants[userId] = {
        nativeName: `참여자${Object.keys(meta.participants || {}).length + 1}`,
        lang: normalizedLang || "en",
        socketId: socket.id,
        adaptedNames: {},
      };
    } else {
      const role = isHost ? "Manager" : "Tech";
      const callSign = assignCallSign(meta, role);
      meta.participants[userId] = {
        callSign,
        localName: "",
        role,
        lang: normalizedLang || "en",
        socketId: socket.id,
        phoneticVariants: generateCallSignPhonetics(callSign),
      };
    }
    if (isHost) meta.ownerPid = userId;
    ROOMS.set(roomId, meta);
    emitParticipants(roomId);

    const room = io.sockets.adapter.rooms.get(roomId);
    console.log(`[SERVER] rejoin-room ${roomId} user=${userId} socket=${socket.id} members=${room?.size || 0}`);
    socket.emit("room-status", { status: "rejoined", roomId });

    // Re-sync peer info for 1:1 so host/guest can recover from missed event windows.
    if (meta.roomType === "oneToOne") {
      const peerPid = Object.keys(meta.participants || {}).find((pid) => pid !== userId);
      if (peerPid && meta.participants[peerPid]) {
        const peer = meta.participants[peerPid];
        socket.emit("partner-joined", {
          roomId,
          peerLang: peer.lang || "en",
          peerFlagUrl: `https://flagcdn.com/w40/${String((() => {
            const map = {
              ko: "kr", vi: "vn", zh: "cn", en: "us", ja: "jp", th: "th",
              km: "kh", my: "mm", id: "id", mn: "mn", uz: "uz", ne: "np",
            };
            const k = String(peer.lang || "en").toLowerCase().split("-")[0];
            return map[k] || "un";
          })())}.png`,
          peerLabel: String((() => {
            const map = {
              ko: "KOR", vi: "VNM", zh: "CHN", en: "ENG", ja: "JPN", th: "THA",
              km: "KHM", my: "MMR", id: "IDN", mn: "MNG", uz: "UZB", ne: "NPL",
            };
            const k = String(peer.lang || "en").toLowerCase().split("-")[0];
            return map[k] || k.toUpperCase();
          })()),
        });
      }
    }
  });

  socket.on("check-room", ({ roomId } = {}) => {
    if (!roomId) return;
    const meta = ROOMS.get(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!meta || !room) {
      socket.emit("room-status", { status: "room-gone", roomId });
      return;
    }
    if (room.has(socket.id)) {
      socket.emit("room-status", { status: "ok", roomId });
      return;
    }
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit("room-status", { status: "rejoined", roomId });
  });

  socket.on("who-is-in-room", ({ roomId, userId } = {}) => {
    if (!roomId) return;
    const meta = ROOMS.get(roomId);
    if (!meta || !meta.participants) {
      socket.emit("room-members", { roomId, members: [] });
      return;
    }
    const members = Object.entries(meta.participants)
      .filter(([pid, info]) => !!info && pid !== (userId || socket.data?.participantId))
      .map(([pid, info]) => ({
        partnerId: pid,
        language: info.lang || "en",
      }));
    socket.emit("room-members", { roomId, members });
  });

  socket.on("mono-ping", (data = {}) => {
    socket.emit("mono-pong", data);
  });

  socket.on("typing-start", ({ roomId, participantId, displayName } = {}) => {
    if (!roomId || !participantId) return;
    socket.to(roomId).emit("typing-start", {
      roomId,
      participantId,
      displayName: displayName || "",
    });
  });

  socket.on("typing-stop", ({ roomId, participantId } = {}) => {
    if (!roomId || !participantId) return;
    socket.to(roomId).emit("typing-stop", {
      roomId,
      participantId,
    });
  });

  // Message status sync (delivered/read) for stable 1:1 UX.
  socket.on("message-status", ({ roomId, messageId, status, participantId } = {}) => {
    if (!roomId || !messageId || !status || !participantId) return;
    if (!isAuthorizedParticipant(socket, roomId, participantId)) return;
    const meta = ROOMS.get(roomId);
    if (!meta?.participants) return;
    const senderPid = Object.keys(meta.participants).find((pid) => pid !== participantId);
    if (!senderPid) return;
    const senderSocketId = meta.participants[senderPid]?.socketId;
    if (!senderSocketId) return;
    io.to(senderSocketId).emit("message-status", {
      roomId,
      messageId,
      participantId,
      status,
      at: Date.now(),
    });
  });

  // Explicit read receipt event (maps to message-status: read).
  socket.on("message-read", ({ roomId, messageId, participantId } = {}) => {
    if (!roomId || !messageId || !participantId) return;
    if (!isAuthorizedParticipant(socket, roomId, participantId)) return;
    const meta = ROOMS.get(roomId);
    if (!meta?.participants) return;
    const senderPid = Object.keys(meta.participants).find((pid) => pid !== participantId);
    if (!senderPid) return;
    const senderSocketId = meta.participants[senderPid]?.socketId;
    if (!senderSocketId) return;
    io.to(senderSocketId).emit("message-status", {
      roomId,
      messageId,
      participantId,
      status: "read",
      at: Date.now(),
    });
  });

  // --- join 핸들러 (call sign system, idempotent) ---
  socket.on("join", ({ roomId, fromLang, participantId, role: selectedRole, localName, roleHint }) => {
    if (!roomId || !participantId) return;
    if (typeof roomId !== 'string' || roomId.length > 200) return;
    if (typeof participantId !== 'string' || participantId.length > 128) return;

    // ✅ 이미 같은 방에 같은 pid로 join된 소켓이면 skip (중복 방지)
    if (socket.roomId === roomId && socket.data.participantId === participantId) {
      const langCode = fromLang ? mapLang(fromLang) : null;
      if (langCode) {
        const meta = ensureRoomMeta(roomId);
        const rec = SOCKET_ROLES.get(socket.id) || {};
        if (rec.role === "owner") meta.ownerLang = langCode;
        else meta.guestLang = langCode;
        if (meta.participants[participantId]) {
          meta.participants[participantId].lang = langCode;
          meta.participants[participantId].socketId = socket.id;
        }
        ROOMS.set(roomId, meta);
        emitRoutes(roomId);
      }
      // Resend identity + room context on reconnect
      const m = ensureRoomMeta(roomId);
      const existing = m.participants[participantId];
      if (m.roomType === "oneToOne") {
        // Re-send partner info for 1:1
        socket.emit("room-context", { siteContext: m.siteContext, locked: m.locked, roomType: m.roomType });
        // Immediately send partner info (cached adapted name or native name)
        const otherPid = Object.keys(m.participants).find(p => p !== participantId);
        if (otherPid && m.participants[otherPid]) {
          const peer = m.participants[otherPid];
          const myLang = m.participants[participantId]?.lang || "en";
          const adaptedName = peer.adaptedNames?.[myLang] || peer.nativeName || "";
          socket.emit("partner-info", {
            roomId,
            peerUserId: otherPid,
            peerCanonicalName: peer.nativeName || "",
            peerLocalizedName: adaptedName,
            partnerName: adaptedName,
            partnerNativeName: peer.nativeName || "",
            peerLang: peer.lang || "en",
          });
        }
        generateNameAdaptations(roomId).catch(() => {});
      } else if (existing?.callSign) {
        socket.emit("call-sign-assigned", { callSign: existing.callSign, siteContext: m.siteContext });
        socket.emit("room-context", {
          siteContext: m.siteContext, locked: m.locked, roomType: m.roomType,
          roles: SITE_ROLES[m.siteContext] || SITE_ROLES.general,
        });
      }
      return;
    }

    const meta = ensureRoomMeta(roomId);

    // ── 1:1 인원 제한: 방 타입이 oneToOne이면 최대 2명 ──
    if (meta.roomType === "oneToOne") {
      const currentPids = Object.keys(meta.participants);
      const isReconnect = currentPids.includes(participantId);
      if (!isReconnect && currentPids.length >= 2) {
        console.log(`[JOIN] ❌ 1:1 room full: ${roomId} (${currentPids.length} ppl)`);
        socket.emit("room-full", { roomId });
        return;
      }
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.data.participantId = participantId;

    let serverRole = meta.ownerPid && meta.ownerPid === participantId ? "owner" : "guest";
    if (roleHint === "owner") {
      serverRole = "owner";
      meta.ownerPid = participantId;
    } else if (roleHint === "guest") {
      serverRole = "guest";
    }
    SOCKET_ROLES.set(socket.id, { role: serverRole });

    const langCode = fromLang ? mapLang(fromLang) : null;
    if (langCode) {
      if (serverRole === "owner") meta.ownerLang = langCode;
      else meta.guestLang = langCode;
    }

    const existing = meta.participants[participantId];
    const pLang = langCode || existing?.lang || (serverRole === "owner" ? meta.ownerLang : meta.guestLang) || "auto";
    const peerLabelFromLang = (lang) => {
      const key = String(lang || "").toLowerCase().split("-")[0];
      const m = {
        ko: "KOR", vi: "VNM", zh: "CHN", en: "ENG", ja: "JPN",
        th: "THA", km: "KHM", my: "MMR", id: "IDN", mn: "MNG",
        uz: "UZB", ne: "NPL", tl: "PHL", ms: "MYS", lo: "LAO",
        bn: "BGD", hi: "IND", ur: "PAK", ta: "TAM", si: "SIN",
        ar: "ARA", fa: "IRN", tr: "TUR", he: "ISR", ku: "KUR",
        ps: "AFG", ka: "GEO", hy: "ARM", az: "AZE", kk: "KAZ",
        ky: "KGZ", tg: "TJK", tk: "TKM", ru: "RUS", uk: "UKR",
        de: "DEU", fr: "FRA", es: "ESP", pt: "PRT", it: "ITA",
        nl: "NLD", pl: "POL", el: "GRC", ro: "ROU", hu: "HUN",
        cs: "CZE", sk: "SVK", bg: "BGR", hr: "HRV", sr: "SRB",
        sv: "SWE", da: "DNK", nb: "NOR", fi: "FIN", et: "EST",
        lv: "LVA", lt: "LTU", sw: "SWA", am: "ETH", zu: "ZUL",
        ha: "HAU", yo: "YOR", so: "SOM",
      };
      return m[key] || key.toUpperCase();
    };
    const peerFlagUrlFromLang = (lang) => {
      const key = String(lang || "").toLowerCase().split("-")[0];
      const m = {
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
      const cc = m[key] || "un";
      return `https://flagcdn.com/w40/${cc}.png`;
    };

    if (meta.roomType === "oneToOne") {
      // ══════════════ 1:1 ROOM: name-based identity, no call signs ══════════════
      const nativeName =
        localName?.trim()
        || existing?.nativeName
        || `참여자${Object.keys(meta.participants).length + 1}`;
      meta.participants[participantId] = {
        nativeName,
        lang: pLang,
        socketId: socket.id,
        adaptedNames: existing?.adaptedNames || {},
      };

      console.log(`[JOIN:1:1] ${socket.id} "${nativeName}" -> ${roomId}`);
      ROOMS.set(roomId, meta);
      emitRoutes(roomId);
      emitParticipants(roomId);
      try {
        const room = io.sockets.adapter.rooms.get(roomId);
        const memberCount = room?.size || 0;
        const hostSocketId = meta.ownerPid && meta.participants?.[meta.ownerPid]?.socketId
          ? meta.participants[meta.ownerPid].socketId
          : null;
        const hostInRoom = hostSocketId ? !!room?.has(hostSocketId) : false;
        console.log(`[SERVER] Room ${roomId} — members: ${memberCount}, host socket in room: ${hostInRoom}`);
      } catch {}

      socket.emit("room-context", {
        siteContext: meta.siteContext, locked: meta.locked, roomType: meta.roomType,
      });

      // guest:joined
      if (serverRole === "guest") {
        console.log(`[GUEST] Joined room: ${roomId}, Socket: ${socket.id}`);
        socket.to(roomId).emit("guest:joined", {
          roomId, socketId: socket.id, lang: fromLang || "auto",
        });
        socket.to(roomId).emit("partner-joined", {
          roomId,
          peerLang: pLang || fromLang || "en",
          peerFlagUrl: peerFlagUrlFromLang(pLang || fromLang || "en"),
          peerLabel: peerLabelFromLang(pLang || fromLang || "en"),
        });
        const room = io.sockets.adapter.rooms.get(roomId);
        socket.to(roomId).emit("sync-room-state", {
          roomId,
          memberCount: room?.size || 0,
        });
      }

      // If both participants present → immediately send native names + generate adapted names
      const pids = Object.keys(meta.participants);
      if (pids.length === 2) {
        const [pidA, pidB] = pids;
        const pA = meta.participants[pidA];
        const pB = meta.participants[pidB];
        // Immediate fallback: send native names so UI never shows blank
        if (pA?.socketId && pB?.nativeName) {
          io.to(pA.socketId).emit("partner-info", {
            roomId,
            peerUserId: pidB,
            peerCanonicalName: pB.nativeName,
            peerLocalizedName: pB.nativeName,
            partnerName: pB.nativeName,
            partnerNativeName: pB.nativeName,
            peerLang: pB.lang || "en",
          });
        }
        if (pB?.socketId && pA?.nativeName) {
          io.to(pB.socketId).emit("partner-info", {
            roomId,
            peerUserId: pidA,
            peerCanonicalName: pA.nativeName,
            peerLocalizedName: pA.nativeName,
            partnerName: pA.nativeName,
            partnerNativeName: pA.nativeName,
            peerLang: pA.lang || "en",
          });
        }
        // Header-safe peer signal for both sides (host/guest): always emit when 1:1 pair is complete.
        if (pA?.socketId) {
          io.to(pA.socketId).emit("partner-joined", {
            roomId,
            peerLang: pB?.lang || "en",
            peerFlagUrl: peerFlagUrlFromLang(pB?.lang || "en"),
            peerLabel: peerLabelFromLang(pB?.lang || "en"),
          });
        }
        if (pB?.socketId) {
          io.to(pB.socketId).emit("partner-joined", {
            roomId,
            peerLang: pA?.lang || "en",
            peerFlagUrl: peerFlagUrlFromLang(pA?.lang || "en"),
            peerLabel: peerLabelFromLang(pA?.lang || "en"),
          });
        }
        // Async: generate localized adapted names (will re-emit partner-info)
        generateNameAdaptations(roomId).catch(e => console.warn("[adapt]", e?.message));
      }

    } else {
      // ══════════════ BROADCAST ROOM: call sign system ══════════════
      let callSign;
      if (existing?.callSign) {
        callSign = existing.callSign;
      } else {
        const csRole = selectedRole || (serverRole === "owner" ? "Manager" : "Tech");
        callSign = assignCallSign(meta, csRole);
      }

      meta.participants[participantId] = {
        callSign,
        localName: localName || existing?.localName || "",
        role: existing?.role || selectedRole || (serverRole === "owner" ? "Manager" : "Tech"),
        lang: pLang,
        socketId: socket.id,
        phoneticVariants: existing?.phoneticVariants || generateCallSignPhonetics(callSign),
      };

      console.log(`[JOIN:BC] ${socket.id} [${callSign}] -> ${roomId}`);
      ROOMS.set(roomId, meta);
      emitRoutes(roomId);
      emitParticipants(roomId);

      socket.emit("call-sign-assigned", { callSign, siteContext: meta.siteContext });
      socket.emit("room-context", {
        siteContext: meta.siteContext, locked: meta.locked, roomType: meta.roomType,
        roles: SITE_ROLES[meta.siteContext] || SITE_ROLES.general,
      });

      if (serverRole === "guest") {
        socket.to(roomId).emit("guest:joined", {
          roomId, socketId: socket.id, lang: fromLang || "auto", callSign,
        });
      }
    }

    // Restore missed messages (common)
    const missed = (messageBuffer[roomId] || []).filter(
      (m) => m.senderPid !== participantId
    );
    if (missed.length > 0) {
      socket.emit(
        "recent-messages",
        missed.map((m) => ({
          id: m.id,
          roomId,
          roomType: meta.roomType || "oneToOne",
          senderPid: m.senderPid,
          senderCallSign: m.senderCallSign || "",
          senderDisplayName: m.senderDisplayName || "",
          originalText: m.originalText || m.text || "",
          translatedText: m.translatedText || m.text || "",
          text: m.text || m.translatedText || m.originalText || "",
          timestamp: Number(m.time || Date.now()),
        }))
      );
      console.log(`📩 Restored ${missed.length} msgs for ${participantId} in ${roomId}`);
    }
  });

  socket.on("heartbeat", ({ roomId, userId } = {}) => {
    socket.emit("heartbeat-ack", {
      roomId: roomId || socket.roomId || "",
      userId: userId || socket.data?.participantId || "",
      timestamp: Date.now(),
    });
  });

  socket.on('register', ({ role, lang }) => {
    if (!socket.roomId) return;
    const meta = ensureRoomMeta(socket.roomId);
    SOCKET_ROLES.set(socket.id, { role: role === 'owner' ? 'owner' : 'guest' });

    const code = mapLang(lang || 'en');

    if (role === 'owner')  meta.ownerLang = code || 'auto';
    else                   meta.guestLang = code || 'auto';

    ROOMS.set(socket.roomId, meta);
    emitRoutes(socket.roomId);
    console.log(`📝 room=${socket.roomId} role=${role} lang=${code} ->`, meta);
  });

  socket.on('set-lang', ({ roomId, lang }) => {
    if (!roomId || !lang) return;
    const meta = ensureRoomMeta(roomId);
    const rec  = SOCKET_ROLES.get(socket.id) || { role: !meta.ownerLang ? 'owner' : 'guest' };
    SOCKET_ROLES.set(socket.id, rec);
  
    const code = mapLang(lang);
    if (rec.role === 'owner') meta.ownerLang = code;
    else meta.guestLang = code;
  
    ROOMS.set(roomId, meta);
    emitRoutes(roomId);
  });

  // --- STT streaming (AudioWorklet + VAD) ---
  socket.on("stt:open", ({ roomId, lang, participantId, sampleRateHz = 16000 }) => {
    if (!roomId || !participantId) return;
    if (!isAuthorizedParticipant(socket, roomId, participantId)) {
      console.warn(`[auth] stt:open rejected room=${roomId} pid=${participantId} sid=${socket.id}`);
      return;
    }
    const meta = ensureRoomMeta(roomId);
    if (!SOCKET_ROLES.get(socket.id)) {
      const role = meta.ownerPid && meta.ownerPid === participantId ? "owner" : "guest";
      SOCKET_ROLES.set(socket.id, { role });
    }
    const role = SOCKET_ROLES.get(socket.id)?.role;
    const langCode = lang && lang !== "auto" ? mapLang(lang) : null;
    if (langCode) {
      if (role === "owner") meta.ownerLang = langCode;
      else meta.guestLang = langCode;
      ROOMS.set(roomId, meta);
      emitRoutes(roomId);
    }
    STT_SESSIONS.set(socket.id, {
      roomId,
      lang: langCode,
      participantId,
      sampleRateHz,
      chunks: [],
      bytes: 0,
    });
  });

  socket.on("stt:audio", ({ roomId, audio, participantId, sampleRateHz }) => {
    if (!consumeRate(socket.id, 'stt:audio', LIMITS.STT_AUDIO_PER_10S, 10000)) {
      return;
    }
    const session = STT_SESSIONS.get(socket.id);
    if (!session || !audio || !roomId || !participantId) return;
    if (session.roomId !== roomId) return;
    if (!isAuthorizedParticipant(socket, roomId, participantId)) {
      console.warn(`[auth] stt:audio rejected room=${roomId} pid=${participantId} sid=${socket.id}`);
      return;
    }
    if (typeof audio !== 'string' || audio.length > LIMITS.MAX_AUDIO_BASE64_CHARS) {
      console.warn(`[stt:audio] payload too large sid=${socket.id} len=${audio?.length || 0}`);
      return;
    }

    const buf = Buffer.from(audio, "base64");
    session.chunks.push(buf);
    session.bytes += buf.length;
    if (sampleRateHz) session.sampleRateHz = sampleRateHz;

    const maxBytes = 16000 * 2 * 30; // 30초 상한
    if (session.bytes > maxBytes) {
      session.chunks = [];
      session.bytes = 0;
    }
  });

  socket.on("stt:segment_end", async ({ roomId, participantId }) => {
    if (!consumeRate(socket.id, 'stt:segment_end', LIMITS.STT_SEGMENT_END_PER_30S, 30000)) {
      return;
    }
    const session = STT_SESSIONS.get(socket.id);
    if (!session || !roomId || !participantId) return;
    if (session.roomId !== roomId) return;
    if (!isAuthorizedParticipant(socket, roomId, participantId)) {
      console.warn(`[auth] stt:segment_end rejected room=${roomId} pid=${participantId} sid=${socket.id}`);
      return;
    }

    if (!session.chunks.length) return;
    const pcm = Buffer.concat(session.chunks);
    session.chunks = [];
    session.bytes = 0;

    const durationSec = pcm.length / (2 * (session.sampleRateHz || 16000));
    console.log(`[stt:segment] pid=${participantId} duration=${durationSec.toFixed(2)}s bytes=${pcm.length}`);
    socket.emit("stt:segment-received", {
      roomId,
      participantId,
      bytes: pcm.length,
      durationSec,
    });
    if (durationSec < 0.25) { console.log("[stt:segment] ⏭ too short"); return; }

    let text = "";
    try {
      text = await transcribePcm16(pcm, session.lang, session.sampleRateHz);
      text = normalizeRepeats(text);
      console.log(`[stt:segment] 🎙 STT result: "${text}"`);
    } catch (e) {
      console.warn("[stt] transcribe error:", e?.message);
      if (isQuotaExceededError(e)) emitQuotaWarning(socket);
      return;
    }
    if (!text || isGarbageText(text)) { console.log("[stt:segment] ⏭ garbage/empty"); return; }
    if (text.trim().length <= 2 && durationSec < 0.8) { console.log("[stt:segment] ⏭ too short text"); return; }

    const meta = ensureRoomMeta(roomId);
    const rec = SOCKET_ROLES.get(socket.id) || {};
    const senderParticipant = meta.participants[participantId];
    const registeredLang = senderParticipant?.lang || (rec.role === "owner" ? meta.ownerLang : meta.guestLang);
    // ✅ 실제 발화 언어 감지: STT 결과의 스크립트를 분석하여 등록 언어와 다르면 실제 언어 사용
    const detectedLang = detectTextLang(text);
    const fromLang = detectedLang || registeredLang;
    if (detectedLang && detectedLang !== registeredLang) {
      console.log(`[stt:lang] ⚠ registered=${registeredLang} detected=${detectedLang} → using ${fromLang}`);
    }
    const siteCtx = meta.siteContext || "general";
    const senderCallSign = senderParticipant?.callSign || "";

    const emitTranslated = async (finalText) => {
      if (!finalText || isGarbageText(finalText)) return;
      const roomType = meta.roomType || "oneToOne";
      const msgId = uuidv4();

      // ══════════════════════════════════════
      // A. ONE-TO-ONE ROOM — always send to the other person
      // ══════════════════════════════════════
      if (roomType === "oneToOne") {
        const otherPid = Object.keys(meta.participants).find(p => p !== participantId);
        if (!otherPid) { console.log("[1:1] no other participant"); return; }
        const otherP = meta.participants[otherPid];
        const toLang = otherP?.lang || "en";

        // Resolve sender display name for receiver's language
        const senderP = meta.participants[participantId];
        const senderDisplayName = senderP?.adaptedNames?.[toLang] || senderP?.nativeName || "";

        let translated = finalText;
        if (fromLang !== toLang) {
          try {
            translated = await fastTranslate(finalText, fromLang, toLang, "", siteCtx);
            console.log(`[1:1:translate] ✅ "${translated.slice(0,60)}"`);
          } catch (e) { console.warn("[translate]:", e?.message); }
        }
        if (isGarbageText(translated)) return;

        // → Other (sender name adapted to receiver's language)
        if (otherP?.socketId) {
          io.to(otherP.socketId).emit("receive-message", {
            id: msgId, roomId, roomType,
            senderPid: participantId,
            senderDisplayName,
            senderCallSign: senderDisplayName,
            originalText: finalText, translatedText: translated,
            text: translated || finalText,
            isDraft: true, at: Date.now(), timestamp: Date.now(),
          });
        socket.emit("message-status", {
          roomId,
          messageId: msgId,
          participantId: otherPid,
          status: "delivered",
          at: Date.now(),
        });
        }
        // Always send push for background/lock-screen reliability.
        // SW suppresses notification when app window is visible.
        const otherUid = Object.keys(meta.participants).find(p => p !== participantId);
        if (otherUid) {
          sendPushToUser(otherUid, {
            title: senderDisplayName || 'MONO',
            body: translated?.substring(0, 80) || finalText?.substring(0, 80) || '',
            roomId,
            senderName: senderDisplayName,
            url: `/room/${roomId}`,
          }).catch(() => {});
        }
        // → Sender echo
        socket.emit("receive-message", {
          id: msgId, roomId, roomType,
          senderPid: participantId,
          senderCallSign: senderP?.nativeName || "",
          originalText: finalText, translatedText: finalText,
          text: finalText,
          isDraft: true, at: Date.now(), timestamp: Date.now(),
        });

        // Make TTS follow the same finalized sentence shown in UI.
        let finalizedForTts = translated;
        try {
          const hq = await hqTranslate(finalText, fromLang, toLang, "", siteCtx);
          if (!isGarbageText(hq) && otherP?.socketId) {
            finalizedForTts = hq;
            io.to(otherP.socketId).emit("revise-message", {
              id: msgId, senderPid: participantId, translatedText: hq, isDraft: false,
            });
          }
        } catch (e) { console.warn("[hq]:", e?.message); }
        try {
          const ttsBuffer = await synthesizeSpeech(finalizedForTts, toLang);
          if (ttsBuffer && otherP?.socketId) {
            io.to(otherP.socketId).emit("tts_audio", {
              senderPid: participantId, format: "mp3",
              audio: ttsBuffer.toString("base64"),
            });
          }
        } catch (e) { console.warn("[tts]:", e?.message); }
        return;
      }

      // ══════════════════════════════════════
      // B. BROADCAST ROOM — owner speaks, listeners receive
      // ══════════════════════════════════════
      if (rec.role !== "owner") {
        console.log("[broadcast] ⏭ non-owner tried to send");
        return;
      }

      // Optional targeted routing via call sign
      const csMatch = matchCallSign(finalText, meta.participants, participantId);
      if (csMatch?.targetPid) {
        const targetP = meta.participants[csMatch.targetPid];
        if (!targetP) return;
        const cleanText = stripCallSign(finalText, csMatch.matchedVariant);
        if (isGarbageText(cleanText)) return;
        console.log(`[broadcast:target] ✅ [${senderCallSign}] → [${targetP.callSign}]`);

        const toLang = targetP.lang || "en";
        let translated = cleanText;
        if (fromLang !== toLang) {
          try { translated = await fastTranslate(cleanText, fromLang, toLang, "", siteCtx); }
          catch (e) { console.warn("[translate]:", e?.message); }
        }

        if (targetP.socketId) {
          io.to(targetP.socketId).emit("receive-message", {
            id: msgId, roomId, roomType,
            senderPid: participantId, senderCallSign,
            originalText: cleanText, translatedText: translated,
            text: translated || cleanText,
            isDraft: true, at: Date.now(), timestamp: Date.now(),
          });
        }
        sendPushToUser(csMatch.targetPid, {
          title: senderCallSign || 'MONO',
          body: translated?.substring(0, 80) || cleanText?.substring(0, 80) || '',
          roomId,
          senderName: senderCallSign,
          url: `/room/${roomId}`,
        }).catch(() => {});
        // Echo to sender
        socket.emit("receive-message", {
          id: msgId, roomId, roomType,
          senderPid: participantId, senderCallSign,
          originalText: cleanText, translatedText: cleanText,
          text: cleanText,
          isDraft: true, at: Date.now(), timestamp: Date.now(),
        });

        let finalizedForTts = translated;
        try {
          const hq = await hqTranslate(cleanText, fromLang, toLang, "", siteCtx);
          if (!isGarbageText(hq) && targetP.socketId) {
            finalizedForTts = hq;
            io.to(targetP.socketId).emit("revise-message", { id: msgId, senderPid: participantId, translatedText: hq, isDraft: false });
          }
        } catch (e) {}
        try {
          const ttsBuffer = await synthesizeSpeech(finalizedForTts, toLang);
          if (ttsBuffer && targetP.socketId) {
            io.to(targetP.socketId).emit("tts_audio", { senderPid: participantId, format: "mp3", audio: ttsBuffer.toString("base64") });
          }
        } catch (e) {}
        return;
      }

      // ── Broadcast fan-out: per-language translation ──
      const langGroups = {};
      for (const [pid, p] of Object.entries(meta.participants)) {
        if (pid === participantId) continue;
        const lang = p.lang || "en";
        if (!langGroups[lang]) langGroups[lang] = [];
        langGroups[lang].push(p);
      }
      console.log(`[broadcast] fan-out to ${Object.keys(langGroups).length} language(s)`);

      for (const [lang, listeners] of Object.entries(langGroups)) {
        let translated = finalText;
        if (fromLang !== lang) {
          try { translated = await fastTranslate(finalText, fromLang, lang, "", siteCtx); }
          catch (e) { console.warn("[translate]:", e?.message); }
        }
        if (isGarbageText(translated)) continue;

        for (const listener of listeners) {
          const listenerPid = Object.keys(meta.participants).find(
            pid => meta.participants[pid] === listener
          );
          if (listener.socketId) {
            io.to(listener.socketId).emit("receive-message", {
              id: msgId, roomId, roomType,
              senderPid: participantId, senderCallSign,
              originalText: finalText, translatedText: translated,
              text: translated || finalText,
              isDraft: true, at: Date.now(), timestamp: Date.now(),
            });
          }
          if (listenerPid) {
            sendPushToUser(listenerPid, {
              title: senderCallSign || 'MONO',
              body: translated?.substring(0, 80) || '',
              roomId,
              senderName: senderCallSign,
              url: `/room/${roomId}`,
            }).catch(() => {});
          }
        }
        let finalizedForTts = translated;
        try {
          const hq = await hqTranslate(finalText, fromLang, lang, "", siteCtx);
          if (!isGarbageText(hq)) {
            finalizedForTts = hq;
            for (const listener of listeners) {
              if (listener.socketId) {
                io.to(listener.socketId).emit("revise-message", { id: msgId, senderPid: participantId, translatedText: hq, isDraft: false });
              }
            }
          }
        } catch (e) {}
        // TTS per language group (uses finalized text shown in UI)
        try {
          const ttsBuffer = await synthesizeSpeech(finalizedForTts, lang);
          if (ttsBuffer) {
            for (const listener of listeners) {
              if (listener.socketId) {
                io.to(listener.socketId).emit("tts_audio", { senderPid: participantId, format: "mp3", audio: ttsBuffer.toString("base64") });
              }
            }
          }
        } catch (e) {}
      }

      // Echo to sender
      socket.emit("receive-message", {
        id: msgId, roomId, roomType,
        senderPid: participantId, senderCallSign,
        originalText: finalText, translatedText: finalText,
        text: finalText,
        isDraft: true, at: Date.now(), timestamp: Date.now(),
      });
    };

    const trimmed = text.trim();
    const endsWithPunct = /[.!?。！？]$/.test(trimmed);
    const shortFragment = trimmed.length < 20 && !endsWithPunct;
    const key = sttBufferKey(roomId, participantId);

    if (shortFragment) {
      const existing = STT_TEXT_BUFFER.get(key);
      const nextText = existing ? `${existing.text} ${trimmed}`.replace(/\s+/g, " ").trim() : trimmed;
      if (existing?.timer) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        const buf = STT_TEXT_BUFFER.get(key);
        if (!buf) return;
        STT_TEXT_BUFFER.delete(key);
        emitTranslated(buf.text);
      }, 1200);
      STT_TEXT_BUFFER.set(key, { text: nextText, timer });
      return;
    }

    const buffered = STT_TEXT_BUFFER.get(key);
    if (buffered) {
      if (buffered.timer) clearTimeout(buffered.timer);
      STT_TEXT_BUFFER.delete(key);
      text = `${buffered.text} ${trimmed}`.replace(/\s+/g, " ").trim();
    }
    await emitTranslated(text);
  });

  socket.on("stt:close", () => {
    const session = STT_SESSIONS.get(socket.id);
    STT_SESSIONS.delete(socket.id);
    if (session) {
      const key = sttBufferKey(session.roomId, session.participantId);
      const buffered = STT_TEXT_BUFFER.get(key);
      if (buffered?.timer) clearTimeout(buffered.timer);
      STT_TEXT_BUFFER.delete(key);
    }
  });

  // --- send-message 핸들러 (room-type aware) ---
  socket.on('send-message', async ({ roomId, message, participantId }, ack) => {
    const ackReply = (payload) => {
      if (typeof ack === "function") {
        try { ack(payload); } catch {}
      }
    };
    if (!consumeRate(socket.id, 'send-message', LIMITS.SEND_MESSAGE_PER_10S, 10000)) {
      console.warn(`[rate] send-message throttled sid=${socket.id}`);
      ackReply({ ok: false, error: "rate_limited" });
      return;
    }
    if (!roomId || !message || !participantId) {
      console.log(`[send-message] ❌ 누락: room=${roomId} msg=${!!message} pid=${participantId}`);
      ackReply({ ok: false, error: "invalid_payload" });
      return;
    }
    if (!isAuthorizedParticipant(socket, roomId, participantId)) {
      console.warn(`[auth] send-message rejected room=${roomId} pid=${participantId} sid=${socket.id}`);
      ackReply({ ok: false, error: "unauthorized" });
      return;
    }

    const { id, text } = message;
    if (!id || typeof id !== 'string' || id.length > 128) {
      ackReply({ ok: false, error: "invalid_message_id" });
      return;
    }
    if (typeof text !== 'string') {
      ackReply({ ok: false, error: "invalid_text" });
      return;
    }
    const trimmedText = text.trim();
    if (!trimmedText) {
      ackReply({ ok: false, error: "empty_text" });
      return;
    }
    if (trimmedText.length > LIMITS.MAX_MESSAGE_CHARS) {
      console.warn(`[send-message] text too long pid=${participantId} len=${trimmedText.length}`);
      ackReply({ ok: false, error: "text_too_long" });
      return;
    }
    if (isRecentDuplicateMessage(roomId, id)) {
      ackReply({ ok: true, duplicate: true });
      return;
    }
    const meta = ensureRoomMeta(roomId);
    const senderP = meta.participants[participantId];
    const senderCallSign = senderP?.callSign || "";
    const siteCtx = meta.siteContext || "general";
    const roomType = meta.roomType || "oneToOne";
    const rec = SOCKET_ROLES.get(socket.id) || {};
    console.log(`[send-message] 📨 [${senderCallSign}] room=${roomId} (${roomType}) text="${(trimmedText||"").slice(0,40)}"`);

    if (!messageBuffer[roomId]) messageBuffer[roomId] = [];
    messageBuffer[roomId].push({ id, text: trimmedText, senderPid: participantId, senderCallSign, time: Date.now() });
    if (messageBuffer[roomId].length > 200) messageBuffer[roomId].shift();
    ackReply({ ok: true, accepted: true });

    const registeredLang = senderP?.lang || (rec.role === 'owner' ? meta.ownerLang : meta.guestLang);
    const detectedLang = detectTextLang(trimmedText);
    const fromLang = detectedLang || registeredLang;

    // ══════════════════════════════════════
    // A. ONE-TO-ONE — always send to the other person
    // ══════════════════════════════════════
    if (roomType === "oneToOne") {
      const otherPid = Object.keys(meta.participants).find(p => p !== participantId);
      if (!otherPid) return;
      const otherP = meta.participants[otherPid];
      const toLang = otherP?.lang || "en";

      // Sender's display name adapted to receiver's language
      const senderDisplayName = senderP?.adaptedNames?.[toLang] || senderP?.nativeName || "";

      let draft = trimmedText;
      if (fromLang !== toLang) {
        try { draft = await fastTranslate(trimmedText, fromLang, toLang, '', siteCtx); }
        catch (e) {
          console.warn('[translate]:', e.message);
          if (isQuotaExceededError(e)) emitQuotaWarning(socket);
        }
      }

      // → Other (sender name adapted to receiver's language)
      if (otherP?.socketId) {
        io.to(otherP.socketId).emit('receive-message', {
          id, roomId, roomType,
          senderPid: participantId,
          senderDisplayName,
          senderCallSign: senderDisplayName,
          originalText: trimmedText, translatedText: draft,
          text: draft || trimmedText,
          isDraft: true, at: Date.now(), timestamp: Date.now(),
        });
        io.to(otherP.socketId).emit("notify", { title: senderDisplayName || "MONO", body: draft?.substring(0, 50) || "" });
        socket.emit("message-status", {
          roomId,
          messageId: id,
          participantId: otherPid,
          status: "delivered",
          at: Date.now(),
        });
      }
      // Always send push for background/lock-screen reliability.
      sendPushToUser(otherPid, {
        title: senderDisplayName || 'MONO',
        body: draft?.substring(0, 80) || trimmedText?.substring(0, 80) || '',
        roomId,
        senderName: senderDisplayName,
        url: `/room/${roomId}`,
      }).catch(() => {});

      let finalizedForTts = draft;
      try {
        const hq = await hqTranslate(trimmedText, fromLang, toLang, '', siteCtx);
        if (!isGarbageText(hq) && otherP?.socketId) {
          finalizedForTts = hq;
          io.to(otherP.socketId).emit('revise-message', { id, senderPid: participantId, translatedText: hq, isDraft: false });
        }
      } catch (e) {}
      // TTS → other (typed messages also get spoken)
      try {
        const ttsBuffer = await synthesizeSpeech(finalizedForTts, toLang);
        if (ttsBuffer && otherP?.socketId) {
          io.to(otherP.socketId).emit("tts_audio", {
            senderPid: participantId, format: "mp3",
            audio: ttsBuffer.toString("base64"),
          });
        }
      } catch (e) { console.warn("[tts:send-msg]:", e?.message); }
      return;
    }

    // ══════════════════════════════════════
    // B. BROADCAST — owner only, per-language fan-out
    // ══════════════════════════════════════
    if (rec.role !== "owner") {
      console.log("[broadcast:send-msg] ⏭ non-owner blocked");
      return;
    }

    // Optional targeted routing via call sign
    const csMatch = matchCallSign(trimmedText, meta.participants, participantId);
    if (csMatch?.targetPid) {
      const targetP = meta.participants[csMatch.targetPid];
      if (!targetP) return;
      const cleanText = stripCallSign(trimmedText, csMatch.matchedVariant);
      if (isGarbageText(cleanText)) return;

      const toLang = targetP.lang || "en";
      let draft = cleanText;
      if (fromLang !== toLang) {
        try { draft = await fastTranslate(cleanText, fromLang, toLang, '', siteCtx); }
        catch (e) {
          console.warn('[translate]:', e.message);
          if (isQuotaExceededError(e)) emitQuotaWarning(socket);
        }
      }

      if (targetP.socketId) {
        io.to(targetP.socketId).emit('receive-message', {
            id, roomId, roomType,
            senderPid: participantId, senderCallSign,
          originalText: cleanText, translatedText: draft,
            text: draft || cleanText,
            isDraft: true, at: Date.now(), timestamp: Date.now(),
        });
      }
      sendPushToUser(csMatch.targetPid, {
        title: senderCallSign || 'MONO',
        body: draft?.substring(0, 80) || cleanText?.substring(0, 80) || '',
        roomId,
        senderName: senderCallSign,
        url: `/room/${roomId}`,
      }).catch(() => {});
      let finalizedForTts = draft;
      try {
        const hq = await hqTranslate(cleanText, fromLang, toLang, '', siteCtx);
        if (!isGarbageText(hq) && targetP.socketId) {
          finalizedForTts = hq;
          io.to(targetP.socketId).emit('revise-message', { id, senderPid: participantId, translatedText: hq, isDraft: false });
        }
      } catch (e) {}
      try {
        const ttsBuffer = await synthesizeSpeech(finalizedForTts, toLang);
        if (ttsBuffer && targetP.socketId) {
          io.to(targetP.socketId).emit("tts_audio", {
            senderPid: participantId, format: "mp3",
            audio: ttsBuffer.toString("base64"),
          });
        }
      } catch (e) {}
      return;
    }

    // Fan-out per language
    const langGroups = {};
    for (const [pid, p] of Object.entries(meta.participants)) {
      if (pid === participantId) continue;
      const lang = p.lang || "en";
      if (!langGroups[lang]) langGroups[lang] = [];
      langGroups[lang].push(p);
    }

    for (const [lang, listeners] of Object.entries(langGroups)) {
      let draft = trimmedText;
      if (fromLang !== lang) {
        try { draft = await fastTranslate(trimmedText, fromLang, lang, '', siteCtx); }
        catch (e) {
          console.warn('[translate]:', e.message);
          if (isQuotaExceededError(e)) emitQuotaWarning(socket);
        }
      }
      for (const listener of listeners) {
        const listenerPid = Object.keys(meta.participants).find(
          pid => meta.participants[pid] === listener
        );
        if (listener.socketId) {
          io.to(listener.socketId).emit('receive-message', {
            id, roomId, roomType,
            senderPid: participantId, senderCallSign,
            originalText: trimmedText, translatedText: draft,
            text: draft || trimmedText,
            isDraft: true, at: Date.now(), timestamp: Date.now(),
          });
          io.to(listener.socketId).emit("notify", { title: "MONO", body: draft?.substring(0, 50) || "" });
        }
        if (listenerPid) {
          sendPushToUser(listenerPid, {
            title: senderCallSign || 'MONO',
            body: draft?.substring(0, 80) || '',
            roomId,
            senderName: senderCallSign,
            url: `/room/${roomId}`,
          }).catch(() => {});
        }
      }
      let finalizedForTts = draft;
      // HQ revision per language group
      try {
        const hq = await hqTranslate(trimmedText, fromLang, lang, '', siteCtx);
        if (!isGarbageText(hq)) {
          finalizedForTts = hq;
          for (const listener of listeners) {
            if (listener.socketId) {
              io.to(listener.socketId).emit('revise-message', { id, senderPid: participantId, translatedText: hq, isDraft: false });
            }
          }
        }
      } catch (e) {}
      // TTS per language group (broadcast typed messages)
      try {
        const ttsBuffer = await synthesizeSpeech(finalizedForTts, lang);
        if (ttsBuffer) {
          for (const listener of listeners) {
            if (listener.socketId) {
              io.to(listener.socketId).emit("tts_audio", {
                senderPid: participantId, format: "mp3",
                audio: ttsBuffer.toString("base64"),
              });
            }
          }
        }
      } catch (e) {}
    }
  });

  socket.on('disconnect', (reason) => {
    const roomId = socket.roomId;
    console.log(`🔴 ${socket.id} disconnected from room ${roomId} (${reason})`);

    // Clear socketId in USER_REGISTRY
    const uid = socket.data?.userId;
    if (uid) {
      const u = USER_REGISTRY.get(uid);
      if (u && u.socketId === socket.id) u.socketId = null;
    }

    if (!roomId) return;
    SOCKET_ROLES.delete(socket.id);
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    const remaining = roomSockets ? roomSockets.size : 0;

    // ✅ 수정: 방 즉시 삭제 → 유예 후 삭제로 변경
    if (remaining === 0) {
      // ✅ 모바일 백그라운드/공유 시 끊김 대비: 방 삭제 유예 (기본 30초, 필요 시 늘림)
      setTimeout(() => {
        const room = io.sockets.adapter.rooms.get(roomId);
        if (!room || room.size === 0) {
          ROOMS.delete(roomId);
          delete messageBuffer[roomId];
          console.log(`💨 Room ${roomId} removed after grace period`);
        } else {
          console.log(`🟢 Room ${roomId} survived grace period`);
        }
      }, 300_000); // 5분 유예 (모바일 백그라운드 재접속 대비)
    } else {
      console.log(`👤 Room ${roomId} has ${remaining} socket(s) remaining`);
    }
  });

  socket.on('reconnect', () => {
    if (socket.roomId) {
      socket.join(socket.roomId);
      console.log(`🔄 ${socket.id} rejoined room ${socket.roomId}`);
    }
  });

  socket.conn.on("close", (reason) => {
    console.log(`⚠️ Socket connection closed (${reason}), waiting for reconnect...`);
  });
});

async function sniff(buffer) {
  try {
    const {fileTypeFromBuffer} = await import('file-type');
    return fileTypeFromBuffer(buffer);
  } catch (e) {
    console.warn("File type sniffing failed:", e.message);
    return null;
  }
}

function bufferToWav(buffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = require("stream").Readable.from(buffer);
    let cmd;

    const timeout = setTimeout(() => {
        if(cmd) cmd.kill('SIGKILL');
        reject(new Error("ffmpeg timeout"));
    }, 3000);

    cmd = new Ffmpeg(stream)
      .inputFormat("webm")
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .on("end", () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
    
    cmd.pipe().on("data", c => chunks.push(c));
  });
}

const supported = new Set([
  "audio/webm", "audio/ogg", "audio/wav",
  "audio/mp3", "audio/mpeg", "audio/mp4", "audio/mpga", "audio/oga"
]);

app.post("/stt", upload.single("audio"), async (req, res) => {
  let tmpFile = null;
  try {
    if (!openai) return res.status(500).json({ error: 'openai_not_configured' });
    if (!req.file?.buffer) return res.status(400).json({ error: "no audio" });

    let buf = req.file.buffer;
    let mime = req.file.mimetype;
    
    const sniffed = await sniff(buf).catch(() => null);
    if (sniffed?.mime) mime = sniffed.mime;

    if (!supported.has(mime)) {
      console.log(`[stt] forcing conversion (${mime} -> wav)`);
      buf = await bufferToWav(buf);
      mime = "audio/wav";
    }

    tmpFile = path.join(os.tmpdir(), `${uuidv4()}.wav`);
    fs.writeFileSync(tmpFile, buf);

    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "gpt-4o-mini-transcribe",
      ...(req.body.lang ? { language: req.body.lang } : {})
    });

    res.json({ text: result.text || "" });

  } catch (err) {
    console.error("[stt] error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    if (tmpFile) {
        res.on("finish", () => {
            try { 
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile); 
                }
            } catch(e){
                console.error("Error cleaning up temp file:", e.message);
            }
        });
    }
  }
});


attachGoogleAuth(app);
attachKakaoAuth(app);
attachAuthApi(app);

app.get("/api/guess-lang", (req,res)=>{
  const code = detectFromAcceptLang(req.headers['accept-language']);
  res.json({ lang: code });
});

app.get("/healthz", async (req, res) => {
  try {
    const sockets = await io.fetchSockets();
    const roomCount = ROOMS.size;
    const socketCount = sockets.length;
    const push = countPushSubscriptions();
    res.json({
      ok: true,
      uptimeSec: Math.floor(process.uptime()),
      roomCount,
      socketCount,
      pushUsers: push.users,
      pushDevices: push.devices,
      now: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "health_check_failed" });
  }
});

// ✅ --- 정적파일 절대경로 기반 서빙 (Cloudflare 대응 버전) ---
const distPath = path.resolve(__dirname, "dist");
// 정적파일 서빙
app.use(express.static(distPath));

// ✅ Cloudflare 404 방지용 — dist 루트 fallback 절대경로 보정
// Cloudflare 터널을 통해 접근할 때 SPA 라우팅 404 방지
app.get("/", (req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).send("dist/index.html not found. Run `npm run build` first.");
  }
});

// SPA 라우팅 (React fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const MAX_PORT_RETRIES = 8;

function startServer(port, retries = 0) {
  // 이전 시도에서 등록된 once 핸들러 정리 (재시도 시 중복 로그 방지)
  server.removeAllListeners('listening');
  server.removeAllListeners('error');
  server
    .once('listening', () => {
      const actualPort = server.address()?.port;
      console.log('USING SERVER AT', __filename);
      console.log(`[server] ✅ listening`);
      console.log(`[server] requested PORT: ${port}`);
      console.log(`[server] actual PORT: ${actualPort}`);
      console.log(`[server] mode: ${IS_DEV ? 'dev' : 'prod'}`);
    })
    .once('error', (err) => {
      if (err?.code === 'EADDRINUSE') {
        console.error(`[server] ⚠ Port ${port} is already in use (EADDRINUSE)`);
        if (ENABLE_AUTO_PORT_FALLBACK && retries < MAX_PORT_RETRIES) {
          const nextPort = port + 1;
          console.warn(`[server] dev fallback → retry on :${nextPort} (${retries + 1}/${MAX_PORT_RETRIES})`);
          return setTimeout(() => startServer(nextPort, retries + 1), 150);
        }
        console.error(`[server] ❌ failed to bind port`);
        console.error(`Try manually: PowerShell -> $env:PORT="3176"; node server.js`);
        process.exit(1);
      } else {
        console.error('[server] ❌ fatal error:', err);
        process.exit(1);
      }
    });

  server.listen(port);
}

function shutdownGracefully(signal) {
  try {
    persistPushSubscriptionsNow();
  } catch {}
  console.log(`[server] shutdown by ${signal}`);
  process.exit(0);
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));

startServer(START_PORT);