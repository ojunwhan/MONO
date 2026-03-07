// src/pages/HospitalPatientJoin.jsx — 환자 QR 스캔 후 자동 입장 페이지
// 첫 스캔: 언어 선택 → 고유번호 생성 → 서버 등록 → 통역 시작
// 재스캔: localStorage에 저장된 언어/고유번호로 바로 통역 시작
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import MonoLogo from "../components/MonoLogo";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";

// ── Hospital mode: "환자" translated per language ──
const PATIENT_LABEL = {
  ko: "환자", en: "Patient", ja: "患者", zh: "患者",
  vi: "Bệnh nhân", th: "ผู้ป่วย", id: "Pasien", tl: "Pasyente",
  mn: "Өвчтөн", uz: "Bemor", ru: "Пациент", ar: "مريض",
  es: "Paciente", ne: "बिरामी", my: "လူနာ", km: "អ្នកជំងឺ",
};

function getPatientLabel(langCode) {
  const code = String(langCode || "en").toLowerCase().split("-")[0];
  return PATIENT_LABEL[code] || "Patient";
}

// ── localStorage key ──
const STORAGE_KEY = "mono_hospital_patient";

// ── Generate patient ID: PT-YYYYMMDD-XXXX ──
function generatePatientId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let rand = "";
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `PT-${y}${m}${d}-${rand}`;
}

// ── Load saved patient data from localStorage ──
function loadSavedPatient() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.patientId && data?.language) return data;
    return null;
  } catch {
    return null;
  }
}

// ── Save patient data to localStorage ──
function savePatientLocal(patientId, language) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ patientId, language, savedAt: Date.now() })
  );
}

