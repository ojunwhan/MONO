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
const Groq = require('groq-sdk');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
// Google 및 Kakao 인증 라우트 모듈 불러오기
const attachGoogleAuth = require('./server/routes/auth_google');
const attachKakaoAuth = require('./server/routes/auth_kakao');
const attachLineAuth = require('./server/routes/auth_line');
const attachAppleAuth = require('./server/routes/auth_apple');
const attachAuthApi = require('./server/routes/auth_api');
const requireHospitalOrg = attachAuthApi.requireHospitalOrg;
const optionalHospitalOrg = attachAuthApi.optionalHospitalOrg;
const { bumpTranslationUsage, checkUsageLimit } = require('./server/billing');
const cron = require('node-cron');
const { generateCostReport } = require('./server/cost-report');
const { run: dbRun, get: dbGet, all: dbAll, exec: dbExec } = require('./server/db/sqlite');
const crypto = require('crypto');
const ALGO = 'aes-256-gcm';

function encryptText(text, keyHex) {
  if (!text || !keyHex) return text;
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptText(encrypted, keyHex) {
  if (!encrypted || !keyHex || !encrypted.includes(':')) return encrypted;
  try {
    const [ivHex, tagHex, dataHex] = encrypted.split(':');
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch { return encrypted; }
}

async function getOrgEncryptionKey(orgCode) {
  return new Promise((resolve) => {
    if (!orgCode) { resolve(null); return; }
    dbGet('SELECT org_encryption_key FROM organizations WHERE org_code = ?', [String(orgCode).trim()])
      .then((row) => resolve(row?.org_encryption_key || null))
      .catch(() => resolve(null));
  });
}

// === 사용량 추적 ===
const usageStats = {
  // 오늘 날짜 (자정에 리셋)
  date: new Date().toISOString().split('T')[0],

  // 접속 관련
  totalVisits: 0,          // 페이지 접속 수 (HTTP 요청)
  uniqueIPs: new Set(),    // 고유 IP 수

  // 소켓 관련
  currentConnections: 0,   // 현재 동시 접속
  peakConnections: 0,      // 오늘 최대 동시 접속
  totalSocketConnects: 0,  // 총 소켓 연결 수

  // 방/세션 관련
  roomsCreated: 0,         // 생성된 방 수
  roomsActive: 0,          // 현재 활성 방 수
  activeSession: 0,        // 호스트+게스트 실제 연결 완료 세션 수
  regions: {},             // 국가별 접속 이벤트 집계

  // 로그인 관련
  googleLogins: 0,         // Google 로그인 수
  kakaoLogins: 0,          // 카카오 로그인 수
  guestJoins: 0,           // 게스트 입장 수

  // 통역 관련
  sttRequests: 0,          // STT 요청 수
  translationRequests: 0,  // 번역 요청 수
  ttsRequests: 0,          // TTS 요청 수

  // Groq / OpenAI 호출 구분
  groqSttRequests: 0,      // Groq Whisper STT 호출 수
  openaiSttRequests: 0,    // OpenAI Whisper STT 호출 수
  openaiTranslations: 0,   // OpenAI GPT 번역 호출 수
  openaiTtsRequests: 0,    // OpenAI TTS 호출 수

  // 에러
  errorCount: 0,           // 에러 발생 수
  errors: [],              // 최근 에러 목록 (최대 100개)
};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STATS_API_KEY = process.env.STATS_API_KEY;
const LOCATION_CACHE = new Map();
const ERROR_ALERT_STATE = new Map();

function resetDailyStats() {
  const today = new Date().toISOString().split('T')[0];
  if (usageStats.date !== today) {
    // ── 날짜 변경 전 이전 날짜 데이터를 먼저 DB에 저장 ──
    const previousDate = usageStats.date;
    persistUsageStats(previousDate);
    usageStats.date = today;
    usageStats.totalVisits = 0;
    usageStats.uniqueIPs = new Set();
    usageStats.peakConnections = 0;
    usageStats.totalSocketConnects = 0;
    usageStats.roomsCreated = 0;
    usageStats.activeSession = 0;
    usageStats.regions = {};
    usageStats.googleLogins = 0;
    usageStats.kakaoLogins = 0;
    usageStats.guestJoins = 0;
    usageStats.sttRequests = 0;
    usageStats.translationRequests = 0;
    usageStats.ttsRequests = 0;
    usageStats.groqSttRequests = 0;
    usageStats.openaiSttRequests = 0;
    usageStats.openaiTranslations = 0;
    usageStats.openaiTtsRequests = 0;
    usageStats.errorCount = 0;
    usageStats.errors = [];
  }
}

// ── 병원 세션 실시간 로그 (파일) ──
const LOGS_SESSIONS_DIR = path.join(__dirname, 'logs', 'sessions');
const LOGS_RECORDS_DIR = path.join(__dirname, 'logs', 'records');

function appendHospitalSessionLog(roomId, roleLabel, originalText, translatedText) {
  try {
    if (!fs.existsSync(LOGS_SESSIONS_DIR)) fs.mkdirSync(LOGS_SESSIONS_DIR, { recursive: true });
    const filePath = path.join(LOGS_SESSIONS_DIR, `${roomId}.txt`);
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    const line = `[${timeStr}] ${roleLabel}: ${(originalText || '').replace(/\n/g, ' ')} → ${(translatedText || '').replace(/\n/g, ' ')}\n`;
    fs.appendFileSync(filePath, line);
  } catch (e) { console.warn('[session-log] append failed:', e?.message); }
}

function archiveHospitalSessionLog(roomId, patientToken) {
  try {
    if (!fs.existsSync(LOGS_RECORDS_DIR)) fs.mkdirSync(LOGS_RECORDS_DIR, { recursive: true });
    const src = path.join(LOGS_SESSIONS_DIR, `${roomId}.txt`);
    if (!fs.existsSync(src)) return;
    const base = patientToken ? `${patientToken}_${roomId}` : roomId;
    const dest = path.join(LOGS_RECORDS_DIR, `${base}.txt`);
    fs.copyFileSync(src, dest);
  } catch (e) { console.warn('[session-log] archive failed:', e?.message); }
}

/** Parse session log file into messages array. Line format: [HH:MM:SS] 직원: original → translated */
function parseSessionLogFile(content, session, msgIdPrefix) {
  const messages = [];
  const sessionDate = (session.started_at || session.created_at || '').toString().trim();
  const datePart = sessionDate ? sessionDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const lines = (content || '').split(/\r?\n/).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const timeMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(직원|환자):\s*(.+)$/);
    if (!timeMatch) continue;
    const [, timeStr, roleLabel, rest] = timeMatch;
    const sep = ' → ';
    const lastSep = rest.lastIndexOf(sep);
    const original = (lastSep >= 0 ? rest.slice(0, lastSep) : rest).trim();
    const translated = (lastSep >= 0 ? rest.slice(lastSep + sep.length) : '').trim();
    const sender_role = roleLabel === '직원' ? 'host' : 'guest';
    const sender_lang = sender_role === 'host' ? (session.host_lang || null) : (session.guest_lang || null);
    const created_at = `${datePart}T${timeStr}.000Z`;
    messages.push({
      id: msgIdPrefix ? `${msgIdPrefix}-${i}` : `log-${i}`,
      sender_role,
      sender_lang,
      created_at,
      original_text: original,
      translated_text: translated || '',
    });
  }
  return messages;
}

// ── API 사용량 DB 영속화 (dbRun/dbGet = async sqlite3 wrapper) ──
function persistUsageStats(dateOverride) {
  const date = dateOverride || usageStats.date;
  dbRun(
    `INSERT INTO api_usage_daily (date, groq_stt_count, openai_stt_count, translation_count, tts_count, total_stt, total_visits, peak_connections, rooms_created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       groq_stt_count = excluded.groq_stt_count,
       openai_stt_count = excluded.openai_stt_count,
       translation_count = excluded.translation_count,
       tts_count = excluded.tts_count,
       total_stt = excluded.total_stt,
       total_visits = excluded.total_visits,
       peak_connections = excluded.peak_connections,
       rooms_created = excluded.rooms_created`,
    [date, usageStats.groqSttRequests, usageStats.openaiSttRequests,
     usageStats.translationRequests, usageStats.openaiTtsRequests,
     usageStats.sttRequests, usageStats.totalVisits,
     usageStats.peakConnections, usageStats.roomsCreated]
  ).catch(() => { /* DB not yet ready */ });
}

async function restoreUsageStats() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const row = await dbGet('SELECT * FROM api_usage_daily WHERE date = ?', [today]);
    if (row) {
      usageStats.groqSttRequests = row.groq_stt_count || 0;
      usageStats.openaiSttRequests = row.openai_stt_count || 0;
      usageStats.translationRequests = row.translation_count || 0;
      usageStats.openaiTtsRequests = row.tts_count || 0;
      usageStats.sttRequests = row.total_stt || 0;
      usageStats.totalVisits = row.total_visits || 0;
      usageStats.peakConnections = row.peak_connections || 0;
      usageStats.roomsCreated = row.rooms_created || 0;
      console.log(`[stats] 📊 Restored today's usage from DB: STT=${usageStats.sttRequests} (Groq=${usageStats.groqSttRequests})`);
    }
  } catch (e) { /* table not yet created */ }
}

// ── 5분마다 사용량 DB에 저장 ──
setInterval(() => persistUsageStats(), 5 * 60 * 1000);

function makeErrorMessage(error) {
  return String(error?.stack || error?.message || error || 'Unknown')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
}

function sendErrorAlertOnce(source, error) {
  const msgText = makeErrorMessage(error);
  const key = `${String(source || 'runtime')}:${msgText.slice(0, 140)}`;
  const nowMs = Date.now();
  const prev = ERROR_ALERT_STATE.get(key) || 0;
  // Prevent alert flooding for repeated identical errors within 3 minutes.
  if (nowMs - prev < 3 * 60 * 1000) return;
  ERROR_ALERT_STATE.set(key, nowMs);
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  sendTelegram(`🚨 ${now} | 에러(${source || 'runtime'})\n${msgText}`);
}

function trackUsageError(error, options = {}) {
  const { source = 'runtime', notify = true } = options;
  usageStats.errorCount += 1;
  if (usageStats.errors.length >= 100) usageStats.errors.shift();
  const errorEntry = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    time: new Date().toISOString(),
    timeKR: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
    source,
    message: makeErrorMessage(error),
    stack: error?.stack ? error.stack.split('\n').slice(0, 3).join('\n') : null,
  };
  usageStats.errors.push(errorEntry);
  // 실시간 에러 소켓 전파 (admin room)
  if (typeof io !== 'undefined') {
    io.to('admin:errors').emit('admin:error', errorEntry);
  }
  if (notify) sendErrorAlertOnce(source, error);
}

function normalizeClientIp(rawIp) {
  const ip = String(rawIp || "").split(",")[0].trim();
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function isPrivateOrLocalIp(ip) {
  const v = normalizeClientIp(ip);
  if (!v) return true;
  if (v === "127.0.0.1" || v === "::1" || v === "localhost") return true;
  if (v.startsWith("10.") || v.startsWith("192.168.") || v.startsWith("169.254.")) return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:")) return true;
  const m = v.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function getClientIpFromReq(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const fallback = req?.connection?.remoteAddress || req?.socket?.remoteAddress || "";
  return normalizeClientIp(Array.isArray(forwarded) ? forwarded[0] : (forwarded || fallback));
}

function getClientIpFromSocket(socket) {
  const forwarded = socket?.handshake?.headers?.["x-forwarded-for"];
  const fallback = socket?.handshake?.address || socket?.request?.socket?.remoteAddress || "";
  return normalizeClientIp(Array.isArray(forwarded) ? forwarded[0] : (forwarded || fallback));
}

function recordRegion(country) {
  const key = String(country || "Unknown").trim() || "Unknown";
  usageStats.regions[key] = (usageStats.regions[key] || 0) + 1;
}

async function getLocation(ip) {
  try {
    const clientIp = normalizeClientIp(ip);
    if (!clientIp || isPrivateOrLocalIp(clientIp)) {
      return { country: "Local", city: "Local" };
    }
    const cached = LOCATION_CACHE.get(clientIp);
    if (cached && (Date.now() - cached.ts) < 10 * 60 * 1000) {
      return cached.location;
    }
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(clientIp)}?fields=country,city`);
    const data = await res.json();
    const location = {
      country: data?.country || "Unknown",
      city: data?.city || "Unknown",
    };
    LOCATION_CACHE.set(clientIp, { ts: Date.now(), location });
    return location;
  } catch {
    return { country: "Unknown", city: "Unknown" };
  }
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (e) {
    console.error('[MONO] Telegram send failed:', e?.message || e);
    trackUsageError(e, { source: 'telegram_send', notify: false });
  }
}

async function sendConnectionAlert(type, details = {}) {
  const now = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  let msg = '';

  switch (type) {
    case 'login': {
      const location = details.location || await getLocation(details.ip);
      recordRegion(location.country);
      msg = `🟢 ${now} | ${details.provider} 로그인 | ${details.name || 'Unknown'} | 📍 ${location.country}, ${location.city}`;
      break;
    }
    case 'guest': {
      const location = details.location || await getLocation(details.ip);
      recordRegion(location.country);
      msg = `👤 ${now} | 게스트 입장 | 방: ${String(details.roomId || '').substring(0, 8)}... | 📍 ${location.country}, ${location.city}`;
      break;
    }
    case 'room':
      msg = `🏠 ${now} | 방 생성 | 현재 활성 ${usageStats.roomsActive}개`;
      break;
    case 'translation':
      if (usageStats.translationRequests % 10 === 0) {
        msg = `🔄 ${now} | 번역 ${usageStats.translationRequests}건 달성`;
      }
      break;
    default:
      break;
  }

  if (msg) sendTelegram(msg);
}

let lastHourlyReportKey = '';
function sendHourlyReport() {
  resetDailyStats();
  const now = new Date();
  const hour = now.getHours();

  // 새벽 1시~7시는 전송 안 함
  if (hour >= 1 && hour <= 7) return;

  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${hour}`;
  if (lastHourlyReportKey === hourKey) return;
  lastHourlyReportKey = hourKey;

  const msg = `📊 <b>MONO 시간별 리포트</b>
⏰ ${now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

👥 현재 접속: <b>${usageStats.currentConnections}명</b>
📈 오늘 최대 동시접속: <b>${usageStats.peakConnections}명</b>
🌐 오늘 방문: ${usageStats.totalVisits}회 (${usageStats.uniqueIPs.size}명)

🔑 로그인: Google ${usageStats.googleLogins} / 카카오 ${usageStats.kakaoLogins}
👤 게스트 입장: ${usageStats.guestJoins}회
🏠 방 생성: ${usageStats.roomsCreated}개 (활성: ${usageStats.roomsActive})
🎯 실제 통역 세션: ${usageStats.activeSession}건
🌍 접속 지역: ${Object.entries(usageStats.regions).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([country, count]) => `${country} ${count}`).join(' / ') || '집계 없음'}

🎤 STT: ${usageStats.sttRequests}회 (Groq ${usageStats.groqSttRequests} / OpenAI ${usageStats.openaiSttRequests})
🔄 번역: ${usageStats.translationRequests}회
🔊 TTS: ${usageStats.ttsRequests}회

❌ 에러: ${usageStats.errorCount}건`;

  sendTelegram(msg);
}

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

const STT_MIN_DURATION_SEC = 0.5;
const STT_MIN_RMS = 0.012;
const WHISPER_HALLUCINATION_PATTERNS = [
  "시청해주셔서 감사합니다",
  "구독과 좋아요",
  "영상은 여기까지",
  "thank you for watching",
  "thanks for watching",
  "please subscribe",
  "subscribe and like",
];

function isWhisperHallucinationText(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  if (s.length <= 2) return true;
  const lower = s.toLowerCase();
  if (WHISPER_HALLUCINATION_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) return true;
  if (/\b(mbc|sbs|kbs)\b/i.test(s)) return true;
  return false;
}

function calculatePcmRms(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length < 2) return 0;
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  if (!sampleCount) return 0;
  let sum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / sampleCount);
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

  // ── Hospital Department-Specific Prompts ──
  hospital_reception: `You are a professional medical interpreter working at a hospital reception and registration desk. Translate accurately in the context of hospital admission, registration, and general patient guidance. Prioritize precise translation of terms related to: patient registration, insurance, identification, appointment scheduling, waiting area, medical history forms, consent forms, referral letters, copayment, hospital departments, directions within the hospital. Use polite, welcoming, and clear language appropriate for first-time or confused patients. Help patients understand hospital procedures, required documents, and navigation. Patient comfort and understanding are the top priority — use simple, reassuring language.`,
  hospital_internal: `You are a professional medical interpreter specializing in Internal Medicine. Translate accurately in the context of internal medicine consultations. Prioritize precise translation of terms related to: heart conditions, blood pressure, diabetes, digestive disorders, liver/kidney function, cholesterol, blood tests, ECG, endoscopy. Medical terms must be translated using standard medical terminology in the target language. Patient safety is the top priority — never omit or alter dosage, medication names, or critical instructions. Maintain a professional, calm, and reassuring tone appropriate for doctor-patient communication.`,
  hospital_surgery: `You are a professional medical interpreter specializing in Surgery. Translate accurately in the context of surgical consultations and pre/post-operative care. Prioritize precise translation of terms related to: surgical procedures, anesthesia, incision, sutures, drainage, wound care, recovery, complications, consent forms. Medical terms must use standard surgical terminology in the target language. Patient safety is the top priority — never omit or alter surgical instructions, medication dosages, or post-operative care instructions.`,
  hospital_emergency: `You are an EMERGENCY medical interpreter. Speed and accuracy are critical. This is an emergency medical situation. Translate quickly and precisely. Life-threatening terms must be translated with absolute priority: myocardial infarction, stroke, cardiac arrest, airway obstruction, hemorrhage, shock, anaphylaxis, seizure, fracture, burns, poisoning. Use short, direct sentences. No ambiguity allowed. NEVER delay or ask for clarification — always provide best-effort translation immediately.`,
  hospital_obstetrics: `You are a professional medical interpreter specializing in Obstetrics and Gynecology. Translate accurately in the context of pregnancy, childbirth, and women's health. Prioritize precise translation of terms related to: pregnancy stages, ultrasound findings, contractions, dilation, fetal heart rate, cesarean section, prenatal vitamins, gestational diabetes, preeclampsia. Use culturally sensitive language. Patient safety is paramount — never omit medication or procedure details.`,
  hospital_pediatrics: `You are a professional medical interpreter specializing in Pediatrics. Translate accurately in the context of child healthcare. Prioritize precise translation of terms related to: vaccinations, growth milestones, fever management, childhood diseases, medication dosages (weight-based), allergies, breastfeeding, developmental screening. Dosage accuracy is critical for pediatric patients — NEVER approximate or omit weight-based dosage information.`,
  hospital_orthopedics: `You are a professional medical interpreter specializing in Orthopedics. Translate accurately in the context of musculoskeletal conditions and treatments. Prioritize precise translation of terms related to: fractures, joints, ligaments, tendons, arthritis, spinal conditions, physical therapy, casting, splinting, MRI/X-ray findings, surgical fixation, rehabilitation exercises.`,
  hospital_neurology: `You are a professional medical interpreter specializing in Neurology. Translate accurately in the context of neurological conditions. Prioritize precise translation of terms related to: headache/migraine, seizure, stroke symptoms, nerve conduction, EEG, MRI brain, Parkinson's, Alzheimer's, neuropathy, dizziness/vertigo. Time-sensitive conditions (stroke, seizure) require urgent, clear translation.`,
  hospital_dermatology: `You are a professional medical interpreter specializing in Dermatology. Translate accurately in the context of skin conditions. Prioritize precise translation of terms related to: rash, eczema, psoriasis, acne, moles, skin biopsy, dermatitis, hives, fungal infections, topical medications, UV exposure, skin cancer screening.`,
  hospital_ophthalmology: `You are a professional medical interpreter specializing in Ophthalmology. Translate accurately in the context of eye conditions. Prioritize precise translation of terms related to: visual acuity, cataracts, glaucoma, retinal conditions, intraocular pressure, eye drops, laser surgery, lens prescription, fundoscopy, OCT scan.`,
  hospital_dentistry: `You are a professional medical interpreter specializing in Dentistry. Translate accurately in the context of dental conditions. Prioritize precise translation of terms related to: cavity/caries, root canal, crown, bridge, extraction, implant, gum disease, scaling, filling, orthodontics, wisdom teeth, dental X-ray, local anesthesia.`,
  hospital_plastic_surgery: `You are a professional medical interpreter specializing in Plastic and Cosmetic Surgery. Translate accurately in the context of cosmetic and reconstructive surgical consultations, pre/post-operative care, and aesthetic procedures. Prioritize precise translation of terms related to: rhinoplasty, blepharoplasty, facelift, liposuction, breast augmentation, botox, filler, laser treatment, skin rejuvenation, scar revision, jaw surgery, cheekbone reduction, fat grafting, thread lifting, recovery period, swelling, bruising, compression garments, follow-up appointments. Patient safety is the top priority — never omit or alter surgical instructions, medication dosages, or post-operative care guidelines.`,
};

// ───────────────── CALL SIGN SYSTEM (DETERMINISTIC — NO GPT) ─────────────────
const SITE_ROLES = {
  construction: ["Manager", "Lead", "Tech", "Operator", "Safety", "Driver"],
  manufacturing: ["Manager", "Lead", "Tech", "Operator", "QC", "Maintenance"],
  logistics: ["Manager", "Lead", "Operator", "Driver", "Picker", "Loader"],
  medical: ["Doctor", "Nurse", "Tech", "Admin", "Paramedic"],
  airport_event: ["Manager", "Lead", "Security", "Operator", "Guide"],
  general: ["Manager", "Lead", "Tech", "Operator", "Staff"],
  // Hospital departments share the same roles
  hospital_reception: ["Admin", "Nurse", "Patient", "Guide", "Staff"],
  hospital_internal: ["Doctor", "Nurse", "Patient", "Tech", "Admin"],
  hospital_surgery: ["Doctor", "Nurse", "Patient", "Tech", "Admin"],
  hospital_emergency: ["Doctor", "Nurse", "Patient", "Paramedic", "Tech"],
  hospital_obstetrics: ["Doctor", "Nurse", "Patient", "Midwife", "Tech"],
  hospital_pediatrics: ["Doctor", "Nurse", "Patient", "Parent", "Tech"],
  hospital_orthopedics: ["Doctor", "Nurse", "Patient", "Tech", "Therapist"],
  hospital_neurology: ["Doctor", "Nurse", "Patient", "Tech", "Admin"],
  hospital_dermatology: ["Doctor", "Nurse", "Patient", "Tech", "Admin"],
  hospital_ophthalmology: ["Doctor", "Nurse", "Patient", "Tech", "Admin"],
  hospital_dentistry: ["Doctor", "Nurse", "Patient", "Hygienist", "Admin"],
  hospital_plastic_surgery: ["Doctor", "Nurse", "Patient", "Consultant", "Admin"],
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

function convertOneToOneRoomToBroadcast(roomId, meta) {
  if (!meta || meta.roomType !== "oneToOne") return meta;
  const nextMeta = meta;
  nextMeta.roomType = "broadcast";
  if (!nextMeta.callSignCounters) nextMeta.callSignCounters = {};
  for (const [pid, p] of Object.entries(nextMeta.participants || {})) {
    if (!p) continue;
    const role = p.role || "tech";
    const callSign = p.callSign || assignCallSign(nextMeta, role);
    nextMeta.participants[pid] = {
      ...p,
      role,
      callSign,
      localName: p.localName || p.nativeName || "",
      phoneticVariants: p.phoneticVariants || generateCallSignPhonetics(callSign),
    };
  }
  ROOMS.set(roomId, nextMeta);
  io.to(roomId).emit("room-context", {
    siteContext: nextMeta.siteContext,
    locked: nextMeta.locked,
    roomType: "broadcast",
    roles: SITE_ROLES[nextMeta.siteContext] || SITE_ROLES.general,
  });
  return nextMeta;
}

/**
 * Revert a room from broadcast back to oneToOne when active participants ≤ 2.
 * This handles the case where a room was auto-converted due to stale/offline guest PIDs.
 */
function revertBroadcastToOneToOne(roomId, meta) {
  if (!meta || meta.roomType !== "broadcast") return meta;
  // Only revert rooms that were auto-converted (not intentionally created as broadcast)
  // We detect this by checking if the room has ≤ 2 active (online) participants
  const isOnline = (sid) => !!(sid && io?.sockets?.sockets?.get(sid));
  const onlinePids = Object.entries(meta.participants || {}).filter(([, p]) => p?.socketId && isOnline(p.socketId));

  if (onlinePids.length > 2) return meta; // Genuinely multi-party, stay broadcast

  meta.roomType = "oneToOne";
  // Remove call signs (not needed for 1:1)
  for (const [, p] of Object.entries(meta.participants || {})) {
    if (p) {
      delete p.callSign;
      delete p.phoneticVariants;
    }
  }
  ROOMS.set(roomId, meta);
  io.to(roomId).emit("room-context", {
    siteContext: meta.siteContext,
    locked: meta.locked,
    roomType: "oneToOne",
  });
  console.log(`[JOIN] broadcast -> oneToOne revert: ${roomId} (${onlinePids.length} online)`);
  return meta;
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

function emitUsageLimitWarning(socket, usage) {
  const limit = usage?.overview?.limit;
  const used = usage?.overview?.used;
  socket.emit("server-warning", {
    code: "usage_limit_exceeded",
    message: `Free translation limit reached (${used}/${limit}). Upgrade to Pro to continue translated delivery.`,
  });
}

async function canTranslateForUser(socket, userId) {
  if (!userId) return true;
  try {
    const status = await checkUsageLimit(userId);
    if (!status.allowed) {
      emitUsageLimitWarning(socket, status);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[billing:check]", e?.message || e);
    return true;
  }
}

async function consumeTranslationUsage(userId) {
  if (!userId) return;
  try {
    await bumpTranslationUsage(userId, 1);
  } catch (e) {
    console.warn("[billing:consume]", e?.message || e);
  }
}

async function transcribePcm16(pcmBuffer, lang, sampleRateHz = 16000, opts = {}) {
  const forceGroq = opts.hospitalMode && groq; // Hospital mode: force Groq, no fallback
  if (!groq && (!openai || isOpenAIBlocked())) return "";
  resetDailyStats();
  usageStats.sttRequests += 1;
  const wavBuffer = pcm16ToWavBuffer(pcmBuffer, sampleRateHz, 1);
  const tmpFile = path.join(os.tmpdir(), `${uuidv4()}.wav`);
  fs.writeFileSync(tmpFile, wavBuffer);
  try {
    if (forceGroq || groq) {
      // Groq whisper-large-v3 (forced for hospital, preferred for general)
      usageStats.groqSttRequests += 1;
      const result = await groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: "whisper-large-v3",
        response_format: "json",
        temperature: 0.0,
        ...(lang ? { language: lang } : {}),
      });
      return (result.text || "").trim();
    }
    // Fallback: OpenAI whisper-1 (NOT used in hospital mode)
    usageStats.openaiSttRequests += 1;
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      ...(lang ? { language: lang } : {}),
    });
    return (result.text || "").trim();
  } catch (e) {
    if (forceGroq) {
      // Hospital mode: no fallback, log and rethrow
      console.error("[stt:hospital] Groq STT failed, no fallback allowed:", e?.message);
      trackUsageError(e, { source: 'stt:hospital' });
      throw e;
    }
    if (!groq) markOpenAIQuotaBlocked(e);
    throw e;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function extFromMimeType(mimeType = "") {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "webm";
}

async function transcribeEncodedAudioBuffer(audioBuffer, mimeType, lang, opts = {}) {
  const forceGroq = opts.hospitalMode && groq;
  if (!groq && (!openai || isOpenAIBlocked())) return "";
  resetDailyStats();
  usageStats.sttRequests += 1;
  const ext = extFromMimeType(mimeType);
  const tmpFile = path.join(os.tmpdir(), `${uuidv4()}.${ext}`);
  fs.writeFileSync(tmpFile, audioBuffer);
  try {
    const language = lang && lang !== "auto" ? mapLang(lang) : undefined;
    if (forceGroq || groq) {
      // Groq whisper-large-v3 (forced for hospital, preferred for general)
      usageStats.groqSttRequests += 1;
      const result = await groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: "whisper-large-v3",
        response_format: "json",
        temperature: 0.0,
        ...(language ? { language } : {}),
      });
      return (result.text || "").trim();
    }
    // Fallback: OpenAI whisper-1 (NOT used in hospital mode)
    usageStats.openaiSttRequests += 1;
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      ...(language ? { language } : {}),
    });
    return (result.text || "").trim();
  } catch (e) {
    if (forceGroq) {
      console.error("[stt:hospital] Groq STT failed, no fallback:", e?.message);
      trackUsageError(e, { source: 'stt:hospital' });
      throw e;
    }
    if (!groq) markOpenAIQuotaBlocked(e);
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
  resetDailyStats();
  usageStats.ttsRequests += 1;
  usageStats.openaiTtsRequests += 1;
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
    origin: ["https://lingora.chat", "http://localhost:3174", "http://127.0.0.1:3174"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: true,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  connectTimeout: 20000,
  maxHttpBufferSize: 5e6,
  path: "/socket.io/",
});

