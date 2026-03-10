// src/pages/HospitalPatientJoin.jsx — 환자 QR 스캔 후 입장 페이지
// 환자가 QR 스캔 → 언어 선택 → "통역 시작" 클릭 → 새 roomId 생성 → ChatScreen 진입
// patientToken을 localStorage에 저장하여 재방문 시 같은 환자로 인식
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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

// ── patientToken localStorage 관리 ──
const PATIENT_TOKEN_KEY = "mono_hospital_patient_token";

function getOrCreatePatientToken() {
  const existing = localStorage.getItem(PATIENT_TOKEN_KEY);
  if (existing) return existing;
  const token = `pt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  localStorage.setItem(PATIENT_TOKEN_KEY, token);
  return token;
}

export default function HospitalPatientJoin() {
  const { department } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const joinCalledRef = useRef(false);
  const urlToken = searchParams.get("token") || null;
  const urlOrg = searchParams.get("org") || null;
  const urlRoom = searchParams.get("room") || null;
  const urlPt = searchParams.get("pt") || null;

  const dept = useMemo(() => {
    const found = HOSPITAL_DEPARTMENTS.find((d) => d.id === department);
    if (found) return found;
    if (department === "consultation")
      return { id: "consultation", labelKo: "진료실", label: "Consultation", icon: "🩺" };
    return null;
  }, [department]);

  // Language
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    return getLanguageByCode(saved)?.code || "";
  }, []);
  const [selectedLang, setSelectedLang] = useState(
    savedLang || detected?.code || "en"
  );
  const [showLangGrid, setShowLangGrid] = useState(true);
  const [step, setStep] = useState("language"); // 'language' | 'connecting' | 'error'
  const [error, setError] = useState("");
  const [isExistingSession, setIsExistingSession] = useState(false);

  const handleLangSelect = useCallback((code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
  }, []);

  // ── 통역 시작: 새 roomId 생성 → 서버에 등록 → ChatScreen 입장 ──
  const handleJoin = useCallback(async () => {
    if (joinCalledRef.current) return;
    joinCalledRef.current = true;
    setStep("connecting");
    setError("");

    try {
      const patientToken = urlToken ? String(urlToken).trim() : getOrCreatePatientToken();
      if (urlToken) localStorage.setItem(PATIENT_TOKEN_KEY, patientToken);
      const lang = selectedLang;
      const dept = department || "general";

      // 1. 환자 등록/업데이트
      await fetch("/api/hospital/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientToken, language: lang, department: dept }),
      });

      // 2. 새 room 생성 또는 진료실 입장 (서버가 roomId 반환)
      const joinBody = {
        department: department || dept?.id || "general",
        patientToken,
        language: lang,
        ...(urlOrg ? { org: urlOrg } : {}),
      };
      if ((department === "consultation" || dept?.id === "consultation") && urlRoom) {
        joinBody.room = urlRoom;
        const ptFromStorage = urlPt || (typeof localStorage !== "undefined" ? localStorage.getItem("mono_hospital_current_pt") : null);
        if (ptFromStorage) joinBody.pt = ptFromStorage;
      }
      const res = await fetch("/api/hospital/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(joinBody),
      });
      const data = await res.json();
      if (!data.success || !data.roomId) {
        throw new Error(data.error || "연결에 실패했습니다");
      }

      setIsExistingSession(data.isExistingSession === true);
      const roomId = data.roomId;
      const guestId = `guest_${uuidv4().slice(0, 8)}`;
      const cleanName = getPatientLabel(lang);

      // 3. localStorage에 언어 저장 + 접수 시 현재 PT 저장 (진료실 QR 스캔 시 재사용)
      localStorage.setItem("myLang", lang);
      if (typeof localStorage !== "undefined") localStorage.setItem("mono_hospital_current_pt", roomId);

      const isConsultationJoin = department === "consultation" && urlRoom;

      // 4. pending 메시지 조회 (직원이 보낸 오프라인 메시지)
      let pendingMessages = [];
      try {
        const pendingRes = await fetch(`/api/hospital/patient/${encodeURIComponent(patientToken)}/pending-messages`);
        const pendingData = await pendingRes.json().catch(() => ({}));
        if (pendingData.ok && Array.isArray(pendingData.messages)) pendingMessages = pendingData.messages;
      } catch (_) {}

      if (isConsultationJoin) {
        // 상담실: 환자 폰 → /fixed-room/:roomId (FixedRoomVAD, VAD)
        sessionStorage.setItem(
          "mono_guest",
          JSON.stringify({
            roomId,
            lang,
            name: cleanName,
            guestId,
            siteContext: "hospital_consultation",
            roomType: "oneToOne",
            joinedAt: Date.now(),
            patientToken,
          })
        );
        navigate(`/fixed-room/${roomId}`, {
          replace: true,
          state: {
            fromLang: lang,
            localName: cleanName,
            guestId,
            isGuest: true,
            isCreator: false,
            roleHint: "guest",
            siteContext: "hospital_consultation",
            roomType: "oneToOne",
            hospitalDept: dept,
            patientToken,
            sessionId: data.sessionId,
            pendingMessages,
          },
        });
        return;
      }

      // 접수처: 환자 폰 → /room/:roomId (ChatScreen, PTT)
      sessionStorage.setItem(
        "mono_guest",
        JSON.stringify({
          roomId,
          lang,
          name: cleanName,
          guestId,
          siteContext: `hospital_${dept}`,
          roomType: "oneToOne",
          joinedAt: Date.now(),
          patientToken,
        })
      );
      navigate(`/room/${roomId}`, {
        replace: true,
        state: {
          fromLang: lang,
          localName: cleanName,
          guestId,
          siteContext: `hospital_${department}`,
          roomType: "oneToOne",
          patientToken,
          pendingMessages,
        },
      });
    } catch (e) {
      console.error("[hospital:patient-join] error:", e);
      setError(e?.message || "연결에 실패했습니다. 다시 시도해주세요.");
      setStep("error");
      joinCalledRef.current = false;
    }
  }, [department, navigate, selectedLang, urlToken, urlOrg, urlRoom, urlPt]);

  // 진료실 QR 스캔 시 (consultation + room): 자동 join → /fixed-room/PT-XXX(VAD)로 이동
  const didAutoJoinRef = useRef(false);
  useEffect(() => {
    if (department !== "consultation" || !urlRoom || didAutoJoinRef.current || joinCalledRef.current) return;
    didAutoJoinRef.current = true;
    setStep("connecting");
    handleJoin();
  }, [department, urlRoom, handleJoin]);

  const isConsultationAutoJoin = department === "consultation" && urlRoom;

  // ── Render: Language Selection (진료실 자동 입장이면 건너뛰고 connecting 표시) ──
  if (step === "language") {
    if (isConsultationAutoJoin) {
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
            진료실 입장 중…
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }
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
          {department === "consultation"
            ? "진료실 입장 중…"
            : isExistingSession
              ? "이전 상담 채널에 다시 연결합니다"
              : "통역을 시작합니다"}
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
          onClick={() => {
            setStep("language");
            setShowLangGrid(true);
            joinCalledRef.current = false;
            didAutoJoinRef.current = false;
          }}
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