export default function HospitalPatientJoin() {
  const { department } = useParams();
  const navigate = useNavigate();
  const joinCalledRef = useRef(false);

  const dept = useMemo(
    () => HOSPITAL_DEPARTMENTS.find((d) => d.id === department) || null,
    [department]
  );

  // Check if patient already registered (재방문)
  const savedPatient = useMemo(() => loadSavedPatient(), []);

  // States
  // 'auto' → 재방문 자동 연결 | 'language' → 첫 방문 언어 선택 | 'connecting' | 'error'
  const [step, setStep] = useState(savedPatient ? "auto" : "language");
  const [error, setError] = useState("");

  // Language
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    return getLanguageByCode(saved)?.code || "";
  }, []);
  const [selectedLang, setSelectedLang] = useState(
    savedPatient?.language || savedLang || detected?.code || "en"
  );
  const [showLangGrid, setShowLangGrid] = useState(true);

  const handleLangSelect = useCallback((code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
  }, []);

  // ── Core join logic (공통) ──
  const doJoin = useCallback(async (lang, patientId) => {
    if (joinCalledRef.current) return;
    joinCalledRef.current = true;
    setStep("connecting");
    setError("");

    try {
      // 1. Register/update patient on server
      await fetch("/api/hospital/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, language: lang }),
      });

      // 2. Create new room via POST /api/hospital/join
      const res = await fetch("/api/hospital/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: department || "general",
          patientId,
          language: lang,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.roomId) {
        throw new Error(data.error || "연결에 실패했습니다");
      }

      const roomId = data.roomId;
      const guestId = `guest_${uuidv4().slice(0, 8)}`;
      const cleanName = getPatientLabel(lang);

      // 3. Save to localStorage for future visits
      savePatientLocal(patientId, lang);
      localStorage.setItem("myLang", lang);

      // 4. Save guest session
      sessionStorage.setItem(
        "mono_guest",
        JSON.stringify({
          roomId,
          lang,
          name: cleanName,
          guestId,
          siteContext: `hospital_${department || "general"}`,
          roomType: "oneToOne",
          joinedAt: Date.now(),
          patientId,
        })
      );

      // 5. Navigate to chat room as guest
      navigate(`/room/${roomId}`, {
        replace: true,
        state: {
          fromLang: lang,
          localName: cleanName,
          guestId,
          isGuest: true,
          isCreator: false,
          siteContext: `hospital_${department || "general"}`,
          roomType: "oneToOne",
          patientId,
        },
      });
    } catch (e) {
      console.error("[hospital:patient-join] error:", e);
      setError(e?.message || "연결에 실패했습니다. 다시 시도해주세요.");
      setStep("error");
      joinCalledRef.current = false;
    }
  }, [department, navigate]);

  // ── 재방문 자동 연결 (step === 'auto') ──
  useEffect(() => {
    if (step !== "auto" || !savedPatient) return;
    doJoin(savedPatient.language, savedPatient.patientId);
  }, [step, savedPatient, doJoin]);

  // ── 첫 방문: 언어 선택 후 join 버튼 클릭 ──
  const handleJoin = useCallback(() => {
    const patientId = generatePatientId();
    doJoin(selectedLang, patientId);
  }, [selectedLang, doJoin]);

  // ── Render: Auto connecting (재방문) ──
  if (step === "auto") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
        }}
      >
        <MonoLogo />
        <div
          style={{
            marginTop: "32px",
            width: "48px",
            height: "48px",
            border: "4px solid #e5e7eb",
            borderTopColor: "#3B82F6",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <p style={{ marginTop: "16px", fontSize: "16px", color: "#374151", fontWeight: 500 }}>
          자동 연결 중... / Auto connecting...
        </p>
        <p style={{ marginTop: "8px", fontSize: "13px", color: "#9ca3af" }}>
          {savedPatient?.patientId}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Render: Language Selection (첫 방문) ──
  if (step === "language") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: "24px" }}>
          <MonoLogo />
        </div>

        {/* Department */}
        {dept && (
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <span style={{ fontSize: "40px", display: "block", marginBottom: "4px" }}>
              {dept.icon}
            </span>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#1a1a1a", margin: 0 }}>
              {dept.labelKo}
            </h2>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0" }}>
              {dept.label}
            </p>
          </div>
        )}

        {/* Guide */}
        <p
          style={{
            fontSize: "15px",
            color: "#374151",
            textAlign: "center",
            marginBottom: "16px",
            fontWeight: 500,
          }}
        >
          언어를 선택해주세요 / Select your language
        </p>

        {/* Language Picker */}
        <div style={{ width: "100%", maxWidth: "400px", marginBottom: "24px" }}>
          <LanguageFlagPicker
            selectedLang={selectedLang}
            showGrid={showLangGrid}
            onToggleGrid={() => setShowLangGrid((p) => !p)}
            onSelect={handleLangSelect}
          />
        </div>

        {/* Join Button — visible when language is confirmed */}
        {!showLangGrid && (
          <button
            type="button"
            onClick={handleJoin}
            style={{
              width: "100%",
              maxWidth: "400px",
              height: "52px",
              borderRadius: "14px",
              border: "none",
              background: "#3B82F6",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            통역 시작 / Start Interpretation
          </button>
        )}

        {/* Footer */}
        <div style={{ marginTop: "auto", paddingTop: "24px" }}>
          <p style={{ fontSize: "10px", color: "#9ca3af", textAlign: "center" }}>
            Powered by MONO Medical Interpreter
          </p>
        </div>
      </div>
    );
  }

  // ── Render: Connecting ──
  if (step === "connecting") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
        }}
      >
        <MonoLogo />
        <div
          style={{
            marginTop: "32px",
            width: "48px",
            height: "48px",
            border: "4px solid #e5e7eb",
            borderTopColor: "#3B82F6",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <p style={{ marginTop: "16px", fontSize: "16px", color: "#374151", fontWeight: 500 }}>
          연결 중... / Connecting...
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Render: Error ──
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <MonoLogo />
      <div
        style={{
          marginTop: "24px",
          padding: "16px 24px",
          borderRadius: "12px",
          background: "#FEF2F2",
          border: "1px solid #FECACA",
          textAlign: "center",
          maxWidth: "400px",
          width: "100%",
        }}
      >
        <p style={{ fontSize: "14px", color: "#DC2626", margin: "0 0 12px" }}>
          ⚠️ {error}
        </p>
        <button
          type="button"
          onClick={() => { setStep("language"); setShowLangGrid(true); joinCalledRef.current = false; }}
          style={{
            padding: "8px 24px",
            borderRadius: "8px",
            border: "1px solid #3B82F6",
            background: "#ffffff",
            color: "#3B82F6",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          다시 시도 / Retry
        </button>
      </div>
    </div>
  );
}