// ✅ 프록시 뒤(Cloudflared)에서 프로토콜/헤더 신뢰
app.set("trust proxy", true);

const { bindGoogleSTT } = require("./server/stt_google_stream.js");
const { getMedicalTermContext } = require("./server/constants/medicalKnowledge.js");
if (process.env.STT_PROVIDER === "google") {
  bindGoogleSTT(io);
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// body-parser SyntaxError 핸들러 (잘못된 JSON 요청 시 stderr 오염 방지)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ error: 'invalid_json' });
  }
  next(err);
});

// 모든 요청에서 방문 카운트 (API 제외, 페이지 요청만)
app.use((req, res, next) => {
  resetDailyStats();
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/socket.io')) {
    usageStats.totalVisits += 1;
    const ip = getClientIpFromReq(req);
    if (ip) usageStats.uniqueIPs.add(ip);
  }
  next();
});

// OAuth 콜백 성공 카운트 (기존 OAuth 로직은 그대로 유지)
app.use((req, res, next) => {
  const pathName = req.path || '';
  const loginIp = getClientIpFromReq(req);
  if (pathName !== '/api/auth/google/callback' && pathName !== '/api/auth/kakao/callback') {
    return next();
  }
  res.on('finish', () => {
    try {
      resetDailyStats();
      const cookies = res.getHeader('set-cookie');
      const list = Array.isArray(cookies) ? cookies : (cookies ? [cookies] : []);
      const hasTokenCookie = list.some((c) => String(c).includes('token='));
      const isSuccessRedirect = res.statusCode >= 300 && res.statusCode < 400;
      if (!hasTokenCookie || !isSuccessRedirect) return;
      if (pathName === '/api/auth/google/callback') {
        usageStats.googleLogins += 1;
        sendConnectionAlert('login', { provider: 'Google', ip: loginIp });
      } else if (pathName === '/api/auth/kakao/callback') {
        usageStats.kakaoLogins += 1;
        sendConnectionAlert('login', { provider: 'Kakao', ip: loginIp });
      }
    } catch {}
  });
  next();
});

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
const USER_PRESENCE = new Map(); // userId(participantId) -> { activeRoomId, visibilityState, socketId, updatedAt }
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

function savePushSubscription(userId, subscription, deviceInfo = null) {
  if (!userId || !subscription?.endpoint) return false;
  if (!PUSH_SUBSCRIPTIONS.has(userId)) {
    PUSH_SUBSCRIPTIONS.set(userId, new Map());
  }
  const now = Date.now();
  const prev = PUSH_SUBSCRIPTIONS.get(userId).get(subscription.endpoint);
  const normalized = {
    endpoint: subscription.endpoint,
    keys: subscription.keys || prev?.keys || {},
    expirationTime: subscription.expirationTime ?? prev?.expirationTime ?? null,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    device: deviceInfo || prev?.device || null,
  };
  PUSH_SUBSCRIPTIONS.get(userId).set(subscription.endpoint, normalized);
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
    const webPushSub = {
      endpoint: sub?.endpoint,
      keys: sub?.keys || {},
      expirationTime: sub?.expirationTime ?? null,
    };
    if (!webPushSub.endpoint || !webPushSub.keys?.p256dh || !webPushSub.keys?.auth) {
      stale.push(endpoint);
      continue;
    }
    try {
      await webpush.sendNotification(webPushSub, payloadStr);
      console.log(`[push] ✅ sent to ${targetUserId} endpoint=${endpoint.slice(0, 48)}...`);
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

function updateUserPresence(userId, { activeRoomId = null, visibilityState = "visible", socketId = "" } = {}) {
  if (!userId) return;
  USER_PRESENCE.set(String(userId), {
    activeRoomId: activeRoomId ? String(activeRoomId) : null,
    visibilityState: String(visibilityState || "visible"),
    socketId: String(socketId || ""),
    updatedAt: Date.now(),
  });
}

function removeUserPresenceBySocket(socketId) {
  if (!socketId) return;
  for (const [userId, p] of USER_PRESENCE.entries()) {
    if (p?.socketId === socketId) USER_PRESENCE.delete(userId);
  }
}

function shouldSendPushToParticipant(targetUserId, roomId) {
  const p = USER_PRESENCE.get(String(targetUserId || ""));
  if (!p) return true;
  if (p.visibilityState !== "visible") return true;
  if (!roomId) return true;
  return String(p.activeRoomId || "") !== String(roomId);
}

function maybeSendPushToUser(targetUserId, payload, context = {}) {
  if (!targetUserId) return Promise.resolve(false);
  const roomId = context?.roomId || payload?.roomId || "";
  if (!shouldSendPushToParticipant(targetUserId, roomId)) {
    console.log(`[push] ⏭ skipped user=${targetUserId} room=${roomId} (visible + active room)`);
    return Promise.resolve(false);
  }
  return sendPushToUser(targetUserId, payload)
    .then(() => true)
    .catch((e) => {
      console.warn(`[push] ❌ send failed user=${targetUserId} room=${roomId}:`, e?.message || e);
      return false;
    });
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
  const { userId, subscription, deviceInfo } = req.body;
  if (!userId || !subscription?.endpoint) {
    return res.status(400).json({ error: 'userId and subscription required' });
  }
  const ok = savePushSubscription(userId, subscription, deviceInfo || null);
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
if (!openai) console.warn("[OpenAI] API key missing — translation/TTS disabled");

// ── Groq STT client (whisper-large-v3) ──
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
if (groq) {
  console.log("[Groq] ✅ STT client initialized (whisper-large-v3)");
} else {
  console.warn("[Groq] ⚠ GROQ_API_KEY missing — falling back to OpenAI Whisper for STT");
}

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

// ── Language code → ISO 3166-1 alpha-3 country code (for hospital display) ──
const LANG_TO_COUNTRY3 = {
  ko: "KOR", en: "ENG", ja: "JPN", zh: "CHN", vi: "VNM", th: "THA",
  id: "IDN", ms: "MYS", tl: "PHL", my: "MMR", km: "KHM", ne: "NPL",
  mn: "MNG", uz: "UZB", ru: "RUS", es: "ESP", pt: "PRT", fr: "FRA",
  de: "DEU", ar: "SAU", hi: "IND", bn: "BGD", ta: "LKA", te: "IND",
  tr: "TUR", uk: "UKR", pl: "POL", it: "ITA", nl: "NLD", sv: "SWE",
  fi: "FIN", da: "DNK", no: "NOR", cs: "CZE", sk: "SVK", ro: "ROU",
  hu: "HUN", bg: "BGR", hr: "HRV", sr: "SRB", sl: "SVN", el: "GRC",
  he: "ISR", fa: "IRN", ur: "PAK", sw: "KEN", si: "LKA", lo: "LAO",
  ka: "GEO", hy: "ARM", kk: "KAZ", ky: "KGZ", tg: "TJK", tk: "TKM",
  af: "ZAF", sq: "ALB", am: "ETH", az: "AZE", be: "BLR", bs: "BIH",
  et: "EST", gl: "ESP", gu: "IND", ht: "HTI", ig: "NGA", jv: "IDN",
  kn: "IND", lt: "LTU", lv: "LVA", mk: "MKD", ml: "IND", mr: "IND",
  mt: "MLT", pa: "IND", ps: "AFG", rw: "RWA", so: "SOM",
};
function langToCountry3(code) {
  return LANG_TO_COUNTRY3[String(code || "").toLowerCase().split("-")[0]] || String(code || "").toUpperCase();
}

// ── In-Memory State
const ROOMS = new Map();
const SOCKET_ROLES = new Map();
const messageBuffer = {}; // { roomId: [ { id, text, senderPid, time } ] }
const STT_SESSIONS = new Map();
const STT_TEXT_BUFFER = new Map();
const RECENT_MESSAGE_IDS = new Map(); // roomId -> Map<msgId, ts>
const RATE_BUCKETS = new Map(); // key(socketId:event) -> { count, resetAt }
const ROOM_MESSAGE_CACHE = new Map(); // roomId -> recent conversation context
const MAX_CONTEXT_MESSAGES = 10;

function syncRoomsActive() {
  usageStats.roomsActive = ROOMS.size;
}

function trackRealSessionConnected(roomId, meta) {
  if (!roomId || !meta || meta.sessionCounted) return;

  const ownerPid = String(meta.ownerPid || "").trim();
  if (!ownerPid || !meta.participants?.[ownerPid]) return;

  const room = io?.sockets?.adapter?.rooms?.get(roomId);
  if (!room || room.size < 2) return;

  const ownerSocketId = meta.participants[ownerPid]?.socketId;
  if (!ownerSocketId || !room.has(ownerSocketId)) return;

  const guestConnected = Object.entries(meta.participants).some(([pid, participant]) => {
    if (pid === ownerPid) return false;
    return !!participant?.socketId && room.has(participant.socketId);
  });
  if (!guestConnected) return;

  meta.sessionCounted = true;
  ROOMS.set(roomId, meta);

  resetDailyStats();
  usageStats.roomsCreated += 1;
  usageStats.activeSession += 1;
  sendConnectionAlert('room');
}

const LIMITS = {
  MAX_MESSAGE_CHARS: 500,
  MAX_AUDIO_BASE64_CHARS: 360000, // ~270KB base64 payload cap per chunk
  MAX_WHISPER_AUDIO_BASE64_CHARS: 30000000, // ~22MB binary cap for mobile media blobs
  SEND_MESSAGE_PER_10S: 60,
  STT_AUDIO_PER_10S: 300,
  STT_SEGMENT_END_PER_30S: 60,
  STT_WHISPER_PER_30S: 30,
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
    m = { roomType:'oneToOne', ownerLang:'auto', guestLang:'auto', siteContext:'general', locked:false, ownerPid:null, participants:{}, callSignCounters:{}, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    ROOMS.set(roomId, m);
  }
  if (!m.participants) m.participants = {};
  if (!m.callSignCounters) m.callSignCounters = {};
  if (!m.roomType) m.roomType = 'oneToOne';
  if (!m.expiresAt) m.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  if (typeof m.sessionCounted !== 'boolean') m.sessionCounted = false;
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

function addToRoomContext(roomId, message) {
  if (!roomId || !message?.text) return;
  if (!ROOM_MESSAGE_CACHE.has(roomId)) {
    ROOM_MESSAGE_CACHE.set(roomId, []);
  }
  const cache = ROOM_MESSAGE_CACHE.get(roomId);
  cache.push({
    text: String(message.text || '').trim(),
    lang: message.lang || 'auto',
    role: message.role || 'user',
    timestamp: Date.now(),
  });
  if (cache.length > MAX_CONTEXT_MESSAGES) {
    cache.splice(0, cache.length - MAX_CONTEXT_MESSAGES);
  }
}

function getRoomContext(roomId) {
  return ROOM_MESSAGE_CACHE.get(roomId) || [];
}

function isHospitalContext(siteContext) {
  return String(siteContext || '').startsWith('hospital_');
}

function buildSystemPrompt(from, to, ctx, siteContext, opts = {}) {
  const siteDomain = SITE_CONTEXT_PROMPTS[siteContext] || SITE_CONTEXT_PROMPTS.general;
  const isHospital = isHospitalContext(siteContext);
  const contextInject = opts.contextInject === true;

  if (isHospital || contextInject) {
    const dept = String(siteContext || "").replace(/^hospital_|^org_/, "");
    const medicalTerms = (isHospital || contextInject) ? getMedicalTermContext(dept, to) : "";
    const isMedical = isHospital || (contextInject && medicalTerms);
    if (isMedical) {
      const hospitalRegister = isHospital
        ? `
CRITICAL — Hospital Mode Language Register:
Always translate using the highest level of formal, respectful language
regardless of the target language.
This applies to ALL 99 supported languages without exception.

The output must always sound like:
- A professional medical staff speaking to a patient with full respect
- Or a patient speaking to a doctor with full politeness
- NEVER casual, informal, or blunt expressions
- NEVER slang or colloquial language

Examples of register:
- Korean: ~하십니까, ~드리겠습니다, ~하시겠습니까 (최고 존칭)
- English: 'Would you please~', 'May I ask~', 'I would like to inform you~'
- Japanese: 最敬語・丁寧語 (keigo, sonkeigo)
- Chinese: 您 instead of 你, 请问, 非常抱歉
- Vietnamese: kính thưa, xin phép
- All other languages: equivalent highest formal/honorific register

If the source text is casual or informal,
ALWAYS elevate the register in the translation to formal/respectful.
Do not mirror the informality of the source.`
        : "";
      return [
        siteDomain,
        medicalTerms,
        `Translate from ${label(from)} to ${label(to)} with conversation context awareness.`,
        `Maintain a professional medical tone. Use standard medical terminology in the target language.`,
        `When medical terms from the glossary above appear, you MUST use the provided translations.`,
        `Preserve proper nouns, medication names, dosages, numbers, units, and medical terms accurately.`,
        hospitalRegister,
        `If message is ambiguous, use conversation context to resolve. Always output best-effort translation.`,
        ctx ? `Recent conversation context:\n${ctx}` : '',
        `Output ONLY translated text. No explanation, no notes, no quotation marks, no brackets.`,
      ].filter(Boolean).join('\n');
    }
  }

  // General mode: original prompt
  return [
    `You are a professional real-time interpreter for MONO multilingual messenger.`,
    `This is a casual chat messenger. Users use slang, abbreviations, and shorthand.`,
    siteDomain ? `Domain context: ${siteDomain}` : '',
    `Translate from ${label(from)} to ${label(to)} with conversation context awareness.`,
    `Always preserve speaker tone and intensity: casual->casual, formal->formal, rude->rude, playful->playful.`,
    `Internet slang must be translated to equivalent slang in target language.`,
    `Examples: ㅇㅇ->yeah, ㄱㄱ->let's go, ㅋㅋㅋ->lol, lol->ㅋㅋ, nvm->됐어/아니야, idk->몰라, www->ㅋㅋㅋ, 666/yyds->sick/goat, 555->lol.`,
    `Do not literal-translate slang if natural equivalent exists in target language.`,
    `Honorific/formal Korean must remain formal and polite in English (business-like register).`,
    `When prior context clearly points to a specific person, prefer natural person pronouns over generic "them".`,
    `For Korean deferential endings like "감사합니다", "부탁드립니다/부탁드리겠습니다", use polite business English (e.g., "I would appreciate...", "could you please...").`,
    `For colloquial Korean pronouns like "걔/그 사람", prefer a natural singular pronoun (him/her) when context indicates one person.`,
    `Preserve proper nouns, brand names, numbers, units, and safety-critical terms accurately.`,
    `Preserve emojis/emoticons (e.g., ㅠㅠ, :) ) as-is unless target has a direct equivalent emoji.`,
    `If message is ambiguous, use conversation context to resolve references/pronouns.`,
    `If message is not empty, NEVER refuse and NEVER ask for more text. Always output best-effort translation.`,
    ctx ? `Recent speaker hints:\n${ctx}` : '',
    `Output ONLY translated text. No explanation, no notes, no quotation marks, no brackets.`,
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

  const isHospital = String(meta.siteContext || "").startsWith("hospital_");
  const ownerPid = meta.ownerPid;

  if (isHospital && ownerPid) {
    // Hospital mode: host(의료진) sees "환자", guest(환자) sees adapted host name
    const isAHost = pidA === ownerPid;
    const hostPid = isAHost ? pidA : pidB;
    const guestPid = isAHost ? pidB : pidA;
    const host = meta.participants[hostPid];
    const guest = meta.participants[guestPid];

    // Adapt host name for guest (normal transliteration)
    const hostNameForGuest = await adaptName(host.nativeName, host.lang, guest.lang);
    // Guest label for host: always "환자"
    const guestLabelForHost = "환자";

    if (!host.adaptedNames) host.adaptedNames = {};
    if (!guest.adaptedNames) guest.adaptedNames = {};
    host.adaptedNames[guest.lang] = host.nativeName; // not used for hospital
    guest.adaptedNames[host.lang] = guestLabelForHost;
    ROOMS.set(roomId, meta);

    // Send to host: show "[국가코드] 환자"
    if (host.socketId) {
      io.to(host.socketId).emit("partner-info", {
        roomId,
        peerUserId: guestPid,
        peerCanonicalName: guest.nativeName,
        peerLocalizedName: guestLabelForHost,
        partnerName: guestLabelForHost,
        partnerNativeName: guest.nativeName,
        peerLang: guest.lang || "en",
      });
    }
    // Send to guest: show adapted host name
    if (guest.socketId) {
      io.to(guest.socketId).emit("partner-info", {
        roomId,
        peerUserId: hostPid,
        peerCanonicalName: host.nativeName,
        peerLocalizedName: hostNameForGuest || host.nativeName,
        partnerName: hostNameForGuest || host.nativeName,
        partnerNativeName: host.nativeName,
        peerLang: host.lang || "ko",
      });
    }
    console.log(`[1:1:hospital] host sees "${guestLabelForHost}", guest sees "${hostNameForGuest}"`);
    return;
  }

  // ── General mode: mutual name adaptation ──
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

async function fastTranslate(text, from, to, ctx, siteContext, conversationHistory = [], opts = {}) {
  if (!openai || !text || !to || to === 'auto' || from === to || isOpenAIBlocked()) return text;
  resetDailyStats();
  usageStats.translationRequests += 1;
  usageStats.openaiTranslations += 1;
  sendConnectionAlert('translation');
  const sys = buildSystemPrompt(from, to, ctx, siteContext || 'general', opts);
  const recentContext = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: `[${label(msg.lang)}] ${String(msg.text || '').trim()}`,
    }))
    .filter((msg) => msg.content.length > 3);
  const useStream = opts.stream === true && typeof opts.onChunk === 'function';
  try {
    if (useStream) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 1024,
        stream: true,
        messages: [
          { role: 'system', content: sys },
          ...recentContext,
          { role: 'user', content: `Translate the following from ${label(from)} to ${label(to)}:\n\n${text}` },
        ],
      });
      let full = '';
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          opts.onChunk(delta);
        }
      }
      return full.trim() || text;
    }
    const r = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: sys },
        ...recentContext,
        { role: 'user', content: `Translate the following from ${label(from)} to ${label(to)}:\n\n${text}` },
      ],
    });
    return r.choices?.[0]?.message?.content?.trim() || text;
  } catch (e) {
    markOpenAIQuotaBlocked(e);
    throw e;
  }
}

