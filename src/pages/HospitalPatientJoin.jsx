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
  const { department } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const joinCalledRef = useRef(false);
  const urlToken = searchParams.get("token") || null;
  const urlOrg = searchParams.get("org") || null;
  const urlRoom = searchParams.get("room") || null;
  const urlPt = searchParams.get("pt") || null;
  const urlInputMode = searchParams.get("inputMode") || null; // 'vad' | 'ptt' (상담실용)

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
  const [step, setStep] = useState("language"); // 'language' | 'connecting' | 'error' | 'patientWaiting'
  const [error, setError] = useState("");
  const [isExistingSession, setIsExistingSession] = useState(false);
  const [localHistoryOpen, setLocalHistoryOpen] = useState(false);
  const [localHistoryList, setLocalHistoryList] = useState([]);
  const [patientWaitingRoomId, setPatientWaitingRoomId] = useState(null);
  const [patientWaitingToken, setPatientWaitingToken] = useState(null);
  const [patientWaitingSessionId, setPatientWaitingSessionId] = useState(null);
  const [serverHistoryOpen, setServerHistoryOpen] = useState(false);
  const [serverHistory, setServerHistory] = useState({ sessions: [] });
  const [serverHistoryLoading, setServerHistoryLoading] = useState(false);

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
        // 상담실: 환자 폰은 방에 참여하지 않음. PT-XXXXXX 발급 후 대기 화면만 표시. 대화는 태블릿↔의사 PC 간에만 진행.
        setStep("patientWaiting");
        setPatientWaitingRoomId(roomId);
        setPatientWaitingToken(patientToken);
        setPatientWaitingSessionId(data.sessionId || null);
        return;
      }

      // 접수처(reception): 환자 폰 → /room/:roomId (ChatScreen, PTT) — 반드시 여기서 이동 후 종료
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
      return;
    } catch (e) {
      console.error("[hospital:patient-join] error:", e);
      setError(e?.message || "연결에 실패했습니다. 다시 시도해주세요.");
      setStep("error");
      joinCalledRef.current = false;
    }
  }, [department, navigate, selectedLang, urlToken, urlOrg, urlRoom, urlPt, urlInputMode]);

  // 상담실(consultation)도 접수처와 동일하게 언어 선택 후 "통역 시작" 클릭 시에만 join (자동 join 제거 → 언어 선택 화면 건너뛰기 방지)

  // ── Render: Language Selection ──
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
              background: "#2563EB",
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

  // ── Render: 상담실 환자 대기 (방 참여 없음, PT 번호 + 통역 기록 보기) ──
  if (step === "patientWaiting") {
    const loadServerHistory = async () => {
      const token = patientWaitingToken;
      if (!token) return;
      setServerHistoryLoading(true);
      setServerHistoryOpen(true);
      try {
        const res = await fetch(`/api/hospital/patient/${encodeURIComponent(token)}/history`);
        const data = await res.json().catch(() => ({}));
        setServerHistory({ sessions: data.sessions || [], found: data.found });
      } catch (_) {
        setServerHistory({ sessions: [], found: false });
      } finally {
        setServerHistoryLoading(false);
      }
    };
    const formatDate = (str) => {
      if (!str) return "";
      const d = new Date(str);
      return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    return (
      <div style={{ minHeight: "100dvh", background: "#f8fafc", display: "flex", flexDirection: "column", padding: "24px 20px" }}>
        <MonoLogo />
        <div style={{ marginTop: "24px", padding: "20px", background: "#fff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 8px" }}>통역 번호</p>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0, letterSpacing: "0.05em" }}>
            {patientWaitingRoomId || "—"}
          </p>
          <p style={{ fontSize: "13px", color: "#64748b", marginTop: "12px" }}>
            진료실에서 이 번호를 알려주시면 통역이 연결됩니다. 이 기기는 대기만 하시면 됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={loadServerHistory}
          style={{
            marginTop: "20px",
            padding: "14px 20px",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            background: "#fff",
            color: "#334155",
            fontSize: "15px",
            fontWeight: 500,
            cursor: "pointer",
            width: "100%",
          }}
        >
          내 통역 기록 보기
        </button>
        {serverHistoryOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 100,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
            onClick={() => setServerHistoryOpen(false)}
          >
            <div
              style={{
                background: "#fff",
                width: "100%",
                maxWidth: "480px",
                maxHeight: "80dvh",
                borderRadius: "16px 16px 0 0",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: "16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "16px", fontWeight: 600 }}>통역 기록</span>
                <button type="button" onClick={() => setServerHistoryOpen(false)} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}>×</button>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
                {serverHistoryLoading ? (
                  <p style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>불러오는 중…</p>
                ) : !serverHistory.sessions || serverHistory.sessions.length === 0 ? (
                  <p style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>저장된 통역 기록이 없습니다.</p>
                ) : (
                  serverHistory.sessions.map((sess) => (
                    <div key={sess.id || sess.room_id} style={{ marginBottom: "20px" }}>
                      <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "8px" }}>{formatDate(sess.started_at || sess.ended_at)} · {sess.room_id}</p>
                      <div style={{ background: "#f1f5f9", borderRadius: "10px", padding: "12px" }}>
                        {(sess.messages || []).map((msg) => (
                          <div key={msg.id} style={{ marginBottom: "8px", fontSize: "14px" }}>
                            <span style={{ color: "#64748b", marginRight: "6px" }}>{msg.sender_role === "host" ? "직원" : "환자"}:</span>
                            <span>{msg.translated_text || msg.original_text || ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
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
