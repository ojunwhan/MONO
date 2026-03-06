-- 002_hospital_kiosk.sql — 병원 키오스크 + 환자 등록 시스템

-- 병원 통역 세션 (차트번호 기반)
CREATE TABLE IF NOT EXISTS hospital_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  chart_number TEXT NOT NULL,
  station_id TEXT DEFAULT 'default',
  department TEXT,
  host_lang TEXT,
  guest_lang TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

-- 병원 대화 메시지 (영구 저장 — 환자 폰에는 저장하지 않음)
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

-- 환자 등록 DB (차트번호 기반, EMR 연동 대비 구조)
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

CREATE INDEX IF NOT EXISTS idx_hospital_sessions_chart ON hospital_sessions(chart_number);
CREATE INDEX IF NOT EXISTS idx_hospital_sessions_station ON hospital_sessions(station_id);
CREATE INDEX IF NOT EXISTS idx_hospital_sessions_status ON hospital_sessions(status);
CREATE INDEX IF NOT EXISTS idx_hospital_sessions_dept ON hospital_sessions(department);
CREATE INDEX IF NOT EXISTS idx_hospital_sessions_created ON hospital_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hospital_messages_session ON hospital_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_hospital_messages_room ON hospital_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_hospital_patients_chart ON hospital_patients(chart_number);
CREATE INDEX IF NOT EXISTS idx_hospital_patients_hospital ON hospital_patients(hospital_id);

-- API 사용량 일별 통계 (서버 재시작 시 복원용)
CREATE TABLE IF NOT EXISTS api_usage_daily (
  date TEXT NOT NULL PRIMARY KEY,
  groq_stt_count INTEGER DEFAULT 0,
  openai_stt_count INTEGER DEFAULT 0,
  translation_count INTEGER DEFAULT 0,
  tts_count INTEGER DEFAULT 0,
  total_stt INTEGER DEFAULT 0,
  total_visits INTEGER DEFAULT 0,
  peak_connections INTEGER DEFAULT 0,
  rooms_created INTEGER DEFAULT 0
);