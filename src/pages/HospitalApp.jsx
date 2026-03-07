// src/pages/HospitalApp.jsx — 병원 전용 진입
// 태블릿(kiosk): QR만 표시 (소켓 연결 없음) / 직원PC(staff): 대기 환자 목록 → 통역 시작 / 기본: 진료과 선택 → QR 표시
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useLocation, useNavigate as useNav, useSearchParams } from "react-router-dom";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import MonoLogo from "../components/MonoLogo";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import QRCode from "react-qr-code";
import socket from "../socket";
import { playNotificationSound } from "../audio/notificationSound";
import {
  ChevronLeft,
  Shield,
  ShieldOff,
  Copy,
  Download,
  AlertTriangle,
  RotateCcw,
  Check,
  ClipboardList,
  Tablet,
  Monitor,
  Bell,
  Users,
} from "lucide-react";

// ── Emergency quick phrases ──
const EMERGENCY_PHRASES = {
  ko: [
    "통증이 어디입니까?",
    "언제부터 아팠습니까?",
    "알레르기가 있습니까?",
    "현재 복용 중인 약이 있습니까?",
    "의식이 있습니까?",
    "숨쉬기 힘듭니까?",
    "출혈이 있습니까?",
  ],
  en: [
    "Where is the pain?",
    "When did the pain start?",
    "Do you have any allergies?",
    "Are you currently taking any medications?",
    "Are you conscious?",
    "Is it difficult to breathe?",
    "Is there any bleeding?",
  ],
};

function HospitalLogo() {
  return (
    <div className="flex items-center gap-3">
      <MonoLogo />
      <div className="flex flex-col min-w-0">
        <span className="text-[12px] font-bold text-[#7C6FEB] whitespace-nowrap">
          병원 관리
        </span>
        <span className="text-[10px] text-[var(--color-text-secondary)] whitespace-nowrap">
          Medical Interpreter
        </span>
      </div>
    </div>
  );
}

// ── Kiosk: 다국어 안내 문구 순환 ──
function KioskGuideText() {
  const messages = [
    "QR을 스캔하세요",
    "Scan QR Code",
    "扫描二维码",
    "Quét mã QR",
    "QRコードをスキャン",
  ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIdx((prev) => (prev + 1) % messages.length), 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="mt-6 text-[18px] font-medium text-[var(--color-text-secondary)] text-center animate-pulse h-[28px]">
      {messages[idx]}
    </p>
  );
}

