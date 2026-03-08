/**
 * server/routes/admin.js — 슈퍼관리자 전용 API
 *
 * POST /api/admin/login        비밀번호 → JWT 쿠키 발급
 * GET  /api/admin/me            관리자 인증 확인
 * POST /api/admin/logout        쿠키 삭제
 * GET  /api/admin/orgs          기관 목록
 * POST /api/admin/orgs          기관 추가
 * GET  /api/admin/orgs/:orgId   기관 상세 (기관 + 부서)
 * PATCH /api/admin/orgs/:orgId  기관 수정
 *
 * GET    /api/admin/orgs/:orgId/departments          부서 목록
 * POST   /api/admin/orgs/:orgId/departments          부서 추가
 * PATCH  /api/admin/orgs/:orgId/departments/:deptId  부서 수정
 * DELETE /api/admin/orgs/:orgId/departments/:deptId  부서 삭제 (소프트)
 *
 * GET    /api/admin/orgs/:orgId/departments/:deptId/pipeline   파이프라인 설정 조회
 * PATCH  /api/admin/orgs/:orgId/departments/:deptId/pipeline   파이프라인 설정 저장
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { run: dbRun, get: dbGet, all: dbAll } = require('../db/sqlite');

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mono-admin-2026';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'admin-secret';
const ADMIN_COOKIE = 'mono_admin_token';
const TOKEN_MAX_AGE = 24 * 60 * 60; // 24h (seconds)

// ── 인증 미들웨어 ──
function verifyAdmin(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET);
    if (payload.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ── org_code 자동 생성 (ORG-0001 형식) ──
async function nextOrgCode() {
  const row = await dbGet(
    `SELECT org_code FROM organizations ORDER BY id DESC LIMIT 1`
  );
  if (!row?.org_code) return 'ORG-0001';
  const num = parseInt(row.org_code.replace('ORG-', ''), 10) || 0;
  return `ORG-${String(num + 1).padStart(4, '0')}`;
}

// ═══════════════════════════════════════
// POST /login
// ═══════════════════════════════════════
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong_password' });
  }
  const token = jwt.sign({ role: 'super_admin' }, ADMIN_JWT_SECRET, {
    expiresIn: TOKEN_MAX_AGE,
  });
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: TOKEN_MAX_AGE * 1000,
    path: '/',
  });
  res.json({ ok: true });
});

// ═══════════════════════════════════════
// GET /me
// ═══════════════════════════════════════
router.get('/me', verifyAdmin, (_req, res) => {
  res.json({ ok: true, role: 'super_admin' });
});

// ═══════════════════════════════════════
// POST /logout
// ═══════════════════════════════════════
router.post('/logout', (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// ═══════════════════════════════════════
// GET /orgs — 기관 목록
// ═══════════════════════════════════════
router.get('/orgs', verifyAdmin, async (_req, res) => {
  try {
    const rows = await dbAll(`
      SELECT
        o.id, o.org_code, o.name, o.org_type, o.plan,
        o.is_active, o.created_at, o.trial_ends_at,
        (SELECT COUNT(*) FROM org_departments d WHERE d.org_id = o.id) AS dept_count
      FROM organizations o
      ORDER BY o.id DESC
    `);
    res.json({ ok: true, orgs: rows });
  } catch (e) {
    console.error('[admin] GET /orgs error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// POST /orgs — 기관 추가
// ═══════════════════════════════════════
router.post('/orgs', verifyAdmin, async (req, res) => {
  try {
    const { name, org_type, plan, trial_days } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name_required' });
    }
    const orgCode = await nextOrgCode();
    const orgType = org_type || 'hospital';
    const orgPlan = plan || 'trial';
    let trialEndsAt = null;
    if (orgPlan === 'trial') {
      const days = Number(trial_days) || 30;
      const d = new Date();
      d.setDate(d.getDate() + days);
      trialEndsAt = d.toISOString().split('T')[0];
    }
    const result = await dbRun(
      `INSERT INTO organizations (org_code, name, org_type, plan, trial_ends_at)
       VALUES (?, ?, ?, ?, ?)`,
      [orgCode, String(name).trim(), orgType, orgPlan, trialEndsAt]
    );
    res.json({ ok: true, id: result.lastID, org_code: orgCode });
  } catch (e) {
    console.error('[admin] POST /orgs error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// GET /orgs/:orgId — 기관 상세
// ═══════════════════════════════════════
router.get('/orgs/:orgId', verifyAdmin, async (req, res) => {
  try {
    const org = await dbGet(
      `SELECT * FROM organizations WHERE id = ?`,
      [req.params.orgId]
    );
    if (!org) return res.status(404).json({ error: 'not_found' });
    const departments = await dbAll(
      `SELECT * FROM org_departments WHERE org_id = ? ORDER BY sort_order`,
      [req.params.orgId]
    );
    res.json({ ok: true, org, departments });
  } catch (e) {
    console.error('[admin] GET /orgs/:orgId error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// PATCH /orgs/:orgId — 기관 수정
// ═══════════════════════════════════════
router.patch('/orgs/:orgId', verifyAdmin, async (req, res) => {
  try {
    const org = await dbGet(
      `SELECT * FROM organizations WHERE id = ?`,
      [req.params.orgId]
    );
    if (!org) return res.status(404).json({ error: 'not_found' });

    const updates = {};
    const allowed = ['name', 'org_type', 'plan', 'trial_ends_at', 'logo_url', 'primary_color', 'welcome_msg', 'default_lang', 'is_active'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }
    updates.updated_at = new Date().toISOString();

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.orgId];
    await dbRun(
      `UPDATE organizations SET ${setClauses} WHERE id = ?`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin] PATCH /orgs/:orgId error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// GET /orgs/:orgId/departments — 부서 목록
// ═══════════════════════════════════════
router.get('/orgs/:orgId/departments', verifyAdmin, async (req, res) => {
  try {
    const org = await dbGet(`SELECT id FROM organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'org_not_found' });
    const departments = await dbAll(
      `SELECT * FROM org_departments WHERE org_id = ? ORDER BY sort_order, id`,
      [req.params.orgId]
    );
    res.json({ ok: true, departments });
  } catch (e) {
    console.error('[admin] GET /orgs/:orgId/departments error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// POST /orgs/:orgId/departments — 부서 추가
// ═══════════════════════════════════════
router.post('/orgs/:orgId/departments', verifyAdmin, async (req, res) => {
  try {
    const org = await dbGet(`SELECT id FROM organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'org_not_found' });

    const { dept_name, dept_code, sort_order } = req.body || {};
    if (!dept_name || !String(dept_name).trim()) {
      return res.status(400).json({ error: 'dept_name_required' });
    }
    if (!dept_code || !String(dept_code).trim()) {
      return res.status(400).json({ error: 'dept_code_required' });
    }
    // dept_code 형식 검증: 영소문자 + 언더바만
    if (!/^[a-z][a-z0-9_]*$/.test(dept_code)) {
      return res.status(400).json({ error: 'dept_code_invalid_format' });
    }

    const result = await dbRun(
      `INSERT INTO org_departments (org_id, dept_code, dept_name, sort_order)
       VALUES (?, ?, ?, ?)`,
      [req.params.orgId, String(dept_code).trim(), String(dept_name).trim(), Number(sort_order) || 0]
    );
    res.json({ ok: true, id: result.lastID });
  } catch (e) {
    if (e?.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'dept_code_duplicate' });
    }
    console.error('[admin] POST /orgs/:orgId/departments error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// PATCH /orgs/:orgId/departments/:deptId — 부서 수정
// ═══════════════════════════════════════
router.patch('/orgs/:orgId/departments/:deptId', verifyAdmin, async (req, res) => {
  try {
    const dept = await dbGet(
      `SELECT * FROM org_departments WHERE id = ? AND org_id = ?`,
      [req.params.deptId, req.params.orgId]
    );
    if (!dept) return res.status(404).json({ error: 'dept_not_found' });

    const updates = {};
    const allowed = ['dept_name', 'dept_name_en', 'dept_code', 'sort_order', 'is_active'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.deptId, req.params.orgId];
    await dbRun(
      `UPDATE org_departments SET ${setClauses} WHERE id = ? AND org_id = ?`,
      values
    );
    res.json({ ok: true });
  } catch (e) {
    if (e?.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'dept_code_duplicate' });
    }
    console.error('[admin] PATCH /orgs/:orgId/departments/:deptId error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// DELETE /orgs/:orgId/departments/:deptId — 부서 소프트 삭제
// ═══════════════════════════════════════
router.delete('/orgs/:orgId/departments/:deptId', verifyAdmin, async (req, res) => {
  try {
    const dept = await dbGet(
      `SELECT * FROM org_departments WHERE id = ? AND org_id = ?`,
      [req.params.deptId, req.params.orgId]
    );
    if (!dept) return res.status(404).json({ error: 'dept_not_found' });

    await dbRun(
      `UPDATE org_departments SET is_active = 0 WHERE id = ? AND org_id = ?`,
      [req.params.deptId, req.params.orgId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin] DELETE /orgs/:orgId/departments/:deptId error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// GET /orgs/:orgId/departments/:deptId/pipeline — 파이프라인 설정 조회
// ═══════════════════════════════════════
router.get('/orgs/:orgId/departments/:deptId/pipeline', verifyAdmin, async (req, res) => {
  try {
    const dept = await dbGet(
      `SELECT id FROM org_departments WHERE id = ? AND org_id = ?`,
      [req.params.deptId, req.params.orgId]
    );
    if (!dept) return res.status(404).json({ error: 'dept_not_found' });

    const row = await dbGet(
      `SELECT config_json FROM org_pipeline_config WHERE dept_id = ?`,
      [req.params.deptId]
    );
    const config = row?.config_json ? JSON.parse(row.config_json) : {};
    res.json({ ok: true, config });
  } catch (e) {
    console.error('[admin] GET pipeline error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// ═══════════════════════════════════════
// PATCH /orgs/:orgId/departments/:deptId/pipeline — 파이프라인 설정 저장 (upsert)
// ═══════════════════════════════════════
router.patch('/orgs/:orgId/departments/:deptId/pipeline', verifyAdmin, async (req, res) => {
  try {
    const dept = await dbGet(
      `SELECT id FROM org_departments WHERE id = ? AND org_id = ?`,
      [req.params.deptId, req.params.orgId]
    );
    if (!dept) return res.status(404).json({ error: 'dept_not_found' });

    const { config } = req.body || {};
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'config_required' });
    }

    const configJson = JSON.stringify(config);
    await dbRun(
      `INSERT INTO org_pipeline_config (dept_id, config_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(dept_id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
      [req.params.deptId, configJson]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin] PATCH pipeline error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;
