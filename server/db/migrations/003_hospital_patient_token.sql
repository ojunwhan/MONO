-- 003_hospital_patient_token.sql — 환자 토큰 기반 저장 시스템
-- 기존 hospital_patients 테이블과 별개로 새 테이블 구조 (patient_token PK 기반)

-- 환자 정보 (patient_token 기반)
CREATE TABLE IF NOT EXISTS hospital_patients_v2 (
  patient_token TEXT PRIMARY KEY,
  dept TEXT,
  first_visit_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_visit_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 방문 세션 기록
CREATE TABLE IF NOT EXISTS hospital_sessions_v2 (
  id TEXT PRIMARY KEY,
  patient_token TEXT,
  room_id TEXT NOT NULL,
  dept TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (patient_token) REFERENCES hospital_patients_v2(patient_token) ON DELETE SET NULL
);

-- 대화 메시지 (환자별 누적)
CREATE TABLE IF NOT EXISTS hospital_messages_v2 (
  id TEXT PRIMARY KEY,
  patient_token TEXT,
  room_id TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('patient', 'staff')),
  original_text TEXT NOT NULL,
  translated_text TEXT,
  lang TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_token) REFERENCES hospital_patients_v2(patient_token) ON DELETE SET NULL
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_hp_v2_token ON hospital_patients_v2(patient_token);
CREATE INDEX IF NOT EXISTS idx_hs_v2_token ON hospital_sessions_v2(patient_token);
CREATE INDEX IF NOT EXISTS idx_hs_v2_room ON hospital_sessions_v2(room_id);
CREATE INDEX IF NOT EXISTS idx_hs_v2_dept ON hospital_sessions_v2(dept);
CREATE INDEX IF NOT EXISTS idx_hs_v2_started ON hospital_sessions_v2(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hm_v2_token ON hospital_messages_v2(patient_token);
CREATE INDEX IF NOT EXISTS idx_hm_v2_room ON hospital_messages_v2(room_id);
CREATE INDEX IF NOT EXISTS idx_hm_v2_created ON hospital_messages_v2(created_at);
