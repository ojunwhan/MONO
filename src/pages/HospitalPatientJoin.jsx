// src/pages/HospitalPatientJoin.jsx — 환자 QR 스캔 후 입장 페이지 (접수처/상담실/이동통역 통일)
// Public page: no authentication required. Patients must access without logging in.
// QR 스캔 → 언어 선택 → "통역 시작" → 기존 PT 있으면 재사용, 없으면 새 PT 발급 → ChatScreen PTT 입장
// patientToken을 localStorage에 저장하여 재방문 시 같은 환자로 인식
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import MonoLogo from "../components/MonoLogo";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import { getAllHospitalConversations } from "../db/hospitalConversations";

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
  const { orgCode } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const joinCalledRef = useRef(false);
  const urlToken = searchParams.get("token") || null;
  const urlOrg = searchParams.get("org") || null;

  const dept = useMemo(() => {
    const found = HOSPITAL_DEPARTMENTS.find((d) => d.id === orgCode);
    if (found) return found;
    if (orgCode === "consultation")
      return { id: "consultation", labelKo: "진료실", label: "Consultation", icon: "🩺" };
    return { id: orgCode || "general", labelKo: "병원 통역", label: "Hospital", icon: "🏥" };
  }, [orgCode]);

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
  const [step, setStep] = useState("language");
  const [error, setError] = useState("");
  const [isExistingSession, setIsExistingSession] = useState(false);
  const [localHistoryOpen, setLocalHistoryOpen] = useState(false);
  const [localHistoryList, setLocalHistoryList] = useState([]);
  const [patientName, setPatientName] = useState("");

  const handleLangSelect = useCallback((code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
  }, []);

  // ── 통역 시작: 기존 PT 재사용 또는 새 roomId 발급 → ChatScreen PTT 입장 ──
  const handleJoin = useCallback(async () => {
    if (joinCalledRef.current) return;
    joinCalledRef.current = true;
    setStep("connecting");
    setError("");

    try {
      const patientToken = urlToken ? String(urlToken).trim() : getOrCreatePatientToken();
      if (urlToken) localStorage.setItem(PATIENT_TOKEN_KEY, patientToken);
      const lang = selectedLang;

      await fetch("/api/hospital/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientToken, language: lang, department: orgCode, name: patientName.trim() }),
      });

      const joinBody = {
        department: orgCode,
        patientToken,
        language: lang,
        ...(urlOrg ? { org: urlOrg } : orgCode ? { org: orgCode } : {}),
      };
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

      localStorage.setItem("myLang", lang);
      if (typeof localStorage !== "undefined") localStorage.setItem("mono_hospital_current_pt", roomId);

      let pendingMessages = [];
      try {
        const historyRes = await fetch(`/api/hospital/patient/${encodeURIComponent(patientToken)}/history`);
        const historyData = await historyRes.json().catch(() => ({}));
        if (historyData.success && Array.isArray(historyData.messages)) pendingMessages = historyData.messages;
      } catch (_) {}

      sessionStorage.setItem(
        "mono_guest",
        JSON.stringify({
          roomId,
          lang,
          name: cleanName,
          guestId,
          siteContext: "hospital_reception",
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
          siteContext: "hospital_reception",
          roomType: "oneToOne",
          patientToken,
          pendingMessages,
          ...(data.sessionId ? { sessionId: data.sessionId } : {}),
        },
      });
    } catch (e) {
      console.error("[hospital:patient-join] error:", e);
      setError(e?.message || "연결에 실패했습니다. 다시 시도해주세요.");
      setStep("error");
      joinCalledRef.current = false;
    }
  }, [orgCode, navigate, selectedLang, urlToken, urlOrg, patientName]);
  if (step === "language") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
          boxSizing: "border-box",
          overflowY: "auto",
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
          <>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 14, color: "#666", marginBottom: 6, textAlign: "center" }}>
                Please enter your name (as shown on passport)
              </p>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="e.g. John Smith"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: 16,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  outline: "none",
                  boxSizing: "border-box",
                }}
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={handleJoin}
              disabled={!patientName.trim()}
              style={{
                width: "100%",
                maxWidth: "400px",
                height: "52px",
                borderRadius: "14px",
                border: "none",
                background: "#2563EB",
                color: "#ffffff",
                fontSize: "16px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s",
                opacity: !patientName.trim() ? 0.5 : 1,
              }}
            >
              통역 시작 / Start Interpretation
            </button>
          </>
        )}

        {/* 내 통역 기록 보기 (로컬 IndexedDB) */}
        <button
          type="button"
          onClick={async () => {
            setLocalHistoryOpen(true);
            const list = await getAllHospitalConversations();
            setLocalHistoryList(list || []);
          }}
          style={{
            marginTop: "16px",
            padding: "10px 20px",
            borderRadius: "10px",
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
            color: "#374151",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          내 통역 기록 보기
        </button>
        {localHistoryOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
            }}
            onClick={() => setLocalHistoryOpen(false)}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: "16px",
                maxWidth: "400px",
                width: "100%",
                maxHeight: "80vh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>내 통역 기록</h3>
                <button type="button" onClick={() => setLocalHistoryOpen(false)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280" }}>×</button>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: "12px" }}>
                {localHistoryList.length === 0 ? (
                  <p style={{ textAlign: "center", color: "#6b7280", fontSize: "14px", padding: "24px" }}>저장된 통역 기록이 없습니다.</p>
                ) : (
                  localHistoryList.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: "14px 16px",
                        marginBottom: "8px",
                        background: "#f3f4f6",
                        borderRadius: "12px",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "#1f2937" }}>{item.roomId}</div>
                      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                        {item.dateStr} · 대화 {item.messages?.length ?? 0}건
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
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
          minHeight: "100vh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
          boxSizing: "border-box",
          overflowY: "auto",
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
          {isExistingSession ? "이전 상담 채널에 다시 연결합니다" : "통역을 시작합니다"}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Render: Error ──
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        boxSizing: "border-box",
        overflowY: "auto",
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
