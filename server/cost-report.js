/**
 * server/cost-report.js — 일일 비용 리포트 (텔레그램)
 *
 * 1. OpenAI API 비용 조회 (Admin Key → Costs API)
 * 2. Groq 호출 횟수 (서버 메모리 usageStats)
 * 매일 오전 9시 KST cron 자동 실행
 */

const OPENAI_ADMIN_KEY = process.env.OPENAI_ADMIN_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── OpenAI 어제 비용 ──
async function fetchOpenAICosts() {
  if (!OPENAI_ADMIN_KEY) return { error: 'OPENAI_ADMIN_KEY not set', totalCost: 0, breakdown: [] };
  try {
    const now = new Date();
    const yesterday = new Date(now); yesterday.setUTCDate(now.getUTCDate() - 1); yesterday.setUTCHours(0,0,0,0);
    const today = new Date(now); today.setUTCHours(0,0,0,0);

    const url = `https://api.openai.com/v1/organization/costs?start_time=${Math.floor(yesterday/1000)}&end_time=${Math.floor(today/1000)}&bucket_width=1d&group_by[]=model`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${OPENAI_ADMIN_KEY}` } });
    if (!res.ok) return { error: `HTTP ${res.status}`, totalCost: 0, breakdown: [] };

    const data = await res.json();
    let totalCost = 0;
    const mc = {};
    for (const b of (data.data || [])) for (const r of (b.results || [])) {
      const amt = (r.amount?.value || 0) / 100;
      totalCost += amt;
      const m = r.model || r.line_item || 'unknown';
      mc[m] = (mc[m] || 0) + amt;
    }
    return { totalCost: +totalCost.toFixed(4), breakdown: Object.entries(mc).sort((a,b)=>b[1]-a[1]).map(([model,cost])=>({model,cost:+cost.toFixed(4)})), error: null };
  } catch (e) { return { error: e?.message, totalCost: 0, breakdown: [] }; }
}

// ── OpenAI 이번 달 누적 ──
async function fetchOpenAIMonthly() {
  if (!OPENAI_ADMIN_KEY) return { totalCost: 0, error: 'no key' };
  try {
    const now = new Date();
    const s = Math.floor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) / 1000);
    const e = Math.floor(now / 1000);
    const res = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${s}&end_time=${e}&bucket_width=1d`, { headers: { Authorization: `Bearer ${OPENAI_ADMIN_KEY}` } });
    if (!res.ok) return { totalCost: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    let t = 0;
    for (const b of (data.data||[])) for (const r of (b.results||[])) t += (r.amount?.value||0)/100;
    return { totalCost: +t.toFixed(4), error: null };
  } catch (e) { return { totalCost: 0, error: e?.message }; }
}

// ── 텔레그램 전송 ──
async function sendTg(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log('[cost-report]', message); return; }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('[cost-report] telegram fail:', e?.message); }
}

// ── 리포트 생성 + 전송 ──
async function generateCostReport(usageStats = {}) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}); })();

  const [daily, monthly] = await Promise.all([fetchOpenAICosts(), fetchOpenAIMonthly()]);

  const groq = usageStats.groqSttRequests || 0;
  const oStt = usageStats.openaiSttRequests || 0;
  const oTrans = usageStats.openaiTranslations || 0;
  const oTts = usageStats.openaiTtsRequests || 0;

  let msg = `💰 <b>MONO 일일 비용 리포트</b>\n`;
  msg += `📅 ${yesterdayStr} | 🕐 ${kst}\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `🤖 <b>OpenAI API</b>\n`;
  if (daily.error) { msg += `  ⚠️ ${daily.error}\n`; }
  else {
    msg += `  어제: <b>$${daily.totalCost}</b>\n`;
    for (const {model,cost} of daily.breakdown.slice(0,5)) msg += `    · ${model}: $${cost}\n`;
  }
  if (!monthly.error) msg += `  📊 이번 달: <b>$${monthly.totalCost}</b>\n`;
  msg += `\n`;

  msg += `⚡ <b>Groq (무료)</b>  STT: <b>${groq}회</b>\n\n`;

  msg += `📈 <b>오늘 API 호출</b>\n`;
  msg += `  🎤 STT ${usageStats.sttRequests||0} (Groq ${groq} / OpenAI ${oStt})\n`;
  msg += `  🔄 번역 ${usageStats.translationRequests||0}\n`;
  msg += `  🔊 TTS ${usageStats.ttsRequests||0}\n`;

  await sendTg(msg);
  return { daily, monthly, groq, sentAt: kst };
}

module.exports = { generateCostReport };
