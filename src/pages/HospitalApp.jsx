// src/pages/HospitalApp.jsx — 병원 전용 진입
// 태블릿(kiosk): QR 표시 호스트 / 직원PC(staff): 같은 방 join / 기본: 모바일 플로우
import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, useNavigate as useNav, useSearchParams } from "react-router-dom";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import MonoLogo from "../components/MonoLogo";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import QRCodeBox from "../components/QRCodeBox";
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
} from "lucide-react";

// ── 고정 roomId 생성 ──
const HOSPITAL_ID = "default"; // 나중에 멀티 병원 지원 시 .env 또는 설정으로
function makeFixedRoomId(department) {
  return `hospital_${HOSPITAL_ID}_${department}`;
}

// ── 고정 PID (기기별로 localStorage에 저장) ──
function getOrCreatePid(roomId) {
  const pidKey = `mro.pid.${roomId}`;
  let pid = localStorage.getItem(pidKey);
  if (!pid) {
    pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    localStorage.setItem(pidKey, pid);
  }
  return pid;
}

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

  // ── Room (고정 roomId) ──
  const [roomId, setRoomId] = useState("");
  const [hostPid, setHostPid] = useState("");
  const [hospitalSessionId, setHospitalSessionId] = useState("");
  const [saveMode, setSaveMode] = useState(false);
  const [chartNumber, setChartNumber] = useState("");
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

  // ── Detect return from ChatScreen ──
  useEffect(() => {
    if (location.state?.returnFromSession) {
      const msgs = location.state?.messages || [];
      setSummaryMessages(msgs);
      setSummaryDept(selectedDept);
      setSummaryChart(chartNumber);
      if (msgs.length > 0) {
        setStep("summary");
      } else {
        setStep("department");
      }
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  // ── 진료과 선택 시 고정 roomId 세팅 ──
  const setupFixedRoom = useCallback((dept) => {
    const fixedRoomId = makeFixedRoomId(dept.id);
    setRoomId(fixedRoomId);
    const pid = getOrCreatePid(fixedRoomId);
    setHostPid(pid);
    return fixedRoomId;
  }, []);

  // ── URL에서 dept가 있으면 자동 세팅 (kiosk/staff 모드) ──
  useEffect(() => {
    if (urlDept && (mode === "kiosk" || mode === "staff")) {
      const dept = HOSPITAL_DEPARTMENTS.find((d) => d.id === urlDept);
      if (dept) {
        setSelectedDept(dept);
        setupFixedRoom(dept);
      }
    }
  }, [urlDept, mode, setupFixedRoom]);

  // ── Create hospital session via API ──
  const createHospitalSession = useCallback(async (rid, dept) => {
    try {
      const res = await fetch("/api/hospital/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chartNumber: chartNumber || "0",
          roomId: rid,
          department: dept?.id || "general",
          hostLang: selectedLang,
          stationId: dept?.id || "default",
        }),
      });
      const data = await res.json();
      if (data.success && data.sessionId) {
        setHospitalSessionId(data.sessionId);
        console.log("[hospital] Session created:", data.sessionId);
      }
    } catch (e) {
      console.warn("[hospital] Session creation failed:", e?.message);
    }
  }, [chartNumber, selectedLang]);

  // ═══════════════════════════════════════
  // MODE: KIOSK (태블릿 거치용)
  // ═══════════════════════════════════════
  if (mode === "kiosk" && selectedDept && roomId && hostPid) {
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

        {/* QR — onGuestJoined 콜백으로 navigate 방지 */}
        <QRCodeBox
          key={roomId}
          roomId={roomId}
          fromLang={selectedLang}
          participantId={hostPid}
          siteContext={`hospital_${selectedDept.id}`}
          role="Doctor"
          localName=""
          roomType="oneToOne"
          hospitalDept={selectedDept}
          saveMode={saveMode}
          onGuestJoined={({ roomId: rid, reason }) => {
            console.log(`[KIOSK] Guest joined room=${rid} reason=${reason} — staying on QR`);
          }}
        />

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
  // MODE: STAFF (직원 PC — 같은 방에 join)
  // ═══════════════════════════════════════
  if (mode === "staff" && selectedDept && roomId) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="mb-6">
          <HospitalLogo />
        </div>

        <div className="text-center mb-6">
          <span className="text-[48px] block mb-2">{selectedDept.icon}</span>
          <h2 className="text-[22px] font-bold mb-1">{selectedDept.labelKo}</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            직원 모드 — 태블릿과 같은 방에서 대기합니다
          </p>
        </div>

        {/* Language picker */}
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
            {/* 통역 시작 버튼 → 같은 고정 roomId의 /room/:roomId로 이동 */}
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("myLang", selectedLang);
                navTo(`/room/${roomId}`, {
                  state: {
                    fromLang: selectedLang,
                    localName: "",
                    role: "Doctor",
                    isCreator: false,
                    siteContext: `hospital_${selectedDept.id}`,
                    roomType: "oneToOne",
                    hospitalDept: selectedDept,
                    saveMode,
                  },
                });
              }}
              className="w-full max-w-[320px] h-[52px] rounded-[14px] bg-[#3B82F6] text-white text-[16px] font-semibold hover:bg-[#2563EB] transition-colors flex items-center justify-center gap-2"
            >
              <Monitor size={20} />
              통역 시작 (방 참여)
            </button>

            <p className="mt-4 text-[11px] text-[var(--color-text-secondary)] text-center max-w-[300px]">
              태블릿에 QR이 표시된 상태에서 이 버튼을 누르면
              같은 방에 참여하여 통역을 진행합니다.
            </p>

            {/* 뒤로가기 */}
            <button
              type="button"
              onClick={() => {
                setSearchParams({});
                setSelectedDept(null);
                setRoomId("");
                setHostPid("");
              }}
              className="mt-6 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            >
              ← 진료과 다시 선택
            </button>
          </>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════
  // HANDLERS (기본 모드용)
  // ═══════════════════════════════════════
  const handleDeptSelect = (dept) => {
    setSelectedDept(dept);
    const rid = setupFixedRoom(dept);
    createHospitalSession(rid, dept);

    if (!isPC) {
      setStep("session");
    }
  };

  const handleLangChange = (code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
    if (selectedDept) {
      const rid = setupFixedRoom(selectedDept);
      createHospitalSession(rid, selectedDept);
    }
  };

  const handleBackToDept = () => {
    setStep("department");
    setSelectedDept(null);
    setChartNumber("");
    setHospitalSessionId("");
    setRoomId("");
    setHostPid("");
  };

  const handleNewSession = () => {
    setSummaryMessages([]);
    setSummaryDept(null);
    setSummaryChart("");
    setChartNumber("");
    setHospitalSessionId("");
    setStep("department");
    setSelectedDept(null);
    setRoomId("");
    setHostPid("");
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
      `차트번호: ${summaryChart || chartNumber || "N/A"}`,
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
    a.download = `mono_hospital_${summaryChart || chartNumber || "session"}_${Date.now()}.txt`;
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
              <p>차트번호: {summaryChart || "N/A"}</p>
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
  // PC RIGHT PANEL — QR Code (고정 roomId)
  // ════════════════════════════════════════════
  const rightPanelContent = (
    <div className="flex flex-col items-center justify-center h-full px-8 py-8">
      {selectedDept && roomId && hostPid ? (
        <>
          <div className="text-center mb-4">
            <span className="text-[56px] block mb-2">{selectedDept.icon}</span>
            <h2 className="text-[24px] font-bold text-[var(--color-text)] mb-1">{selectedDept.labelKo}</h2>
            <p className="text-[14px] text-[var(--color-text-secondary)]">{selectedDept.label}</p>
          </div>

          {/* QR Code — 기존 QRCodeBox 그대로 */}
          <div className="mb-4">
            <QRCodeBox
              key={roomId}
              roomId={roomId}
              fromLang={selectedLang}
              participantId={hostPid}
              siteContext={`hospital_${selectedDept.id}`}
              role="Doctor"
              localName=""
              roomType="oneToOne"
              chartNumber={chartNumber}
              stationId={selectedDept.id}
              hospitalSessionId={hospitalSessionId}
              hospitalDept={selectedDept}
              saveMode={saveMode}
            />
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
            고정 QR: 태블릿·직원PC·환자 모두 같은 방에 연결됩니다.
            <br />
            <span className="font-mono text-[10px] text-[#3B82F6]">Room: {roomId}</span>
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
  // STEP 2: Session Setup — Mobile only
  // ════════════════════════════════════════════
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

        <div className="mb-4 p-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)]">
          <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase">차트번호 (선택)</label>
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={chartNumber}
            onChange={(e) => setChartNumber(e.target.value.replace(/\D/g, ""))} placeholder="환자 차트번호 입력"
            className="w-full h-[40px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[14px] focus:outline-none focus:border-[#3B82F6]" />
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

        {roomId && hostPid && (
          <div className="mb-4">
            <QRCodeBox
              key={roomId}
              roomId={roomId}
              fromLang={selectedLang}
              participantId={hostPid}
              siteContext={`hospital_${selectedDept?.id || "general"}`}
              role="Doctor"
              localName=""
              roomType="oneToOne"
              chartNumber={chartNumber}
              stationId={selectedDept?.id || ""}
              hospitalSessionId={hospitalSessionId}
              hospitalDept={selectedDept}
              saveMode={saveMode}
            />
          </div>
        )}

        <div className="text-center mt-2">
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            환자가 QR 코드를 스캔하면 자동으로 통역 세션이 시작됩니다
          </p>
          <p className="mt-1 text-[10px] text-[#3B82F6] font-mono">{roomId}</p>
        </div>

        <div className="mt-8 text-center">
          <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
        </div>
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
