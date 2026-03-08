/**
 * OrgJoin — 기관/부서 전용 방문자(환자) 입장 페이지
 * URL: /org/:orgCode/:deptCode/join
 *
 * QR 스캔 후 진입. 언어 선택 → 방 생성 → ChatScreen/FixedRoomVAD 입장.
 * 기존 HospitalPatientJoin.jsx 흐름과 동일.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import MonoLogo from "../../components/MonoLogo";
import LanguageFlagPicker from "../../components/LanguageFlagPicker";
import { detectUserLanguage } from "../../constants/languageProfiles";
import { getLanguageByCode } from "../../constants/languages";

// ── "방문자" 다국어 라벨 ──
const VISITOR_LABEL = {
  ko: "방문자", en: "Visitor", ja: "訪問者", zh: "访客",
  vi: "Khách", th: "ผู้เยี่ยมชม", id: "Pengunjung", tl: "Bisita",
  mn: "Зочин", uz: "Tashrif buyuruvchi", ru: "Посетитель", ar: "زائر",
  es: "Visitante", ne: "आगन्तुक", my: "ဧည့်သည်", km: "អ្នកទស្សនា",
};

function getVisitorLabel(langCode) {
  const code = String(langCode || "en").toLowerCase().split("-")[0];
  return VISITOR_LABEL[code] || "Visitor";
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

export default function OrgJoin() {
  const { orgCode, deptCode } = useParams();
  const navigate = useNavigate();
  const joinCalledRef = useRef(false);

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState("");

  // Language
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const s = localStorage.getItem("myLang");
    return getLanguageByCode(s)?.code || "";
  }, []);
  const [selectedLang, setSelectedLang] = useState(savedLang || detected?.code || "en");
  const [showLangGrid, setShowLangGrid] = useState(!savedLang);
  const [langConfirmed, setLangConfirmed] = useState(!!savedLang);
  const [step, setStep] = useState("language"); // 'language' | 'connecting' | 'error'
  const [error, setError] = useState("");

  // ── config 로드 ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/org/${encodeURIComponent(orgCode)}/${encodeURIComponent(deptCode)}/config`);
        if (!res.ok) {
          setConfigError(res.status === 404 ? "기관 또는 부서를 찾을 수 없습니다" : "서버 오류");
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (data.ok) setConfig(data);
        else setConfigError(data.error || "설정 불러오기 실패");
      } catch {
        setConfigError("서버에 연결할 수 없습니다");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgCode, deptCode]);

  const handleLangSelect = useCallback((code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
    setLangConfirmed(true);
  }, []);

  // ── 통역 시작: 새 roomId 생성 → 서버에 등록 → 입장 ──
  const handleJoin = useCallback(async () => {
    if (joinCalledRef.current) return;
    joinCalledRef.current = true;
    setStep("connecting");
    setError("");

    try {
      const patientToken = getOrCreatePatientToken();
      const lang = selectedLang;

      // 1. 환자 등록/업데이트
      await fetch("/api/hospital/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientToken, language: lang, department: deptCode }),
      });

      // 2. 새 room 생성
      const res = await fetch("/api/hospital/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: deptCode,
          patientToken,
          language: lang,
          orgCode,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.roomId) {
        throw new Error(data.error || "연결에 실패했습니다");
      }

      const roomId = data.roomId;
      const guestId = `guest_${uuidv4().slice(0, 8)}`;
      const cleanName = getVisitorLabel(lang);

      localStorage.setItem("myLang", lang);

      // 번역 컨텍스트 결정
      const translateBlock = config?.pipeline?.translate || "gpt4o_general";
      let siteContext = "general";
      if (translateBlock.includes("hospital")) siteContext = `hospital_${deptCode}`;
      else if (translateBlock.includes("legal")) siteContext = `legal_${deptCode}`;
      else if (translateBlock.includes("industrial")) siteContext = `industrial_${deptCode}`;
      else siteContext = `org_${deptCode}`;

      // guest session 저장
      sessionStorage.setItem(
        "mono_guest",
        JSON.stringify({
          roomId,
          lang,
          name: cleanName,
          guestId,
          siteContext,
          roomType: "oneToOne",
          joinedAt: Date.now(),
          patientToken,
        })
      );

      // output 타입에 따라 다른 화면으로 진입
      const outputType = config?.pipeline?.output;
      const targetPath = outputType === "subtitle" || outputType === "chat_bubble"
        ? `/fixed-room/${roomId}`
        : `/room/${roomId}`;

      navigate(targetPath, {
        replace: true,
        state: {
          fromLang: lang,
          localName: cleanName,
          guestId,
          isGuest: true,
          isCreator: false,
          roleHint: "guest",
          siteContext,
          roomType: "oneToOne",
          hospitalDept: { id: deptCode, labelKo: config?.deptName, label: config?.deptNameEn || deptCode },
          patientToken,
          orgCode,
          deptCode,
        },
      });
    } catch (e) {
      console.error("[org-join] error:", e);
      setError(e?.message || "연결에 실패했습니다. 다시 시도해주세요.");
      setStep("error");
      joinCalledRef.current = false;
    }
  }, [config, deptCode, navigate, orgCode, selectedLang]);

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #e5e7eb", borderTopColor: "#3B82F6", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Config Error ──
  if (configError || !config) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff", padding: "32px 24px" }}>
        <MonoLogo />
        <p style={{ marginTop: 24, fontSize: 16, color: "#DC2626", fontWeight: 500 }}>⚠️ {configError || "설정 불러오기 실패"}</p>
      </div>
    );
  }

  // ── Language Selection ──
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
        <div style={{ marginBottom: "24px" }}>
          <MonoLogo />
        </div>

        {/* Org & Dept */}
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#1a1a1a", margin: "0 0 4px 0" }}>
            {config.orgName}
          </h2>
          <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
            {config.deptName}
            {config.deptNameEn ? ` · ${config.deptNameEn}` : ""}
          </p>
        </div>

        <p style={{ fontSize: "15px", color: "#374151", textAlign: "center", marginBottom: "16px", fontWeight: 500 }}>
          언어를 선택해주세요 / Select your language
        </p>

        <div style={{ width: "100%", maxWidth: "400px", marginBottom: "24px" }}>
          <LanguageFlagPicker
            selectedLang={selectedLang}
            showGrid={showLangGrid}
            onToggleGrid={() => {
              setShowLangGrid((prev) => {
                if (prev) setLangConfirmed(true);
                return !prev;
              });
            }}
            onSelect={handleLangSelect}
          />
        </div>

        {!showLangGrid && langConfirmed && (
          <button
            type="button"
            onClick={handleJoin}
            style={{
              width: "100%",
              maxWidth: "400px",
              height: "52px",
              borderRadius: "14px",
              border: "none",
              background: config.primaryColor || "#3B82F6",
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

        <div style={{ marginTop: "auto", paddingTop: "24px" }}>
          <p style={{ fontSize: "10px", color: "#9ca3af", textAlign: "center" }}>
            Powered by MONO Interpreter
          </p>
        </div>
      </div>
    );
  }

  // ── Connecting ──
  if (step === "connecting") {
    return (
      <div style={{ minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px" }}>
        <MonoLogo />
        <div style={{ marginTop: 32, width: 48, height: 48, border: "4px solid #e5e7eb", borderTopColor: config?.primaryColor || "#3B82F6", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        <p style={{ marginTop: 16, fontSize: 16, color: "#374151", fontWeight: 500 }}>연결 중... / Connecting...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Error ──
  return (
    <div style={{ minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px" }}>
      <MonoLogo />
      <div style={{ marginTop: 24, padding: "16px 24px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", textAlign: "center", maxWidth: 400, width: "100%" }}>
        <p style={{ fontSize: 14, color: "#DC2626", margin: "0 0 12px" }}>⚠️ {error}</p>
        <button
          type="button"
          onClick={() => { setStep("language"); setShowLangGrid(true); setLangConfirmed(false); joinCalledRef.current = false; }}
          style={{ padding: "8px 24px", borderRadius: 8, border: "1px solid #3B82F6", background: "#fff", color: "#3B82F6", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
        >
          다시 시도 / Retry
        </button>
      </div>
    </div>
  );
}
