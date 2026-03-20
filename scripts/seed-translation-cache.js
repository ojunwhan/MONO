#!/usr/bin/env node
/**
 * Translation Cache Seeder for MONO Hospital Mode
 * Generates ko→{targetLang} translations for 50 standard hospital sentences
 * across 50 languages and inserts them into the translation_cache SQLite table.
 *
 * Usage:
 *   node scripts/seed-translation-cache.js
 *
 * Requirements:
 *   - .env with OPENAI_API_KEY
 *   - SQLite DB at state/mono_phase1.sqlite (or MONO_DB_PATH env)
 *   - translation_cache table must already exist
 *
 * Safety:
 *   - Uses INSERT OR IGNORE (won't overwrite existing cache entries)
 *   - Dry-run mode: SEED_DRY_RUN=1 node scripts/seed-translation-cache.js
 *   - Resume support: skips languages that already have all 50 entries cached
 */

require('dotenv').config();
const OpenAI = require('openai');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.MONO_DB_PATH || path.join(__dirname, '..', 'state', 'mono_phase1.sqlite');
const DRY_RUN = process.env.SEED_DRY_RUN === '1';
const SITE_CONTEXT = 'hospital_plastic_surgery';
const BATCH_SIZE = 10; // sentences per API call (balance quality vs cost)
const DELAY_MS = 500;  // delay between API calls to avoid rate limits

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================
// 50 Target Languages (ISO 639-1 codes)
// Ordered by Korean plastic surgery patient visit frequency
// ============================================================
const TARGET_LANGUAGES = [
  { code: 'en', name: 'English', formality: 'polite' },
  { code: 'zh', name: 'Chinese (Simplified)', formality: 'polite' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', formality: 'polite' },
  { code: 'ja', name: 'Japanese', formality: 'polite/desu-masu' },
  { code: 'vi', name: 'Vietnamese', formality: 'polite' },
  { code: 'th', name: 'Thai', formality: 'polite/krub-ka' },
  { code: 'ru', name: 'Russian', formality: 'formal-vy' },
  { code: 'mn', name: 'Mongolian', formality: 'polite' },
  { code: 'id', name: 'Indonesian', formality: 'formal' },
  { code: 'ms', name: 'Malay', formality: 'formal' },
  { code: 'ar', name: 'Arabic', formality: 'formal' },
  { code: 'fr', name: 'French', formality: 'formal-vous' },
  { code: 'es', name: 'Spanish', formality: 'formal-usted' },
  { code: 'pt', name: 'Portuguese (Brazilian)', formality: 'formal' },
  { code: 'de', name: 'German', formality: 'formal-Sie' },
  { code: 'it', name: 'Italian', formality: 'formal-Lei' },
  { code: 'hi', name: 'Hindi', formality: 'formal-aap' },
  { code: 'tr', name: 'Turkish', formality: 'formal-siz' },
  { code: 'uz', name: 'Uzbek', formality: 'formal' },
  { code: 'kk', name: 'Kazakh', formality: 'formal' },
  { code: 'fil', name: 'Filipino/Tagalog', formality: 'polite-po' },
  { code: 'my', name: 'Burmese/Myanmar', formality: 'polite' },
  { code: 'km', name: 'Khmer', formality: 'polite' },
  { code: 'ne', name: 'Nepali', formality: 'formal-tapai' },
  { code: 'bn', name: 'Bengali', formality: 'formal-apni' },
  { code: 'ur', name: 'Urdu', formality: 'formal-aap' },
  { code: 'fa', name: 'Persian/Farsi', formality: 'formal-shoma' },
  { code: 'sw', name: 'Swahili', formality: 'polite' },
  { code: 'pl', name: 'Polish', formality: 'formal-pan/pani' },
  { code: 'cs', name: 'Czech', formality: 'formal-vy' },
  { code: 'hu', name: 'Hungarian', formality: 'formal-ön' },
  { code: 'ro', name: 'Romanian', formality: 'formal-dvs' },
  { code: 'uk', name: 'Ukrainian', formality: 'formal-vy' },
  { code: 'nl', name: 'Dutch', formality: 'formal-u' },
  { code: 'sv', name: 'Swedish', formality: 'polite' },
  { code: 'no', name: 'Norwegian', formality: 'polite' },
  { code: 'da', name: 'Danish', formality: 'polite' },
  { code: 'fi', name: 'Finnish', formality: 'polite' },
  { code: 'el', name: 'Greek', formality: 'formal-esis' },
  { code: 'he', name: 'Hebrew', formality: 'polite' },
  { code: 'ka', name: 'Georgian', formality: 'formal-tkven' },
  { code: 'si', name: 'Sinhala', formality: 'formal' },
  { code: 'ta', name: 'Tamil', formality: 'formal-neengal' },
  { code: 'lo', name: 'Lao', formality: 'polite' },
  { code: 'am', name: 'Amharic', formality: 'formal' },
  { code: 'sr', name: 'Serbian', formality: 'formal-vi' },
  { code: 'hr', name: 'Croatian', formality: 'formal-vi' },
  { code: 'bg', name: 'Bulgarian', formality: 'formal-vie' },
  { code: 'mk', name: 'Macedonian', formality: 'formal-vie' },
  { code: 'sq', name: 'Albanian', formality: 'formal-ju' },
];

// ============================================================
// 50 Standard Korean Sentences (Plastic Surgery Hospital)
// ============================================================
const KOREAN_SENTENCES = [
  // --- Reception (접수/안내) ---
  '안녕하세요, 예약하셨나요?',
  '여권 보여주시겠어요?',
  '이 서류에 서명해 주세요.',
  '대기실에서 잠시 기다려 주세요.',
  '상담료는 무료입니다.',
  '수술 전 동의서를 작성해 주세요.',
  '보호자가 함께 오셨나요?',
  '알레르기가 있으신가요?',
  '현재 복용 중인 약이 있나요?',
  '이전에 수술 받으신 적 있나요?',

  // --- Consultation (상담) ---
  '어떤 부분이 고민이세요?',
  '원하시는 스타일이 있으신가요?',
  '사진으로 보여드릴게요.',
  '이 시술은 약 1시간 정도 걸립니다.',
  '회복 기간은 약 2주입니다.',
  '부기는 1~2주 안에 빠집니다.',
  '실밥은 5~7일 후에 제거합니다.',
  '마취는 수면마취로 진행합니다.',
  '부작용 가능성에 대해 설명드리겠습니다.',
  '비용은 상담 후 안내드립니다.',

  // --- Procedure Names (시술명) ---
  '쌍꺼풀 수술 (눈 성형)',
  '코 성형 (융비술)',
  '지방흡입',
  '안면윤곽 수술 (턱 수술)',
  '실리프팅',
  '보톡스 시술',
  '필러 시술',
  '레이저 토닝',
  '가슴 성형',
  '지방이식',

  // --- Pre/Post-op Instructions (수술 전후 안내) ---
  '수술 8시간 전부터 금식해 주세요.',
  '수술 당일에는 화장을 하지 마세요.',
  '콘택트렌즈는 빼고 오세요.',
  '수술 후 냉찜질을 해주세요.',
  '처방약을 반드시 복용해 주세요.',
  '수술 후 음주와 흡연은 2주간 금지입니다.',
  '다음 내원일은 일주일 후입니다.',
  '이상이 있으면 바로 연락해 주세요.',
  '수술 부위를 만지지 마세요.',
  '세안은 3일 후부터 가능합니다.',

  // --- Payment/Admin (결제/행정) ---
  '카드 결제 가능합니다.',
  '현금영수증 발행해 드릴까요?',
  '진단서가 필요하시면 말씀해 주세요.',
  '환불 규정을 안내드리겠습니다.',
  '계약금을 먼저 납부해 주세요.',
  '잔금은 수술 당일 결제해 주세요.',

  // --- General Guidance (일상 안내) ---
  '화장실은 복도 끝에 있습니다.',
  '와이파이 비밀번호를 알려드릴게요.',
  '택시를 불러드릴까요?',
  '통역이 필요하시면 말씀해 주세요.',
];

// ============================================================
// Translation via GPT-4o (batch of sentences per call)
// ============================================================
async function translateBatch(sentences, targetLang) {
  const { code, name, formality } = targetLang;

  const systemPrompt = `You are a professional medical translator working in a Korean plastic surgery and aesthetic clinic.

TASK: Translate Korean sentences into ${name} (${code}).

RULES:
- Use ${formality} register (this is a hospital setting, staff speaking to patients)
- Keep medical terminology accurate and natural in ${name}
- For procedure names (쌍꺼풀, 코성형, etc.), use the most commonly understood term in ${name}-speaking countries. If no standard translation exists, transliterate the Korean term and add a brief explanation in parentheses.
- Keep translations concise — these are spoken sentences in real-time interpretation
- Do NOT add explanations, notes, or alternatives — output ONLY the translated sentence
- Each line of input corresponds to one line of output. Output exactly ${sentences.length} lines.
- Do NOT number the lines or add any prefix/suffix

INPUT (Korean, one sentence per line):`;

  const userContent = sentences.join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const output = response.choices?.[0]?.message?.content?.trim() || '';
  const lines = output.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Remove numbering if GPT added it (e.g., "1. ..." or "1) ...")
  const cleaned = lines.map(l => l.replace(/^\d+[\.\)\-]\s*/, ''));

  if (cleaned.length !== sentences.length) {
    console.warn(`[WARN] ${code}: expected ${sentences.length} lines, got ${cleaned.length}. Will pad/truncate.`);
  }

  return cleaned;
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== MONO Translation Cache Seeder ===');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Sentences: ${KOREAN_SENTENCES.length}`);
  console.log(`Languages: ${TARGET_LANGUAGES.length}`);
  console.log(`Total entries: ${KOREAN_SENTENCES.length * TARGET_LANGUAGES.length}`);
  console.log('');

  const db = new Database(DB_PATH);

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_cache (
      cache_key TEXT PRIMARY KEY,
      translated_text TEXT NOT NULL,
      hit_count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      last_used_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO translation_cache (cache_key, translated_text, hit_count) VALUES (?, ?, 0)'
  );

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let li = 0; li < TARGET_LANGUAGES.length; li++) {
    const lang = TARGET_LANGUAGES[li];
    const progress = `[${li + 1}/${TARGET_LANGUAGES.length}]`;

    // Check how many entries already exist for this language
    const existingCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM translation_cache WHERE cache_key LIKE ?'
    ).get(`ko:${lang.code}:${SITE_CONTEXT}:%`)?.cnt || 0;

    if (existingCount >= KOREAN_SENTENCES.length) {
      console.log(`${progress} ${lang.code} (${lang.name}): already seeded (${existingCount} entries). Skipping.`);
      totalSkipped += KOREAN_SENTENCES.length;
      continue;
    }

    console.log(`${progress} ${lang.code} (${lang.name}): translating...`);

    try {
      // Process in batches
      const allTranslations = [];

      for (let i = 0; i < KOREAN_SENTENCES.length; i += BATCH_SIZE) {
        const batch = KOREAN_SENTENCES.slice(i, i + BATCH_SIZE);
        const translations = await translateBatch(batch, lang);
        allTranslations.push(...translations);

        if (i + BATCH_SIZE < KOREAN_SENTENCES.length) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }

      // Insert into DB
      const insertMany = db.transaction((entries) => {
        for (const { key, text } of entries) {
          if (DRY_RUN) {
            console.log(`  [DRY] ${key} → ${text.substring(0, 50)}...`);
          } else {
            const result = insertStmt.run(key, text);
            if (result.changes > 0) totalInserted++;
            else totalSkipped++;
          }
        }
      });

      const entries = KOREAN_SENTENCES.map((sentence, idx) => ({
        key: `ko:${lang.code}:${SITE_CONTEXT}:${sentence.trim()}`,
        text: allTranslations[idx] || sentence, // fallback to original if translation missing
      }));

      insertMany(entries);
      console.log(`  ✓ Done (${allTranslations.length} translations)`);

    } catch (err) {
      console.error(`  ✗ Error for ${lang.code}: ${err.message}`);
      totalErrors++;
    }

    // Rate limit delay between languages
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  db.close();

  console.log('\n=== Summary ===');
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Skipped (already existed): ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
