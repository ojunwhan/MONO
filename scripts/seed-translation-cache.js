#!/usr/bin/env node
/**
 * Translation Cache Seeder for MONO Hospital Mode
 * Generates ko→{targetLang} translations for the standard hospital sentence set
 * (see seed-sentences.js) across 50 languages into translation_cache.
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
 *   - Resume support: skips languages that already have a full sentence set cached
 */

require('dotenv').config();
const OpenAI = require('openai');
const Database = require('better-sqlite3');
const path = require('path');
const KOREAN_SENTENCES = require('./seed-sentences');
const PATIENT_SENTENCES_EN = require('./seed-patient-sentences');

const DB_PATH = process.env.MONO_DB_PATH || path.join(__dirname, '..', 'state', 'mono_phase1.sqlite');
const DRY_RUN = process.env.SEED_DRY_RUN === '1';
const SITE_CONTEXT = 'hospital_plastic_surgery';
const BATCH_SIZE = 25; // sentences per API call (balance quality vs cost)
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

/**
 * Translate English patient sentences into a target language AND Korean.
 * Returns array of { inTargetLang, inKorean } objects.
 */
async function translatePatientBatch(sentences, targetLang) {
  const { code, name, formality } = targetLang;

  const systemPrompt = `You are a professional medical translator working in a Korean plastic surgery clinic.

TASK: For each English sentence, provide TWO translations:
1. Translation into ${name} (${code}) — this is what a ${name}-speaking patient would naturally say
2. Translation into Korean — this is what the Korean staff would hear/read

RULES:
- Use casual/polite patient speech (not formal medical language — these are patients talking)
- For ${name}: use ${formality} register appropriate for a patient speaking to medical staff
- For Korean: use polite 존댓말 (as the Korean staff would interpret it)
- Output format: one line per sentence, with the two translations separated by ||| delimiter
- Line format: {${name} translation}|||{Korean translation}
- Do NOT number the lines
- Do NOT add notes or alternatives
- Output exactly ${sentences.length} lines

INPUT (English patient sentences, one per line):`;

  const userContent = sentences.join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 8000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const output = response.choices?.[0]?.message?.content?.trim() || '';
  const lines = output.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const cleaned = lines.map(l => l.replace(/^\d+[\.\)\-]\s*/, ''));

  return cleaned.map(line => {
    const parts = line.split('|||').map(p => p.trim());
    return {
      inTargetLang: parts[0] || '',
      inKorean: parts[1] || parts[0] || '',
    };
  });
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

  // ============================================================
  // PASS 2: Patient direction ({targetLang} → ko)
  // ============================================================
  console.log('\n=== Pass 2: Patient sentences (foreign → Korean) ===\n');

  // First, handle English→Korean directly (no intermediate translation needed)
  console.log('[en→ko] Seeding English patient sentences...');
  try {
    const enToKoBatches = [];
    for (let i = 0; i < PATIENT_SENTENCES_EN.length; i += BATCH_SIZE) {
      const batch = PATIENT_SENTENCES_EN.slice(i, i + BATCH_SIZE);
      // Translate English → Korean only
      const systemPrompt = `You are a professional medical translator. Translate each English sentence into Korean (polite 존댓말). These are sentences patients say at a plastic surgery clinic. Output one Korean translation per line. Do NOT number lines.`;
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.2,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: batch.join('\n') },
        ],
      });
      const output = response.choices?.[0]?.message?.content?.trim() || '';
      const lines = output.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const cleaned = lines.map(l => l.replace(/^\d+[\.\)\-]\s*/, ''));
      enToKoBatches.push(...cleaned);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const enInsertMany = db.transaction((entries) => {
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

    const enEntries = PATIENT_SENTENCES_EN.map((sentence, idx) => ({
      key: `en:ko:${SITE_CONTEXT}:${sentence.trim()}`,
      text: enToKoBatches[idx] || sentence,
    }));
    enInsertMany(enEntries);
    console.log(`  ✓ en→ko done (${enEntries.length} entries)`);
  } catch (err) {
    console.error(`  ✗ en→ko error: ${err.message}`);
    totalErrors++;
  }

  // Now handle all other languages
  for (let li = 0; li < TARGET_LANGUAGES.length; li++) {
    const lang = TARGET_LANGUAGES[li];
    if (lang.code === 'en') continue; // already handled above

    const progress = `[${li + 1}/${TARGET_LANGUAGES.length}]`;

    // Check existing entries for this language→ko direction
    const existingCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM translation_cache WHERE cache_key LIKE ?'
    ).get(`${lang.code}:ko:${SITE_CONTEXT}:%`)?.cnt || 0;

    if (existingCount >= PATIENT_SENTENCES_EN.length) {
      console.log(`${progress} ${lang.code}→ko: already seeded (${existingCount} entries). Skipping.`);
      totalSkipped += PATIENT_SENTENCES_EN.length;
      continue;
    }

    console.log(`${progress} ${lang.code}→ko (${lang.name}): translating patient sentences...`);

    try {
      const allResults = [];
      for (let i = 0; i < PATIENT_SENTENCES_EN.length; i += BATCH_SIZE) {
        const batch = PATIENT_SENTENCES_EN.slice(i, i + BATCH_SIZE);
        const results = await translatePatientBatch(batch, lang);
        allResults.push(...results);
        if (i + BATCH_SIZE < PATIENT_SENTENCES_EN.length) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }

      const patientInsertMany = db.transaction((entries) => {
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

      const entries = allResults.map((result, idx) => ({
        key: `${lang.code}:ko:${SITE_CONTEXT}:${(result.inTargetLang || PATIENT_SENTENCES_EN[idx]).trim()}`,
        text: result.inKorean || PATIENT_SENTENCES_EN[idx],
      }));
      patientInsertMany(entries);
      console.log(`  ✓ Done (${allResults.length} translations)`);

    } catch (err) {
      console.error(`  ✗ Error for ${lang.code}→ko: ${err.message}`);
      totalErrors++;
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  db.close();

  console.log('\n=== Summary ===');
  console.log(`Staff sentences (ko→foreign): ${KOREAN_SENTENCES.length} × ${TARGET_LANGUAGES.length} languages`);
  console.log(`Patient sentences (foreign→ko): ${PATIENT_SENTENCES_EN.length} × ${TARGET_LANGUAGES.length} languages`);
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Skipped (already existed): ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