export default function HospitalApp() {
  const location = useLocation();
  const navTo = useNav();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL에서 mode 읽기 ──
  const mode = searchParams.get("mode") || ""; // "kiosk" | "staff" | ""
  const urlDept = searchParams.get("dept") || "";

  // ── Language ──
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    if (saved) return getLanguageByCode(saved)?.code || "";
    return "";
  }, []);
  const initialLang = useMemo(() => savedLang || detected?.code || "ko", [detected, savedLang]);
  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [showLangGrid, setShowLangGrid] = useState(false);

  // ── Department ──
  const [selectedDept, setSelectedDept] = useState(() => {
    if (urlDept) return HOSPITAL_DEPARTMENTS.find((d) => d.id === urlDept) || null;
    return null;
  });
  const [step, setStep] = useState("department"); // 'department' | 'session' | 'summary'

  // ── States ──
  const [saveMode, setSaveMode] = useState(false);
  const [copiedPhrase, setCopiedPhrase] = useState("");

  // ── Summary ──
  const [summaryMessages, setSummaryMessages] = useState([]);
  const [summaryDept, setSummaryDept] = useState(null);
  const [summaryChart, setSummaryChart] = useState("");
  const [copiedSummary, setCopiedSummary] = useState(false);

  // ── PC layout ──
  const [isPC, setIsPC] = useState(
    typeof window !== "undefined" && window.innerWidth >= 1024
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const handler = (e) => setIsPC(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // ── URL에서 dept가 있으면 자동 세팅 (kiosk/staff 모드) ──
  useEffect(() => {
    if (urlDept && (mode === "kiosk" || mode === "staff")) {
      const dept = HOSPITAL_DEPARTMENTS.find((d) => d.id === urlDept);
      if (dept) {
        setSelectedDept(dept);
      }
    }
  }, [urlDept, mode]);

  // ── Detect return from ChatScreen ──
  useEffect(() => {
    if (location.state?.returnFromSession) {
      const msgs = location.state?.messages || [];
      setSummaryMessages(msgs);
      setSummaryDept(location.state?.hospitalDept || selectedDept);
      setSummaryChart(location.state?.chartNumber || "");
      if (msgs.length > 0) {
        setStep("summary");
      } else {
        setStep("department");
      }
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  // ═══════════════════════════════════════
  // MODE: KIOSK (태블릿 거치용 — QR만 표시, 소켓 연결 없음)
  // QR URL은 /hospital/join/{dept} (방 번호 없음, 진료과 정보만)
  // ═══════════════════════════════════════
  if (mode === "kiosk" && selectedDept) {
    const qrUrl = `${window.location.origin}/hospital/join/${encodeURIComponent(selectedDept.id)}`;
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center bg-white dark:bg-[#111] text-[var(--color-text)]"
        style={{ padding: "2rem" }}
      >
        {/* Logo */}
        <div className="mb-6">
          <MonoLogo />
        </div>

        {/* Dept info */}
        <div className="text-center mb-4">
          <span className="text-[64px] block mb-2">{selectedDept.icon}</span>
          <h2 className="text-[28px] font-bold">{selectedDept.labelKo}</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)]">{selectedDept.label}</p>
        </div>

        {/* QR — 소켓 연결 없음, 순수 QR만 표시 */}
        <div
          className="p-6 rounded-[20px]"
          style={{ backgroundColor: "#FFFFFF", boxShadow: "0 4px 24px rgba(0,0,0,0.10)" }}
        >
          <QRCode
            value={qrUrl}
            size={280}
            bgColor="#FFFFFF"
            fgColor="#3B82F6"
            level="M"
          />
        </div>

        {/* 안내 문구 */}
        <KioskGuideText />

        {/* Staff PC 모드 전환 링크 */}
        <p className="mt-6 text-[10px] text-[var(--color-text-secondary)]">
          직원 PC에서 접속:{" "}
          <span className="font-mono text-[#3B82F6]">
            /hospital?mode=staff&dept={selectedDept.id}
          </span>
        </p>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // MODE: STAFF (직원 PC — 대기 환자 목록 표시 → 통역 시작)
  // ═══════════════════════════════════════
  if (mode === "staff" && selectedDept) {
    return (
      <StaffModePanel
        selectedDept={selectedDept}
        selectedLang={selectedLang}
        setSelectedLang={setSelectedLang}
        showLangGrid={showLangGrid}
        setShowLangGrid={setShowLangGrid}
        saveMode={saveMode}
        navTo={navTo}
        onBack={() => {
          setSearchParams({});
          setSelectedDept(null);
        }}
      />
    );
  }

  // ═══════════════════════════════════════
  // HANDLERS (기본 모드용)
  // ═══════════════════════════════════════
  const handleDeptSelect = (dept) => {
    setSelectedDept(dept);
    if (!isPC) {
      setStep("session");
    }
  };

  const handleLangChange = (code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
  };

  const handleBackToDept = () => {
    setStep("department");
    setSelectedDept(null);
  };

  const handleNewSession = () => {
    setSummaryMessages([]);
    setSummaryDept(null);
    setSummaryChart("");
    setStep("department");
    setSelectedDept(null);
  };

  const handleCopyPhrase = (phrase) => {
    navigator.clipboard?.writeText(phrase).catch(() => {});
    setCopiedPhrase(phrase);
    setTimeout(() => setCopiedPhrase(""), 1500);
  };

  const handleCopySummary = () => {
    const text = summaryMessages
      .filter((m) => m.text || m.original)
      .map((m) => {
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
        const speaker = m.isMine ? "의료진" : "환자";
        return `[${time}] ${speaker}: ${m.original || m.text || ""}`;
      })
      .join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleDownloadSummary = () => {
    const lines = [
      `=== MONO Hospital - 진료 대화 요약 ===`,
      `진료과: ${summaryDept?.labelKo || selectedDept?.labelKo || "N/A"}`,
      `날짜: ${new Date().toLocaleString()}`,
      `언어: ${selectedLang}`,
      `---`,
      ...summaryMessages
        .filter((m) => m.text || m.original)
        .map((m) => {
          const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
          const speaker = m.isMine ? "의료진" : "환자";
          const orig = m.original || m.text || "";
          const translated = m.translated || "";
          return translated
            ? `[${time}] ${speaker}: ${orig}\n         → ${translated}`
            : `[${time}] ${speaker}: ${orig}`;
        }),
    ];
    const text = lines.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mono_hospital_session_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ════════════════════════════════════════════
  // STEP 3: Summary
  // ════════════════════════════════════════════
  if (step === "summary") {
    return (
      <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
        <div className="mx-auto w-full max-w-[520px] px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <HospitalLogo />
            <button type="button" onClick={handleNewSession}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#3B82F6] text-white text-[13px] font-medium hover:bg-[#2563EB] transition-colors">
              <RotateCcw size={14} /> 새 세션
            </button>
          </div>

          <div className="p-4 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-bg)] mb-4">
            <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-2">📋 진료 대화 요약</h2>
            <div className="text-[12px] text-[var(--color-text-secondary)] space-y-0.5">
              <p>진료과: {summaryDept?.labelKo || "N/A"} {summaryDept?.icon || ""}</p>
              <p>날짜: {new Date().toLocaleString()}</p>
              <p>대화 수: {summaryMessages.filter((m) => m.text || m.original).length}건</p>
            </div>
          </div>

          <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
            {summaryMessages.filter((m) => m.text || m.original).length === 0 ? (
              <p className="text-center text-[13px] text-[var(--color-text-secondary)] py-8">대화 기록이 없습니다.</p>
            ) : (
              summaryMessages.filter((m) => m.text || m.original).map((m, i) => {
                const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
                const speaker = m.isMine ? "🩺 의료진" : "🧑 환자";
                return (
                  <div key={i} className="p-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-medium">{speaker}</span>
                      <span className="text-[10px] text-[var(--color-text-secondary)]">{time}</span>
                    </div>
                    <p className="text-[13px] text-[var(--color-text)]">{m.original || m.text}</p>
                    {m.translated && <p className="text-[12px] text-[#3B82F6] mt-1">→ {m.translated}</p>}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={handleCopySummary}
              className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] border border-[var(--color-border)] text-[13px] font-medium">
              {copiedSummary ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copiedSummary ? "복사됨" : "텍스트 복사"}
            </button>
            <button type="button" onClick={handleDownloadSummary}
              className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] bg-[#3B82F6] text-white text-[13px] font-medium">
              <Download size={14} /> 파일 다운로드
            </button>
          </div>

          <div className="mt-8 text-center">
            <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // LEFT PANEL (Department Selection)
  // ════════════════════════════════════════════
  const leftPanelContent = (
    <>
      <div className="flex items-center justify-center mb-8"><HospitalLogo /></div>

      <div className="mb-6">
        <LanguageFlagPicker
          selectedLang={selectedLang}
          showGrid={showLangGrid}
          onToggleGrid={() => setShowLangGrid((prev) => !prev)}
          onSelect={handleLangChange}
        />
      </div>

      {!showLangGrid && (
        <div>
          <h2 className="text-[15px] font-semibold text-center mb-4 text-[var(--color-text)]">진료과 선택</h2>

          {/* Reception */}
          {HOSPITAL_DEPARTMENTS.filter((d) => d.id === "reception").map((dept) => (
            <button key={dept.id} type="button" onClick={() => handleDeptSelect(dept)}
              className={`w-full flex items-center gap-4 p-4 mb-3 rounded-[16px] border-2 transition-all active:scale-[0.98] ${
                selectedDept?.id === dept.id
                  ? "border-[#2563EB] bg-[#DBEAFE] dark:bg-[#1E4A7F] ring-2 ring-[#3B82F6]/30"
                  : "border-[#3B82F6] bg-[#EFF6FF] dark:bg-[#1E3A5F] hover:bg-[#DBEAFE] dark:hover:bg-[#1E4A7F]"
              }`}>
              <span className="text-[36px]">{dept.icon}</span>
              <div className="flex flex-col items-start text-left">
                <span className="text-[15px] font-semibold text-[var(--color-text)]">{dept.labelKo}</span>
                <span className="text-[11px] text-[#3B82F6] font-medium">{dept.label}</span>
                {dept.description && <span className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">{dept.description}</span>}
              </div>
            </button>
          ))}

          <div className="grid grid-cols-2 gap-3">
            {HOSPITAL_DEPARTMENTS.filter((d) => d.id !== "reception").map((dept) => (
              <button key={dept.id} type="button" onClick={() => handleDeptSelect(dept)}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-[16px] border transition-all active:scale-95 ${
                  selectedDept?.id === dept.id
                    ? "border-[#3B82F6] bg-[#DBEAFE] dark:bg-[#1E4A7F] ring-2 ring-[#3B82F6]/30"
                    : "border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]"
                }`}>
                <span className="text-[28px]">{dept.icon}</span>
                <span className="text-[13px] font-medium text-[var(--color-text)]">{dept.labelKo}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">{dept.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom buttons */}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => navTo("/hospital/records")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors">
          <ClipboardList size={16} /> 통역 기록 조회
        </button>
        <button type="button" onClick={() => navTo("/hospital-dashboard")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#3B82F6] text-[13px] font-medium text-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] transition-colors">
          <ClipboardList size={16} /> 관리 대시보드
        </button>
      </div>

      <div className="mt-4 text-center">
        <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
      </div>
    </>
  );

  // ════════════════════════════════════════════
  // PC RIGHT PANEL — QR Code (환자 join URL 기반)
  // ════════════════════════════════════════════
  const rightPanelContent = (
    <div className="flex flex-col items-center justify-center h-full px-8 py-8">
      {selectedDept ? (
        <>
          <div className="text-center mb-4">
            <span className="text-[56px] block mb-2">{selectedDept.icon}</span>
            <h2 className="text-[24px] font-bold text-[var(--color-text)] mb-1">{selectedDept.labelKo}</h2>
            <p className="text-[14px] text-[var(--color-text-secondary)]">{selectedDept.label}</p>
          </div>

          {/* QR Code — /hospital/join/{dept} 로 연결 (방 번호 없음) */}
          <div className="mb-4">
            <div
              className="p-4 rounded-[12px]"
              style={{ backgroundColor: "#FFFFFF", boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)" }}
            >
              <QRCode
                value={`${window.location.origin}/hospital/join/${encodeURIComponent(selectedDept.id)}`}
                size={200}
                bgColor="#FFFFFF"
                fgColor="#3B82F6"
                level="M"
              />
            </div>
          </div>

          {/* 모드 전환 버튼 */}
          <div className="flex gap-3 mt-2">
            <button type="button"
              onClick={() => window.open(`/hospital?mode=kiosk&dept=${selectedDept.id}`, "_blank")}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] transition-colors">
              <Tablet size={14} /> 태블릿 QR 열기
            </button>
            <button type="button"
              onClick={() => window.open(`/hospital?mode=staff&dept=${selectedDept.id}`, "_blank")}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[#3B82F6] text-[12px] font-medium text-[#3B82F6] hover:bg-[#EFF6FF] transition-colors">
              <Monitor size={14} /> 직원 PC 열기
            </button>
          </div>

          <p className="mt-4 text-[11px] text-[var(--color-text-secondary)] text-center max-w-[320px]">
            환자가 QR을 스캔하면 새로운 방이 자동 생성됩니다.
            <br />
            직원 PC에서 대기 환자를 확인하고 통역을 시작하세요.
          </p>
        </>
      ) : (
        <div className="text-center">
          <span className="text-[64px] block mb-4 opacity-30">🏥</span>
          <h3 className="text-[18px] font-semibold text-[var(--color-text)] mb-1 opacity-60">진료과를 선택하세요</h3>
          <p className="text-[12px] text-[var(--color-text-secondary)] opacity-50">
            왼쪽에서 진료과를 선택하면 QR 코드가 표시됩니다
          </p>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════
  // STEP 1: Department Selection
  // ════════════════════════════════════════════
  if (step === "department") {
    if (!isPC) {
      return (
        <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
          <div className="mx-auto w-full max-w-[480px] px-4 py-6">{leftPanelContent}</div>
        </div>
      );
    }

    return (
      <div className="text-[var(--color-text)]" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <div style={{ width: "40%", overflowY: "auto", background: "var(--color-bg)" }}>
          <div className="mx-auto w-full max-w-[480px] px-6 py-6">{leftPanelContent}</div>
        </div>
        <div style={{ width: "60%", overflowY: "auto", background: "var(--color-bg-secondary)", borderLeft: "1px solid var(--color-border)" }}>
          {rightPanelContent}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // STEP 2: Session Setup — Mobile only (QR 표시)
  // ════════════════════════════════════════════
  const mobileQrUrl = selectedDept
    ? `${window.location.origin}/hospital/join/${encodeURIComponent(selectedDept.id)}`
    : "";

  return (
    <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-[480px] px-4 py-4">
        <div className="flex items-center gap-3 mb-4">
          <button type="button" onClick={handleBackToDept}
            className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]">
            <ChevronLeft size={24} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">{selectedDept?.icon}</span>
              <span className="text-[16px] font-semibold text-[var(--color-text)]">{selectedDept?.labelKo}</span>
            </div>
            <span className="text-[11px] text-[var(--color-text-secondary)]">{selectedDept?.label}</span>
          </div>
          <HospitalLogo />
        </div>

        <div className="mb-4 flex items-center gap-3">
          <button type="button" onClick={() => setSaveMode(!saveMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium transition-colors ${
              saveMode ? "bg-[#DBEAFE] text-[#1D4ED8] border border-[#3B82F6]" : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}>
            {saveMode ? <Shield size={14} /> : <ShieldOff size={14} />}
            {saveMode ? "대화 저장 ON" : "무기록 모드"}
          </button>
          {selectedDept?.id === "emergency" && (
            <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium animate-pulse">
              <AlertTriangle size={12} /> 응급
            </span>
          )}
        </div>

        {selectedDept?.id === "emergency" && (
          <div className="mb-4 p-3 rounded-[12px] border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
            <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 mb-2 uppercase">⚡ 긴급 문구 (클릭하여 복사)</p>
            <div className="space-y-1">
              {(EMERGENCY_PHRASES[selectedLang] || EMERGENCY_PHRASES.en).map((phrase, i) => (
                <button key={i} type="button" onClick={() => handleCopyPhrase(phrase)}
                  className={`w-full text-left text-[12px] px-2 py-1.5 rounded transition-colors ${
                    copiedPhrase === phrase ? "bg-green-100 text-green-700" : "text-red-700 hover:bg-red-100"
                  }`}>
                  {copiedPhrase === phrase ? "✓ 복사됨" : phrase}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 px-3 py-2 rounded-[8px] bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <p className="text-[11px] text-blue-600 dark:text-blue-400">
            🧪 병원 모드: <strong>Groq Whisper Large V3</strong> 고정 (최고 품질 STT)
          </p>
          <p className="text-[10px] text-blue-500 mt-0.5">{selectedDept?.labelKo} 전문 의료 번역 프롬프트 적용 중</p>
        </div>

        {mobileQrUrl && (
          <div className="mb-4 flex flex-col items-center">
            <div
              className="p-4 rounded-[12px]"
              style={{ backgroundColor: "#FFFFFF", boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)" }}
            >
              <QRCode
                value={mobileQrUrl}
                size={200}
                bgColor="#FFFFFF"
                fgColor="#3B82F6"
                level="M"
              />
            </div>
            <p className="mt-3 text-[13px] text-[var(--color-text-secondary)] text-center">
              환자가 QR을 스캔하면 새로운 방이 자동 생성됩니다
            </p>
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
        </div>
      </div>
    </div>
  );
}

// ── Staff 모드: hospital:watch 소켓으로 대기 환자 실시간 수신 → 통역 시작 ──
function StaffModePanel({
  selectedDept,
  selectedLang,
  setSelectedLang,
  showLangGrid,
  setShowLangGrid,
  saveMode,
  navTo,
  onBack,
}) {
  const [waitingPatients, setWaitingPatients] = useState([]);
  const [staffJoined, setStaffJoined] = useState(false);
  const joinedRef = useRef(false);

  // ── 직원 PC: hospital:watch 소켓으로 대기 환자 구독 ──
  useEffect(() => {
    if (!selectedDept || joinedRef.current) return;
    joinedRef.current = true;

    const doWatch = () => {
      console.log(`[STAFF] Watching department: ${selectedDept.id}`);
      socket.emit("hospital:watch", { department: selectedDept.id });
      setStaffJoined(true);
    };

    if (socket.connected) doWatch();
    else socket.connect();

    const onConnect = () => doWatch();
    socket.on("connect", onConnect);

    return () => {
      socket.off("connect", onConnect);
      if (socket.connected && selectedDept) {
        socket.emit("hospital:unwatch", { department: selectedDept.id });
      }
      joinedRef.current = false;
    };
  }, [selectedDept]);

  // ── 환자 대기 알림 수신 ──
  useEffect(() => {
    if (!selectedDept) return;

    const onPatientWaiting = (data) => {
      console.log("[STAFF] Patient waiting:", data);
      playNotificationSound();

      // 브라우저 알림
      try {
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          new Notification("MONO Hospital", { body: "환자가 대기 중입니다" });
        }
        if (navigator?.vibrate) navigator.vibrate([200, 100, 200]);
      } catch {}

      setWaitingPatients((prev) => {
        // 중복 방지 (같은 roomId)
        if (prev.some((p) => p.roomId === data?.roomId)) return prev;
        return [...prev, {
          roomId: data?.roomId,
          department: data?.department || selectedDept.id,
          language: data?.language || "unknown",
          patientToken: data?.patientToken || null,
          createdAt: data?.createdAt || new Date().toISOString(),
        }];
      });
    };

    const onPatientPicked = (data) => {
      console.log("[STAFF] Patient picked:", data);
      setWaitingPatients((prev) => prev.filter((p) => p.roomId !== data?.roomId));
    };

    socket.on("hospital:patient-waiting", onPatientWaiting);
    socket.on("hospital:patient-picked", onPatientPicked);

    return () => {
      socket.off("hospital:patient-waiting", onPatientWaiting);
      socket.off("hospital:patient-picked", onPatientPicked);
    };
  }, [selectedDept]);

  // ── 통역 시작: 직원이 해당 roomId로 입장 (호스트) ──
  const handleStartInterpretation = async (patient) => {
    localStorage.setItem("myLang", selectedLang);
    const targetRoomId = patient.roomId;

    // 대기 목록에서 제거 (서버에도 알림)
    try {
      await fetch(`/api/hospital/waiting/${encodeURIComponent(targetRoomId)}`, { method: "DELETE" });
    } catch {}

    // 로컬 대기 목록에서 즉시 제거
    setWaitingPatients((prev) => prev.filter((p) => p.roomId !== targetRoomId));

    navTo(`/room/${targetRoomId}`, {
      state: {
        fromLang: selectedLang,
        localName: "",
        role: "Doctor",
        isCreator: true,      // 직원 = 호스트 (마이크/채팅 입력 활성화)
        siteContext: `hospital_${selectedDept.id}`,
        roomType: "oneToOne",
        hospitalDept: selectedDept,
        saveMode,
        patientToken: patient.patientToken || null,
      },
    });
  };

  // ── Notification 권한 요청 ──
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between max-w-[600px] mx-auto">
          <HospitalLogo />
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-[#DBEAFE] text-[#1D4ED8] text-[11px] font-semibold">
              <Monitor size={12} className="inline mr-1" />
              직원 모드
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 py-6 max-w-[600px] mx-auto w-full">
        {/* 진료과 정보 */}
        <div className="text-center mb-6">
          <span className="text-[48px] block mb-2">{selectedDept.icon}</span>
          <h2 className="text-[22px] font-bold mb-1">{selectedDept.labelKo}</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">{selectedDept.label}</p>
        </div>

        {/* 언어 선택 */}
        <div className="w-full max-w-[360px] mb-6">
          <LanguageFlagPicker
            selectedLang={selectedLang}
            showGrid={showLangGrid}
            onToggleGrid={() => setShowLangGrid((prev) => !prev)}
            onSelect={(code) => {
              setSelectedLang(code);
              localStorage.setItem("myLang", code);
              setShowLangGrid(false);
            }}
          />
        </div>

        {!showLangGrid && (
          <>
            {/* 연결 상태 */}
            <div className="w-full max-w-[400px] mb-4">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-[12px] font-medium ${
                staffJoined
                  ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
                  : "bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800"
              }`}>
                <span className={`w-2 h-2 rounded-full ${staffJoined ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
                {staffJoined ? "대기 중 — 환자 QR 스캔을 기다리고 있습니다" : "연결 중..."}
              </div>
            </div>

            {/* 대기 중인 환자 목록 */}
            {waitingPatients.length > 0 && (
              <div className="w-full max-w-[400px] mb-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Bell size={16} className="text-[#F59E0B] animate-bounce" />
                  <span className="text-[14px] font-semibold text-[var(--color-text)]">
                    대기 중인 환자 ({waitingPatients.length}명)
                  </span>
                </div>

                {waitingPatients.map((patient, idx) => {
                  const waitSec = Math.floor((Date.now() - new Date(patient.createdAt).getTime()) / 1000);
                  const langInfo = getLanguageByCode(patient.language);
                  return (
                    <div
                      key={patient.roomId || idx}
                      className="flex items-center justify-between p-4 rounded-[14px] border-2 border-[#F59E0B] bg-[#FFFBEB] dark:bg-[#422006] animate-pulse"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[28px]">🧑‍⚕️</span>
                        <div>
                          <p className="text-[14px] font-semibold text-[var(--color-text)]">
                            환자 #{idx + 1}
                          </p>
                          <p className="text-[11px] text-[var(--color-text-secondary)]">
                            언어: {langInfo?.name || patient.language} · 대기 {waitSec < 60 ? `${waitSec}초` : `${Math.floor(waitSec / 60)}분`}
                          </p>
                          {patient.patientToken && (
                            <p className="text-[10px] text-[var(--color-text-secondary)] font-mono">
                              {patient.patientToken}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartInterpretation(patient)}
                        className="px-5 py-2.5 rounded-[12px] bg-[#3B82F6] text-white text-[14px] font-semibold hover:bg-[#2563EB] active:scale-[0.97] transition-all flex items-center gap-2"
                      >
                        <Monitor size={16} />
                        통역 시작
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 환자 없을 때 안내 */}
            {waitingPatients.length === 0 && (
              <div className="w-full max-w-[400px] mb-4 p-6 rounded-[16px] border border-dashed border-[var(--color-border)] text-center">
                <Users size={32} className="mx-auto mb-3 text-[var(--color-text-secondary)] opacity-40" />
                <p className="text-[14px] text-[var(--color-text-secondary)]">
                  대기 중인 환자가 없습니다
                </p>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                  태블릿의 QR 코드를 환자가 스캔하면 여기에 알림이 표시됩니다
                </p>
              </div>
            )}

            {/* 뒤로가기 */}
            <button
              type="button"
              onClick={onBack}
              className="mt-4 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            >
              ← 진료과 다시 선택
            </button>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex-none py-3 text-center">
        <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
      </div>
    </div>
  );
}
