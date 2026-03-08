-- 004_admin_console.sql — MONO 관리자 콘솔 DB 마이그레이션
-- 실행 순서: 기존 001~003 이후

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. organizations (기관 정보)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT    NOT NULL UNIQUE,          -- ORG-0001
  name          TEXT    NOT NULL,                  -- 서울성형외과
  org_type      TEXT    NOT NULL DEFAULT 'hospital',
                                                   -- hospital | police | court | multicultural | industrial | other
  plan          TEXT    NOT NULL DEFAULT 'trial',  -- trial | free | basic | pro | enterprise
  trial_ends_at TEXT,                              -- ISO 날짜 (트라이얼 만료일)
  logo_url      TEXT,
  primary_color TEXT    DEFAULT '#2563EB',
  welcome_msg   TEXT,                              -- 키오스크 환영 문구
  default_lang  TEXT    DEFAULT 'ko',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 2. org_departments (부서 정보)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dept_code     TEXT    NOT NULL,                  -- reception | plastic_surgery | ...
  dept_name     TEXT    NOT NULL,                  -- 접수처
  dept_name_en  TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, dept_code)
);

-- ============================================================
-- 3. org_pipeline_config (부서별 블럭 파이프라인 설정)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_pipeline_config (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id       INTEGER NOT NULL REFERENCES org_departments(id) ON DELETE CASCADE,
  config_json   TEXT    NOT NULL DEFAULT '{}',
  -- 예시:
  -- {
  --   "input":   { "type": "kiosk_qr" },          -- kiosk_qr | staff_ptt | text
  --   "stt":     { "engine": "groq_whisper" },
  --   "translate": { "engine": "gpt4o", "context": "hospital" },
  --   "session": { "type": "qr_scan", "reset": "auto" },
  --   "output":  { "type": "subtitle" },           -- subtitle | chat
  --   "storage": { "type": "no_record" }           -- no_record | db | summary
  -- }
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by    INTEGER REFERENCES users(id),
  UNIQUE(dept_id)
);

-- ============================================================
-- 4. org_staff_accounts (직원 계정)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_staff_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id),      -- MONO 계정 연결 시
  email         TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'staff',  -- admin | staff
  dept_ids      TEXT    NOT NULL DEFAULT '[]',     -- JSON array of dept_id
  invite_token  TEXT    UNIQUE,                    -- 초대 링크 토큰
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 5. org_devices (등록 기기)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dept_id       INTEGER REFERENCES org_departments(id),
  device_label  TEXT    NOT NULL,                  -- "1층 접수 키오스크"
  device_type   TEXT    NOT NULL DEFAULT 'kiosk',  -- kiosk | staff_pc | mobile
  last_seen_at  TEXT,
  last_ip       TEXT,
  is_online     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 6. org_session_logs (세션 로그)
-- ============================================================
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

-- ============================================================
-- 7. org_api_cost_logs (API 비용 추적)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_api_cost_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  log_date      TEXT    NOT NULL,                  -- YYYY-MM-DD
  api_type      TEXT    NOT NULL,                  -- groq_stt | openai_translate
  call_count    INTEGER NOT NULL DEFAULT 0,
  input_units   INTEGER NOT NULL DEFAULT 0,        -- chars or tokens
  cost_usd      REAL    NOT NULL DEFAULT 0,
  cost_krw      REAL    NOT NULL DEFAULT 0,
  UNIQUE(org_id, log_date, api_type)
);

-- ============================================================
-- 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_org_dept_org_id     ON org_departments(org_id);
CREATE INDEX IF NOT EXISTS idx_org_staff_org_id    ON org_staff_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_org_devices_org_id  ON org_devices(org_id);
CREATE INDEX IF NOT EXISTS idx_org_sessions_org_id ON org_session_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_org_sessions_date   ON org_session_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_org_cost_org_date   ON org_api_cost_logs(org_id, log_date);

-- ============================================================
-- 슈퍼관리자 설정 테이블 (단순 KV)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 슈퍼관리자 비밀번호 초기값 (bcrypt로 교체 필요)
INSERT OR IGNORE INTO admin_settings (key, value)
VALUES ('admin_setup_done', 'false');
