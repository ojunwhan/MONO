#!/usr/bin/env node
/**
 * Seed translation_cache from server/constants/medicalKnowledge.js term arrays.
 * Inserts ko↔en, ko↔zh, ko↔ja, ko↔vi pairs with siteContext hospital_plastic_surgery.
 *
 * Usage (repo root):
 *   node scripts/seed-translation-cache.js
 *
 * DB: state/mono_phase1.sqlite or MONO_DB_PATH
 * Requires: translation_cache table (cache_key, translated_text, hit_count)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sqlite3 = require('sqlite3').verbose();

const SITE_CONTEXT = 'hospital_plastic_surgery';
const DB_PATH = process.env.MONO_DB_PATH || path.join(__dirname, '..', 'state', 'mono_phase1.sqlite');

const MEDICAL_KNOWLEDGE_PATH = path.join(__dirname, '..', 'server', 'constants', 'medicalKnowledge.js');

/** All term array identifiers defined in medicalKnowledge.js (order matches file). */
const TERM_ARRAY_NAMES = [
  'COMMON_HOSPITAL',
  'PLASTIC_SURGERY',
  'COSMETIC_DERMATOLOGY',
  'INTERNAL_MEDICINE',
  'SURGERY',
  'EMERGENCY_MEDICINE',
  'OBGYN',
  'PEDIATRICS',
  'ORTHOPEDICS',
  'NEUROLOGY',
  'OPHTHALMOLOGY',
  'ENT',
  'PROCEDURES_AND_TESTS',
  'MEDICATIONS',
];

/** Bidirectional pairs among ko and the four non-ko langs (8 directions). */
const DIRECTIONS = [
  ['ko', 'en'],
  ['en', 'ko'],
  ['ko', 'zh'],
  ['zh', 'ko'],
  ['ko', 'ja'],
  ['ja', 'ko'],
  ['ko', 'vi'],
  ['vi', 'ko'],
];

function loadMedicalKnowledgeTerms() {
  let src = fs.readFileSync(MEDICAL_KNOWLEDGE_PATH, 'utf8');
  const exportRepl = `module.exports = { getMedicalTermContext, ${TERM_ARRAY_NAMES.join(', ')} };`;
  src = src.replace(/module\.exports\s*=\s*\{\s*getMedicalTermContext\s*\}\s*;/, exportRepl);
  if (!src.includes(exportRepl.slice(0, 40))) {
    throw new Error(
      'Could not patch medicalKnowledge.js exports (expected `module.exports = { getMedicalTermContext };`). File unchanged on disk.'
    );
  }
  const m = { exports: {} };
  const dirname = path.dirname(MEDICAL_KNOWLEDGE_PATH);
  const filename = MEDICAL_KNOWLEDGE_PATH;
  vm.runInNewContext(
    src,
    {
      module: m,
      exports: m.exports,
      require,
      __dirname: dirname,
      __filename: filename,
      console,
      Buffer,
      process,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
    },
    { filename }
  );
  const all = [];
  for (const name of TERM_ARRAY_NAMES) {
    const arr = m.exports[name];
    if (!Array.isArray(arr)) {
      throw new Error(`Expected array export ${name}, got ${typeof arr}`);
    }
    all.push(...arr);
  }
  return all;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

async function main() {
  console.log('=== MONO medical terms → translation_cache ===');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Terms file: ${MEDICAL_KNOWLEDGE_PATH}`);

  const terms = loadMedicalKnowledgeTerms();
  const rows = [];

  for (const term of terms) {
    if (!term || typeof term !== 'object') continue;
    for (const [from, to] of DIRECTIONS) {
      const sourceText = String(term[from] ?? '').trim();
      const targetText = String(term[to] ?? '').trim();
      if (!sourceText || !targetText) continue;
      const cacheKey = `${from}:${to}:${SITE_CONTEXT}:${sourceText}`;
      rows.push({ cacheKey, translatedText: targetText });
    }
  }

  const db = new sqlite3.Database(DB_PATH);
  let inserted = 0;
  let skipped = 0;

  try {
    await run(db, 'BEGIN IMMEDIATE');
    for (const { cacheKey, translatedText } of rows) {
      const changes = await run(
        db,
        'INSERT OR IGNORE INTO translation_cache (cache_key, translated_text) VALUES (?, ?)',
        [cacheKey, translatedText]
      );
      if (changes === 1) inserted += 1;
      else skipped += 1;
    }
    await run(db, 'COMMIT');
  } catch (e) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.close();
  }

  console.log('');
  console.log(`Total terms processed: ${terms.length}`);
  console.log(`Total cache rows attempted: ${rows.length}`);
  console.log(`Total cache entries inserted: ${inserted}`);
  console.log(`Total skipped (already existed): ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
