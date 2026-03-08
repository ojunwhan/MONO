/**
 * server/routes/org.js — 기관/부서 공개 API (인증 불필요)
 *
 * GET /api/org/:orgCode/:deptCode/config
 *   → organizations + org_departments + org_pipeline_config 조인
 *   → 기관/부서 없거나 비활성이면 404
 */

const express = require('express');
const { get: dbGet } = require('../db/sqlite');

const router = express.Router();

// ═══════════════════════════════════════
// GET /:orgCode/:deptCode/config
// ═══════════════════════════════════════
router.get('/:orgCode/:deptCode/config', async (req, res) => {
  try {
    const { orgCode, deptCode } = req.params;

    // 기관 조회 (활성 상태만)
    const org = await dbGet(
      `SELECT id, org_code, name, org_type, plan, is_active, primary_color, welcome_msg, default_lang
       FROM organizations
       WHERE org_code = ? AND is_active = 1`,
      [orgCode]
    );
    if (!org) {
      return res.status(404).json({ error: 'org_not_found' });
    }

    // 부서 조회 (활성 상태만)
    const dept = await dbGet(
      `SELECT id, dept_code, dept_name, dept_name_en, is_active
       FROM org_departments
       WHERE org_id = ? AND dept_code = ? AND is_active = 1`,
      [org.id, deptCode]
    );
    if (!dept) {
      return res.status(404).json({ error: 'dept_not_found' });
    }

    // 파이프라인 설정 조회
    const pipelineRow = await dbGet(
      `SELECT config_json FROM org_pipeline_config WHERE dept_id = ?`,
      [dept.id]
    );
    const pipeline = pipelineRow?.config_json
      ? JSON.parse(pipelineRow.config_json)
      : {};

    res.json({
      ok: true,
      orgName: org.name,
      orgCode: org.org_code,
      orgType: org.org_type,
      plan: org.plan,
      primaryColor: org.primary_color,
      welcomeMsg: org.welcome_msg,
      defaultLang: org.default_lang,
      deptName: dept.dept_name,
      deptNameEn: dept.dept_name_en,
      deptCode: dept.dept_code,
      pipeline,
    });
  } catch (e) {
    console.error('[org] GET /:orgCode/:deptCode/config error:', e?.message);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
