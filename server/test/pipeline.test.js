/**
 * MONO 병원 VAD 파이프라인 자동 테스트 (브라우저 없이 서버 로직만)
 *
 * 실행 (프로젝트 루트에서):
 *   npm run test:pipeline
 *   또는
 *   NODE_TEST=1 node server/test/pipeline.test.js
 *   (Windows PowerShell: $env:NODE_TEST='1'; node server/test/pipeline.test.js)
 *
 * 테스트 1: STT + fastTranslate 속도 측정 (PCM 샘플 → transcribePcm16, 문장 → fastTranslate)
 * 테스트 2: 병원 존댓말 프롬프트 검증 (영문 5문장 → 한국어 존댓말 출력 여부)
 * 테스트 3: PT-XXXXXX 채널 재사용 (active 세션 insert 후 POST /api/hospital/join → isExistingSession: true)
 *
 * 의존성: .env (API 키), supertest (Test 3, npm install supertest --save-dev)
 */
process.env.NODE_TEST = '1';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { transcribePcm16, fastTranslate, buildSystemPrompt, app } = require('../../server.js');
const { run: dbRun, get: dbGet } = require('../db/sqlite');
const { v4: uuidv4 } = require('uuid');

const log = (msg) => console.log(msg);
const ok = (name) => log(`  ✅ ${name}`);
const fail = (name, detail) => log(`  ❌ ${name}${detail ? ': ' + detail : ''}`);

// ── 테스트 1: STT + 번역 파이프라인 속도 측정 ──
async function test1PipelineSpeed() {
  log('\n[테스트 1] STT + 번역 파이프라인 속도 측정');
  try {
    // 1초 분량 PCM 16bit mono 16kHz = 32000 bytes
    const pcmBuffer = Buffer.alloc(32000, 0);
    const sampleText = 'Hello, I need help.';

    const sttStart = Date.now();
    const transcript = await transcribePcm16(pcmBuffer, 'en', 16000, { hospitalMode: true });
    const sttMs = Date.now() - sttStart;

    const translateStart = Date.now();
    const translated = await fastTranslate(sampleText, 'en', 'ko', '', 'hospital_reception', []);
    const translateMs = Date.now() - translateStart;

    const totalMs = sttMs + translateMs;
    log(`  STT: ${sttMs}ms / fastTranslate: ${translateMs}ms / 합계: ${totalMs}ms`);
    if (typeof transcript === 'string' && typeof translated === 'string') {
      ok('STT 및 fastTranslate 호출 성공');
    } else {
      fail('테스트 1', '반환값 형식 이상');
    }
  } catch (e) {
    fail('테스트 1', e.message || String(e));
  }
}

// ── 테스트 2: 병원 존댓말 프롬프트 검증 ──
async function test2HospitalFormalPrompt() {
  log('\n[테스트 2] 병원 존댓말 프롬프트 검증');
  const sentences = [
    "I'm sick",
    "Where is the bathroom?",
    "It hurts",
    "How long do I wait?",
    "I have a fever",
  ];
  const formalPattern = /(십니까|드리겠습니다|습니다|니다|세요|시겠습니까|하십시오|여요|예요|있습니까|합니까)/;
  let passed = 0;
  for (const phrase of sentences) {
    try {
      const out = await fastTranslate(phrase, 'en', 'ko', '', 'hospital_reception', []);
      const isFormal = formalPattern.test(out || '');
      if (isFormal) {
        passed++;
        log(`  ✅ "${phrase}" → "${(out || '').slice(0, 50)}..." (존댓말)`);
      } else {
        log(`  ❌ "${phrase}" → "${(out || '').slice(0, 50)}..." (존댓말 아님)`);
      }
    } catch (e) {
      log(`  ❌ "${phrase}" 오류: ${e.message}`);
    }
  }
  if (passed >= 3) {
    ok(`병원 존댓말 검증 (${passed}/5 통과)`);
  } else {
    fail('테스트 2', `${passed}/5만 존댓말 형태`);
  }
}

// ── 테스트 3: PT-XXXXXX 채널 재사용 ──
async function test3ChannelReuse() {
  log('\n[테스트 3] PT-XXXXXX 채널 재사용');
  let request;
  try {
    request = require('supertest');
  } catch (_) {
    log('  ⚠ 테스트 3 스킵: supertest 미설치. npm install supertest --save-dev 후 재실행.');
    return;
  }
  const testToken = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const testRoomId = 'PT-TEST01';
  const testSessionId = uuidv4();
  try {
    await dbRun(
      `INSERT OR REPLACE INTO hospital_patients (id, chart_number, patient_token, dept, first_visit_at, last_visit_at) VALUES (?, ?, ?, 'reception', datetime('now'), datetime('now'))`,
      [testToken, testToken, testToken]
    );
    const createdAt = new Date().toISOString();
    await dbRun(
      `INSERT INTO hospital_sessions (id, patient_token, room_id, dept, started_at, chart_number, station_id, status) VALUES (?, ?, ?, 'reception', ?, ?, 'hospital', 'active')`,
      [testSessionId, testToken, testRoomId, createdAt, testToken]
    );

    const res = await request(app)
      .post('/api/hospital/join')
      .set('Content-Type', 'application/json')
      .send({ department: 'reception', patientToken: testToken, language: 'en' });

    const body = res.body || {};
    if (body.success && body.isExistingSession === true && body.roomId === testRoomId) {
      ok('isExistingSession: true 및 기존 roomId 반환');
    } else {
      fail('테스트 3', `success=${body.success} isExistingSession=${body.isExistingSession} roomId=${body.roomId}`);
    }

    await dbRun('DELETE FROM hospital_sessions WHERE id = ?', [testSessionId]);
    await dbRun('DELETE FROM hospital_patients WHERE patient_token = ?', [testToken]);
  } catch (e) {
    fail('테스트 3', e.message || String(e));
    try {
      await dbRun('DELETE FROM hospital_sessions WHERE id = ?', [testSessionId]);
      await dbRun('DELETE FROM hospital_patients WHERE patient_token = ?', [testToken]);
    } catch (_) {}
  }
}

async function main() {
  log('MONO 병원 VAD 파이프라인 자동 테스트 (서버 로직만)');
  await test1PipelineSpeed();
  await test2HospitalFormalPrompt();
  await test3ChannelReuse();
  log('\n완료.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
