// src/pages/HospitalApp.jsx — 병원 전용 진입 컴포넌트 (의료진 측)
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useLocation, useNavigate as useNav } from "react-router-dom";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import MonoLogo from "../components/MonoLogo";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import QRCodeBox from "../components/QRCodeBox";
import socket from "../socket";
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
  QrCode,
  Tablet,
  UserCheck,
  Clock,
  ExternalLink,
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

// ── Time ago helper ──
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

export default function HospitalApp() {
  const location = useLocation();
  const navTo = useNav();

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
  const [selectedDept, setSelectedDept] = useState(null);
  const [step, setStep] = useState("department"); // 'department' | 'session' | 'summary'

  // ── Session (mobile step 2 only) ──
  const [roomId, setRoomId] = useState("");
  const [hostPid, setHostPid] = useState("");
  const [hospitalSessionId, setHospitalSessionId] = useState("");
  const [saveMode, setSaveMode] = useState(false);
  const [chartNumber, setChartNumber] = useState("");
  const [copiedPhrase, setCopiedPhrase] = useState("");

  // ── Summary (returned from ChatScreen) ──
  const [summaryMessages, setSummaryMessages] = useState([]);
  const [summaryDept, setSummaryDept] = useState(null);
  const [summaryChart, setSummaryChart] = useState("");
  const [copiedSummary, setCopiedSummary] = useState(false);

  // ── Waiting patients (PC right panel) ──
  const [waitingPatients, setWaitingPatients] = useState([]);
  const watchedDeptRef = useRef(null);
  const timerRef = useRef(null);

  // ── PC layout detection ──
  const [isPC, setIsPC] = useState(
    typeof window !== "undefined" && window.innerWidth >= 1024
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const handler = (e) => setIsPC(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // ── Detect return from ChatScreen with session data ──
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

  // ── Generate room (for mobile session step) ──
  const generateRoom = useCallback(() => {
    const newRoomId = uuidv4();
    setRoomId(newRoomId);
    const pidKey = `mro.pid.${newRoomId}`;
    let pid = localStorage.getItem(pidKey);
    if (!pid) {
      pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem(pidKey, pid);
    }
    setHostPid(pid);
    return newRoomId;
  }, []);

  useEffect(() => {
    if (step !== "summary") generateRoom();
  }, [generateRoom, step]);

  // ── Create hospital session via API (mobile) ──
  const createHospitalSession = useCallback(async (newRoomId, dept) => {
    try {
      const res = await fetch("/api/hospital/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chartNumber: chartNumber || "0",
          roomId: newRoomId,
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

  // ── Socket: watch department for waiting patients (PC) ──
  useEffect(() => {
    if (!isPC || !selectedDept) return;
    const dept = selectedDept.id;

    // Unwatch previous
    if (watchedDeptRef.current && watchedDeptRef.current !== dept) {
      socket.emit("hospital:unwatch", { department: watchedDeptRef.current });
    }

    // Watch new department
    socket.emit("hospital:watch", { department: dept });
    watchedDeptRef.current = dept;

    // Also fetch current waiting list via API
    fetch(`/api/hospital/waiting?department=${encodeURIComponent(dept)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setWaitingPatients(data.waiting || []);
      })
      .catch(() => {});

    const onPatientWaiting = (data) => {
      if (data.department === dept) {
        setWaitingPatients((prev) => {
          // Avoid duplicates
          if (prev.some((p) => p.roomId === data.roomId)) return prev;
          return [...prev, data];
        });
      }
    };

    const onPatientPicked = (data) => {
      if (data.department === dept) {
        setWaitingPatients((prev) => prev.filter((p) => p.roomId !== data.roomId));
      }
    };

    socket.on("hospital:patient-waiting", onPatientWaiting);
    socket.on("hospital:patient-picked", onPatientPicked);

    return () => {
      socket.off("hospital:patient-waiting", onPatientWaiting);
      socket.off("hospital:patient-picked", onPatientPicked);
    };
  }, [isPC, selectedDept]);

  // Unwatch on unmount
  useEffect(() => {
    return () => {
      if (watchedDeptRef.current) {
        socket.emit("hospital:unwatch", { department: watchedDeptRef.current });
      }
    };
  }, []);

  // ── Refresh timeAgo display ──
  useEffect(() => {
    if (!isPC || waitingPatients.length === 0) return;
    timerRef.current = setInterval(() => {
      setWaitingPatients((prev) => [...prev]); // Force re-render
    }, 10000);
    return () => clearInterval(timerRef.current);
  }, [isPC, waitingPatients.length]);

  // ── Handlers ──
  const handleDeptSelect = (dept) => {
    setSelectedDept(dept);
    if (!isPC) {
      setStep("session");
      const newRoomId = generateRoom();
      createHospitalSession(newRoomId, dept);
    } else {
      // PC: just select dept, show waiting patients
      setWaitingPatients([]);
    }
  };

  const handleLangChange = (code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
    if (!isPC) generateRoom();
  };

  const handleBackToDept = () => {
    setStep("department");
    setSelectedDept(null);
    setChartNumber("");
    setHospitalSessionId("");
    generateRoom();
  };

  const handleNewSession = () => {
    setSummaryMessages([]);
    setSummaryDept(null);
    setSummaryChart("");
    setChartNumber("");
    setHospitalSessionId("");
    setStep("department");
    generateRoom();
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

  // ── Start interpretation with waiting patient (PC) ──
  const handleStartInterpretation = useCallback(async (patient) => {
    const rid = patient.roomId;
    // Remove from waiting list
    try {
      await fetch(`/api/hospital/waiting/${encodeURIComponent(rid)}`, { method: "DELETE" });
    } catch {}
    setWaitingPatients((prev) => prev.filter((p) => p.roomId !== rid));

    // Generate host pid for this room
    const pidKey = `mro.pid.${rid}`;
    let pid = localStorage.getItem(pidKey);
    if (!pid) {
      pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem(pidKey, pid);
    }

    // Navigate to chat as host
    navTo(`/room/${rid}`, {
      state: {
        fromLang: selectedLang,
        localName: "",
        role: "Doctor",
        isCreator: true,
        siteContext: `hospital_${selectedDept?.id || "general"}`,
        roomType: "oneToOne",
        hospitalDept: selectedDept,
        saveMode,
      },
    });
  }, [selectedLang, selectedDept, saveMode, navTo]);

  const handleOpenKiosk = useCallback(() => {
    if (!selectedDept) return;
    window.open(`/hospital/kiosk/${selectedDept.id}`, "_blank");
  }, [selectedDept]);

  // ════════════════════════════════════════════
  // STEP 3: Summary (after returning from session)
  // ════════════════════════════════════════════
  if (step === "summary") {
    return (
      <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
        <div className="mx-auto w-full max-w-[520px] px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <HospitalLogo />
            <button
              type="button"
              onClick={handleNewSession}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#3B82F6] text-white text-[13px] font-medium hover:bg-[#2563EB] transition-colors"
            >
              <RotateCcw size={14} />
              새 세션
            </button>
          </div>

          {/* Summary Header */}
          <div className="p-4 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-bg)] mb-4">
            <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-2">
              📋 진료 대화 요약
            </h2>
            <div className="text-[12px] text-[var(--color-text-secondary)] space-y-0.5">
              <p>진료과: {summaryDept?.labelKo || "N/A"} {summaryDept?.icon || ""}</p>
              <p>차트번호: {summaryChart || "N/A"}</p>
              <p>날짜: {new Date().toLocaleString()}</p>
              <p>대화 수: {summaryMessages.filter((m) => m.text || m.original).length}건</p>
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
            {summaryMessages.filter((m) => m.text || m.original).length === 0 ? (
              <p className="text-center text-[13px] text-[var(--color-text-secondary)] py-8">
                대화 기록이 없습니다.
              </p>
            ) : (
              summaryMessages
                .filter((m) => m.text || m.original)
                .map((m, i) => {
                  const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
                  const speaker = m.isMine ? "🩺 의료진" : "🧑 환자";
                  return (
                    <div
                      key={i}
                      className="p-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)]"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-medium">{speaker}</span>
                        <span className="text-[10px] text-[var(--color-text-secondary)]">{time}</span>
                      </div>
                      <p className="text-[13px] text-[var(--color-text)]">{m.original || m.text}</p>
                      {m.translated && (
                        <p className="text-[12px] text-[#3B82F6] mt-1">→ {m.translated}</p>
                      )}
                    </div>
                  );
                })
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] border border-[var(--color-border)] text-[13px] font-medium"
            >
              {copiedSummary ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copiedSummary ? "복사됨" : "텍스트 복사"}
            </button>
            <button
              type="button"
              onClick={handleDownloadSummary}
              className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] bg-[#3B82F6] text-white text-[13px] font-medium"
            >
              <Download size={14} />
              파일 다운로드
            </button>
          </div>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-[10px] text-[var(--color-text-secondary)]">
              Powered by MONO Medical Interpreter
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // DEPARTMENT SELECTION — shared content
  // ════════════════════════════════════════════

  // ── Left Panel Content (Department Selection) ──
  const leftPanelContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-center mb-8">
        <HospitalLogo />
      </div>

      {/* Language Selection */}
      <div className="mb-6">
        <LanguageFlagPicker
          selectedLang={selectedLang}
          showGrid={showLangGrid}
          onToggleGrid={() => setShowLangGrid((prev) => !prev)}
          onSelect={handleLangChange}
        />
      </div>

      {/* Department Grid */}
      {!showLangGrid && (
        <div>
          <h2 className="text-[15px] font-semibold text-center mb-4 text-[var(--color-text)]">
            진료과 선택
          </h2>
          {/* Reception card – full width at top */}
          {HOSPITAL_DEPARTMENTS.filter((d) => d.id === "reception").map((dept) => (
            <button
              key={dept.id}
              type="button"
              onClick={() => handleDeptSelect(dept)}
              className={`w-full flex items-center gap-4 p-4 mb-3 rounded-[16px] border-2 transition-all active:scale-[0.98] ${
                isPC && selectedDept?.id === dept.id
                  ? "border-[#2563EB] bg-[#DBEAFE] dark:bg-[#1E4A7F] ring-2 ring-[#3B82F6]/30"
                  : "border-[#3B82F6] bg-[#EFF6FF] dark:bg-[#1E3A5F] hover:bg-[#DBEAFE] dark:hover:bg-[#1E4A7F]"
              }`}
            >
              <span className="text-[36px]">{dept.icon}</span>
              <div className="flex flex-col items-start text-left">
                <span className="text-[15px] font-semibold text-[var(--color-text)]">
                  {dept.labelKo}
                </span>
                <span className="text-[11px] text-[#3B82F6] font-medium">
                  {dept.label}
                </span>
                {dept.description && (
                  <span className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                    {dept.description}
                  </span>
                )}
              </div>
            </button>
          ))}

          {/* Department grid */}
          <div className="grid grid-cols-2 gap-3">
            {HOSPITAL_DEPARTMENTS.filter((d) => d.id !== "reception").map((dept) => (
              <button
                key={dept.id}
                type="button"
                onClick={() => handleDeptSelect(dept)}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-[16px] border transition-all active:scale-95 ${
                  isPC && selectedDept?.id === dept.id
                    ? "border-[#3B82F6] bg-[#DBEAFE] dark:bg-[#1E4A7F] ring-2 ring-[#3B82F6]/30"
                    : "border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]"
                }`}
              >
                <span className="text-[28px]">{dept.icon}</span>
                <span className="text-[13px] font-medium text-[var(--color-text)]">
                  {dept.labelKo}
                </span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">
                  {dept.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Action Buttons */}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => navTo("/hospital/records")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
        >
          <ClipboardList size={16} />
          통역 기록 조회
        </button>
        <button
          type="button"
          onClick={() => navTo("/hospital-dashboard")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#3B82F6] text-[13px] font-medium text-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] transition-colors"
        >
          <ClipboardList size={16} />
          관리 대시보드
        </button>
      </div>

      {/* Footer */}
      <div className="mt-4 text-center">
        <p className="text-[10px] text-[var(--color-text-secondary)]">
          Powered by MONO Medical Interpreter
        </p>
      </div>
    </>
  );

  // ════════════════════════════════════════════
  // PC RIGHT PANEL — waiting patients + kiosk setup
  // ════════════════════════════════════════════
  const rightPanelContent = (
    <div className="flex flex-col h-full px-8 py-8">
      {selectedDept ? (
        <>
          {/* Selected Department Info */}
          <div className="text-center mb-6">
            <span className="text-[56px] block mb-2">{selectedDept.icon}</span>
            <h2 className="text-[24px] font-bold text-[var(--color-text)] mb-1">
              {selectedDept.labelKo}
            </h2>
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              {selectedDept.label}
            </p>
          </div>

          {/* Tablet QR Setup Button */}
          <button
            type="button"
            onClick={handleOpenKiosk}
            className="mx-auto flex items-center gap-2 px-6 py-3 rounded-[14px] bg-[#3B82F6] text-white text-[14px] font-semibold hover:bg-[#2563EB] transition-colors mb-6"
          >
            <Tablet size={18} />
            태블릿 QR 설정
            <ExternalLink size={14} className="opacity-60" />
          </button>

          {/* Divider */}
          <div className="w-full border-t border-[var(--color-border)] mb-6" />

          {/* Waiting Patients Section */}
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
              <UserCheck size={18} className="text-[#3B82F6]" />
              대기 중인 환자
              {waitingPatients.length > 0 && (
                <span className="ml-2 px-2.5 py-0.5 rounded-full bg-[#EF4444] text-white text-[12px] font-bold animate-pulse">
                  {waitingPatients.length}
                </span>
              )}
            </h3>

            {waitingPatients.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-bg)] border-2 border-dashed border-[var(--color-border)] flex items-center justify-center">
                  <Clock size={24} className="text-[var(--color-text-secondary)] opacity-40" />
                </div>
                <p className="text-[14px] text-[var(--color-text-secondary)]">
                  현재 대기 중인 환자가 없습니다
                </p>
                <p className="text-[12px] text-[var(--color-text-secondary)] mt-1 opacity-60">
                  환자가 QR 코드를 스캔하면 여기에 표시됩니다
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {waitingPatients.map((patient, i) => (
                  <div
                    key={patient.roomId}
                    className="flex items-center justify-between p-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[#3B82F6] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A5F] flex items-center justify-center text-[#3B82F6] font-bold text-[14px]">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-[var(--color-text)]">
                          환자 #{i + 1}
                        </p>
                        <p className="text-[11px] text-[var(--color-text-secondary)] flex items-center gap-1">
                          <Clock size={10} />
                          {timeAgo(patient.createdAt)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartInterpretation(patient)}
                      className="px-4 py-2 rounded-[10px] bg-[#3B82F6] text-white text-[13px] font-semibold hover:bg-[#2563EB] transition-colors"
                    >
                      통역 시작
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hint */}
          <div className="mt-4 text-center">
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              태블릿에 QR을 표시하면 환자가 스캔하여 자동으로 대기 목록에 추가됩니다
            </p>
          </div>
        </>
      ) : (
        /* Empty State — no dept selected yet */
        <div className="flex flex-col items-center justify-center h-full">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-[var(--color-border)] flex items-center justify-center opacity-40">
            <QrCode size={48} strokeWidth={1} />
          </div>
          <h3 className="text-[20px] font-semibold text-[var(--color-text)] mb-2 opacity-60">
            진료과를 선택하세요
          </h3>
          <p className="text-[13px] text-[var(--color-text-secondary)] opacity-50 text-center">
            왼쪽에서 진료과를 선택하면
            <br />
            대기 환자 목록이 여기에 표시됩니다
          </p>
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════
  // STEP 1: Department Selection
  // ════════════════════════════════════════════
  if (step === "department") {
    // ── Mobile: original single-column ──
    if (!isPC) {
      return (
        <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
          <div className="mx-auto w-full max-w-[480px] px-4 py-6">
            {leftPanelContent}
          </div>
        </div>
      );
    }

    // ── PC: two-column layout ──
    return (
      <div
        className="text-[var(--color-text)]"
        style={{ display: "flex", height: "100vh", overflow: "hidden" }}
      >
        {/* Left Panel */}
        <div
          style={{
            width: "40%",
            overflowY: "auto",
            background: "var(--color-bg)",
          }}
        >
          <div className="mx-auto w-full max-w-[480px] px-6 py-6">
            {leftPanelContent}
          </div>
        </div>
        {/* Right Panel */}
        <div
          style={{
            width: "60%",
            overflowY: "auto",
            background: "var(--color-bg-secondary)",
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          {rightPanelContent}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // STEP 2: Session Setup — Mobile only (QR + Controls)
  // ════════════════════════════════════════════
  return (
    <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-[480px] px-4 py-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={handleBackToDept}
            className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">{selectedDept?.icon}</span>
              <span className="text-[16px] font-semibold text-[var(--color-text)]">
                {selectedDept?.labelKo}
              </span>
            </div>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              {selectedDept?.label}
            </span>
          </div>
          <HospitalLogo />
        </div>

        {/* Chart Number Input */}
        <div className="mb-4 p-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)]">
          <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5 uppercase">
            차트번호 (선택)
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={chartNumber}
            onChange={(e) => setChartNumber(e.target.value.replace(/\D/g, ""))}
            placeholder="환자 차트번호 입력"
            className="w-full h-[40px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[14px] focus:outline-none focus:border-[#3B82F6]"
          />
        </div>

        {/* Record Mode Toggle */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSaveMode(!saveMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium transition-colors ${
              saveMode
                ? "bg-[#DBEAFE] text-[#1D4ED8] border border-[#3B82F6]"
                : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}
          >
            {saveMode ? <Shield size={14} /> : <ShieldOff size={14} />}
            {saveMode ? "대화 저장 ON" : "무기록 모드"}
          </button>

          {selectedDept?.id === "emergency" && (
            <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium animate-pulse">
              <AlertTriangle size={12} />
              응급
            </span>
          )}
        </div>

        {/* Emergency Quick Phrases */}
        {selectedDept?.id === "emergency" && (
          <div className="mb-4 p-3 rounded-[12px] border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
            <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 mb-2 uppercase">
              ⚡ 긴급 문구 (클릭하여 복사)
            </p>
            <div className="space-y-1">
              {(EMERGENCY_PHRASES[selectedLang] || EMERGENCY_PHRASES.en).map((phrase, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleCopyPhrase(phrase)}
                  className={`w-full text-left text-[12px] px-2 py-1.5 rounded transition-colors ${
                    copiedPhrase === phrase
                      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : "text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900"
                  }`}
                >
                  {copiedPhrase === phrase ? "✓ 복사됨" : phrase}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Info banner - STT Model */}
        <div className="mb-4 px-3 py-2 rounded-[8px] bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <p className="text-[11px] text-blue-600 dark:text-blue-400">
            🧪 병원 모드: <strong>Groq Whisper Large V3</strong> 고정 (최고 품질 STT)
          </p>
          <p className="text-[10px] text-blue-500 dark:text-blue-500 mt-0.5">
            {selectedDept?.labelKo} 전문 의료 번역 프롬프트 적용 중
          </p>
        </div>

        {/* QR Code */}
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

        {/* Hint */}
        <div className="text-center mt-2">
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            환자가 QR 코드를 스캔하면 자동으로 통역 세션이 시작됩니다
          </p>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-[10px] text-[var(--color-text-secondary)]">
            Powered by MONO Medical Interpreter
          </p>
        </div>
      </div>
    </div>
  );
}