async function hqTranslate(text, from, to, ctx, siteContext, conversationHistory = [], opts = {}) {
  if (!openai || !text || !to || to === 'auto' || from === to || isOpenAIBlocked()) return text;
  resetDailyStats();
  usageStats.translationRequests += 1;
  usageStats.openaiTranslations += 1;
  const sys = buildSystemPrompt(from, to, ctx, siteContext || 'general', opts)
    + `\nRefine to fluent native chat style without changing meaning or emotional tone.`;
  const recentContext = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: `[${label(msg.lang)}] ${String(msg.text || '').trim()}`,
    }))
    .filter((msg) => msg.content.length > 3);
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: sys },
        ...recentContext,
        { role: 'user', content: `Translate the following from ${label(from)} to ${label(to)}:\n\n${text}` },
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
  resetDailyStats();
  usageStats.currentConnections += 1;
  usageStats.totalSocketConnects += 1;
  socket.data.clientIp = getClientIpFromSocket(socket);
  if (usageStats.currentConnections > usageStats.peakConnections) {
    usageStats.peakConnections = usageStats.currentConnections;
  }
  console.log('🟢 New client connected:', socket.id);

  // ── Admin 실시간 에러 모니터링 구독 ──
  socket.on('admin:subscribe-errors', (data) => {
    const key = data?.key || '';
    if (STATS_API_KEY && key === STATS_API_KEY) {
      socket.join('admin:errors');
      socket.emit('admin:subscribed', { ok: true, errorCount: usageStats.errors.length });
      console.log(`[admin] 🔔 Error monitor subscribed: ${socket.id}`);
    } else {
      socket.emit('admin:subscribed', { ok: false, reason: 'invalid_key' });
    }
  });

  const leaveRoomInternal = ({ roomId, participantId, reason } = {}) => {
    const rid = String(roomId || socket.roomId || "").trim();
    if (!rid) return;
    const pid = String(participantId || socket.data?.participantId || "").trim();

    try {
      socket.leave(rid);
    } catch {}

    const meta = ROOMS.get(rid);
    const isHospitalRoom = meta && String(meta.siteContext || '').startsWith('hospital_');
    const isOneToOne = meta?.roomType === 'oneToOne';
    const wasGuest = meta?.ownerPid && pid && meta.ownerPid !== pid;
    if (meta?.participants && pid && meta.participants[pid]?.socketId === socket.id) {
      delete meta.participants[pid];
      if (meta.ownerPid === pid) {
        const nextOwner = Object.keys(meta.participants)[0] || null;
        meta.ownerPid = nextOwner;
      }
      ROOMS.set(rid, meta);
      emitParticipants(rid);
      emitRoutes(rid).catch(() => {});
      // 환자가 먼저 나갈 때: 직원 PC/태블릿에 room:ended 전송 → QR 대기화면 복귀
      if (isHospitalRoom && isOneToOne && wasGuest && io) {
        io.to(rid).emit('room:ended', { roomId: rid, message: '환자가 나갔습니다.' });
      }
    }

    SOCKET_ROLES.delete(socket.id);
    if (socket.roomId === rid) socket.roomId = null;
    if (socket.data?.participantId === pid) socket.data.participantId = null;
    if (pid) {
      updateUserPresence(pid, {
        activeRoomId: null,
        visibilityState: "visible",
        socketId: socket.id,
      });
    }
    console.log(`[LEAVE] ${socket.id} room=${rid} pid=${pid || "-"} reason=${reason || "manual"}`);
  };

  const leaveBeforeJoin = ({ nextRoomId, participantId, reason } = {}) => {
    const prevRoomId = String(socket.roomId || "").trim();
    if (!prevRoomId) return;
    if (prevRoomId === String(nextRoomId || "").trim()) return;
    leaveRoomInternal({
      roomId: prevRoomId,
      participantId: participantId || socket.data?.participantId,
      reason: reason || "switch-room",
    });
  };

  // ═══════════════════════════════════════════════════════
  // REGISTER USER — global identity registration
  // ═══════════════════════════════════════════════════════
  socket.on("register-user", ({ userId, canonicalName, lang }) => {
    if (!userId || !canonicalName) return;
    if (typeof userId !== 'string' || userId.length > 128) return;
    if (typeof canonicalName !== 'string' || !canonicalName.trim() || canonicalName.length > 60) return;
    const user = getOrCreateUser(userId, { canonicalName, lang, socketId: socket.id });
    socket.data.userId = userId;
    updateUserPresence(userId, { socketId: socket.id, visibilityState: "visible", activeRoomId: socket.roomId || null });
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
  socket.on("push-subscribe", ({ userId, subscription, deviceInfo }) => {
    if (!userId || !subscription?.endpoint) return;
    savePushSubscription(userId, subscription, deviceInfo || null);
  });

  socket.on("push-unsubscribe", ({ userId, endpoint }) => {
    if (!userId || !endpoint) return;
    removePushSubscription(userId, endpoint);
  });

  socket.on("presence:update", ({ participantId, activeRoomId, visibilityState } = {}) => {
    const uid = String(participantId || socket.data?.participantId || socket.data?.userId || "").trim();
    if (!uid) return;
    updateUserPresence(uid, {
      activeRoomId: activeRoomId || null,
      visibilityState: visibilityState || "visible",
      socketId: socket.id,
    });
  });

  socket.on("leave-room", ({ roomId, participantId, reason } = {}) => {
    leaveRoomInternal({ roomId, participantId, reason: reason || "client-leave-room" });
  });

  socket.on("manual-leave", ({ roomId, participantId } = {}) => {
    leaveRoomInternal({ roomId, participantId, reason: "manual-leave" });
  });

  // ── fixed-room:start — 직원이 통역 시작 → 양쪽 모두 VAD 시작 ──
  socket.on("fixed-room:start", ({ roomId } = {}) => {
    if (!roomId) return;
    io.to(roomId).emit("fixed-room:start", { roomId });
  });

  // ── fixed-room:end — 직원이 통역 종료 → 양쪽 모두 종료 ──
  socket.on("fixed-room:end", ({ roomId } = {}) => {
    if (!roomId) return;
    const meta = ROOMS.get(roomId);
    const patientToken = meta?.patientToken ?? null;
    archiveHospitalSessionLog(roomId, patientToken);
    io.to(roomId).emit("fixed-room:end", { roomId });
  });

  // ── vad:gain — 직원이 환자 마이크 감도/게인 원격 조절 ──
  socket.on("vad:gain", ({ roomId, target, gain, vadThreshold, minSpeechMs } = {}) => {
    if (!roomId) return;
    const payload = { roomId, gain, vadThreshold, minSpeechMs };
    // target에 따라 해당 역할에게만 전달 (broadcast 후 클라이언트에서 필터)
    io.to(roomId).emit("vad:gain:update", { ...payload, target: target || "guest" });
    console.log(`[socket] vad:gain → room ${roomId}, target=${target}, gain=${gain}, vad=${vadThreshold}, minMs=${minSpeechMs}`);
  });

  socket.on("delete-room", ({ roomId, participantId } = {}) => {
    const rid = String(roomId || "").trim();
    const pid = String(participantId || socket.data?.participantId || "").trim();
    if (!rid || !pid) return;
    const meta = ROOMS.get(rid);
    if (!meta) return;

    // 1:1 room: remove the room for everyone
    if (meta.roomType === "oneToOne") {
      io.to(rid).emit("room-deleted", { roomId: rid, by: pid });
      try { io.in(rid).socketsLeave(rid); } catch {}
      ROOMS.delete(rid);
      delete messageBuffer[rid];
      syncRoomsActive();
      console.log(`[ROOM:DELETE] oneToOne room removed room=${rid} by=${pid}`);
      return;
    }

    // group/broadcast: requester only leaves
    leaveRoomInternal({ roomId: rid, participantId: pid, reason: "delete-room-leave-self" });
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
    const roomAlreadyExists = ROOMS.has(roomId);

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
    if (!roomAlreadyExists) {
      syncRoomsActive();
    }

    // Join socket room (leave previous room first)
    leaveBeforeJoin({ nextRoomId: roomId, participantId: myUserId, reason: "create-1to1" });
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
  socket.on("create-room", ({ roomId, fromLang, participantId, siteContext, role, localName, roomType, chartNumber, stationId, hospitalSessionId } = {}) => {
    if (!roomId) return;
    const roomAlreadyExists = ROOMS.has(roomId);

    const hostLangCode = mapLang(fromLang);
    const ctx = siteContext || "general";
    const hostRole = role || "Manager";
    const rType = roomType === "broadcast" ? "broadcast" : "oneToOne";

    // If room already exists, reuse it — just update this participant
    let meta;
    if (roomAlreadyExists) {
      meta = ROOMS.get(roomId);
      // Update owner info if this is the creator reconnecting
      meta.ownerLang = hostLangCode;
      meta.siteContext = ctx;
      meta.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    } else {
      meta = {
        roomType: rType,
        ownerLang: hostLangCode,
        guestLang: "auto",
        siteContext: ctx,
        locked: true,
        ownerPid: participantId || null,
        ...(chartNumber ? { chartNumber: String(chartNumber), stationId: stationId || 'default', hospitalSessionId: hospitalSessionId || null, sessionType: 'hospital' } : {}),
        participants: {},
        callSignCounters: {},
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
    }

    if (participantId) {
      leaveBeforeJoin({ nextRoomId: roomId, participantId, reason: "create-room" });
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
      console.log(`🏠 Host ${socket.id} [${callSign}] ${roomAlreadyExists ? 're-joined' : 'created'} room: ${roomId} [${hostLangCode}] [${ctx}]`);
      socket.emit("call-sign-assigned", { callSign, siteContext: ctx });
    }

    ROOMS.set(roomId, meta);
    if (!roomAlreadyExists) {
      syncRoomsActive();
    }
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
    if (created) {
      syncRoomsActive();
    }
    ackReply({ ok: true, roomId: rid, created, isOwner });
    socket.emit("global-room-ready", { roomId: rid, created, isOwner });
  });

  // Atomic global join: avoid race between room ensure and join/auth checks.
  socket.on("join-global", ({ roomId, participantId, fromLang, localName, roleHint } = {}, ack) => {
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

    const isOwner = roleHint === "owner"
      ? true
      : (meta.ownerPid === participantId ? true : (!meta.ownerPid && roleHint !== "guest"));
    if (isOwner) meta.ownerPid = participantId;
    const role = isOwner ? "owner" : "guest";
    const roleName = isOwner ? "Manager" : "Tech";
    const langCode = mapLang(fromLang || "en");

    leaveBeforeJoin({ nextRoomId: rid, participantId, reason: "join-global" });
    socket.join(rid);
    socket.roomId = rid;
    socket.data.participantId = participantId;
    updateUserPresence(participantId, { activeRoomId: rid, visibilityState: "visible", socketId: socket.id });
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
    leaveBeforeJoin({ nextRoomId: roomId, participantId: socket.data?.participantId, reason: "joinRoom" });
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

    leaveBeforeJoin({ nextRoomId: roomId, participantId: userId, reason: "rejoin-room" });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.data.participantId = userId;
    updateUserPresence(userId, { activeRoomId: roomId, visibilityState: "visible", socketId: socket.id });

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
        const myLang = meta.participants[userId]?.lang || "en";
        let peerDisplayName = peer.adaptedNames?.[myLang] || peer.nativeName || "";
        // Hospital mode: host always sees "환자" for guest
        const isHospitalRejoin = String(meta.siteContext || "").startsWith("hospital_");
        if (isHospitalRejoin && meta.ownerPid && userId === meta.ownerPid) {
          peerDisplayName = "환자";
        }
        socket.emit("partner-info", {
          roomId,
          peerUserId: peerPid,
          peerCanonicalName: peer.nativeName || "",
          peerLocalizedName: peerDisplayName,
          partnerName: peerDisplayName,
          partnerNativeName: peer.nativeName || "",
          peerLang: peer.lang || "en",
        });
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
    leaveBeforeJoin({ nextRoomId: roomId, participantId: socket.data?.participantId, reason: "check-room" });
    socket.join(roomId);
    socket.roomId = roomId;
    if (socket.data?.participantId) {
      updateUserPresence(socket.data.participantId, {
        activeRoomId: roomId,
        visibilityState: "visible",
        socketId: socket.id,
      });
    }
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

  // ── Staff 모니터링: 소켓 룸에만 join (참가자 등록 X) ──
  socket.on("monitor-room", ({ roomId } = {}) => {
    if (!roomId || typeof roomId !== "string") return;
    socket.join(roomId);
    console.log(`[STAFF-MONITOR] Socket ${socket.id} monitoring room ${roomId}`);
    // 현재 방 상태를 즉시 전달
    const meta = ROOMS.get(roomId);
    if (meta && meta.participants) {
      const members = Object.entries(meta.participants)
        .filter(([, info]) => !!info?.socketId)
        .map(([pid, info]) => ({
          partnerId: pid,
          language: info.lang || "en",
          isOwner: pid === meta.ownerPid,
        }));
      const guestCount = members.filter((m) => !m.isOwner).length;
      socket.emit("room-monitor-status", { roomId, members, guestCount });
    }
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
  socket.on("join", async ({ roomId, fromLang, participantId, role: selectedRole, localName, roleHint, saveMessages, summaryOnly, contextInject, inputMode }) => {
    if (!roomId || !participantId) return;
    if (typeof roomId !== 'string' || roomId.length > 200) return;
    if (typeof participantId !== 'string' || participantId.length > 128) return;

    // ended된 병원 방 재접속: ROOMS에 없으면 DB에서 roomId 조회 후 메타 재생성 (active도 복구 — pm2 reload 대비)
    if (!ROOMS.has(roomId) && String(roomId).startsWith('PT-')) {
      try {
        const row = await dbGet('SELECT id, status, patient_token, dept FROM hospital_sessions WHERE room_id = ? LIMIT 1', [roomId]);
        if (row) {
          const hospitalSiteContext = `hospital_${row.dept || 'general'}`;
          const isEnded = row.status === 'ended';
          ROOMS.set(roomId, {
            roomType: 'oneToOne',
            ownerLang: 'auto',
            guestLang: 'auto',
            siteContext: hospitalSiteContext,
            locked: true,
            ownerPid: null,
            participants: {},
            callSignCounters: {},
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            hospitalMode: true,
            hospitalEndedSession: isEnded,
            department: row.dept || 'general',
            patientToken: row.patient_token,
            hospitalSessionId: row.id,
          });
        }
      } catch (e) { /* ignore */ }
    }

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
          let adaptedName = peer.adaptedNames?.[myLang] || peer.nativeName || "";
          // Hospital mode: host always sees "환자" for guest
          const isHospitalReconn = String(m.siteContext || "").startsWith("hospital_");
          if (isHospitalReconn && m.ownerPid && participantId === m.ownerPid) {
            adaptedName = "환자";
          }
          socket.emit("partner-info", {
            roomId,
            peerUserId: otherPid,
            peerCanonicalName: peer.nativeName || "",
            peerLocalizedName: adaptedName,
            partnerName: adaptedName,
            partnerNativeName: peer.nativeName || "",
            peerLang: peer.lang || "en",
          });
          // 헤더 언어 표시 동기화를 위해 partner-joined도 재전송
          const peerLangCode = peer.lang || "en";
          const peerLK = String(peerLangCode).toLowerCase().split("-")[0];
          const pjFlagMap = { ko:"kr",vi:"vn",zh:"cn",en:"us",ja:"jp",th:"th",km:"kh",my:"mm",id:"id",mn:"mn",uz:"uz",ne:"np",tl:"ph",ms:"my",lo:"la",bn:"bd",hi:"in",ur:"pk",ru:"ru",uk:"ua",de:"de",fr:"fr",es:"es",pt:"pt",it:"it",ar:"sa",tr:"tr" };
          const pjLabelMap = { ko:"KOR",vi:"VNM",zh:"CHN",en:"ENG",ja:"JPN",th:"THA",km:"KHM",my:"MMR",id:"IDN",mn:"MNG",uz:"UZB",ne:"NPL",tl:"PHL",ms:"MYS",lo:"LAO",bn:"BGD",hi:"IND",ur:"PAK",ru:"RUS",uk:"UKR",de:"DEU",fr:"FRA",es:"ESP",pt:"PRT",it:"ITA",ar:"ARA",tr:"TUR" };
          socket.emit("partner-joined", {
            roomId,
            peerLang: peerLangCode,
            peerFlagUrl: `https://flagcdn.com/w40/${pjFlagMap[peerLK] || "un"}.png`,
            peerLabel: pjLabelMap[peerLK] || peerLK.toUpperCase(),
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

    leaveBeforeJoin({ nextRoomId: roomId, participantId, reason: "join" });

    const meta = ensureRoomMeta(roomId);
    if (meta.expiresAt && Date.now() > Number(meta.expiresAt)) {
      socket.emit("room-status", { status: "room-expired", roomId });
      return;
    }
    if (saveMessages !== undefined) meta.saveMessages = saveMessages;
    if (summaryOnly !== undefined) meta.summaryOnly = summaryOnly;
    if (contextInject !== undefined) meta.contextInject = contextInject;
    if (inputMode !== undefined) meta.inputMode = inputMode;

    // ── 1:1 방에서 게스트 교체 및 3번째 입장 시 그룹(브로드캐스트)으로 자동 전환 ──
    if (meta.roomType === "oneToOne") {
      // 병원 모드 방은 절대 broadcast 전환하지 않음 — 항상 1:1 유지
      const isHospitalRoom = String(meta.siteContext || "").startsWith("hospital_");
      if (isHospitalRoom) {
        // 병원 모드: 오프라인 게스트만 정리하고, broadcast 전환 안 함
        const currentPids = Object.keys(meta.participants);
        const isReconnect = currentPids.includes(participantId);
        if (!isReconnect && currentPids.length >= 2) {
          const isOnline = (sid) => !!(sid && io?.sockets?.sockets?.get(sid));
          for (const pid of currentPids) {
            if (pid === meta.ownerPid) continue;
            const p = meta.participants[pid];
            if (!p?.socketId || !isOnline(p.socketId)) {
              console.log(`[JOIN:hospital] Removing offline guest ${pid} from room ${roomId}`);
              delete meta.participants[pid];
            }
          }
          ROOMS.set(roomId, meta);
        }
        console.log(`[JOIN:hospital] Skipping broadcast conversion for hospital room ${roomId} (siteContext=${meta.siteContext})`);
      } else {
        // 일반 모드: 기존 broadcast 전환 로직 유지
        const currentPids = Object.keys(meta.participants);
        const isReconnect = currentPids.includes(participantId);

        // 새 게스트가 들어올 때, 오프라인인 이전 게스트를 정리 (방 소유자는 유지)
        if (!isReconnect && currentPids.length >= 2) {
          const isOnline = (sid) => !!(sid && io?.sockets?.sockets?.get(sid));
          const offlineGuestPids = currentPids.filter(pid => {
            if (pid === meta.ownerPid) return false;
            const p = meta.participants[pid];
            return !p?.socketId || !isOnline(p.socketId);
          });

          if (offlineGuestPids.length > 0) {
            for (const gPid of offlineGuestPids) {
              console.log(`[JOIN:1:1] Removing offline guest ${gPid} from room ${roomId}`);
              delete meta.participants[gPid];
            }
            ROOMS.set(roomId, meta);
          }
        }

        // 정리 후 다시 체크: 여전히 3명 이상이면 broadcast 전환
        const activePids = Object.keys(meta.participants);
        const isReconnectAfterCleanup = activePids.includes(participantId);
        if (!isReconnectAfterCleanup && activePids.length >= 2) {
          const isOnline2 = (sid) => !!(sid && io?.sockets?.sockets?.get(sid));
          const onlineCount = activePids.filter(pid => {
            const p = meta.participants[pid];
            return p?.socketId && isOnline2(p.socketId);
          }).length;
          if (onlineCount >= 2) {
            console.log(`[JOIN] oneToOne -> broadcast conversion: ${roomId} (${activePids.length + 1} ppl, ${onlineCount} online)`);
            convertOneToOneRoomToBroadcast(roomId, meta);
          } else {
            console.log(`[JOIN:1:1] Skipping broadcast conversion: only ${onlineCount} online in ${roomId}`);
          }
        }
      }
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.data.participantId = participantId;
    updateUserPresence(participantId, { activeRoomId: roomId, visibilityState: "visible", socketId: socket.id });

    // PT- rooms: role by roleHint/patientToken only (join order must not flip owner/guest)
    const isPTRoom = String(roomId).startsWith('PT-');
    let isOwner;
    if (isPTRoom) {
      const isGuest = roleHint === 'guest' || (meta.patientToken && participantId === meta.patientToken);
      isOwner = !isGuest;
      if (isOwner) meta.ownerPid = participantId;
    } else {
      isOwner = roleHint === "owner"
        ? true
        : (meta.ownerPid === participantId ? true : (!meta.ownerPid && roleHint !== "guest"));
      if (isOwner) meta.ownerPid = participantId;
    }
    const serverRole = isOwner ? "owner" : "guest";
    SOCKET_ROLES.set(socket.id, { role: serverRole });

    const langCode = fromLang ? mapLang(fromLang) : null;
    if (langCode) {
      if (serverRole === "owner") meta.ownerLang = langCode;
      else meta.guestLang = langCode;
    }

    // When staff (host) joins a hospital room, persist host_lang to hospital_sessions
    if (serverRole === "owner" && String(meta.siteContext || "").startsWith("hospital_") && fromLang) {
      const hostLangVal = mapLang(fromLang) || String(fromLang).trim() || null;
      if (hostLangVal) {
        dbRun("UPDATE hospital_sessions SET host_lang = ? WHERE room_id = ? AND status = ?", [hostLangVal, roomId, "active"]).catch(() => {});
      }
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
      const isHospitalRoom = String(meta.siteContext || "").startsWith("hospital_");
      if (isHospitalRoom) {
        const pids = Object.keys(meta.participants);
        console.log(`[consultation:join] roomId=${roomId} participantId=${participantId} roleHint=${roleHint} participantsCount=${pids.length} pids=[${pids.join(",")}]`);
      }
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
        resetDailyStats();
        usageStats.guestJoins += 1;
        sendConnectionAlert('guest', { roomId, ip: socket.data.clientIp || getClientIpFromSocket(socket) });
        console.log(`[GUEST] Joined room: ${roomId}, Socket: ${socket.id}`);
        const joinPayload = { roomId, socketId: socket.id, lang: fromLang || "auto" };
        socket.to(roomId).emit("guest:joined", joinPayload);
        socket.to(roomId).emit("user-joined", joinPayload);
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
        const hostPid = meta.ownerPid;
        if (hostPid && hostPid !== participantId) {
          const isHospitalPush = String(meta.siteContext || "").startsWith("hospital_");
          const guestName = isHospitalPush ? "환자" : String(nativeName || localName || "Guest");
          const guestLang = String(pLang || fromLang || "auto").toUpperCase();
          maybeSendPushToUser(
            hostPid,
            {
              title: "MONO",
              body: `[${guestName}/${guestLang}]님이 대화방에 입장했습니다`,
              roomId,
              senderName: guestName,
              url: `/room/${roomId}`,
              tag: `mono-guest-join-${roomId}`,
            },
            { roomId }
          );
        }
      }

      // If both participants present → immediately send native names + generate adapted names
      const pids = Object.keys(meta.participants);
      if (pids.length === 2) {
        const [pidA, pidB] = pids;
        const pA = meta.participants[pidA];
        const pB = meta.participants[pidB];
        const isHospitalJoin = String(meta.siteContext || "").startsWith("hospital_");
        const ownerPidJoin = meta.ownerPid;

        // Immediate fallback: send native names so UI never shows blank
        // Hospital mode: host sees "[국가코드] 환자", guest sees host nativeName
        if (pA?.socketId && pB?.nativeName) {
          const isAHost = pidA === ownerPidJoin;
          let nameForA = pB.nativeName;
          if (isHospitalJoin && ownerPidJoin) {
            if (isAHost) {
              // A is host → show "환자" for guest B
              nameForA = "환자";
            }
            // A is guest → show host nativeName (unchanged)
          }
          io.to(pA.socketId).emit("partner-info", {
            roomId,
            peerUserId: pidB,
            peerCanonicalName: pB.nativeName,
            peerLocalizedName: nameForA,
            partnerName: nameForA,
            partnerNativeName: pB.nativeName,
            peerLang: pB.lang || "en",
          });
        }
        if (pB?.socketId && pA?.nativeName) {
          const isBHost = pidB === ownerPidJoin;
          let nameForB = pA.nativeName;
          if (isHospitalJoin && ownerPidJoin) {
            if (isBHost) {
              // B is host → show "환자" for guest A
              nameForB = "환자";
            }
            // B is guest → show host nativeName (unchanged)
          }
          io.to(pB.socketId).emit("partner-info", {
            roomId,
            peerUserId: pidA,
            peerCanonicalName: pA.nativeName,
            peerLocalizedName: nameForB,
            partnerName: nameForB,
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
        resetDailyStats();
        usageStats.guestJoins += 1;
        sendConnectionAlert('guest', { roomId, ip: socket.data.clientIp || getClientIpFromSocket(socket) });
        const joinPayload = {
          roomId,
          socketId: socket.id,
          lang: fromLang || "auto",
          callSign,
        };
        socket.to(roomId).emit("guest:joined", joinPayload);
        socket.to(roomId).emit("user-joined", joinPayload);
        const hostPid = meta.ownerPid;
        if (hostPid && hostPid !== participantId) {
          const guestName = String(localName || callSign || "Guest");
          const guestLang = String(pLang || fromLang || "auto").toUpperCase();
          maybeSendPushToUser(
            hostPid,
            {
              title: "MONO",
              body: `[${guestName}/${guestLang}]님이 대화방에 입장했습니다`,
              roomId,
              senderName: guestName,
              url: `/room/${roomId}`,
              tag: `mono-guest-join-${roomId}`,
            },
            { roomId }
          );
        }
      }
    }

    trackRealSessionConnected(roomId, meta);

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
  socket.on("stt:open", async ({ roomId, lang, participantId, sampleRateHz = 16000, roleHint }) => {
    if (!roomId || !participantId) return;
    socket._sttParticipantId = participantId;
    // ROOMS-DB 동기화: ROOMS에 없고 PT- 방이면 hospital_sessions에서 조회 후 ROOMS 재생성 후 인증 통과
    if (!ROOMS.has(roomId) && String(roomId).startsWith('PT-')) {
      try {
        const row = await dbGet('SELECT id, status, patient_token, dept FROM hospital_sessions WHERE room_id = ? LIMIT 1', [roomId]);
        if (row) {
          const hospitalSiteContext = `hospital_${row.dept || 'general'}`;
          const isEnded = row.status === 'ended';
          ROOMS.set(roomId, {
            roomType: 'oneToOne',
            ownerLang: 'auto',
            guestLang: 'auto',
            siteContext: hospitalSiteContext,
            locked: true,
            ownerPid: null,
            participants: {},
            callSignCounters: {},
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            hospitalMode: true,
            hospitalEndedSession: isEnded,
            department: row.dept || 'general',
            patientToken: row.patient_token,
            hospitalSessionId: row.id,
            restored: true,
          });
          const meta = ROOMS.get(roomId);
          meta.participants[participantId] = { socketId: socket.id };
          ROOMS.set(roomId, meta);
        }
      } catch (e) {
        console.warn('[stt:open] PT- room restore failed:', e?.message);
      }
    }
    if (!isAuthorizedParticipant(socket, roomId, participantId)) {
      console.warn(`[auth] stt:open rejected room=${roomId} pid=${participantId} sid=${socket.id}`);
      return;
    }
    const meta = ensureRoomMeta(roomId);
    if (!SOCKET_ROLES.get(socket.id)) {
      const isHospitalRoom = String(roomId).startsWith('PT-') || String(meta.siteContext || '').startsWith('hospital_');
      let role = meta.ownerPid && meta.ownerPid === participantId ? "owner" : "guest";
      if (isHospitalRoom && roleHint === "owner") {
        role = "owner";
        meta.ownerPid = participantId;
        ROOMS.set(roomId, meta);
      }
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
    const tServer = Date.now();
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
    const rms = calculatePcmRms(pcm);
    console.log(`[stt:segment] pid=${participantId} duration=${durationSec.toFixed(2)}s bytes=${pcm.length}`);
    socket.emit("stt:segment-received", {
      roomId,
      participantId,
      bytes: pcm.length,
      durationSec,
    });
    if (durationSec < STT_MIN_DURATION_SEC) { console.log("[stt:segment] ⏭ too short"); return; }
    if (rms < STT_MIN_RMS) {
      console.log(`[stt:segment] ⏭ low volume rms=${rms.toFixed(5)}`);
      socket.emit("stt:no-voice", { roomId, participantId, message: "음성이 감지되지 않았습니다" });
      return;
    }

    const sttMeta = ensureRoomMeta(roomId);
    const sttHospitalMode = isHospitalContext(sttMeta.siteContext);

    let text = "";
    try {
      text = await transcribePcm16(pcm, session.lang, session.sampleRateHz, { hospitalMode: sttHospitalMode });
      text = normalizeRepeats(text);
      console.log(`[stt:segment] 🎙 STT result: "${text}"${sttHospitalMode ? ' [hospital]' : ''}`);
    } catch (e) {
      console.warn("[stt] transcribe error:", e?.message);
      if (isQuotaExceededError(e)) emitQuotaWarning(socket);
      return;
    }
    if (!text || isGarbageText(text) || isWhisperHallucinationText(text)) {
      console.log("[stt:segment] ⏭ garbage/hallucination");
      return;
    }
    if (text.trim().length <= 2 && durationSec < 0.8) { console.log("[stt:segment] ⏭ too short text"); return; }

    const meta = ensureRoomMeta(roomId);
    const rec = SOCKET_ROLES.get(socket.id) || {};
    const senderParticipant = meta.participants[participantId];
    const registeredLang = senderParticipant?.lang || (rec.role === "owner" ? meta.ownerLang : meta.guestLang);
    // ✅ 실제 발화 언어 감지: STT 결과의 스크립트를 분석하여 등록 언어와 다르면 실제 언어 사용
    const detectedLang = detectTextLang(text);
    const fromLang = registeredLang || detectedLang;
    if (detectedLang && detectedLang !== registeredLang) {
      console.log(`[stt:lang] ⚠ registered=${registeredLang} detected=${detectedLang} → keeping registered=${fromLang}`);
    }
    const siteCtx = meta.siteContext || "general";
    const senderCallSign = senderParticipant?.callSign || "";
    const senderSocketId = socket.id; // stt:segment_end emitter = sender; use this for session log role, not receiver

    const emitTranslated = async (finalText) => {
      if (!finalText || isGarbageText(finalText)) return;
      const roomType = meta.roomType || "oneToOne";
      const msgId = uuidv4();

      const roomContext = getRoomContext(roomId);
      addToRoomContext(roomId, { text: finalText, lang: fromLang, role: 'user' });

      // ══════════════════════════════════════
      // A. ONE-TO-ONE ROOM — always send to the other person
      // ══════════════════════════════════════
      if (roomType === "oneToOne") {
        const otherPid = Object.keys(meta.participants).find(p => p !== participantId);
        const otherP = otherPid ? meta.participants[otherPid] : null;
        const toLang = otherP?.lang || "en";
        const isHospital1to1 = String(meta.siteContext || "").startsWith("hospital_");
        if (isHospital1to1) {
          const pcount = Object.keys(meta.participants).length;
          console.log(`[consultation:stt] roomId=${roomId} sender=${participantId} otherPid=${otherPid || 'none'} participants=${pcount} otherSocketId=${otherP?.socketId || 'none'}`);
        }

        // Resolve sender display name for receiver's language
        const senderP = meta.participants[participantId];
        let senderDisplayName = senderP?.adaptedNames?.[toLang] || senderP?.nativeName || "";
        // Hospital mode: host sees guest as "환자", guest sees host as "의료진"
        const isHospitalMsg = String(meta.siteContext || "").startsWith("hospital_");
        if (isHospitalMsg && meta.ownerPid) {
          if (otherPid === meta.ownerPid) {
            // receiver is host, sender is guest → host sees "환자"
            senderDisplayName = "환자";
          } else if (participantId === meta.ownerPid) {
            // sender is host, receiver is guest → guest sees "의료진"
            senderDisplayName = "의료진";
          }
        }

        let translated = finalText;
        if (fromLang !== toLang) {
          try {
            if (await canTranslateForUser(socket, participantId)) {
              translated = await fastTranslate(finalText, fromLang, toLang, "", siteCtx, roomContext, {
                contextInject: meta.contextInject,
                stream: true,
                onChunk: (chunk) => {
                  if (otherP?.socketId) {
                    io.to(otherP.socketId).emit("receive-message-stream", {
                      roomId,
                      messageId: msgId,
                      chunk,
                      fromLang,
                      toLang,
                      senderPid: participantId,
                      originalText: finalText,
                    });
                  }
                },
              });
              if (otherP?.socketId) {
                io.to(otherP.socketId).emit("receive-message-stream-end", {
                  roomId,
                  messageId: msgId,
                  fullText: translated || finalText,
                  fromLang,
                  toLang,
                  originalText: finalText,
                });
              }
              await consumeTranslationUsage(participantId);
              console.log(`[1:1:translate] ✅ "${(translated || '').slice(0, 60)}"`);
            }
          } catch (e) { console.warn("[translate]:", e?.message); }
        }
        // Strip ALL leading [tag] (e.g. [Korean], [Professional Medical Korean]) before sending/saving
        if (typeof translated === 'string') translated = translated.replace(/^(\[.*?\]\s*)+/, '').trim();
        if (isGarbageText(translated)) return;

        // → Other: 번역 시 스트리밍으로 이미 전송됨. 동일 언어 시 receive-message로 한 번에 전송
        // 태블릿→의사 PC: otherP가 없을 때도 같은 방(roomId)의 다른 소켓에 전달
        const targetSocketId = otherP?.socketId;
        if (targetSocketId) {
          if (fromLang === toLang) {
            io.to(targetSocketId).emit("receive-message", {
              id: msgId, roomId, roomType,
              senderPid: participantId,
              senderDisplayName,
              senderCallSign: senderDisplayName,
              originalText: finalText, translatedText: translated,
              text: translated || finalText,
              isDraft: true, at: Date.now(), timestamp: Date.now(),
            });
          } else {
            // 번역 경로에서도 최종 receive-message 전송 (클라이언트가 stream-end만 놓칠 수 있음)
            io.to(targetSocketId).emit("receive-message", {
              id: msgId, roomId, roomType,
              senderPid: participantId,
              senderDisplayName,
              senderCallSign: senderDisplayName,
              originalText: finalText, translatedText: translated,
              text: translated || finalText,
              isDraft: true, at: Date.now(), timestamp: Date.now(),
            });
          }
          addToRoomContext(roomId, { text: translated || finalText, lang: toLang, role: 'assistant' });
          if (otherPid) {
            socket.emit("message-status", {
              roomId,
              messageId: msgId,
              participantId: otherPid,
              status: "delivered",
              at: Date.now(),
            });
          }
        } else {
          socket.to(roomId).emit("receive-message", {
            id: msgId, roomId, roomType,
            senderPid: participantId,
            senderDisplayName,
            senderCallSign: senderDisplayName,
            originalText: finalText, translatedText: translated,
            text: translated || finalText,
            isDraft: true, at: Date.now(), timestamp: Date.now(),
          });
          addToRoomContext(roomId, { text: translated || finalText, lang: toLang, role: 'assistant' });
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
          const hq = await hqTranslate(finalText, fromLang, toLang, "", siteCtx, roomContext, { contextInject: meta.contextInject });
          if (!isGarbageText(hq)) {
            finalizedForTts = hq;
            if (otherP?.socketId) {
              io.to(otherP.socketId).emit("revise-message", {
                id: msgId, senderPid: participantId, translatedText: hq, isDraft: false,
              });
            }
            // Session log: append ONLY after hqTranslate completes; use SENDER's role (stt:segment_end emitter), not receiver's
            if (isHospital1to1) {
              const senderRec = SOCKET_ROLES.get(senderSocketId) || {};
              const roleLabel = senderRec.role === 'owner' ? '직원' : '환자';
              appendHospitalSessionLog(roomId, roleLabel, finalText, finalizedForTts);
            }
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

        // ── Save to DB: when saveMessages is true, or when hospital mode and saveMessages not explicitly false ──
        const isOrgContext = String(meta.siteContext || "").startsWith("org_");
        const shouldSaveMessages = !meta.hospitalEndedSession && (meta.saveMessages === true || (meta.saveMessages !== false && isHospitalMsg) || (roomId && roomId.startsWith('PT-')));
        if (shouldSaveMessages && roomId) {
          try {
            const sessionRow = await dbGet('SELECT patient_token FROM hospital_sessions WHERE room_id = ?', [roomId]).catch(() => null);
            const pToken = meta?.patientToken ?? ROOMS.get(roomId)?.patientToken ?? sessionRow?.patient_token ?? null;
            // Find active session for this room (try new patient_token-based first)
            let activeSession = null;
            if (pToken) {
              activeSession = await dbGet(
                `SELECT id FROM hospital_sessions WHERE room_id = ? ORDER BY started_at DESC LIMIT 1`,
                [roomId]
              ).catch(() => null);
            }
            if (!activeSession) {
              activeSession = await dbGet(
                `SELECT id FROM hospital_sessions WHERE room_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                [roomId]
              ).catch(() => null);
            }
            const senderRole = rec.role === 'owner' ? 'host' : 'guest';
            // Dedup: skip if same room+text already saved in last 10s (e.g. stt:whisper + send-message on mobile)
            const recentDup = await dbGet(
              `SELECT id FROM hospital_messages WHERE room_id = ? AND original_text = ? AND created_at > datetime('now', '-10 seconds') LIMIT 1`,
              [roomId, finalText]
            ).catch(() => null);
            if (!recentDup) {
              const orgRow = await dbGet('SELECT org_code FROM hospital_sessions WHERE room_id = ? LIMIT 1', [roomId]).catch(() => null);
              const keyHex = await getOrgEncryptionKey(orgRow?.org_code || null);
              const encOriginal = encryptText(finalText, keyHex);
              const encTranslated = encryptText(translated || '', keyHex);
              await dbRun(
                `INSERT INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [msgId, activeSession?.id || null, roomId, senderRole, fromLang, encOriginal, encTranslated, toLang, pToken]
              );
            }
          } catch (dbErr) { console.warn('[hospital:msg-save]', dbErr?.message); trackUsageError(dbErr, { source: 'hospital:msg-save' }); }
        }
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
          try {
            if (await canTranslateForUser(socket, participantId)) {
              translated = await fastTranslate(cleanText, fromLang, toLang, "", siteCtx, roomContext, { contextInject: meta.contextInject });
              await consumeTranslationUsage(participantId);
            }
          } catch (e) { console.warn("[translate]:", e?.message); }
        }

        if (targetP.socketId) {
          io.to(targetP.socketId).emit("receive-message", {
            id: msgId, roomId, roomType,
            senderPid: participantId, senderCallSign,
            originalText: cleanText, translatedText: translated,
            text: translated || cleanText,
            isDraft: true, at: Date.now(), timestamp: Date.now(),
          });
        addToRoomContext(roomId, { text: translated || cleanText, lang: toLang, role: 'assistant' });
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
          const hq = await hqTranslate(cleanText, fromLang, toLang, "", siteCtx, roomContext, { contextInject: meta.contextInject });
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
          try {
            if (await canTranslateForUser(socket, participantId)) {
              translated = await fastTranslate(finalText, fromLang, lang, "", siteCtx, roomContext, { contextInject: meta.contextInject });
              await consumeTranslationUsage(participantId);
            }
          } catch (e) { console.warn("[translate]:", e?.message); }
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
            addToRoomContext(roomId, { text: translated || finalText, lang, role: 'assistant' });
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
          const hq = await hqTranslate(finalText, fromLang, lang, "", siteCtx, roomContext, { contextInject: meta.contextInject });
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

  socket.on("stt:whisper", async ({ roomId, participantId, lang, audio, mimeType } = {}, ack) => {
    const ackReply = (payload) => {
      if (typeof ack === "function") {
        try { ack(payload); } catch {}
      }
    };
    if (!consumeRate(socket.id, "stt:whisper", LIMITS.STT_WHISPER_PER_30S, 30000)) {
      ackReply({ ok: false, error: "rate_limited" });
      return;
    }
    if (!roomId || !participantId || typeof audio !== "string" || !audio.trim()) {
      ackReply({ ok: false, error: "invalid_payload" });
      return;
    }
    if (!isAuthorizedParticipant(socket, roomId, participantId)) {
      console.warn(`[auth] stt:whisper rejected room=${roomId} pid=${participantId} sid=${socket.id}`);
      ackReply({ ok: false, error: "unauthorized" });
      return;
    }
    if (audio.length > LIMITS.MAX_WHISPER_AUDIO_BASE64_CHARS) {
      console.warn(`[stt:whisper] payload too large sid=${socket.id} len=${audio.length}`);
      ackReply({ ok: false, error: "payload_too_large" });
      return;
    }

    let audioBuffer = null;
    try {
      audioBuffer = Buffer.from(audio, "base64");
    } catch {
      ackReply({ ok: false, error: "invalid_base64" });
      return;
    }
    if (!audioBuffer?.length) {
      ackReply({ ok: false, error: "empty_audio" });
      return;
    }

    const whisperMeta = ROOMS.get(roomId) || {};
    const whisperHospitalMode = isHospitalContext(whisperMeta.siteContext);

    let text = "";
    try {
      text = await transcribeEncodedAudioBuffer(audioBuffer, mimeType || "audio/webm", lang, { hospitalMode: whisperHospitalMode });
      text = normalizeRepeats(text);
    } catch (e) {
      console.warn("[stt:whisper] transcribe error:", e?.message || e);
      if (isQuotaExceededError(e)) emitQuotaWarning(socket);
      ackReply({ ok: false, error: "transcribe_failed" });
      return;
    }

    const normalized = String(text || "").trim();
    if (!normalized || isGarbageText(normalized) || isWhisperHallucinationText(normalized)) {
      ackReply({ ok: true, text: "" });
      return;
    }
    if (normalized.length <= 2) {
      ackReply({ ok: true, text: "" });
      return;
    }

    // 병원 모드 + 미디어레코드(마이크 눌렀다 뗐을 때) 경로: hospital_messages 저장 (send-message와 동일하게 SOCKET_ROLES로 sender_role 결정)
    if (whisperHospitalMode && roomId) {
      try {
        const meta = ensureRoomMeta(roomId);
        const isHospital1to1 = meta.roomType === "oneToOne" && String(meta.siteContext || "").startsWith("hospital_");
        if (isHospital1to1 && !meta.hospitalEndedSession) {
          const rec = SOCKET_ROLES.get(socket.id) || {};
          const senderRole = rec.role === "owner" ? "host" : "guest";
          const fromLang = mapLang(lang || "en");
          const sessionRow = await dbGet("SELECT patient_token FROM hospital_sessions WHERE room_id = ?", [roomId]).catch(() => null);
          const pToken = meta?.patientToken ?? ROOMS.get(roomId)?.patientToken ?? sessionRow?.patient_token ?? null;
          let activeSession = null;
          if (pToken) {
            activeSession = await dbGet(
              "SELECT id FROM hospital_sessions WHERE room_id = ? ORDER BY started_at DESC LIMIT 1",
              [roomId]
            ).catch(() => null);
          }
          if (!activeSession) {
            activeSession = await dbGet(
              "SELECT id FROM hospital_sessions WHERE room_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
              [roomId]
            ).catch(() => null);
          }
          const otherPid = Object.keys(meta.participants).find(p => p !== participantId);
          const otherP = otherPid ? meta.participants[otherPid] : null;
          const toLang = otherP?.lang || "en";
          const siteCtx = meta.siteContext || "general";
          const roomContext = getRoomContext(roomId);
          addToRoomContext(roomId, { text: normalized, lang: fromLang, role: 'user' });
          let translatedText = normalized;
          if (fromLang !== toLang) {
            try {
              if (await canTranslateForUser(socket, participantId)) {
                translatedText = await fastTranslate(normalized, fromLang, toLang, "", siteCtx, roomContext, { contextInject: meta.contextInject });
                await consumeTranslationUsage(participantId);
              }
            } catch (e) { console.warn("[stt:whisper][translate]:", e?.message); }
          }
          // Strip ALL leading [tag] (e.g. [Korean], [Professional Medical Korean]) before every use
          const stripBracketTag = (s) => (typeof s === 'string' ? s.replace(/^(\[.*?\]\s*)+/, '').trim() : s);
          translatedText = stripBracketTag(translatedText);
          const msgId = uuidv4();
          // Dedup: skip if same room+text already saved in last 10s (e.g. stt:whisper + send-message on mobile)
          const recentDup = await dbGet(
            `SELECT id FROM hospital_messages WHERE room_id = ? AND original_text = ? AND created_at > datetime('now', '-10 seconds') LIMIT 1`,
            [roomId, normalized]
          ).catch(() => null);
          if (!recentDup) {
            const orgRow = await dbGet('SELECT org_code FROM hospital_sessions WHERE room_id = ? LIMIT 1', [roomId]).catch(() => null);
            const keyHex = await getOrgEncryptionKey(orgRow?.org_code || null);
            const encOriginal = encryptText(normalized, keyHex);
            const encTranslated = encryptText(translatedText, keyHex);
            await dbRun(
              `INSERT INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [msgId, activeSession?.id || null, roomId, senderRole, fromLang, encOriginal, encTranslated, toLang, pToken]
            );
          }
          const senderSocketId = socket.id;
          const senderRec = SOCKET_ROLES.get(senderSocketId) || {};
          const roleLabel = senderRec.role === 'owner' ? '직원' : '환자';
          appendHospitalSessionLog(roomId, roleLabel, normalized, translatedText);
        }
      } catch (dbErr) {
        console.warn("[stt:whisper][hospital:msg-save]", dbErr?.message);
        trackUsageError(dbErr, { source: "hospital:msg-save-whisper" });
      }
    }

    socket.emit("stt:result", { roomId, participantId, text: normalized, final: true });
    ackReply({ ok: true, text: normalized });
  });

  // --- send-message 핸들러 (room-type aware) ---
  socket.on('send-message', async (data, ack) => {
    const { roomId, message, participantId } = data || {};
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
    const fromLang = registeredLang || detectedLang;

    const roomContext = getRoomContext(roomId);
    addToRoomContext(roomId, { text: trimmedText, lang: fromLang, role: 'user' });

    // ══════════════════════════════════════
    // A. ONE-TO-ONE — always send to the other person
    // ══════════════════════════════════════
    if (roomType === "oneToOne") {
      const otherPid = Object.keys(meta.participants).find(p => p !== participantId);
      const otherP = otherPid ? meta.participants[otherPid] : null;
      const toLang = otherP?.lang || "en";

      // Sender's display name adapted to receiver's language
      let senderDisplayName = senderP?.adaptedNames?.[toLang] || senderP?.nativeName || "";
      // Hospital mode: host always sees guest as "환자"
      const isHospitalMsg2 = String(meta.siteContext || "").startsWith("hospital_");
      if (isHospitalMsg2 && meta.ownerPid && otherPid === meta.ownerPid) {
        senderDisplayName = "환자";
      }

      let draft = trimmedText;
      if (fromLang !== toLang) {
        try {
          if (await canTranslateForUser(socket, participantId)) {
            draft = await fastTranslate(trimmedText, fromLang, toLang, '', siteCtx, roomContext, { contextInject: meta.contextInject });
            await consumeTranslationUsage(participantId);
          }
        }
        catch (e) {
          console.warn('[translate]:', e.message);
          if (isQuotaExceededError(e)) emitQuotaWarning(socket);
        }
      }
      // Strip ALL leading [tag] (e.g. [Korean], [English]) before sending/saving — same as stt:segment_end
      if (typeof draft === 'string') draft = draft.replace(/^(\[.*?\]\s*)+/, '').trim();

      // → Other (sender name adapted to receiver's language)
      const targetSocketId = otherP?.socketId;
      if (targetSocketId) {
        io.to(targetSocketId).emit('receive-message', {
          id, roomId, roomType,
          senderPid: participantId,
          senderDisplayName,
          senderCallSign: senderDisplayName,
          originalText: trimmedText, translatedText: draft,
          text: draft || trimmedText,
          isDraft: true, at: Date.now(), timestamp: Date.now(),
        });
        addToRoomContext(roomId, { text: draft || trimmedText, lang: toLang, role: 'assistant' });
        io.to(targetSocketId).emit("notify", {
          title: senderDisplayName || "MONO",
          body: draft?.substring(0, 50) || "",
          roomId,
        });
        if (otherPid) {
          socket.emit("message-status", {
            roomId,
            messageId: id,
            participantId: otherPid,
            status: "delivered",
            at: Date.now(),
          });
        }
      } else {
        socket.to(roomId).emit('receive-message', {
          id, roomId, roomType,
          senderPid: participantId,
          senderDisplayName,
          senderCallSign: senderDisplayName,
          originalText: trimmedText, translatedText: draft,
          text: draft || trimmedText,
          isDraft: true, at: Date.now(), timestamp: Date.now(),
        });
        addToRoomContext(roomId, { text: draft || trimmedText, lang: toLang, role: 'assistant' });
      }
      // Push only when receiver is not actively viewing this room in foreground.
      maybeSendPushToUser(otherPid, {
        title: senderDisplayName || 'MONO',
        body: draft?.substring(0, 80) || trimmedText?.substring(0, 80) || '',
        roomId,
        senderName: senderDisplayName,
        url: `/room/${roomId}`,
      }, { roomId });

      let finalizedForTts = draft;
      try {
        const hq = await hqTranslate(trimmedText, fromLang, toLang, '', siteCtx, roomContext, { contextInject: meta.contextInject });
        // Strip ALL leading [tag] (e.g. [Korean], [English]) — same as stt:segment_end
        const hqClean = typeof hq === 'string' ? hq.replace(/^(\[.*?\]\s*)+/, '').trim() : hq;
        if (!isGarbageText(hqClean)) {
          finalizedForTts = hqClean;
          if (targetSocketId) {
            io.to(targetSocketId).emit('revise-message', { id, senderPid: participantId, translatedText: hqClean, isDraft: false });
          } else {
            socket.to(roomId).emit('revise-message', { id, senderPid: participantId, translatedText: hqClean, isDraft: false });
          }
        }
        // ── Hospital: update translated text ──
        if (meta.hospitalSessionId || meta.hospitalMode || (roomId && roomId.startsWith('PT-'))) {
          dbRun(
            `UPDATE hospital_messages SET translated_text = ?, translated_lang = ? WHERE id = ?`,
            [finalizedForTts, toLang, id]
          ).catch(() => {});
        }
      } catch (e) {}
      // TTS → other (typed messages also get spoken)
      try {
        const ttsBuffer = await synthesizeSpeech(finalizedForTts, toLang);
        if (ttsBuffer) {
          if (targetSocketId) {
            io.to(targetSocketId).emit("tts_audio", {
              senderPid: participantId, format: "mp3",
              audio: ttsBuffer.toString("base64"),
            });
          } else {
            socket.to(roomId).emit("tts_audio", {
              senderPid: participantId, format: "mp3",
              audio: ttsBuffer.toString("base64"),
            });
          }
        }
      } catch (e) { console.warn("[tts:send-msg]:", e?.message); }

      // ── Hospital mode: auto-save message to DB ──
      if ((isHospitalMsg2 || (roomId && roomId.startsWith('PT-'))) && roomId) {
        try {
          const sessionRow2 = await dbGet('SELECT patient_token FROM hospital_sessions WHERE room_id = ?', [roomId]).catch(() => null);
          const pToken2 = meta?.patientToken ?? ROOMS.get(roomId)?.patientToken ?? sessionRow2?.patient_token ?? null;
          let activeSession2 = null;
          if (pToken2) {
            activeSession2 = await dbGet(
              `SELECT id FROM hospital_sessions WHERE room_id = ? ORDER BY started_at DESC LIMIT 1`,
              [roomId]
            ).catch(() => null);
          }
          if (!activeSession2) {
            activeSession2 = await dbGet(
              `SELECT id FROM hospital_sessions WHERE room_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
              [roomId]
            ).catch(() => null);
          }
          const senderRole = rec.role === 'owner' ? 'host' : 'guest';
          // Dedup: skip if same room+text already saved in last 10s (e.g. stt:whisper + send-message on mobile)
          const recentDup = await dbGet(
            `SELECT id FROM hospital_messages WHERE room_id = ? AND original_text = ? AND created_at > datetime('now', '-10 seconds') LIMIT 1`,
            [roomId, trimmedText]
          ).catch(() => null);
          if (!recentDup) {
            const orgRow = await dbGet('SELECT org_code FROM hospital_sessions WHERE room_id = ? LIMIT 1', [roomId]).catch(() => null);
            const keyHex = await getOrgEncryptionKey(orgRow?.org_code || null);
            const encOriginal = encryptText(trimmedText, keyHex);
            const encTranslated = encryptText(draft || '', keyHex);
            await dbRun(
              `INSERT OR IGNORE INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, activeSession2?.id || null, roomId, senderRole, fromLang, encOriginal, encTranslated, toLang, pToken2]
            );
          }
        } catch (dbErr2) { console.warn('[hospital:msg-save2]', dbErr2?.message); trackUsageError(dbErr2, { source: 'hospital:msg-save2' }); }
      }
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
        try {
          if (await canTranslateForUser(socket, participantId)) {
            draft = await fastTranslate(cleanText, fromLang, toLang, '', siteCtx, roomContext, { contextInject: meta.contextInject });
            await consumeTranslationUsage(participantId);
          }
        }
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
        addToRoomContext(roomId, { text: draft || cleanText, lang: toLang, role: 'assistant' });
      }
      maybeSendPushToUser(csMatch.targetPid, {
        title: senderCallSign || 'MONO',
        body: draft?.substring(0, 80) || cleanText?.substring(0, 80) || '',
        roomId,
        senderName: senderCallSign,
        url: `/room/${roomId}`,
      }, { roomId });
      let finalizedForTts = draft;
      try {
        const hq = await hqTranslate(cleanText, fromLang, toLang, '', siteCtx, roomContext, { contextInject: meta.contextInject });
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
        try {
          if (await canTranslateForUser(socket, participantId)) {
            draft = await fastTranslate(trimmedText, fromLang, lang, '', siteCtx, roomContext, { contextInject: meta.contextInject });
            await consumeTranslationUsage(participantId);
          }
        }
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
          addToRoomContext(roomId, { text: draft || trimmedText, lang, role: 'assistant' });
          io.to(listener.socketId).emit("notify", {
            title: "MONO",
            body: draft?.substring(0, 50) || "",
            roomId,
          });
        }
        if (listenerPid) {
          maybeSendPushToUser(listenerPid, {
            title: senderCallSign || 'MONO',
            body: draft?.substring(0, 80) || '',
            roomId,
            senderName: senderCallSign,
            url: `/room/${roomId}`,
          }, { roomId });
        }
      }
      let finalizedForTts = draft;
      // HQ revision per language group
      try {
        const hq = await hqTranslate(trimmedText, fromLang, lang, '', siteCtx, roomContext, { contextInject: meta.contextInject });
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
    resetDailyStats();
    usageStats.currentConnections = Math.max(0, usageStats.currentConnections - 1);
    const roomId = socket.roomId;
    console.log(`🔴 ${socket.id} disconnected from room ${roomId} (${reason})`);
    removeUserPresenceBySocket(socket.id);

    // Clear socketId in USER_REGISTRY
    const uid = socket.data?.userId;
    if (uid) {
      const u = USER_REGISTRY.get(uid);
      if (u && u.socketId === socket.id) u.socketId = null;
    }

    if (!roomId) return;
    SOCKET_ROLES.delete(socket.id);
    let disconnectedWasHost = false;
    const metaBefore = roomId ? ROOMS.get(roomId) : null;
    if (metaBefore?.ownerPid) {
      const ownerSocketId = metaBefore.participants?.[metaBefore.ownerPid]?.socketId;
      disconnectedWasHost = ownerSocketId === socket.id;
    }
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    const remaining = roomSockets ? roomSockets.size : 0;

    // ✅ 수정: 방 즉시 삭제 → 유예 후 삭제로 변경
    if (remaining === 0) {
      // ✅ 모바일 백그라운드/공유 시 끊김 대비: 방 삭제 유예 (기본 30초, 필요 시 늘림)
      const capturedRoomId = roomId; // closure safety
      setTimeout(async () => {
        const room = io.sockets.adapter.rooms.get(capturedRoomId);
        if (!room || room.size === 0) {
          // ── Hospital: 세션 자동 종료 ──
          if (String(metaBefore?.siteContext || '').startsWith('hospital_')) {
            archiveHospitalSessionLog(capturedRoomId, metaBefore?.patientToken ?? null);
          }
          try {
            const activeSess = await dbGet(
              `SELECT id FROM hospital_sessions WHERE room_id = ? AND status = 'active' LIMIT 1`,
              [capturedRoomId]
            );
            if (activeSess) {
              await dbRun(
                `UPDATE hospital_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`,
                [activeSess.id]
              );
              console.log(`[hospital] 🔚 Session ${activeSess.id} auto-ended (room empty)`);
            }
          } catch (e) { console.warn('[hospital:auto-end]', e?.message); trackUsageError(e, { source: 'hospital:auto-end' }); }
          ROOMS.delete(capturedRoomId);
          delete messageBuffer[capturedRoomId];
          syncRoomsActive();
          console.log(`💨 Room ${capturedRoomId} removed after grace period`);
        } else {
          console.log(`🟢 Room ${capturedRoomId} survived grace period`);
        }
      }, 300_000); // 5분 유예 (모바일 백그라운드 재접속 대비)
    } else {
      console.log(`👤 Room ${roomId} has ${remaining} socket(s) remaining`);

      // ── broadcast → oneToOne 복원: 온라인 참여자 ≤ 2이면 1:1로 되돌림 ──
      const metaCheck = ROOMS.get(roomId);
      if (metaCheck && metaCheck.roomType === "broadcast") {
        revertBroadcastToOneToOne(roomId, metaCheck);
      }

      if (disconnectedWasHost) {
        io.to(roomId).emit("host-left", { message: "호스트가 통역을 종료했습니다." });
        // ── Hospital: 호스트가 떠나면 즉시 세션 종료 ──
        const isHospitalDisc = String(metaBefore?.siteContext || "").startsWith("hospital_");
        if (isHospitalDisc) {
          archiveHospitalSessionLog(roomId, metaBefore?.patientToken ?? null);
          (async () => {
            try {
              const activeSessHost = await dbGet(
                `SELECT id FROM hospital_sessions WHERE room_id = ? AND status = 'active' LIMIT 1`,
                [roomId]
              );
              if (activeSessHost) {
                await dbRun(
                  `UPDATE hospital_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`,
                  [activeSessHost.id]
                );
                console.log(`[hospital] 🔚 Session ${activeSessHost.id} ended (host left)`);
              }
            } catch (e) { console.warn('[hospital:host-left-end]', e?.message); trackUsageError(e, { source: 'hospital:host-left-end' }); }
          })();
        }
        setTimeout(() => {
          const room = io.sockets.adapter.rooms.get(roomId);
          const meta = ROOMS.get(roomId);
          if (!room || room.size === 0 || !meta?.participants || Object.keys(meta.participants).length === 0) {
            io.to(roomId).emit("room-closed");
            ROOMS.delete(roomId);
            delete messageBuffer[roomId];
            syncRoomsActive();
            console.log(`💨 Room ${roomId} closed after host left`);
          }
        }, 5 * 60 * 1000);
      }
    }
  });

  socket.on('reconnect', () => {
    if (socket.roomId) {
      socket.join(socket.roomId);
      console.log(`🔄 ${socket.id} rejoined room ${socket.roomId}`);
    }
  });

  socket.on('hospital:watch', ({ department }) => {
    if (!department) return;
    const channel = `hospital:watch:${department}`;
    socket.join(channel);
    console.log(`[hospital:watch] Staff PC watching dept=${department} (socket=${socket.id})`);

    if (department === '__all__') {
      for (const [d, list] of HOSPITAL_WAITING.entries()) {
        list.forEach(w => {
          socket.emit('hospital:patient-waiting', w);
        });
      }
    } else {
      const waiting = HOSPITAL_WAITING.get(department) || [];
      if (waiting.length > 0) {
        waiting.forEach(w => socket.emit('hospital:patient-waiting', w));
      }
    }
  });

  socket.conn.on("close", (reason) => {
    console.log(`⚠️ Socket connection closed (${reason}), waiting for reconnect...`);
  });
});

async function handleSttUpload(req, res) {
  let tmpFile = null;
  try {
    if (!groq && !openai) return res.status(500).json({ error: 'stt_not_configured' });
    if (!req.file?.buffer) return res.status(400).json({ error: "no audio" });
    resetDailyStats();
    usageStats.sttRequests += 1;

    // Browser MediaRecorder outputs webm/opus; Whisper supports webm directly.
    tmpFile = path.join(os.tmpdir(), `${uuidv4()}.webm`);
    fs.writeFileSync(tmpFile, req.file.buffer);

    const language = String(req.body?.language || req.body?.lang || "").trim();

    let result;
    if (groq) {
      // Groq whisper-large-v3
      usageStats.groqSttRequests += 1;
      result = await groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: "whisper-large-v3",
        response_format: "json",
        temperature: 0.0,
        ...(language ? { language } : {}),
      });
    } else {
      // Fallback: OpenAI whisper-1
      usageStats.openaiSttRequests += 1;
      result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: "whisper-1",
        ...(language ? { language } : {}),
      });
    }

    res.json({ text: result.text || "" });

  } catch (err) {
    trackUsageError(err);
    console.error("[stt] error:", err.message);
    if (!res.headersSent) {
      const status = Number(err?.status || err?.code || 500);
      if (status === 429 || String(err?.message || "").includes("quota")) {
        return res.status(429).json({
          error: "stt_quota_exceeded",
          message: "잠시 후 다시 시도해주세요.",
        });
      }
      res.status(500).json({
        error: "stt_failed",
        message: "잠시 후 다시 시도해주세요.",
      });
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
}

app.post("/stt", upload.single("audio"), handleSttUpload);
app.post("/api/stt", upload.single("audio"), handleSttUpload);

function readAuthTokenFromRequest(req) {
  const cookieToken = req.cookies?.token;
  if (cookieToken) return cookieToken;
  const auth = req.headers?.authorization || "";
  if (String(auth).toLowerCase().startsWith("bearer ")) return String(auth).slice(7).trim();
  return "";
}

app.post("/api/auth/convert-guest", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "server_misconfig_jwt_secret" });
    }
    const token = readAuthTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "invalid_token" });
    }
    const roomId = String(req.body?.roomId || "").trim();
    const guestId = String(req.body?.guestId || "").trim();
    const userId = String(payload?.sub || "").trim();
    if (!roomId || !guestId || !userId) {
      return res.status(400).json({ error: "room_id_guest_id_required" });
    }
    const meta = ROOMS.get(roomId);
    if (!meta?.participants || !meta.participants[guestId]) {
      return res.json({ success: true, userId, converted: false });
    }

    if (!meta.participants[userId]) {
      meta.participants[userId] = {
        ...meta.participants[guestId],
        role: meta.participants[guestId]?.role || "Tech",
      };
    }
    delete meta.participants[guestId];
    if (meta.ownerPid === guestId) meta.ownerPid = userId;
    ROOMS.set(roomId, meta);
    emitParticipants(roomId);

    return res.json({ success: true, userId, converted: true });
  } catch (e) {
    return res.status(500).json({ error: "convert_guest_failed" });
  }
});

// ═══════════════════════════════════════════════════════════════
// HOSPITAL KIOSK MODE — DB + REST API + Socket events
// ═══════════════════════════════════════════════════════════════

// Auto-migrate: create hospital tables if not exist
(async () => {
  try {
    // Step 1: Create tables (without department in CREATE — safe for existing DBs)
    await dbExec(`
      CREATE TABLE IF NOT EXISTS hospital_sessions (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        chart_number TEXT NOT NULL,
        station_id TEXT DEFAULT 'default',
        host_lang TEXT,
        guest_lang TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS hospital_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        sender_role TEXT NOT NULL CHECK (sender_role IN ('host', 'guest')),
        sender_lang TEXT,
        original_text TEXT NOT NULL,
        translated_text TEXT,
        translated_lang TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES hospital_sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS hospital_patients (
        id TEXT PRIMARY KEY,
        chart_number TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL DEFAULT 'en',
        hospital_id TEXT DEFAULT 'default',
        name TEXT,
        phone TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Step 2: Backfill columns if missing (existing DBs)
    try {
      const cols = await dbAll("PRAGMA table_info(hospital_sessions)");
      if (!cols.some(c => c.name === 'department')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN department TEXT");
        console.log('[hospital] ✅ added department column to sessions');
      }
      if (!cols.some(c => c.name === 'patient_id')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN patient_id TEXT");
        console.log('[hospital] ✅ added patient_id column to sessions');
      }
    } catch (_) {}
    try {
      const pcols = await dbAll("PRAGMA table_info(hospital_patients)");
      if (!pcols.some(c => c.name === 'patient_id')) {
        await dbRun("ALTER TABLE hospital_patients ADD COLUMN patient_id TEXT");
        console.log('[hospital] ✅ added patient_id column to patients');
      }
      if (!pcols.some(c => c.name === 'last_seen')) {
        await dbRun("ALTER TABLE hospital_patients ADD COLUMN last_seen TEXT");
        console.log('[hospital] ✅ added last_seen column to patients');
      }
    } catch (_) {}
    // Step 3: Create indexes (after column backfill)
    await dbExec(`
      CREATE INDEX IF NOT EXISTS idx_hospital_sessions_chart ON hospital_sessions(chart_number);
      CREATE INDEX IF NOT EXISTS idx_hospital_sessions_station ON hospital_sessions(station_id);
      CREATE INDEX IF NOT EXISTS idx_hospital_sessions_status ON hospital_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_hospital_sessions_dept ON hospital_sessions(department);
      CREATE INDEX IF NOT EXISTS idx_hospital_messages_session ON hospital_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_hospital_messages_room ON hospital_messages(room_id);
      CREATE INDEX IF NOT EXISTS idx_hospital_patients_chart ON hospital_patients(chart_number);
      CREATE INDEX IF NOT EXISTS idx_hospital_patients_hospital ON hospital_patients(hospital_id);
    `);
    // patient_id index (may fail if column doesn't exist yet on first run)
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hospital_patients_pid ON hospital_patients(patient_id);`); } catch (_) {}
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hospital_sessions_pid ON hospital_sessions(patient_id);`); } catch (_) {}

    // ── patient_token 기반 새 테이블 (v2) ──
    await dbExec(`
      CREATE TABLE IF NOT EXISTS hospital_patients (
        patient_token TEXT PRIMARY KEY,
        dept TEXT,
        first_visit_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_visit_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `).catch(() => {
      // hospital_patients가 이미 다른 스키마로 존재할 수 있음 — patient_token 컬럼 추가 시도
    });
    // 기존 hospital_patients에 patient_token 컬럼이 없으면 추가
    try {
      const ptCols = await dbAll("PRAGMA table_info(hospital_patients)");
      if (!ptCols.some(c => c.name === 'patient_token')) {
        await dbRun("ALTER TABLE hospital_patients ADD COLUMN patient_token TEXT");
        console.log('[hospital] ✅ added patient_token column to hospital_patients');
      }
      if (!ptCols.some(c => c.name === 'first_visit_at')) {
        await dbRun("ALTER TABLE hospital_patients ADD COLUMN first_visit_at TEXT");
      }
      if (!ptCols.some(c => c.name === 'last_visit_at')) {
        await dbRun("ALTER TABLE hospital_patients ADD COLUMN last_visit_at TEXT");
      }
      if (!ptCols.some(c => c.name === 'dept')) {
        await dbRun("ALTER TABLE hospital_patients ADD COLUMN dept TEXT");
      }
    } catch (_) {}
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hp_patient_token ON hospital_patients(patient_token);`); } catch (_) {}

    // hospital_sessions에 patient_token 컬럼 추가 (기존 테이블 호환)
    try {
      const sesCols = await dbAll("PRAGMA table_info(hospital_sessions)");
      if (!sesCols.some(c => c.name === 'patient_token')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN patient_token TEXT");
        console.log('[hospital] ✅ added patient_token column to hospital_sessions');
      }
      if (!sesCols.some(c => c.name === 'dept')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN dept TEXT");
        console.log('[hospital] ✅ added dept column to hospital_sessions');
      }
      if (!sesCols.some(c => c.name === 'started_at')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN started_at TEXT");
      }
      if (!sesCols.some(c => c.name === 'org_id')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN org_id TEXT");
        console.log('[hospital] ✅ added org_id column to hospital_sessions');
      }
      if (!sesCols.some(c => c.name === 'assigned_room')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN assigned_room TEXT");
        console.log('[hospital] ✅ added assigned_room column to hospital_sessions');
      }
      if (!sesCols.some(c => c.name === 'status')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN status TEXT DEFAULT 'active'");
        console.log('[hospital] ✅ added status column to hospital_sessions');
      }
      if (!sesCols.some(c => c.name === 'org_code')) {
        await dbRun("ALTER TABLE hospital_sessions ADD COLUMN org_code TEXT");
        console.log('[hospital] ✅ added org_code column to hospital_sessions');
      }
    } catch (_) {}
    try {
      await dbRun("UPDATE hospital_sessions SET org_code = 'UNKNOWN' WHERE org_code IS NULL");
    } catch (_) {}
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hs_patient_token ON hospital_sessions(patient_token);`); } catch (_) {}
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hs_org_code ON hospital_sessions(org_code);`); } catch (_) {}

    // users 테이블에 org_code 컬럼 추가 (병원 대시보드 org 격리용)
    try {
      const userCols = await dbAll("PRAGMA table_info(users)");
      if (!userCols.some(c => c.name === 'org_code')) {
        await dbRun("ALTER TABLE users ADD COLUMN org_code TEXT");
        console.log('[hospital] ✅ added org_code column to users');
      }
    } catch (_) {}

    // hospital_messages에 patient_token, lang 컬럼 추가 (기존 테이블 호환)
    try {
      const msgCols = await dbAll("PRAGMA table_info(hospital_messages)");
      if (!msgCols.some(c => c.name === 'patient_token')) {
        await dbRun("ALTER TABLE hospital_messages ADD COLUMN patient_token TEXT");
        console.log('[hospital] ✅ added patient_token column to hospital_messages');
      }
      if (!msgCols.some(c => c.name === 'lang')) {
        await dbRun("ALTER TABLE hospital_messages ADD COLUMN lang TEXT");
      }
    } catch (_) {}
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hm_patient_token ON hospital_messages(patient_token);`); } catch (_) {}
    try {
      const msgCols2 = await dbAll("PRAGMA table_info(hospital_messages)");
      if (!msgCols2.some(c => c.name === 'offline')) {
        await dbRun("ALTER TABLE hospital_messages ADD COLUMN offline INTEGER DEFAULT 0");
        console.log('[hospital] ✅ added offline column to hospital_messages');
      }
      if (!msgCols2.some(c => c.name === 'delivered')) {
        await dbRun("ALTER TABLE hospital_messages ADD COLUMN delivered INTEGER DEFAULT 0");
        console.log('[hospital] ✅ added delivered column to hospital_messages');
      }
      if (!msgCols2.some(c => c.name === 'org_id')) {
        await dbRun("ALTER TABLE hospital_messages ADD COLUMN org_id TEXT");
        console.log('[hospital] ✅ added org_id column to hospital_messages');
      }
      if (!msgCols2.some(c => c.name === 'session_type')) {
        await dbRun("ALTER TABLE hospital_messages ADD COLUMN session_type TEXT DEFAULT 'reception'");
        console.log('[hospital] ✅ added session_type column to hospital_messages');
      }
    } catch (_) {}

    // hospital_rooms — 병원별 방 관리 (org_id 격리)
    await dbExec(`
      CREATE TABLE IF NOT EXISTS hospital_rooms (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'reception',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hospital_rooms_org ON hospital_rooms(org_id);`); } catch (_) {}
    try {
      const roomCols = await dbAll("PRAGMA table_info(hospital_rooms)");
      if (!roomCols.some(c => c.name === 'org_code')) {
        await dbRun("ALTER TABLE hospital_rooms ADD COLUMN org_code TEXT");
        console.log('[hospital] ✅ added org_code column to hospital_rooms');
      }
    } catch (_) {}
    console.log('[hospital] ✅ hospital_rooms table ready');

    // hospital_admins — 병원 대시보드 전용 이메일+비밀번호 로그인
    await dbExec(`
      CREATE TABLE IF NOT EXISTS hospital_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_code TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(org_code, email)
      );
    `);
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hospital_admins_org ON hospital_admins(org_code);`); } catch (_) {}
    try { await dbExec(`CREATE INDEX IF NOT EXISTS idx_hospital_admins_email ON hospital_admins(email);`); } catch (_) {}
    console.log('[hospital] ✅ hospital_admins table ready');

    // 병원 관리자 시드 (없으면 추가). organizations 행은 004 블록에서 생성 후 채움.
    const hospitalAdminSeeds = [
      { org_code: 'CHEONGDAM', email: 'cheongdam@lingora.chat', password: 'Cheongdam2026!', name: '청담 관리자' },
      { org_code: 'ORG-0001', email: 'seoul@lingora.chat', password: 'Seoul2026!', name: '서울 관리자' },
    ];
    for (const seed of hospitalAdminSeeds) {
      try {
        const existing = await dbGet('SELECT id FROM hospital_admins WHERE org_code = ? AND email = ? LIMIT 1', [seed.org_code, seed.email]);
        if (!existing) {
          const hash = await bcrypt.hash(seed.password, 10);
          await dbRun(
            'INSERT INTO hospital_admins (org_code, email, password_hash, name) VALUES (?, ?, ?, ?)',
            [seed.org_code, seed.email, hash, seed.name || '']
          );
          console.log('[hospital] ✅ seeded hospital_admin:', seed.email);
        }
      } catch (e) {
        console.warn('[hospital] seed hospital_admin failed:', e?.message);
      }
    }

    console.log('[hospital] ✅ hospital tables ready (patients + sessions + messages + patient_token columns)');

    // ── ROOMS ↔ DB 동기화: 서버 시작 시 active 병원 세션 복원 ──
    try {
      const activeRows = await dbAll(
        'SELECT room_id, dept, id, patient_token FROM hospital_sessions WHERE status = ?',
        ['active']
      );
      for (const row of activeRows || []) {
        if (!row || !row.room_id) continue;
        const siteContext = `hospital_${row.dept || 'general'}`;
        ROOMS.set(row.room_id, {
          roomType: 'oneToOne',
          ownerLang: 'auto',
          guestLang: 'auto',
          siteContext,
          locked: true,
          ownerPid: null,
          participants: {},
          callSignCounters: {},
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          hospitalMode: true,
          hospitalEndedSession: false,
          department: row.dept || 'general',
          patientToken: row.patient_token,
          hospitalSessionId: row.id,
          restored: true,
        });
      }
      if (activeRows && activeRows.length > 0) {
        console.log(`[hospital] ✅ ROOMS restored ${activeRows.length} active session(s) from DB`);
      }
    } catch (e) {
      console.warn('[hospital] ROOMS restore from DB failed:', e?.message);
    }

    // ── API 사용량 통계 영속화 테이블 ──
    await dbExec(`
      CREATE TABLE IF NOT EXISTS api_usage_daily (
        date TEXT NOT NULL,
        groq_stt_count INTEGER DEFAULT 0,
        openai_stt_count INTEGER DEFAULT 0,
        translation_count INTEGER DEFAULT 0,
        tts_count INTEGER DEFAULT 0,
        total_stt INTEGER DEFAULT 0,
        total_visits INTEGER DEFAULT 0,
        peak_connections INTEGER DEFAULT 0,
        rooms_created INTEGER DEFAULT 0,
        PRIMARY KEY (date)
      );
    `);
    console.log('[stats] ✅ api_usage_daily table ready');

    // ═══════════════════════════════════════════════════════════════
    // 004_admin_console — 관리자 콘솔 테이블 자동 마이그레이션
    // ═══════════════════════════════════════════════════════════════
    await dbExec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        org_code      TEXT    NOT NULL UNIQUE,
        name          TEXT    NOT NULL,
        org_type      TEXT    NOT NULL DEFAULT 'hospital',
        plan          TEXT    NOT NULL DEFAULT 'trial',
        trial_ends_at TEXT,
        logo_url      TEXT,
        primary_color TEXT    DEFAULT '#2563EB',
        welcome_msg   TEXT,
        default_lang  TEXT    DEFAULT 'ko',
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS org_departments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        dept_code     TEXT    NOT NULL,
        dept_name     TEXT    NOT NULL,
        dept_name_en  TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(org_id, dept_code)
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS org_pipeline_config (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        dept_id       INTEGER NOT NULL REFERENCES org_departments(id) ON DELETE CASCADE,
        config_json   TEXT    NOT NULL DEFAULT '{}',
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_by    INTEGER REFERENCES users(id),
        UNIQUE(dept_id)
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS org_staff_accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id       INTEGER REFERENCES users(id),
        email         TEXT    NOT NULL,
        role          TEXT    NOT NULL DEFAULT 'staff',
        dept_ids      TEXT    NOT NULL DEFAULT '[]',
        invite_token  TEXT    UNIQUE,
        is_active     INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS org_devices (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        dept_id       INTEGER REFERENCES org_departments(id),
        device_label  TEXT    NOT NULL,
        device_type   TEXT    NOT NULL DEFAULT 'kiosk',
        last_seen_at  TEXT,
        last_ip       TEXT,
        is_online     INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS org_session_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id          INTEGER NOT NULL REFERENCES organizations(id),
        dept_id         INTEGER REFERENCES org_departments(id),
        room_id         TEXT,
        patient_token   TEXT,
        started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        ended_at        TEXT,
        duration_sec    INTEGER,
        lang_staff      TEXT,
        lang_patient    TEXT,
        stt_chars       INTEGER NOT NULL DEFAULT 0,
        translate_chars INTEGER NOT NULL DEFAULT 0,
        stt_cost_krw    REAL    NOT NULL DEFAULT 0,
        translate_cost_krw REAL NOT NULL DEFAULT 0
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS org_api_cost_logs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id        INTEGER NOT NULL REFERENCES organizations(id),
        log_date      TEXT    NOT NULL,
        api_type      TEXT    NOT NULL,
        call_count    INTEGER NOT NULL DEFAULT 0,
        input_units   INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL    NOT NULL DEFAULT 0,
        cost_krw      REAL    NOT NULL DEFAULT 0,
        UNIQUE(org_id, log_date, api_type)
      );
    `);
    await dbExec(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // organizations 테이블에 EMR/CRM 통합 도구 설정 컬럼 추가
    try {
      const orgCols = await dbAll("PRAGMA table_info(organizations)");
      if (!orgCols.some(c => c.name === 'emr_enabled')) {
        await dbRun("ALTER TABLE organizations ADD COLUMN emr_enabled INTEGER NOT NULL DEFAULT 0");
        console.log('[admin] ✅ added organizations.emr_enabled');
      }
      if (!orgCols.some(c => c.name === 'crm_enabled')) {
        await dbRun("ALTER TABLE organizations ADD COLUMN crm_enabled INTEGER NOT NULL DEFAULT 0");
        console.log('[admin] ✅ added organizations.crm_enabled');
      }
      if (!orgCols.some(c => c.name === 'emr_label')) {
        await dbRun("ALTER TABLE organizations ADD COLUMN emr_label TEXT");
        console.log('[admin] ✅ added organizations.emr_label');
      }
      if (!orgCols.some(c => c.name === 'crm_label')) {
        await dbRun("ALTER TABLE organizations ADD COLUMN crm_label TEXT");
        console.log('[admin] ✅ added organizations.crm_label');
      }
    } catch (_) {}

    // org_encryption_key 컬럼 추가 후 키가 없는 기관에 32바이트 랜덤 키 생성
    await dbRun("ALTER TABLE organizations ADD COLUMN org_encryption_key TEXT").catch(() => {});
    const orgRows = await dbAll("SELECT org_code, org_encryption_key FROM organizations");
    if (orgRows) {
      for (const row of orgRows) {
        if (!row.org_encryption_key) {
          const key = crypto.randomBytes(32).toString('hex');
          await dbRun("UPDATE organizations SET org_encryption_key = ? WHERE org_code = ?", [key, row.org_code]);
        }
      }
    }

    // 슈퍼관리자 초기값 삽입
    await dbRun(
      `INSERT OR IGNORE INTO admin_settings (key, value) VALUES ('admin_setup_done', 'false')`
    );
    // 병원 관리자 시드용 기관 등록 (CHEONGDAM, ORG-0001)
    try {
      for (const oc of ['CHEONGDAM', 'ORG-0001']) {
        const ex = await dbGet('SELECT id FROM organizations WHERE org_code = ? LIMIT 1', [oc]);
        if (!ex) {
          await dbRun('INSERT INTO organizations (org_code, name, org_type, plan) VALUES (?, ?, ?, ?)', [oc, oc + ' 병원', 'hospital', 'trial']);
          console.log('[admin] ✅ seeded organization:', oc);
        }
      }
    } catch (_) {}
    // 인덱스 생성
    await dbExec(`
      CREATE INDEX IF NOT EXISTS idx_org_dept_org_id     ON org_departments(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_staff_org_id    ON org_staff_accounts(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_devices_org_id  ON org_devices(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_sessions_org_id ON org_session_logs(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_sessions_date   ON org_session_logs(started_at);
      CREATE INDEX IF NOT EXISTS idx_org_cost_org_date   ON org_api_cost_logs(org_id, log_date);
    `);
    console.log('[admin] ✅ admin console tables ready (organizations + departments + pipeline + staff + devices + session_logs + cost_logs + settings)');

    // ── 서버 시작 시 당일 사용량 복원 ──
    restoreUsageStats();
  } catch (e) {
    console.warn('[hospital] ⚠ table init failed:', e?.message);
    trackUsageError(e, { source: 'hospital:table-init' });
  }
})();

// In-memory kiosk station registry: stationId → { roomId, sessionId, chartNumber, hostLang }
const KIOSK_STATIONS = new Map();

// In-memory hospital department watchers: department → Set<socketId>
// Each watching staff member's socket joins room `hospital:watch:${department}`
const HOSPITAL_WAITING = new Map(); // department → [{ roomId, department, createdAt }]

const HOSPITAL_TOKEN_COOKIE = 'hospital_token';
const HOSPITAL_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function readHospitalToken(req) {
  const cookieToken = req.cookies?.[HOSPITAL_TOKEN_COOKIE];
  if (cookieToken) return cookieToken;
  const auth = req.headers?.authorization || '';
  if (String(auth).toLowerCase().startsWith('bearer ')) return String(auth).slice(7).trim();
  return '';
}

function requireHospitalAdminJwt(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'server_misconfig_jwt_secret' });
  }
  const token = readHospitalToken(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'hospital_admin') {
      return res.status(403).json({ error: 'forbidden', message: '접근 권한이 없습니다.' });
    }
    req.hospitalOrgCode = payload.org_code || null;
    req.hospitalAdminEmail = payload.email || null;
    req.hospitalAdminId = payload.sub || null;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// POST /api/hospital/auth/login — 병원 관리자 이메일+비밀번호 로그인
app.post('/api/hospital/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailTrim = (email || '').trim().toLowerCase();
    const pwd = password || '';
    if (!emailTrim || !pwd) {
      return res.status(400).json({ error: 'email_password_required' });
    }
    const row = await dbGet(
      'SELECT id, org_code, email, password_hash, name FROM hospital_admins WHERE email = ? LIMIT 1',
      [emailTrim]
    );
    if (!row) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const match = await bcrypt.compare(pwd, row.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const orgExists = await dbGet('SELECT 1 FROM organizations WHERE org_code = ? LIMIT 1', [row.org_code]);
    if (!orgExists) {
      return res.status(403).json({ error: 'org_not_found', message: '등록되지 않은 기관입니다.' });
    }
    const token = jwt.sign(
      { sub: row.id, org_code: row.org_code, email: row.email, role: 'hospital_admin' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const secureCookie = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(HOSPITAL_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: HOSPITAL_TOKEN_MAX_AGE,
    });
    return res.json({
      success: true,
      org_code: row.org_code,
      email: row.email,
      name: row.name || '',
      role: 'hospital_admin',
    });
  } catch (e) {
    console.error('[hospital:auth:login]', e?.message);
    res.status(500).json({ error: 'login_failed' });
  }
});

// POST /api/hospital/register — 병원 등록 신청
app.post('/api/hospital/register', async (req, res) => {
  try {
    const { hospitalName, contactName, email, password, phone } = req.body || {};
    const emailTrim = (email || '').trim().toLowerCase();
    const nameTrim = (hospitalName || '').trim();
    const contactTrim = (contactName || '').trim();
    const phoneTrim = (phone || '').trim();
    const pwd = password || '';

    if (!nameTrim || !contactTrim || !emailTrim || !pwd || !phoneTrim) {
      return res.status(400).json({ error: '모든 항목을 입력해 주세요.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
    }
    if (pwd.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    }

    const existing = await dbGet('SELECT 1 FROM hospital_admins WHERE email = ? LIMIT 1', [emailTrim]);
    if (existing) {
      return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
    }

    const orgCode = 'HOSP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const passwordHash = await bcrypt.hash(pwd, 10);

    await dbRun(
      `INSERT INTO organizations (org_code, name, org_type, plan, default_lang, created_at, updated_at)
       VALUES (?, ?, 'hospital', 'pending', 'ko', datetime('now'), datetime('now'))`,
      [orgCode, nameTrim]
    );

    await dbRun(
      `INSERT INTO hospital_admins (org_code, email, password_hash, name, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [orgCode, emailTrim, passwordHash, contactTrim]
    );

    console.log(`[hospital:register] New registration: org=${orgCode} email=${emailTrim} hospital=${nameTrim} phone=${phoneTrim}`);
    return res.json({ success: true, message: '등록 신청이 완료되었습니다.' });
  } catch (e) {
    console.error('[hospital:register]', e?.message);
    if (e?.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
    }
    res.status(500).json({ error: '등록에 실패했습니다.' });
  }
});

// GET /api/hospital/auth/me — 병원 관리자 인증 확인 (대시보드 로더/프론트용)
app.get('/api/hospital/auth/me', requireHospitalAdminJwt, (req, res) => {
  res.json({
    authenticated: true,
    org_code: req.hospitalOrgCode,
    email: req.hospitalAdminEmail,
    role: 'hospital_admin',
  });
});

// GET /api/hospital/org-settings — 직원/상담 화면용 EMR·CRM 버튼 설정 (org_code 기준, 인증 불필요)
app.get('/api/hospital/org-settings', async (req, res) => {
  try {
    const orgCode = String(req.query.org_code || '').trim();
    if (!orgCode) return res.json({ ok: true, emr_enabled: false, crm_enabled: false, emr_label: null, crm_label: null });
    const row = await dbGet(
      'SELECT emr_enabled, crm_enabled, emr_label, crm_label FROM organizations WHERE org_code = ? LIMIT 1',
      [orgCode]
    );
    if (!row) return res.json({ ok: true, emr_enabled: false, crm_enabled: false, emr_label: null, crm_label: null });
    res.json({
      ok: true,
      emr_enabled: !!row.emr_enabled,
      crm_enabled: !!row.crm_enabled,
      emr_label: row.emr_label || null,
      crm_label: row.crm_label || null,
    });
  } catch (e) {
    console.error('[hospital:org-settings]', e?.message);
    res.status(500).json({ error: 'org_settings_failed' });
  }
});

// GET /api/hospital/org/:orgCode — 병원 이름 조회 (환자/직원 화면 헤더용, 인증 불필요)
app.get('/api/hospital/org/:orgCode', async (req, res) => {
  try {
    const orgCode = String(req.params.orgCode || '').trim();
    if (!orgCode) return res.status(400).json({ error: 'org_code_required' });
    const row = await dbGet(
      'SELECT name FROM organizations WHERE org_code = ? AND is_active = 1 LIMIT 1',
      [orgCode]
    );
    if (!row || !row.name) return res.status(404).json({ error: 'org_not_found' });
    res.json({ name: row.name });
  } catch (e) {
    console.error('[hospital:org]', e?.message);
    res.status(500).json({ error: 'org_lookup_failed' });
  }
});

// POST /api/hospital/auth/logout — 병원 관리자 로그아웃 (쿠키 삭제)
app.post('/api/hospital/auth/logout', (req, res) => {
  res.clearCookie(HOSPITAL_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
  });
  res.json({ success: true });
});

// POST /api/hospital/join — 환자가 QR 스캔 후 채널 연결 (환자 1명 = 채널 1개, 재방문 시 기존 채널 재사용)
// consultation + room: 진료실 QR 스캔 시 pt(기존 PT번호) 있으면 세션 재사용 및 assigned_room 연결, 없으면 새 PT 생성
app.post('/api/hospital/join', async (req, res) => {
  try {
    const { department, patientToken, patientId, language, org, room: consultationRoomId, pt: existingPtRoomId } = req.body || {};
    const dept = String(department || 'general').trim();
    const pToken = patientToken ? String(patientToken).trim() : (patientId ? String(patientId).trim() : null);
    const lang = language ? String(language).trim() : null;
    const orgId = org ? String(org).trim() : null;
    const consultRoomId = consultationRoomId ? String(consultationRoomId).trim() : null;
    const ptRoomId = existingPtRoomId ? String(existingPtRoomId).trim() : null;
    const hospitalSiteContext = `hospital_${dept}`;

    // org_code: URL/body param(org) 우선, 없으면 진료실 방 소유자(users.org_code) 또는 'UNKNOWN'
    let orgCode = orgId || null;
    if (!orgCode && consultRoomId) {
      const roomForOrg = await dbGet('SELECT org_id FROM hospital_rooms WHERE id = ? LIMIT 1', [consultRoomId]);
      if (roomForOrg?.org_id) {
        const u = await dbGet('SELECT org_code FROM users WHERE id = ? LIMIT 1', [roomForOrg.org_id]);
        orgCode = (u?.org_code || '').trim() || 'UNKNOWN';
      }
    }
    if (!orgCode) orgCode = 'UNKNOWN';

    // ── 진료실 입장 (consultation + room): 기존 PT 재사용 또는 새 PT, assigned_room 설정 후 patient-arrived 알림 ──
    if (dept === 'consultation' && consultRoomId) {
      const roomRow = await dbGet('SELECT id, name FROM hospital_rooms WHERE id = ? LIMIT 1', [consultRoomId]);
      if (!roomRow) return res.status(400).json({ error: 'consultation_room_not_found' });

      let roomId;
      let sessionId;
      let isExistingSession = false;

      if (ptRoomId) {
        const existingSession = await dbGet(
          'SELECT id, room_id, patient_token FROM hospital_sessions WHERE room_id = ? AND status = ? LIMIT 1',
          [ptRoomId, 'active']
        );
        if (existingSession) {
          await dbRun('UPDATE hospital_sessions SET assigned_room = ? WHERE id = ?', [consultRoomId, existingSession.id]);
          roomId = existingSession.room_id;
          sessionId = existingSession.id;
          isExistingSession = true;
          if (!ROOMS.has(roomId)) {
            ROOMS.set(roomId, {
              roomType: 'oneToOne',
              ownerLang: 'auto',
              guestLang: lang ? mapLang(lang) : 'auto',
              siteContext: 'hospital_consultation',
              locked: true,
              ownerPid: null,
              participants: {},
              callSignCounters: {},
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
              hospitalMode: true,
              department: 'consultation',
              patientToken: existingSession.patient_token,
              hospitalSessionId: sessionId,
            });
          }
        }
      }

      if (!roomId) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let candidate;
        let exists;
        do {
          candidate = 'PT-';
          for (let i = 0; i < 6; i++) candidate += chars[Math.floor(Math.random() * chars.length)];
          exists = await dbGet('SELECT 1 FROM hospital_sessions WHERE room_id = ? LIMIT 1', [candidate]);
        } while (exists);
        roomId = candidate;
        sessionId = uuidv4();
        const createdAt = new Date().toISOString();
        await dbRun(
          `INSERT INTO hospital_sessions (id, patient_token, room_id, dept, started_at, chart_number, station_id, status, org_id, assigned_room, org_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [sessionId, pToken || null, roomId, 'consultation', createdAt, pToken || 'auto', 'hospital', orgId, consultRoomId, orgCode]
        );
        ROOMS.set(roomId, {
          roomType: 'oneToOne',
          ownerLang: 'auto',
          guestLang: lang ? mapLang(lang) : 'auto',
          siteContext: 'hospital_consultation',
          locked: true,
          ownerPid: null,
          participants: {},
          callSignCounters: {},
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          hospitalMode: true,
          department: 'consultation',
          patientToken: pToken,
          hospitalSessionId: sessionId,
        });
      }

      const payload = { roomId, sessionId, consultationRoomId: consultRoomId, consultationRoomName: roomRow.name, patientToken: pToken || null };
      io.to(`hospital:consultation:${consultRoomId}`).emit('hospital:patient-arrived', payload);
      io.to(`hospital:consultation:${consultRoomId}`).emit('hospital:switch-to-chat', payload);
      return res.json({ success: true, roomId, patientToken: pToken || undefined, isExistingSession, sessionId });
    }

    // 1) patientToken으로 hospital_patients upsert
    if (pToken) {
      try {
        const existing = await dbGet('SELECT * FROM hospital_patients WHERE patient_token = ?', [pToken]);
        if (existing) {
          await dbRun(
            `UPDATE hospital_patients SET last_visit_at = datetime('now'), dept = ? WHERE patient_token = ?`,
            [dept, pToken]
          );
        } else {
          await dbRun(
            `INSERT INTO hospital_patients (id, chart_number, patient_token, dept, first_visit_at, last_visit_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [pToken, pToken, pToken, dept]
          );
        }
      } catch (dbErr) {
        console.warn('[hospital:join] patient upsert warning:', dbErr?.message);
        trackUsageError(dbErr, { source: 'hospital:join:patient-upsert' });
      }
    }

    // 2) Visit count per org (for display only)
    let visitCount = 0;
    if (pToken) {
      try {
        const vcRow = await dbGet('SELECT COUNT(*) as c FROM hospital_sessions WHERE patient_token = ? AND org_code = ?', [pToken, orgCode]);
        visitCount = vcRow?.c || 0;
      } catch (_) {}
    }

    // 3) Reuse existing active session for this patient_token + org_code, else create new room/session
    const existingSession = pToken
      ? await dbGet(
          'SELECT id, room_id FROM hospital_sessions WHERE patient_token = ? AND org_code = ? AND status = ? ORDER BY started_at DESC LIMIT 1',
          [pToken, orgCode, 'active']
        ).catch(() => null)
      : null;

    let roomId;
    let sessionId;
    let isExistingSession = false;

    let createdAt;
    if (existingSession) {
      roomId = existingSession.room_id;
      sessionId = existingSession.id;
      isExistingSession = true;
      createdAt = new Date().toISOString();
    } else {
      // Resolve room_id from hospital_sessions only (hospital_patients may not have room_id column)
      const priorSession = pToken ? await dbGet('SELECT room_id FROM hospital_sessions WHERE patient_token = ? AND status = ? ORDER BY COALESCE(started_at, created_at) DESC LIMIT 1', [pToken, 'active']).catch(() => null) : null;
      if (priorSession && priorSession.room_id) {
        roomId = priorSession.room_id;
        isExistingSession = true;
      } else {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let candidate;
        let exists;
        do {
          candidate = 'PT-';
          for (let i = 0; i < 6; i++) candidate += chars[Math.floor(Math.random() * chars.length)];
          exists = await dbGet('SELECT 1 FROM hospital_sessions WHERE room_id = ? LIMIT 1', [candidate]);
        } while (exists);
        roomId = candidate;
        if (pToken) {
          try {
            await dbRun('UPDATE hospital_patients SET last_visit_at = datetime(\'now\'), dept = ? WHERE patient_token = ?', [dept, pToken]);
          } catch (dbErr) {
            console.warn('[hospital:join] patient room_id update warning:', dbErr?.message);
          }
        }
      }
      sessionId = uuidv4();
      createdAt = new Date().toISOString();
      try {
        await dbRun(
          `INSERT INTO hospital_sessions (id, patient_token, room_id, dept, started_at, chart_number, station_id, status, org_id, org_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [sessionId, pToken || null, roomId, dept, createdAt, pToken || 'auto', 'hospital', orgId, orgCode]
        );
      } catch (dbErr) {
        console.warn('[hospital:join] session insert warning:', dbErr?.message);
        trackUsageError(dbErr, { source: 'hospital:join:session-insert' });
      }
    }

    if (!ROOMS.has(roomId)) {
      ROOMS.set(roomId, {
        roomType: 'oneToOne',
        ownerLang: 'auto',
        guestLang: lang ? mapLang(lang) : 'auto',
        siteContext: hospitalSiteContext,
        locked: true,
        ownerPid: null,
        participants: {},
        callSignCounters: {},
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        hospitalMode: true,
        department: dept,
        patientToken: pToken,
        hospitalSessionId: sessionId,
      });
    }

    if (!HOSPITAL_WAITING.has(dept)) HOSPITAL_WAITING.set(dept, []);
    HOSPITAL_WAITING.get(dept).push({ roomId, department: dept, createdAt, patientToken: pToken, language: lang, sessionId, visitCount });
    const waitingData = { roomId, department: dept, createdAt, patientToken: pToken, language: lang, sessionId, visitCount };
    io.to(`hospital:watch:${dept}`).emit('hospital:patient-waiting', waitingData);
    io.to('hospital:watch:__all__').emit('hospital:patient-waiting', waitingData);
    console.log(`[hospital:join] 🏥 Patient joined dept=${dept} room=${roomId} ctx=${hospitalSiteContext} token=${pToken || 'anonymous'} isExistingRoom=${isExistingSession}`);

    res.json({
      success: true,
      roomId,
      patientToken: pToken || undefined,
      isExistingSession,
      sessionId,
      visitCount,
    });
  } catch (e) {
    console.error('[hospital:join] error:', e?.message);
    trackUsageError(e, { source: 'hospital:join' });
    res.status(500).json({ error: 'join_failed' });
  }
});

// POST /api/hospital/patient — 환자 토큰으로 등록/업데이트 (QR 스캔 시)
app.post('/api/hospital/patient', async (req, res) => {
  try {
    const { patientToken, patientId, language, department, name } = req.body || {};
    const pToken = patientToken || patientId;
    if (!pToken) return res.status(400).json({ error: 'patient_token_required' });
    const token = String(pToken).trim();
    const lang = String(language || 'en').trim();
    const dept = String(department || 'general').trim();

    // Check if already exists in new table
    const existing = await dbGet('SELECT * FROM hospital_patients WHERE patient_token = ?', [token]);
    if (existing) {
      await dbRun(
        `UPDATE hospital_patients SET last_visit_at = datetime('now'), dept = ?, name = COALESCE(?, name) WHERE patient_token = ?`,
        [dept, name || null, token]
      );
      const updated = await dbGet('SELECT * FROM hospital_patients WHERE patient_token = ?', [token]);
      return res.json({ success: true, patient: updated, isNew: false });
    }

    // New registration
    await dbRun(
      `INSERT INTO hospital_patients (id, chart_number, patient_token, dept, first_visit_at, last_visit_at, name) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      [token, token, token, dept, name || '']
    );
    const patient = await dbGet('SELECT * FROM hospital_patients WHERE patient_token = ?', [token]);
    console.log(`[hospital] 👤 Patient registered: token=${token} lang=${lang} dept=${dept}`);
    res.json({ success: true, patient, isNew: true });
  } catch (e) {
    console.error('[hospital:patient] register error:', e?.message);
    trackUsageError(e, { source: 'hospital:patient:register' });
    res.status(500).json({ error: 'patient_register_failed' });
  }
});

// GET /api/hospital/patient/:patientToken — 환자 토큰으로 조회 (이전 방문 기록 포함)
app.get('/api/hospital/patient/:patientToken', async (req, res) => {
  try {
    const token = String(req.params.patientToken).trim();
    // 새 테이블에서 먼저 조회
    let patient = await dbGet('SELECT * FROM hospital_patients WHERE patient_token = ?', [token]);
    if (!patient) {
      // 이전 테이블 호환: patient_id 로도 조회 시도
      patient = await dbGet('SELECT * FROM hospital_patients WHERE patient_id = ?', [token]);
    }
    if (!patient) return res.json({ success: true, found: false });

    // Fetch recent sessions from new table
    let sessions = [];
    try {
      sessions = await dbAll(
        `SELECT id, patient_token, room_id, dept, started_at, ended_at
         FROM hospital_sessions WHERE patient_token = ? ORDER BY started_at DESC LIMIT 20`,
        [token]
      );
    } catch {
      // Fallback: try old table
      sessions = await dbAll(
        `SELECT id, room_id, department, host_lang, guest_lang, status, created_at, ended_at
         FROM hospital_sessions WHERE patient_id = ? ORDER BY created_at DESC LIMIT 10`,
        [token]
      ).catch(() => []);
    }

    res.json({ success: true, found: true, patient, sessions });
  } catch (e) {
    console.error('[hospital:patient] lookup error:', e?.message);
    trackUsageError(e, { source: 'hospital:patient:lookup' });
    res.status(500).json({ error: 'patient_lookup_failed' });
  }
});

// GET /api/hospital/waiting — 대기 환자 목록 조회 (department= 접수 대기, consultationRoom= 진료실 배정 대기)
app.get('/api/hospital/waiting', async (req, res) => {
  const dept = req.query.department ? String(req.query.department).trim() : null;
  const consultationRoomId = req.query.consultationRoom ? String(req.query.consultationRoom).trim() : null;

  if (consultationRoomId) {
    try {
      const sessions = await dbAll(
        `SELECT id, room_id, patient_token, dept, started_at, assigned_room, created_at
         FROM hospital_sessions WHERE assigned_room = ? AND status = 'active' ORDER BY created_at ASC`,
        [consultationRoomId]
      );
      const waiting = (sessions || []).map(s => ({
        roomId: s.room_id,
        sessionId: s.id,
        patientToken: s.patient_token,
        department: s.dept,
        createdAt: s.created_at || s.started_at,
        assignedRoom: s.assigned_room,
      }));
      return res.json({ success: true, consultationRoom: consultationRoomId, waiting });
    } catch (e) {
      return res.status(500).json({ error: 'waiting_query_failed' });
    }
  }

  if (!dept || dept === 'all') {
    const all = [];
    for (const [d, list] of HOSPITAL_WAITING.entries()) {
      all.push(...list);
    }
    all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return res.json({ success: true, department: 'all', waiting: all });
  }
  const list = HOSPITAL_WAITING.get(dept) || [];
  res.json({ success: true, department: dept, waiting: list });
});

// DELETE /api/hospital/waiting/:roomId — 대기 목록에서 제거 (통역 시작 시). 로그인된 기관이면 해당 세션에 org_id 부여.
app.delete('/api/hospital/waiting/:roomId', optionalHospitalOrg, (req, res) => {
  const { roomId } = req.params;
  const orgId = req.hospitalOrgId;
  for (const [dept, list] of HOSPITAL_WAITING.entries()) {
    const idx = list.findIndex(w => w.roomId === roomId);
    if (idx !== -1) {
      const removed = list[idx];
      list.splice(idx, 1);
      if (orgId && removed.sessionId) {
        dbRun('UPDATE hospital_sessions SET org_id = ? WHERE id = ?', [orgId, removed.sessionId]).catch(() => {});
      }
      io.to(`hospital:watch:${dept}`).emit('hospital:patient-picked', { roomId, department: dept });
      io.to('hospital:watch:__all__').emit('hospital:patient-picked', { roomId, department: dept });
      return res.json({ success: true, sessionId: removed.sessionId || null });
    }
  }
  res.json({ success: true, sessionId: null });
});

// POST /api/hospital/assign-room — 접수에서 진료실 배정 (PT → 진료실 연결)
app.post('/api/hospital/assign-room', optionalHospitalOrg, async (req, res) => {
  try {
    const { roomId, consultationRoomId } = req.body || {};
    const ptRoomId = String(roomId || '').trim();
    const consultRoomId = String(consultationRoomId || '').trim();
    if (!ptRoomId || !consultRoomId) return res.status(400).json({ error: 'roomId_and_consultationRoomId_required' });

    const session = await dbGet(
      'SELECT id, room_id, assigned_room, patient_token FROM hospital_sessions WHERE room_id = ? AND status = ? LIMIT 1',
      [ptRoomId, 'active']
    );
    if (!session) return res.status(404).json({ error: 'session_not_found' });

    const roomRow = await dbGet('SELECT id, name FROM hospital_rooms WHERE id = ? LIMIT 1', [consultRoomId]);
    if (!roomRow) return res.status(404).json({ error: 'consultation_room_not_found' });

    await dbRun('UPDATE hospital_sessions SET assigned_room = ? WHERE id = ?', [consultRoomId, session.id]);
    const orgId = req.hospitalOrgId;
    if (orgId) dbRun('UPDATE hospital_sessions SET org_id = ? WHERE id = ?', [orgId, session.id]).catch(() => {});

    for (const [dept, list] of HOSPITAL_WAITING.entries()) {
      const idx = list.findIndex(w => w.roomId === ptRoomId);
      if (idx !== -1) {
        list.splice(idx, 1);
        io.to(`hospital:watch:${dept}`).emit('hospital:patient-picked', { roomId: ptRoomId, department: dept });
        io.to('hospital:watch:__all__').emit('hospital:patient-picked', { roomId: ptRoomId, department: dept });
        break;
      }
    }

    const payload = {
      roomId: ptRoomId,
      sessionId: session.id,
      consultationRoomId: consultRoomId,
      consultationRoomName: roomRow.name,
      patientToken: session.patient_token || null,
      createdAt: new Date().toISOString(),
    };
    io.to(ptRoomId).emit('hospital:room-assigned', payload);
    io.to(`hospital:consultation:${consultRoomId}`).emit('hospital:patient-assigned', payload);

    res.json({ success: true, roomId: ptRoomId, consultationRoomId: consultRoomId, consultationRoomName: roomRow.name });
  } catch (e) {
    console.error('[hospital:assign-room] error:', e?.message);
    res.status(500).json({ error: 'assign_failed' });
  }
});

// GET /api/hospital/session-log/:roomId — 해당 방 실시간 세션 로그 파일 내용 (plain text)
app.get('/api/hospital/session-log/:roomId', (req, res) => {
  const roomId = String(req.params.roomId || '').trim();
  if (!roomId) return res.status(400).send('roomId required');
  const filePath = path.join(LOGS_SESSIONS_DIR, `${roomId}.txt`);
  try {
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    const content = fs.readFileSync(filePath, 'utf8');
    res.type('text/plain').send(content);
  } catch (e) {
    console.warn('[session-log] read failed:', e?.message);
    res.status(500).send('Error reading log');
  }
});

// GET /api/hospital/patient/:patientToken/history — 환자 이전 대화 최근 30건 (logs/sessions/{roomId}.txt 파싱)
// Line format: [HH:MM:SS] role: original_text → translated_text  (role: 직원=host, 환자=guest)
app.get('/api/hospital/patient/:patientToken/history', async (req, res) => {
  try {
    const token = String(req.params.patientToken).trim();
    const patient = await dbGet('SELECT room_id FROM hospital_patients WHERE patient_token = ?', [token]);
    if (!patient?.room_id) return res.json({ success: true, messages: [] });

    const roomId = patient.room_id;
    const filePath = path.join(LOGS_SESSIONS_DIR, `${roomId}.txt`);
    if (!fs.existsSync(filePath)) return res.json({ success: true, messages: [] });

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    // Parse: [HH:MM:SS] 직원: original_text → translated_text  (role: 직원=host, 환자=guest)
    const parsed = [];
    const arrow = ' → ';
    for (const line of lines) {
      const arrowIdx = line.lastIndexOf(arrow);
      if (arrowIdx === -1) continue;
      const prefix = line.slice(0, arrowIdx);
      const translated_text = line.slice(arrowIdx + arrow.length).trim();
      const prefixRe = /^\[(\d{2}:\d{2}:\d{2})\]\s*(직원|환자):\s*(.*)$/;
      const m = prefix.match(prefixRe);
      if (!m) continue;
      const [, timeStr, roleKo, originalText] = m;
      const sender_role = roleKo === '직원' ? 'host' : 'guest';
      // Frontend expects parseable date: use same-day ISO so date dividers work
      const created_at = timeStr.length === 8 ? `1970-01-01T${timeStr}Z` : timeStr;
      parsed.push({
        sender_role,
        original_text: (originalText || '').trim(),
        translated_text,
        created_at,
      });
    }
    const messages = parsed.slice(-30);

    res.json({ success: true, messages });
  } catch (e) {
    console.error('[hospital:patient:history] error:', e?.message);
    trackUsageError(e, { source: 'hospital:patient:history' });
    res.status(500).json({ error: 'history_lookup_failed' });
  }
});

// GET /api/hospital/patient-by-room/:roomId/history — roomId 기준 이전 대화 메시지 (최대 100건) + patient_lang, patient_name
app.get('/api/hospital/patient-by-room/:roomId/history', async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) return res.json({ success: false, message: 'Missing roomId' });

    const messages = await dbAll(
      `SELECT id, session_id, room_id, sender_role, original_text, translated_text, sender_lang, translated_lang, created_at
       FROM hospital_messages
       WHERE room_id = ?
       ORDER BY id ASC
       LIMIT 100`,
      [roomId]
    );

    const sessionRow = await dbGet(
      `SELECT s.guest_lang, s.patient_id, p.name, s.org_code
       FROM hospital_sessions s
       LEFT JOIN hospital_patients p ON s.patient_id = p.patient_id
       WHERE s.room_id = ?
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [roomId]
    ).catch(() => null);

    const keyHex = await getOrgEncryptionKey(sessionRow?.org_code || null);
    const decryptedMessages = (messages || []).map((m) => ({
      ...m,
      original_text: decryptText(m.original_text, keyHex),
      translated_text: decryptText(m.translated_text, keyHex),
    }));

    res.json({
      success: true,
      messages: decryptedMessages,
      patient_lang: sessionRow?.guest_lang ?? null,
      patient_name: sessionRow?.name ?? null,
    });
  } catch (err) {
    console.error('[patient-by-room history]', err);
    res.json({ success: false, message: 'Server error' });
  }
});

// POST /api/hospital/patient/:patientToken/message — 직원이 퇴원 환자에게 오프라인 메시지 저장
app.post('/api/hospital/patient/:patientToken/message', async (req, res) => {
  try {
    const token = String(req.params.patientToken).trim();
    const { text } = req.body || {};
    const originalText = String(text || '').trim();
    if (!originalText) return res.status(400).json({ error: 'text_required' });

    const session = await dbGet(
      `SELECT id, room_id, org_code FROM hospital_sessions WHERE patient_token = ? ORDER BY COALESCE(started_at, created_at) DESC LIMIT 1`,
      [token]
    );
    if (!session) return res.status(404).json({ error: 'no_session', message: '해당 환자의 세션이 없습니다.' });

    const msgId = uuidv4();
    const keyHex = await getOrgEncryptionKey(session.org_code || null);
    const encOriginal = encryptText(originalText, keyHex);
    const encTranslated = encryptText(originalText, keyHex);
    await dbRun(
      `INSERT INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token, offline, delivered)
       VALUES (?, ?, ?, 'host', 'ko', ?, ?, '', ?, 1, 0)`,
      [msgId, session.id, session.room_id, encOriginal, encTranslated, token]
    );
    res.json({ ok: true, roomId: session.room_id, delivered: false });
  } catch (e) {
    console.error('[hospital:patient:message]', e?.message);
    res.status(500).json({ error: 'message_save_failed' });
  }
});

// GET /api/hospital/patient/:patientToken/pending-messages — 미전달 오프라인 메시지 조회 후 delivered 처리
app.get('/api/hospital/patient/:patientToken/pending-messages', async (req, res) => {
  try {
    const token = String(req.params.patientToken).trim();
    const rows = await dbAll(
      `SELECT id, session_id, room_id, sender_role, original_text, translated_text, created_at
       FROM hospital_messages WHERE patient_token = ? AND offline = 1 AND delivered = 0 ORDER BY created_at ASC`,
      [token]
    );
    let keyHex = null;
    if (rows.length > 0 && rows[0].session_id) {
      const sess = await dbGet('SELECT org_code FROM hospital_sessions WHERE id = ? LIMIT 1', [rows[0].session_id]).catch(() => null);
      keyHex = await getOrgEncryptionKey(sess?.org_code || null);
    }
    const decrypted = (rows || []).map((m) => ({
      ...m,
      original_text: decryptText(m.original_text, keyHex),
      translated_text: decryptText(m.translated_text, keyHex),
    }));
    if (rows.length > 0) {
      await dbRun(`UPDATE hospital_messages SET delivered = 1 WHERE patient_token = ? AND offline = 1 AND delivered = 0`, [token]);
    }
    res.json({ ok: true, messages: decrypted });
  } catch (e) {
    console.error('[hospital:pending-messages]', e?.message);
    res.status(500).json({ error: 'pending_messages_failed' });
  }
});

// POST /api/hospital/session — 직원이 병원 세션 생성
app.post('/api/hospital/session', async (req, res) => {
  try {
    const { chartNumber, stationId, hostLang, roomId, department, guestLang, patientId } = req.body || {};
    if (!chartNumber || !/^\d+$/.test(String(chartNumber).trim())) {
      return res.status(400).json({ error: 'chart_number_required', message: '차트번호는 숫자만 입력하세요.' });
    }
    const cleanChart = String(chartNumber).trim();
    const station = String(stationId || 'default').trim();
    const rid = String(roomId || uuidv4()).trim();
    const sessionId = uuidv4();
    const lang = String(hostLang || 'ko').trim();
    const dept = String(department || '').trim() || null;
    const gLang = String(guestLang || '').trim() || null;
    const pid = patientId ? String(patientId).trim() : null;

    await dbRun(
      `INSERT INTO hospital_sessions (id, room_id, chart_number, station_id, department, host_lang, guest_lang, patient_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [sessionId, rid, cleanChart, station, dept, lang, gLang, pid]
    );

    // Register kiosk station mapping
    KIOSK_STATIONS.set(station, { roomId: rid, sessionId, chartNumber: cleanChart, hostLang: lang });

    // Notify kiosk tablets listening on this station
    io.to(`kiosk:${station}`).emit('kiosk:session-ready', {
      roomId: rid,
      sessionId,
      chartNumber: cleanChart,
      hostLang: lang,
    });

    console.log(`[hospital] 🏥 Session created: chart=${cleanChart} station=${station} room=${rid}`);
    res.json({ success: true, sessionId, roomId: rid, chartNumber: cleanChart, stationId: station });
  } catch (e) {
    console.error('[hospital] session create error:', e?.message);
    trackUsageError(e, { source: 'hospital:session-create' });
    res.status(500).json({ error: 'session_create_failed' });
  }
});

// POST /api/hospital/session/:sessionId/end — 세션 종료
app.post('/api/hospital/session/:sessionId/end', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await dbGet('SELECT * FROM hospital_sessions WHERE id = ? LIMIT 1', [sessionId]);
    if (!session) return res.status(404).json({ error: 'session_not_found' });

    await dbRun(
      `UPDATE hospital_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`,
      [sessionId]
    );

    // 환자 폰에 종료 안내 메시지 전송
    const roomId = session.room_id;
    if (roomId && io) {
      io.to(roomId).emit('hospital:session-ended', {
        message: '통역이 종료되었습니다. 수고하셨습니다.',
        sessionId,
        roomId,
      });
    }

    // Clear kiosk station
    for (const [sid, data] of KIOSK_STATIONS.entries()) {
      if (data.sessionId === sessionId) {
        KIOSK_STATIONS.delete(sid);
        io.to(`kiosk:${sid}`).emit('kiosk:session-ended', { sessionId, stationId: sid });
        break;
      }
    }

    console.log(`[hospital] Session ended: ${sessionId}`);
    res.json({ success: true, sessionId });
  } catch (e) {
    res.status(500).json({ error: 'session_end_failed' });
  }
});

// POST /api/hospital/message — 병원 대화 메시지 저장 (org 소유 세션만, session_type: reception|consultation)
app.post('/api/hospital/message', requireHospitalOrg, async (req, res) => {
  try {
    const orgId = req.hospitalOrgId;
    const orgCode = req.hospitalOrgCode || null;
    const { sessionId, roomId, senderRole, senderLang, originalText, translatedText, translatedLang } = req.body || {};
    if (!sessionId || !roomId || !originalText) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const session = await dbGet('SELECT id, assigned_room FROM hospital_sessions WHERE id = ? AND (org_id IS NULL OR org_id = ?) LIMIT 1', [sessionId, orgId]);
    if (!session) return res.status(404).json({ error: 'session_not_found' });
    const sessionType = session.assigned_room ? 'consultation' : 'reception';
    const msgId = uuidv4();
    const keyHex = await getOrgEncryptionKey(orgCode);
    const encOriginal = encryptText(originalText, keyHex);
    const encTranslated = encryptText(translatedText || '', keyHex);
    await dbRun(
      `INSERT INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, org_id, session_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [msgId, sessionId, roomId, senderRole || 'guest', senderLang || '', encOriginal, encTranslated, translatedLang || '', orgId, sessionType]
    );
    res.json({ success: true, id: msgId });
  } catch (e) {
    res.status(500).json({ error: 'message_save_failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// HOSPITAL DASHBOARD — 통계 API
// ═══════════════════════════════════════════════════════════════

app.get('/api/hospital/dashboard/stats', requireHospitalAdminJwt, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    const orgCodeFilter = req.hospitalOrgCode || 'UNKNOWN';
    const whereOrg = "(COALESCE(org_code, 'UNKNOWN') = ?)";
    const params = [orgCodeFilter];

    // 오늘 통역 건수
    const todayRow = await dbGet(
      `SELECT COUNT(*) as cnt FROM hospital_sessions WHERE DATE(created_at) = ? AND ${whereOrg}`,
      [today, orgCodeFilter]
    );

    // 이번 달 누적
    const monthRow = await dbGet(
      `SELECT COUNT(*) as cnt FROM hospital_sessions WHERE created_at >= ? AND ${whereOrg}`,
      [monthStart, orgCodeFilter]
    );

    // 사용 언어 종류 수
    const langRow = await dbGet(
      `SELECT COUNT(DISTINCT guest_lang) as cnt FROM hospital_sessions WHERE guest_lang IS NOT NULL AND guest_lang != '' AND ${whereOrg}`,
      [...params]
    );

    // 평균 통역 시간 (분)
    const avgRow = await dbGet(
      `SELECT AVG(
         CASE WHEN ended_at IS NOT NULL AND created_at IS NOT NULL
         THEN (julianday(ended_at) - julianday(created_at)) * 24 * 60
         ELSE NULL END
       ) as avg_min FROM hospital_sessions WHERE status = 'ended' AND ${whereOrg}`,
      [...params]
    );

    // 최근 7일 일별 통역 건수
    const dailyStats = await dbAll(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM hospital_sessions
       WHERE created_at >= date('now', '-7 days') AND ${whereOrg}
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [...params]
    );

    // 언어별 비율
    const languageStats = await dbAll(
      `SELECT guest_lang as language, COUNT(*) as count
       FROM hospital_sessions
       WHERE guest_lang IS NOT NULL AND guest_lang != '' AND ${whereOrg}
       GROUP BY guest_lang
       ORDER BY count DESC`,
      [...params]
    );

    // 진료과별 현황
    const deptStats = await dbAll(
      `SELECT COALESCE(department, dept) as department, COUNT(*) as count,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
              COUNT(DISTINCT guest_lang) as lang_count
       FROM hospital_sessions
       WHERE (department IS NOT NULL AND department != '' OR dept IS NOT NULL AND dept != '') AND ${whereOrg}
       GROUP BY COALESCE(department, dept)
       ORDER BY count DESC`,
      [...params]
    );

    res.json({
      success: true,
      todayCount: todayRow?.cnt || 0,
      monthCount: monthRow?.cnt || 0,
      languageCount: langRow?.cnt || 0,
      avgDuration: avgRow?.avg_min ? +avgRow.avg_min.toFixed(1) : 0,
      dailyStats,
      languageStats,
      deptStats,
    });
  } catch (e) {
    console.error('[hospital:dashboard:stats]', e?.message);
    trackUsageError(e, { source: 'hospital:dashboard:stats' });
    res.status(500).json({ error: 'stats_query_failed' });
  }
});

// GET /api/hospital/dashboard/sessions — 대시보드용 세션 목록 (hospital_sessions + message_count, JWT org_code로 필터)
app.get('/api/hospital/dashboard/sessions', requireHospitalAdminJwt, async (req, res) => {
  try {
    const { startDate, endDate, department, language, search, page: pg, limit: lim } = req.query;
    const page = Math.max(1, Number(pg) || 1);
    const limit = Math.min(100, Math.max(1, Number(lim) || 20));
    const offset = (page - 1) * limit;

    const orgCodeFilter = req.hospitalOrgCode || 'UNKNOWN';
    let where = "(COALESCE(hs.org_code, 'UNKNOWN') = ?)";
    const params = [orgCodeFilter];

    if (startDate) { where += ' AND DATE(COALESCE(hs.started_at, hs.created_at)) >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND DATE(COALESCE(hs.started_at, hs.created_at)) <= ?'; params.push(endDate); }
    if (department) { where += ' AND (hs.department = ? OR hs.dept = ?)'; params.push(department, department); }
    if (language) { where += ' AND (hs.guest_lang = ? OR hs.host_lang = ?)'; params.push(language, language); }
    if (search) {
      where += ' AND (hs.chart_number LIKE ? OR hs.room_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Total count: unique patients (room_id = PT number) matching filters
    const countRow = await dbGet(
      `SELECT COUNT(DISTINCT hs.room_id) as total FROM hospital_sessions hs WHERE ${where}`,
      params
    );

    // One row per patient (room_id), aggregated from hospital_sessions + hospital_patients
    const whereForSub = where.replace(/\bhs\./g, 'hs2.');
    const sessions = await dbAll(
      `SELECT
         hs.room_id as chart_number,
         MAX(hs.patient_token) as patient_token,
         MAX(hp.name) as name,
         COALESCE(MAX(hs.guest_lang), MAX(hp.language), '') as language,
         COALESCE(MAX(hs.department), MAX(hs.dept)) as dept,
         COUNT(DISTINCT hs.id) as session_count,
         COUNT(hm.id) as message_count,
         MAX(COALESCE(hs.started_at, hs.created_at)) as last_started_at,
         (SELECT hs2.id FROM hospital_sessions hs2 WHERE hs2.room_id = hs.room_id AND ${whereForSub} ORDER BY COALESCE(hs2.started_at, hs2.created_at) DESC LIMIT 1) as id,
         hs.room_id as room_id
       FROM hospital_sessions hs
       LEFT JOIN hospital_patients hp ON hp.chart_number = hs.chart_number
       LEFT JOIN hospital_messages hm ON hm.session_id = hs.id
       WHERE ${where}
       GROUP BY hs.room_id
       ORDER BY last_started_at DESC
       LIMIT ? OFFSET ?`,
      [...params, ...params, limit, offset]
    );

    res.json({
      success: true,
      sessions,
      total: countRow?.total || 0,
      page,
      limit,
      totalPages: Math.ceil((countRow?.total || 0) / limit),
    });
  } catch (e) {
    console.error('[hospital:dashboard:sessions]', e?.message);
    trackUsageError(e, { source: 'hospital:dashboard:sessions' });
    res.status(500).json({ error: 'sessions_query_failed' });
  }
});

// GET /api/hospital/sessions — roomId면 sessionId만 반환; 아니면 차트번호 등으로 세션 목록 조회 (org 기준)
app.get('/api/hospital/sessions', requireHospitalAdminJwt, async (req, res) => {
  const orgCode = req.hospitalOrgCode || 'UNKNOWN';
  const roomId = req.query.roomId ? String(req.query.roomId).trim() : null;
  if (roomId) {
    try {
      const row = await dbGet(
        "SELECT id FROM hospital_sessions WHERE room_id = ? AND status = 'active' AND (COALESCE(org_code, 'UNKNOWN') = ?) LIMIT 1",
        [roomId, orgCode]
      );
      return res.json({ success: true, sessionId: row ? row.id : null });
    } catch (e) {
      return res.status(500).json({ error: 'sessions_lookup_failed' });
    }
  }
  try {
    const { chartNumber, stationId, date, limit: lim } = req.query;
    let sql = `SELECT hs.*,
      (SELECT hm.original_text FROM hospital_messages hm WHERE hm.session_id = hs.id ORDER BY hm.created_at DESC LIMIT 1) as last_message
      FROM hospital_sessions hs WHERE (COALESCE(hs.org_code, 'UNKNOWN') = ?)`;
    const params = [orgCode];
    if (chartNumber) { sql += ' AND hs.chart_number = ?'; params.push(chartNumber); }
    if (stationId) { sql += ' AND hs.station_id = ?'; params.push(stationId); }
    if (date) { sql += ' AND DATE(hs.created_at) = ?'; params.push(date); }
    sql += ' ORDER BY hs.created_at DESC LIMIT ?';
    params.push(Number(lim) || 50);
    const sessions = await dbAll(sql, params);
    const keyHex = await getOrgEncryptionKey(orgCode || null);
    const withDecryptedLastMessage = (sessions || []).map((s) => ({
      ...s,
      last_message: s.last_message ? decryptText(s.last_message, keyHex) : s.last_message,
    }));
    res.json({ success: true, sessions: withDecryptedLastMessage });
  } catch (e) {
    res.status(500).json({ error: 'sessions_query_failed' });
  }
});

// GET /api/hospital/sessions/:sessionId/messages — 세션별 대화 내역 (session_id로만 필터, org 소유만)
app.get('/api/hospital/sessions/:sessionId/messages', requireHospitalAdminJwt, async (req, res) => {
  try {
    const orgCode = req.hospitalOrgCode || 'UNKNOWN';
    const { sessionId } = req.params;
    const session = await dbGet(
      "SELECT * FROM hospital_sessions WHERE id = ? AND (COALESCE(org_code, 'UNKNOWN') = ?) LIMIT 1",
      [sessionId, orgCode]
    );
    if (!session) return res.status(404).json({ error: 'session_not_found' });
    const roomId = session.room_id;
    const messagesQuery = 'SELECT * FROM hospital_messages WHERE room_id = ? ORDER BY created_at ASC';
    console.log('[hospital:sessions:messages]', { sessionId, roomId, query: messagesQuery });
    const messages = await dbAll(messagesQuery, [roomId]);
    const keyHex = await getOrgEncryptionKey(orgCode || null);
    const decrypted = (messages || []).map((m) => ({
      ...m,
      original_text: decryptText(m.original_text, keyHex),
      translated_text: decryptText(m.translated_text, keyHex),
    }));
    res.json({ success: true, session, messages: decrypted });
  } catch (e) {
    res.status(500).json({ error: 'messages_query_failed' });
  }
});

// DELETE /api/hospital/sessions/:sessionId — 세션 삭제 (DB + 로그 파일), org 소유만
app.delete('/api/hospital/sessions/:sessionId', requireHospitalAdminJwt, async (req, res) => {
  try {
    const orgCode = req.hospitalOrgCode || 'UNKNOWN';
    const { sessionId } = req.params;
    const session = await dbGet(
      "SELECT id, room_id, patient_token FROM hospital_sessions WHERE id = ? AND (COALESCE(org_code, 'UNKNOWN') = ?) LIMIT 1",
      [sessionId, orgCode]
    );
    if (!session) return res.status(404).json({ error: 'session_not_found' });
    const roomId = session.room_id || null;
    const patientToken = session.patient_token || null;

    await dbRun('DELETE FROM hospital_sessions WHERE id = ?', [sessionId]);

    if (roomId) {
      const sessionPath = path.join(LOGS_SESSIONS_DIR, `${roomId}.txt`);
      const archiveBase = patientToken ? `${patientToken}_${roomId}` : roomId;
      const archivePath = path.join(LOGS_RECORDS_DIR, `${archiveBase}.txt`);
      try {
        if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
      } catch (_) {}
      try {
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      } catch (_) {}
    }

    return res.json({ success: true });
  } catch (e) {
    console.error('[hospital:delete-session]', e?.message);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// GET /api/hospital/rooms — 병원별 방 목록 (JWT org_code로 필터)
app.get('/api/hospital/rooms', requireHospitalAdminJwt, async (req, res) => {
  try {
    const orgCode = req.hospitalOrgCode || 'UNKNOWN';
    const rooms = await dbAll(
      "SELECT id, org_id, org_code, name, template, created_at FROM hospital_rooms WHERE (COALESCE(org_code, 'UNKNOWN') = ?) ORDER BY created_at DESC",
      [orgCode]
    );
    res.json({ success: true, rooms: rooms || [] });
  } catch (e) {
    res.status(500).json({ error: 'rooms_query_failed' });
  }
});

// POST /api/hospital/rooms — 방 추가 (JWT org_code 사용)
app.post('/api/hospital/rooms', requireHospitalAdminJwt, async (req, res) => {
  try {
    const orgCode = req.hospitalOrgCode || 'UNKNOWN';
    const { name, template: rawTemplate } = req.body || {};
    const roomName = String(name || '').trim();
    const templateStr = String(rawTemplate || 'reception').toLowerCase();
    const roomTemplate = templateStr === 'consultation' ? 'consultation' : 'reception';
    if (!roomName) return res.status(400).json({ error: 'name_required' });
    const id = uuidv4();
    await dbRun(
      'INSERT INTO hospital_rooms (id, org_id, org_code, name, template) VALUES (?, ?, ?, ?, ?)',
      [id, orgCode, orgCode, roomName, roomTemplate]
    );
    const room = await dbGet('SELECT id, org_id, org_code, name, template, created_at FROM hospital_rooms WHERE id = ?', [id]);
    res.status(201).json({ success: true, room });
  } catch (e) {
    res.status(500).json({ error: 'room_create_failed' });
  }
});

// DELETE /api/hospital/rooms/:id — 방 삭제 (본인 org_code만)
app.delete('/api/hospital/rooms/:id', requireHospitalAdminJwt, async (req, res) => {
  try {
    const orgCode = req.hospitalOrgCode || 'UNKNOWN';
    const roomId = String(req.params.id || '').trim();
    if (!roomId) return res.status(400).json({ error: 'room_id_required' });
    const room = await dbGet("SELECT id, org_code FROM hospital_rooms WHERE id = ?", [roomId]);
    if (!room) return res.status(404).json({ error: 'room_not_found' });
    if ((room.org_code || 'UNKNOWN') !== orgCode) return res.status(403).json({ error: 'forbidden' });
    await dbRun('DELETE FROM hospital_rooms WHERE id = ?', [roomId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'room_delete_failed' });
  }
});

// GET /api/hospital/kiosk/status — 키오스크가 현재 대기 중인 세션 확인
app.get('/api/hospital/kiosk/status', (req, res) => {
  const station = String(req.query.stationId || 'default').trim();
  const data = KIOSK_STATIONS.get(station);
  if (data) {
    res.json({ active: true, ...data });
  } else {
    res.json({ active: false, stationId: station });
  }
});

// Socket: kiosk tablet joins station channel
io.on('connection', (kioskSocket) => {
  kioskSocket.on('kiosk:join-station', ({ stationId }) => {
    if (!stationId) return;
    const channel = `kiosk:${stationId}`;
    kioskSocket.join(channel);
    console.log(`[kiosk] 📺 Tablet joined station: ${stationId} (socket=${kioskSocket.id})`);

    // If there's an active session for this station, notify immediately
    const data = KIOSK_STATIONS.get(stationId);
    if (data) {
      kioskSocket.emit('kiosk:session-ready', {
        roomId: data.roomId,
        sessionId: data.sessionId,
        chartNumber: data.chartNumber,
        hostLang: data.hostLang,
      });
    }
  });


  kioskSocket.on('hospital:unwatch', ({ department }) => {
    if (!department) return;
    const channel = `hospital:watch:${department}`;
    kioskSocket.leave(channel);
    console.log(`[hospital:unwatch] 🔇 Staff unwatching dept=${department} (socket=${kioskSocket.id})`);
  });

  // 진료실별 대기 목록 시청 (consultation room staff)
  kioskSocket.on('hospital:consultation:watch', ({ consultationRoomId }) => {
    if (!consultationRoomId) return;
    const channel = `hospital:consultation:${consultationRoomId}`;
    kioskSocket.join(channel);
    kioskSocket._hospitalConsultationRoom = consultationRoomId;
    console.log(`[hospital:consultation:watch] 👁️ Staff watching consultation room=${consultationRoomId} (socket=${kioskSocket.id})`);
  });

  kioskSocket.on('hospital:consultation:unwatch', ({ consultationRoomId }) => {
    if (!consultationRoomId) return;
    const channel = `hospital:consultation:${consultationRoomId}`;
    kioskSocket.leave(channel);
    if (kioskSocket._hospitalConsultationRoom === consultationRoomId) delete kioskSocket._hospitalConsultationRoom;
    console.log(`[hospital:consultation:unwatch] 🔇 Staff unwatching consultation room=${consultationRoomId} (socket=${kioskSocket.id})`);
  });

  // 진료실 직원이 환자에게 "진료실 입장 요청" 보낼 때
  kioskSocket.on('hospital:request-consultation-entry', async ({ roomId, consultationRoomId, consultationRoomName }) => {
    if (!roomId) return;
    const ptRoomId = String(roomId).trim();
    io.to(ptRoomId).emit('hospital:enter-consultation-request', {
      roomId: ptRoomId,
      consultationRoomId: consultationRoomId || null,
      consultationRoomName: consultationRoomName || null,
    });
  });

  // 환자가 진료실 입장 수락 시
  kioskSocket.on('hospital:enter-consultation', async ({ roomId }) => {
    if (!roomId) return;
    const ptRoomId = String(roomId).trim();
    try {
      const session = await dbGet(
        'SELECT id, assigned_room FROM hospital_sessions WHERE room_id = ? AND status = ? LIMIT 1',
        [ptRoomId, 'active']
      );
      if (session && session.assigned_room) {
        io.to(`hospital:consultation:${session.assigned_room}`).emit('hospital:enter-consultation', {
          roomId: ptRoomId,
          sessionId: session.id,
        });
      }
    } catch (_) {}
  });
});

// ═══════════════════════════════════════════════════════════════
// HOSPITAL PATIENT REGISTRY — RESTful API (EMR-ready)
// ═══════════════════════════════════════════════════════════════

// POST /api/hospital/patients — 환자 등록 (최초 방문)
app.post('/api/hospital/patients', async (req, res) => {
  try {
    const { chartNumber, language, hospitalId, name, phone, notes } = req.body || {};
    if (!chartNumber) return res.status(400).json({ error: 'chart_number_required' });
    const cleanChart = String(chartNumber).trim();
    // Check if already registered
    const existing = await dbGet('SELECT * FROM hospital_patients WHERE chart_number = ?', [cleanChart]);
    if (existing) {
      // Update language if changed
      if (language && language !== existing.language) {
        await dbRun(
          `UPDATE hospital_patients SET language = ?, updated_at = datetime('now') WHERE chart_number = ?`,
          [language, cleanChart]
        );
      }
      const updated = await dbGet('SELECT * FROM hospital_patients WHERE chart_number = ?', [cleanChart]);
      return res.json({ success: true, patient: updated, isNew: false });
    }
    const patientId = uuidv4();
    await dbRun(
      `INSERT INTO hospital_patients (id, chart_number, language, hospital_id, name, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patientId, cleanChart, language || 'en', hospitalId || 'default', name || null, phone || null, notes || null]
    );
    const patient = await dbGet('SELECT * FROM hospital_patients WHERE id = ?', [patientId]);
    console.log(`[hospital] 👤 Patient registered: chart=${cleanChart} lang=${language || 'en'}`);
    res.json({ success: true, patient, isNew: true });
  } catch (e) {
    console.error('[hospital] patient register error:', e?.message);
    trackUsageError(e, { source: 'hospital:patient:register2' });
    res.status(500).json({ error: 'patient_register_failed' });
  }
});

// GET /api/hospital/patients/:chartNumber — 차트번호로 환자 조회 (재방문 매칭)
app.get('/api/hospital/patients/:chartNumber', async (req, res) => {
  try {
    const { chartNumber } = req.params;
    const patient = await dbGet('SELECT * FROM hospital_patients WHERE chart_number = ?', [String(chartNumber).trim()]);
    if (!patient) return res.json({ success: true, found: false });
    // Also fetch recent sessions
    const sessions = await dbAll(
      `SELECT id, room_id, department, host_lang, guest_lang, status, created_at, ended_at
       FROM hospital_sessions WHERE chart_number = ? ORDER BY created_at DESC LIMIT 10`,
      [String(chartNumber).trim()]
    );
    res.json({ success: true, found: true, patient, recentSessions: sessions });
  } catch (e) {
    res.status(500).json({ error: 'patient_lookup_failed' });
  }
});

// PUT /api/hospital/patients/:chartNumber — 환자 정보 수정
app.put('/api/hospital/patients/:chartNumber', async (req, res) => {
  try {
    const { chartNumber } = req.params;
    const { language, name, phone, notes } = req.body || {};
    const patient = await dbGet('SELECT * FROM hospital_patients WHERE chart_number = ?', [String(chartNumber).trim()]);
    if (!patient) return res.status(404).json({ error: 'patient_not_found' });
    const updates = [];
    const params = [];
    if (language) { updates.push('language = ?'); params.push(language); }
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (updates.length === 0) return res.json({ success: true, patient });
    updates.push("updated_at = datetime('now')");
    params.push(String(chartNumber).trim());
    await dbRun(`UPDATE hospital_patients SET ${updates.join(', ')} WHERE chart_number = ?`, params);
    const updated = await dbGet('SELECT * FROM hospital_patients WHERE chart_number = ?', [String(chartNumber).trim()]);
    res.json({ success: true, patient: updated });
  } catch (e) {
    res.status(500).json({ error: 'patient_update_failed' });
  }
});

// GET /api/hospital/patients — 전체 환자 목록 (검색 가능)
app.get('/api/hospital/patients', async (req, res) => {
  try {
    const { hospitalId, language, search, limit: lim } = req.query;
    let sql = 'SELECT * FROM hospital_patients WHERE 1=1';
    const params = [];
    if (hospitalId) { sql += ' AND hospital_id = ?'; params.push(hospitalId); }
    if (language) { sql += ' AND language = ?'; params.push(language); }
    if (search) { sql += ' AND (chart_number LIKE ? OR name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(Number(lim) || 50);
    const patients = await dbAll(sql, params);
    res.json({ success: true, patients });
  } catch (e) {
    res.status(500).json({ error: 'patients_list_failed' });
  }
});

// GET /api/hospital/records/:identifier — 차트번호 또는 PT-XXXXXX(room_id) 기준 기록 조회
app.get('/api/hospital/records/:identifier', async (req, res) => {
  try {
    const identifier = String(req.params.identifier).trim();
    let patient = null;
    let sessions = [];

    if (identifier.startsWith('PT-')) {
      sessions = await dbAll(
        `SELECT * FROM hospital_sessions WHERE room_id = ? ORDER BY created_at DESC`,
        [identifier]
      );
      if (sessions.length > 0 && sessions[0].patient_token) {
        patient = await dbGet('SELECT * FROM hospital_patients WHERE patient_token = ?', [sessions[0].patient_token]);
      }
    } else {
      patient = await dbGet('SELECT * FROM hospital_patients WHERE chart_number = ?', [identifier]);
      sessions = await dbAll(
        `SELECT * FROM hospital_sessions WHERE chart_number = ? ORDER BY created_at DESC`,
        [identifier]
      );
    }

    const sessionsWithMessages = await Promise.all(sessions.map(async (s) => {
      const messages = await dbAll(
        'SELECT * FROM hospital_messages WHERE session_id = ? ORDER BY created_at ASC',
        [s.id]
      );
      const keyHex = await getOrgEncryptionKey(s.org_code || null);
      const decrypted = (messages || []).map((m) => ({
        ...m,
        original_text: decryptText(m.original_text, keyHex),
        translated_text: decryptText(m.translated_text, keyHex),
      }));
      return { ...s, messages: decrypted };
    }));
    res.json({ success: true, patient: patient || null, sessions: sessionsWithMessages });
  } catch (e) {
    res.status(500).json({ error: 'records_query_failed' });
  }
});

// POST /api/hospital/session/:sessionId/guest-lang — 세션에 환자 언어 업데이트
app.post('/api/hospital/session/:sessionId/guest-lang', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { guestLang } = req.body || {};
    if (!guestLang) return res.status(400).json({ error: 'guest_lang_required' });
    await dbRun(
      `UPDATE hospital_sessions SET guest_lang = ? WHERE id = ?`,
      [guestLang, sessionId]
    );
    // Also update patient language if chart exists
    const session = await dbGet('SELECT chart_number FROM hospital_sessions WHERE id = ?', [sessionId]);
    if (session?.chart_number) {
      const patient = await dbGet('SELECT id FROM hospital_patients WHERE chart_number = ?', [session.chart_number]);
      if (patient) {
        await dbRun(
          `UPDATE hospital_patients SET language = ?, updated_at = datetime('now') WHERE chart_number = ?`,
          [guestLang, session.chart_number]
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'guest_lang_update_failed' });
  }
});

// ═══════════════════════════════════════════════════════════════

app.get('/api/stats', (req, res) => {
  if (!STATS_API_KEY || req.query.key !== STATS_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  resetDailyStats();
  syncRoomsActive();
  res.json({
    date: usageStats.date,
    currentConnections: usageStats.currentConnections,
    peakConnections: usageStats.peakConnections,
    totalVisits: usageStats.totalVisits,
    uniqueVisitors: usageStats.uniqueIPs.size,
    roomsCreated: usageStats.roomsCreated,
    roomsActive: usageStats.roomsActive,
    activeSession: usageStats.activeSession,
    logins: {
      google: usageStats.googleLogins,
      kakao: usageStats.kakaoLogins,
      guest: usageStats.guestJoins,
    },
    api: {
      stt: usageStats.sttRequests,
      groqStt: usageStats.groqSttRequests,
      openaiStt: usageStats.openaiSttRequests,
      translation: usageStats.translationRequests,
      openaiTranslations: usageStats.openaiTranslations,
      tts: usageStats.ttsRequests,
      openaiTts: usageStats.openaiTtsRequests,
    },
    errorCount: usageStats.errorCount,
    recentErrors: usageStats.errors,
  });
});


// ── 실시간 에러 모니터링 페이지 ──
app.get('/admin/errors', (req, res) => {
  if (!STATS_API_KEY || req.query.key !== STATS_API_KEY) {
    return res.status(403).send('Forbidden — ?key= 필요');
  }
  const apiKey = req.query.key;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MONO 실시간 에러 모니터</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', -apple-system, sans-serif; background:#0d1117; color:#c9d1d9; }
  .header { background:#161b22; border-bottom:1px solid #30363d; padding:16px 24px; display:flex; justify-content:space-between; align-items:center; }
  .header h1 { font-size:18px; color:#58a6ff; }
  .header .stats { font-size:13px; color:#8b949e; }
  .status { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; }
  .status.connected { background:#3fb950; }
  .status.disconnected { background:#f85149; }
  .controls { padding:12px 24px; background:#161b22; border-bottom:1px solid #30363d; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  .controls input, .controls select { background:#0d1117; border:1px solid #30363d; color:#c9d1d9; padding:6px 10px; border-radius:6px; font-size:13px; }
  .controls button { background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:13px; }
  .controls button:hover { background:#30363d; }
  .controls button.danger { border-color:#f85149; color:#f85149; }
  .errors { padding:8px 24px; max-height:calc(100vh - 140px); overflow-y:auto; }
  .error-card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px 16px; margin:6px 0; transition:border-color .2s; }
  .error-card.new { border-color:#f85149; animation:flashIn .5s; }
  @keyframes flashIn { 0%{background:#2d1214;} 100%{background:#161b22;} }
  .error-meta { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .error-time { font-size:12px; color:#8b949e; font-family:monospace; }
  .error-source { font-size:11px; background:#21262d; color:#79c0ff; padding:2px 8px; border-radius:10px; }
  .error-msg { font-size:14px; color:#f0f6fc; word-break:break-all; }
  .error-stack { font-size:11px; color:#6e7681; font-family:monospace; margin-top:6px; white-space:pre-wrap; }
  .empty { text-align:center; padding:60px; color:#484f58; font-size:16px; }
  .count-badge { background:#f85149; color:#fff; font-size:12px; padding:2px 8px; border-radius:10px; margin-left:8px; }
  .sound-toggle { cursor:pointer; font-size:18px; }
</style>
</head>
<body>
<div class="header">
  <h1><span class="status disconnected" id="connStatus"></span>MONO 실시간 에러 모니터</h1>
  <div class="stats">
    총 에러: <strong id="totalCount">0</strong>
    | 세션 에러: <strong id="sessionCount">0</strong>
    | <span class="sound-toggle" id="soundToggle" title="알림 소리">🔔</span>
  </div>
</div>
<div class="controls">
  <input type="text" id="filterSource" placeholder="source 필터 (예: hospital)" />
  <input type="text" id="filterMsg" placeholder="메시지 검색" />
  <select id="sortOrder">
    <option value="newest">최신순</option>
    <option value="oldest">오래된순</option>
  </select>
  <button onclick="clearErrors()">화면 클리어</button>
  <button onclick="loadHistory()" style="background:#1f6feb;border-color:#1f6feb;color:#fff;">이전 에러 로드</button>
  <label style="font-size:12px;color:#8b949e;"><input type="checkbox" id="autoScroll" checked /> 자동 스크롤</label>
</div>
<div class="errors" id="errorList">
  <div class="empty" id="emptyMsg">에러 없음 — 실시간 대기 중...</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const API_KEY = '${apiKey}';
let soundEnabled = true;
let sessionErrors = 0;
const errorCards = [];

// 알림 사운드
const beep = () => {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 800; gain.gain.value = 0.3;
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  } catch {}
};

document.getElementById('soundToggle').onclick = () => {
  soundEnabled = !soundEnabled;
  document.getElementById('soundToggle').textContent = soundEnabled ? '🔔' : '🔕';
};

// Socket 연결
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  document.getElementById('connStatus').className = 'status connected';
  socket.emit('admin:subscribe-errors', { key: API_KEY });
});

socket.on('disconnect', () => {
  document.getElementById('connStatus').className = 'status disconnected';
});

socket.on('admin:subscribed', (data) => {
  if (!data.ok) { alert('인증 실패: ' + (data.reason || '')); return; }
  document.getElementById('totalCount').textContent = data.errorCount || 0;
});

socket.on('admin:error', (err) => {
  sessionErrors++;
  document.getElementById('sessionCount').textContent = sessionErrors;
  const tc = parseInt(document.getElementById('totalCount').textContent) || 0;
  document.getElementById('totalCount').textContent = tc + 1;
  addErrorCard(err, true);
  beep();
});

function addErrorCard(err, isNew) {
  const el = document.getElementById('emptyMsg');
  if (el) el.remove();

  // 필터 체크
  const fs = document.getElementById('filterSource').value.toLowerCase();
  const fm = document.getElementById('filterMsg').value.toLowerCase();
  if (fs && !(err.source || '').toLowerCase().includes(fs)) return;
  if (fm && !(err.message || '').toLowerCase().includes(fm)) return;

  const card = document.createElement('div');
  card.className = 'error-card' + (isNew ? ' new' : '');
  card.innerHTML = \`
    <div class="error-meta">
      <span class="error-time">\${err.timeKR || new Date(err.time).toLocaleTimeString('ko-KR')}</span>
      <span class="error-source">\${err.source || 'unknown'}</span>
    </div>
    <div class="error-msg">\${escapeHtml(err.message || '')}</div>
    \${err.stack ? '<div class="error-stack">' + escapeHtml(err.stack) + '</div>' : ''}
  \`;

  const list = document.getElementById('errorList');
  const order = document.getElementById('sortOrder').value;
  if (order === 'newest') {
    list.prepend(card);
  } else {
    list.append(card);
  }

  errorCards.push({ el: card, data: err });

  if (document.getElementById('autoScroll').checked && order === 'newest') {
    list.scrollTop = 0;
  }

  // 카드 수 제한
  while (errorCards.length > 200) {
    const old = errorCards.shift();
    old.el.remove();
  }

  if (isNew) {
    setTimeout(() => card.classList.remove('new'), 3000);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function clearErrors() {
  document.getElementById('errorList').innerHTML = '<div class="empty" id="emptyMsg">화면 클리어됨</div>';
  errorCards.length = 0;
}

async function loadHistory() {
  try {
    const res = await fetch('/api/errors?key=' + API_KEY + '&limit=100');
    const data = await res.json();
    if (data.errors) {
      clearErrors();
      document.getElementById('totalCount').textContent = data.totalErrorCount || 0;
      const sorted = document.getElementById('sortOrder').value === 'newest' ? data.errors : data.errors.reverse();
      sorted.forEach(e => addErrorCard(e, false));
    }
  } catch (e) { alert('로드 실패: ' + e.message); }
}

// 필터 변경 시 다시 로드
document.getElementById('filterSource').addEventListener('input', () => loadHistory());
document.getElementById('filterMsg').addEventListener('input', () => {
  clearTimeout(window._fmTimer);
  window._fmTimer = setTimeout(loadHistory, 300);
});

// 초기 로드
loadHistory();
</script>
</body>
</html>`);
});

// ── 에러 전용 API ──
app.get('/api/errors', (req, res) => {
  if (!STATS_API_KEY || req.query.key !== STATS_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { source, limit: lim, since } = req.query;
  let errors = [...usageStats.errors];
  
  // source 필터
  if (source) {
    errors = errors.filter(e => e.source && e.source.includes(source));
  }
  // since 필터 (ISO timestamp)
  if (since) {
    errors = errors.filter(e => e.time >= since);
  }
  // 최신순 정렬
  errors.reverse();
  // limit
  const limit = Math.min(parseInt(lim) || 100, 100);
  errors = errors.slice(0, limit);

  res.json({
    totalErrorCount: usageStats.errorCount,
    showing: errors.length,
    errors,
  });
});

// ── 비용 리포트 수동 트리거 ──
app.get('/api/cost-report', async (req, res) => {
  if (!STATS_API_KEY || req.query.key !== STATS_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const result = await generateCostReport(usageStats);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[cost-report] manual trigger error:', e?.message);
    res.status(500).json({ error: e?.message });
  }
});

attachGoogleAuth(app);
attachKakaoAuth(app);
attachLineAuth(app);
attachAppleAuth(app);
attachAuthApi(app);

// ── 슈퍼관리자 API ──
const adminRouter = require('./server/routes/admin');
app.use('/api/admin', adminRouter);

// ── 기관/부서 공개 API (인증 불필요) ──
const orgRouter = require('./server/routes/org');
app.use('/api/org', orgRouter);

app.get("/api/guess-lang", (req,res)=>{
  const code = detectFromAcceptLang(req.headers['accept-language']);
  res.json({ lang: code });
});

// ── Translate a single word (for hospital guest nickname) ──
app.post("/api/translate-word", async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: "openai_unavailable" });
    const word = String(req.body?.word || "").trim();
    const targetLang = String(req.body?.targetLang || "").trim();
    if (!word || !targetLang) return res.status(400).json({ error: "missing_params" });
    const r = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 30,
      messages: [
        { role: "system", content: "You are a translator. Reply with ONLY the translated word, nothing else." },
        { role: "user", content: `Translate the Korean word "${word}" into ${targetLang}. Reply with only the translated word.` },
      ],
    });
    const translated = (r.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    res.json({ translated: translated || word });
  } catch (e) {
    res.status(500).json({ error: "translate_failed", detail: e?.message });
  }
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

// ✅ COOP/COEP 헤더 — VAD 사용 경로에만 적용 (전체 적용 시 카카오 등 외부 리소스 차단됨)
app.use(["/fixed-room", "/fixed"], (req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});

// ✅ WASM/MJS MIME 타입 올바르게 설정
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    } else if (filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.onnx')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
  },
}));

// ✅ 페이지별 OG 메타태그 (카카오톡 미리보기 대응)
const OG_ROUTES = [
  // 일반 MONO
  { path: "/", title: "MONO | AI 실시간 통역 메신저", desc: "앱 설치 없이 QR 스캔만으로 외국인과 바로 대화. 99개 언어 실시간 양방향 통역." },
  { path: "/interpret", title: "MONO | QR 통역 시작 - 바로 연결", desc: "QR 코드를 생성하거나 스캔하여 즉시 AI 실시간 통역을 시작하세요." },
  { path: "/home", title: "MONO | 대화방 목록", desc: "MONO 대화방 목록. AI 실시간 통역 메신저." },
  { path: "/contacts", title: "MONO | 연락처", desc: "MONO 연락처 관리. AI 실시간 통역 메신저." },
  { path: "/settings", title: "MONO | 설정", desc: "MONO 설정. AI 실시간 통역 메신저." },
  // 병원 - 접수
  { path: "/hospital", query: { mode: "kiosk", dept: "reception" }, title: "MONO 병원 키오스크 | 접수 QR 통역", desc: "병원 접수처 키오스크에서 QR 코드를 표시하여 환자가 스캔 후 AI 통역을 시작합니다." },
  { path: "/hospital", query: { mode: "staff", dept: "reception" }, title: "MONO 직원 모드 | 접수 대기 환자 목록", desc: "접수처 대기 환자 목록을 실시간으로 확인하고 통역을 시작하세요." },
  // 병원 - 성형외과
  { path: "/hospital/kiosk/plastic_surgery", title: "MONO 성형외과 키오스크 | QR 스캔으로 통역 시작", desc: "성형외과 키오스크에서 QR 코드를 표시하여 환자가 스캔 후 AI 통역을 시작합니다." },
  { path: "/hospital/aesthetic", title: "MONO 성형/피부 클리닉 | 키오스크 · 상담실", desc: "성형외과·피부과 전용 AI 실시간 통역. 키오스크 모드와 상담실 모드를 지원합니다." },
  { path: "/hospital", query: { mode: "staff", dept: "plastic_surgery" }, title: "MONO 직원 모드 | 성형외과 대기 환자 목록", desc: "성형외과 대기 환자 목록을 실시간으로 확인하고 통역을 시작하세요." },
  { path: "/hospital", query: { mode: "normal", dept: "plastic_surgery" }, title: "MONO 성형외과 상담실 | 1:1 통역", desc: "성형외과 1:1 상담 통역. QR 코드로 환자와 즉시 연결됩니다." },
];

function matchOgRoute(reqPath, reqQuery) {
  // query 있는 룰 먼저 매칭 (더 구체적)
  for (const r of OG_ROUTES) {
    if (r.query && r.path === reqPath) {
      const allMatch = Object.keys(r.query).every(k => reqQuery[k] === r.query[k]);
      if (allMatch) return r;
    }
  }
  // path만 매칭
  for (const r of OG_ROUTES) {
    if (!r.query && r.path === reqPath) return r;
  }
  return null;
}

function sendWithOg(req, res) {
  const indexPath = path.join(distPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    return res.status(500).send("dist/index.html not found. Run `npm run build` first.");
  }
  const matched = matchOgRoute(req.path, req.query || {});
  if (!matched) return res.sendFile(indexPath);

  let html = fs.readFileSync(indexPath, "utf-8");
  const t = matched.title;
  const d = matched.desc;
  html = html
    .replace(/<title>[^<]*<\/title>/i, `<title>${t}</title>`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${t}" />`)
    .replace(/<meta\s+property="og:description"[\s\S]*?\/>/i, `<meta property="og:description" content="${d}" />`)
    .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${t}" />`)
    .replace(/<meta\s+name="twitter:description"[\s\S]*?\/>/i, `<meta name="twitter:description" content="${d}" />`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/i, `<meta name="description" content="${d}" />`);
  return res.type("html").send(html);
}

// ✅ Cloudflare 404 방지용 — dist 루트 fallback 절대경로 보정
app.get("/", (req, res) => sendWithOg(req, res));

// SPA 라우팅 (React fallback)
app.get("*", (req, res) => sendWithOg(req, res));

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
      sendTelegram(`🚀 <b>MONO 서버 시작</b>\n⏰ ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n🌐 Port: ${actualPort || port}`);
    })
    .once('error', (err) => {
      trackUsageError(err);
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
  try {
    persistUsageStats();
  } catch {}
  console.log(`[server] shutdown by ${signal}`);
  process.exit(0);
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('uncaughtException', (err) => {
  trackUsageError(err, { source: 'uncaughtException' });
});
process.on('unhandledRejection', (reason) => {
  trackUsageError(reason, { source: 'unhandledRejection' });
});

setInterval(() => {
  const now = new Date();
  resetDailyStats();
  syncRoomsActive();
  if (now.getMinutes() === 0) {
    sendHourlyReport();
  }
}, 60 * 1000).unref?.();

// ── 매일 오전 9시 (KST) 비용 리포트 ──
// cron: 분 시 일 월 요일 (KST = UTC+9, 9AM KST = 0AM UTC)
cron.schedule('0 0 * * *', async () => {
  console.log('[cost-report] 🕘 Daily cost report triggered (9AM KST)');
  try {
    await generateCostReport(usageStats);
    console.log('[cost-report] ✅ Report sent successfully');
  } catch (e) {
    console.error('[cost-report] ❌ Report failed:', e?.message);
  }
}, {
  timezone: 'Asia/Seoul',
  scheduled: true,
});
// 참고: 서버가 Asia/Seoul TZ가 아닌 UTC에서 돌아가면
// node-cron의 timezone 옵션이 자동 변환해줌
console.log('[cost-report] 📅 Daily cost report scheduled at 9:00 AM KST');

if (process.env.NODE_TEST === '1') {
  module.exports = { transcribePcm16, fastTranslate, buildSystemPrompt, app };
  return;
}
startServer(START_PORT);