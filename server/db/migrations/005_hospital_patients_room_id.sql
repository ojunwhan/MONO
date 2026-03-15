-- 005_hospital_patients_room_id.sql — persistent PT room per patient
-- Adds room_id to hospital_patients so each patient keeps the same PT-XXXXXX every visit.

ALTER TABLE hospital_patients ADD COLUMN room_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hospital_patients_room_id ON hospital_patients(room_id);
