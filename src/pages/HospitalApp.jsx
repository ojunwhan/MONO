// src/pages/HospitalApp.jsx
// /hospital?template=&room= → 직원 PC 통역 화면
// /hospital?template=&room=&kiosk=true → 키오스크 QR 화면
// 그 외 /hospital → /hospital-dashboard 리다이렉트
import { useEffect, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate as useNav, useSearchParams } from "react-router-dom";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import MonoLogo from "../components/MonoLogo";
import QRCode from "react-qr-code";
import socket from "../socket";
import { playNotificationSound } from "../audio/notificationSound";
import {
  Shield,
  ShieldOff,
  Copy,
  Download,
  RotateCcw,
  Check,
  Monitor,
  Bell,
  Users,
  FolderOpen,
} from "lucide-react";

function HospitalLogo() {
  return (
    <div className="flex items-center gap-3">
      <MonoLogo />
      <div className="flex flex-col min-w-0">
        <span className="text-[12px] font-bold text-[#7C6FEB] whitespace-nowrap">병원 관리</span>
        <span className="text-[10px] text-[var(--color-text-secondary)] whitespace-nowrap">Medical Interpreter</span>
      </div>
    </div>
  );
}

const IDB_STORE = "mono_fs_handles";
const IDB_KEY = "hospital_save_dir";

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("mono_hospital_fs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  const db = await openHandleDB();
  const tx = db.transaction(IDB_STORE, "readwrite");
  tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function loadDirHandle() {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    return new Promise((res) => { req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); });
  } catch { return null; }
}

function buildFileName(deptLabel) {
  const now = new Date();
  const d = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const t = [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join("-");
  const dept = (deptLabel || "일반").replace(/[/\\?*:|"<>]/g, "_");
  return `MONO_통역_${d}_${t}_${dept}.txt`;
}

function buildFileContent(messages, deptLabel, lang) {
  const now = new Date();
  const lines = [
    `=== MONO Hospital - 진료 대화 기록 ===`,
    `날짜: ${now.toLocaleDateString()}`, `시간: ${now.toLocaleTimeString()}`,
    `진료과: ${deptLabel || "N/A"}`, `언어: ${lang || "N/A"}`,
    `대화 수: ${messages.filter((m) => m.text || m.original).length}건`,
    `${"─".repeat(40)}`, "",
    ...messages.filter((m) => m.text || m.original).map((m) => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
      const speaker = m.isMine ? "의료진" : "환자";
      const orig = m.original || m.text || "";
      const translated = m.translated || "";
      return translated ? `[${time}] ${speaker}: ${orig}\n         → ${translated}` : `[${time}] ${speaker}: ${orig}`;
    }),
    "", `${"─".repeat(40)}`, `Powered by MONO Medical Interpreter`,
  ];
  return lines.join("\n");
}

async function autoSaveFile(content, fileName) {
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await loadDirHandle();
      if (dirHandle && (await dirHandle.queryPermission({ mode: "readwrite" })) === "granted" || (await dirHandle.requestPermission({ mode: "readwrite" })) === "granted") {
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(new Blob(["\uFEFF" + content], { type: "text/plain;charset=utf-8" }));
        await writable.close();
        return "folder";
      }
    } catch {}
  }
  const blob = new Blob(["\uFEFF" + content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  return "download";
}

function KioskGuideText() {
  const messages = ["QR을 스캔하세요", "Scan QR Code", "扫描二维码", "Quét mã QR", "QRコードをスキャン"];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((prev) => (prev + 1) % messages.length), 3000);
    return () => clearInterval(t);
  }, []);
  return <p className="mt-6 text-[18px] font-medium text-[var(--color-text-secondary)] text-center animate-pulse h-[28px]">{messages[idx]}</p>;
}

// 진료실 키오스크: QR 상시 표시 + patient-arrived 시 VAD 대화창으로 전환
function ConsultationKioskView({ template, urlRoom, roomName, staffDept, authUser, searchParams, navTo }) {
  const urlOrg = searchParams.get("org") || (authUser?.accountType === "organization" && authUser?.id ? authUser.id : "");
  const isConsultation = template === "consultation";
  const qrUrl = isConsultation
    ? `${window.location.origin}/hospital/join/consultation?room=${encodeURIComponent(urlRoom)}${urlOrg ? `&org=${encodeURIComponent(urlOrg)}` : ""}`
    : `${window.location.origin}/hospital/join/reception${urlOrg ? `?org=${encodeURIComponent(urlOrg)}` : ""}`;
  const displayName = roomName || staffDept.labelKo;

  useEffect(() => {
    if (!isConsultation || !urlRoom) return;
    socket.emit("hospital:consultation:watch", { consultationRoomId: urlRoom });
    const onArrived = (payload) => {
      if (payload?.consultationRoomId !== urlRoom || !payload?.roomId) return;
      const ptRoomId = payload.roomId;
      const fromLang = localStorage.getItem("myLang") || "ko";
      navTo(`/fixed-room/${ptRoomId}`, {
        replace: false,
        state: {
          fromLang,
          localName: "",
          isGuest: true,
          isCreator: false,
          roleHint: "guest",
          siteContext: "hospital_consultation",
          roomType: "oneToOne",
          hospitalDept: staffDept,
          hospitalTemplate: "consultation",
          saveMode: false,
          patientToken: payload.patientToken ?? null,
          sessionId: payload.sessionId ?? null,
          inputMode: "vad",
        },
      });
    };
    socket.on("hospital:patient-arrived", onArrived);
    return () => {
      socket.off("hospital:patient-arrived", onArrived);
      socket.emit("hospital:consultation:unwatch", { consultationRoomId: urlRoom });
    };
  }, [isConsultation, urlRoom, navTo, staffDept]);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-white dark:bg-[#111] text-[var(--color-text)]" style={{ padding: "2rem" }}>
      <div className="mb-6"><MonoLogo /></div>
      <div className="text-center mb-4">
        <span className="text-[64px] block mb-2">{staffDept.icon}</span>
        <h2 className="text-[28px] font-bold">{displayName}</h2>
        <p className="text-[14px] text-[var(--color-text-secondary)]">{staffDept.label}</p>
      </div>
      <div className="p-6 rounded-[20px]" style={{ backgroundColor: "#FFFFFF", boxShadow: "0 4px 24px rgba(0,0,0,0.10)" }}>
        <QRCode value={qrUrl} size={280} bgColor="#FFFFFF" fgColor="#3B82F6" level="M" />
      </div>
      <KioskGuideText />
    </div>
  );
}

export default function HospitalApp() {
  const location = useLocation();
  const navTo = useNav();
  const [searchParams] = useSearchParams();

  const template = searchParams.get("template") || "";
  const kiosk = searchParams.get("kiosk") === "true";
  const urlRoom = searchParams.get("room") || "";

  const hasStaffParams = template && urlRoom && !kiosk;
  const hasKioskParams = template && urlRoom && kiosk;
  const shouldRedirect = !hasStaffParams && !hasKioskParams;

  const [roomName, setRoomName] = useState(null);
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    if (saved) return getLanguageByCode(saved)?.code || "";
    return "";
  }, []);
  const initialLang = useMemo(() => savedLang || detected?.code || "ko", [detected, savedLang]);
  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [showLangGrid, setShowLangGrid] = useState(false);
  const [step, setStep] = useState("choose");

  const [authUser, setAuthUser] = useState(null);
  const [saveMode, setSaveMode] = useState(false);
  const [summaryMessages, setSummaryMessages] = useState([]);
  const [summaryDept, setSummaryDept] = useState(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [hasSaveDir, setHasSaveDir] = useState(false);
  const [saveDirName, setSaveDirName] = useState("");
  const [autoSaveResult, setAutoSaveResult] = useState("");
  const autoSaveTriggered = useRef(false);

  const staffDept = useMemo(
    () => (template === "reception" ? { id: "reception", labelKo: "접수", label: "Reception", icon: "🖥️" } : { id: "consultation", labelKo: "진료실", label: "Consultation", icon: "🩺" }),
    [template]
  );

  useEffect(() => {
    if (shouldRedirect) {
      navTo("/hospital-dashboard", { replace: true });
      return;
    }
  }, [shouldRedirect, navTo]);

  // 환자가 진료실 키오스크 URL을 스캔한 경우(폰): join URL로 리다이렉트 → HospitalPatientJoin → VAD
  useEffect(() => {
    if (!hasKioskParams || template !== "consultation" || !urlRoom) return;
    const w = typeof window !== "undefined" ? window.innerWidth : 1024;
    if (w > 768) return;
    const org = searchParams.get("org") || "";
    const joinUrl = `/hospital/join/consultation?room=${encodeURIComponent(urlRoom)}${org ? `&org=${encodeURIComponent(org)}` : ""}`;
    navTo(joinUrl, { replace: true });
  }, [hasKioskParams, template, urlRoom, searchParams, navTo]);

  useEffect(() => {
    if ((hasStaffParams || hasKioskParams) && urlRoom) {
      fetch("/api/hospital/rooms", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          if (data?.success && data?.rooms) {
            const r = data.rooms.find((x) => x.id === urlRoom);
            if (r?.name) setRoomName(r.name);
          }
        })
        .catch(() => {});
    }
  }, [hasStaffParams, hasKioskParams, urlRoom]);

  useEffect(() => {
    loadDirHandle().then((h) => { if (h) { setHasSaveDir(true); setSaveDirName(h.name || ""); } });
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { if (data?.user) setAuthUser(data.user); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (location.state?.returnFromSession) {
      const msgs = location.state?.messages || [];
      setSummaryMessages(msgs);
      setSummaryDept(location.state?.hospitalDept || staffDept);
      autoSaveTriggered.current = false;
      setAutoSaveResult("");
      setStep(msgs.length > 0 ? "summary" : "choose");
      window.history.replaceState({}, "");
    }
  }, [location.state, staffDept]);

  useEffect(() => {
    if (step !== "summary" || autoSaveTriggered.current) return;
    const filtered = summaryMessages.filter((m) => m.text || m.original);
    if (filtered.length === 0) return;
    autoSaveTriggered.current = true;
    const deptLabel = summaryDept?.labelKo || staffDept?.labelKo || "일반";
    autoSaveFile(buildFileContent(summaryMessages, deptLabel, selectedLang), buildFileName(deptLabel))
      .then(setAutoSaveResult).catch(() => setAutoSaveResult("none"));
  }, [step, summaryMessages, summaryDept, staffDept, selectedLang]);

  if (shouldRedirect) return null;

  if (step === "summary") {
    const handleNewSession = () => { setSummaryMessages([]); setSummaryDept(null); setStep("choose"); navTo("/hospital-dashboard", { replace: true }); };
    const handleCopySummary = () => {
      const text = summaryMessages.filter((m) => m.text || m.original).map((m) => `[${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ""}] ${m.isMine ? "의료진" : "환자"}: ${m.original || m.text || ""}`).join("\n");
      navigator.clipboard?.writeText(text).catch(() => {});
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    };
    const handleDownloadSummary = () => {
      const deptLabel = summaryDept?.labelKo || staffDept?.labelKo || "일반";
      autoSaveFile(buildFileContent(summaryMessages, deptLabel, selectedLang), buildFileName(deptLabel)).then(() => {}).catch(() => {});
    };
    return (
      <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
        <div className="mx-auto max-w-[520px] px-4 py-6">
          <div className="flex justify-between mb-6">
            <HospitalLogo />
            <button type="button" onClick={handleNewSession} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#3B82F6] text-white text-[13px] font-medium hover:bg-[#2563EB]">
              <RotateCcw size={14} /> 새 세션
            </button>
          </div>
          <div className="p-4 rounded-[16px] border border-[var(--color-border)] mb-4">
            <h2 className="text-[16px] font-semibold mb-2">📋 진료 대화 요약</h2>
            <p className="text-[12px] text-[var(--color-text-secondary)]">진료과: {summaryDept?.labelKo || "N/A"} · 대화 {summaryMessages.filter((m) => m.text || m.original).length}건</p>
          </div>
          <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
            {summaryMessages.filter((m) => m.text || m.original).map((m, i) => (
              <div key={i} className="p-3 rounded-[12px] border border-[var(--color-border)]">
                <p className="text-[13px]">{m.original || m.text}</p>
                {m.translated && <p className="text-[12px] text-[#3B82F6] mt-1">→ {m.translated}</p>}
              </div>
            ))}
          </div>
          {autoSaveResult === "folder" && <div className="mb-3 px-3 py-2 rounded-[8px] bg-green-50 dark:bg-green-950 border border-green-200"><p className="text-[11px] text-green-700 dark:text-green-400">✅ 지정 폴더에 저장됨</p></div>}
          {autoSaveResult === "download" && <div className="mb-3 px-3 py-2 rounded-[8px] bg-blue-50 dark:bg-blue-950 border border-blue-200"><p className="text-[11px] text-blue-700 dark:text-blue-400">✅ 다운로드 폴더에 저장됨</p></div>}
          <div className="flex gap-2">
            <button type="button" onClick={handleCopySummary} className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] border border-[var(--color-border)] text-[13px] font-medium">
              {copiedSummary ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}{copiedSummary ? "복사됨" : "텍스트 복사"}
            </button>
            <button type="button" onClick={handleDownloadSummary} className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] bg-[#3B82F6] text-white text-[13px] font-medium"><Download size={14} /> 파일 다운로드</button>
          </div>
          <button type="button" onClick={async () => { try { const h = await window.showDirectoryPicker?.({ mode: "readwrite" }); if (h) { await saveDirHandle(h); setHasSaveDir(true); setSaveDirName(h.name || ""); } } catch {} }}
            className="mt-3 w-full flex items-center justify-center gap-1.5 h-[40px] rounded-[12px] border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-text-secondary)]">
            <FolderOpen size={14} /> {hasSaveDir ? `저장 폴더: ${saveDirName || "지정됨"}` : "저장 폴더 지정"}
          </button>
          <p className="mt-8 text-center text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
        </div>
      </div>
    );
  }

  if (hasKioskParams) {
    return (
      <ConsultationKioskView
        template={template}
        urlRoom={urlRoom}
        roomName={roomName}
        staffDept={staffDept}
        authUser={authUser}
        searchParams={searchParams}
        navTo={navTo}
      />
    );
  }

  if (hasStaffParams) {
    return (
      <StaffModePanel
        template={template}
        selectedDept={staffDept}
        roomName={roomName}
        consultationRoomId={urlRoom || null}
        selectedLang={selectedLang}
        setSelectedLang={setSelectedLang}
        showLangGrid={showLangGrid}
        setShowLangGrid={setShowLangGrid}
        saveMode={saveMode}
        setSaveMode={setSaveMode}
        navTo={navTo}
        onBack={() => navTo("/hospital-dashboard")}
      />
    );
  }

  return null;
}

function StaffModePanel({ template, selectedDept, roomName, consultationRoomId, selectedLang, setSelectedLang, showLangGrid, setShowLangGrid, saveMode, setSaveMode, navTo, onBack }) {
  const [waitingPatients, setWaitingPatients] = useState([]);
  const [consultationRooms, setConsultationRooms] = useState([]);
  const [assignDropdownRoomId, setAssignDropdownRoomId] = useState(null);
  const [acceptedRoomIds, setAcceptedRoomIds] = useState(new Set());
  const [staffJoined, setStaffJoined] = useState(false);
  const joinedRef = useRef(false);
  const isReception = template === "reception";
  const isConsultationRoom = template === "consultation" && consultationRoomId;

  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    if (isConsultationRoom) {
      const doWatch = () => {
        socket.emit("hospital:consultation:watch", { consultationRoomId });
        setStaffJoined(true);
      };
      if (socket.connected) doWatch();
      else socket.connect();
      const onConnect = () => doWatch();
      socket.on("connect", onConnect);
      return () => {
        socket.off("connect", onConnect);
        if (socket.connected) socket.emit("hospital:consultation:unwatch", { consultationRoomId });
        joinedRef.current = false;
      };
    } else {
      if (!selectedDept) return;
      const doWatch = () => {
        socket.emit("hospital:watch", { department: selectedDept.id });
        setStaffJoined(true);
      };
      if (socket.connected) doWatch();
      else socket.connect();
      const onConnect = () => doWatch();
      socket.on("connect", onConnect);
      return () => {
        socket.off("connect", onConnect);
        if (socket.connected && selectedDept) socket.emit("hospital:unwatch", { department: selectedDept.id });
        joinedRef.current = false;
      };
    }
  }, [selectedDept, isConsultationRoom, consultationRoomId]);

  useEffect(() => {
    if (!isConsultationRoom) return;
    const fetchConsultationWaiting = () => {
      fetch(`/api/hospital/waiting?consultationRoom=${encodeURIComponent(consultationRoomId)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => { if (data.success && data.waiting) setWaitingPatients(data.waiting); })
        .catch(() => {});
    };
    fetchConsultationWaiting();
    const t = setInterval(fetchConsultationWaiting, 4000);
    return () => clearInterval(t);
  }, [isConsultationRoom, consultationRoomId]);

  useEffect(() => {
    if (isConsultationRoom) return;
    if (!selectedDept) return;
    const onPatientWaiting = (data) => {
      playNotificationSound();
      try {
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          new Notification("MONO Hospital", { body: "환자가 대기 중입니다" });
        }
        if (navigator?.vibrate) navigator.vibrate([200, 100, 200]);
      } catch {}
      setWaitingPatients((prev) =>
        prev.some((p) => p.roomId === data?.roomId)
          ? prev
          : [...prev, {
              roomId: data?.roomId,
              department: data?.department || selectedDept.id,
              language: data?.language || "unknown",
              patientToken: data?.patientToken != null ? data.patientToken : null,
              createdAt: data?.createdAt || new Date().toISOString(),
              sessionId: data?.sessionId ?? null,
            }]
      );
    };
    const onPatientPicked = (data) =>
      setWaitingPatients((prev) => prev.filter((p) => p.roomId !== data?.roomId));
    socket.on("hospital:patient-waiting", onPatientWaiting);
    socket.on("hospital:patient-picked", onPatientPicked);
    return () => { socket.off("hospital:patient-waiting", onPatientWaiting); socket.off("hospital:patient-picked", onPatientPicked); };
  }, [selectedDept, isConsultationRoom]);

  useEffect(() => {
    if (!isConsultationRoom) return;
    const onPatientAssigned = (data) => {
      playNotificationSound();
      setWaitingPatients((prev) =>
        prev.some((p) => p.roomId === data?.roomId)
          ? prev
          : [...prev, {
              roomId: data?.roomId,
              sessionId: data?.sessionId,
              patientToken: data?.patientToken,
              createdAt: data?.createdAt || new Date().toISOString(),
              consultationRoomName: data?.consultationRoomName,
            }]
      );
    };
    const onEnterConsultation = (data) => {
      if (data?.roomId) setAcceptedRoomIds((prev) => new Set(prev).add(data.roomId));
    };
    socket.on("hospital:patient-assigned", onPatientAssigned);
    socket.on("hospital:enter-consultation", onEnterConsultation);
    return () => {
      socket.off("hospital:patient-assigned", onPatientAssigned);
      socket.off("hospital:enter-consultation", onEnterConsultation);
    };
  }, [isConsultationRoom]);

  useEffect(() => {
    if (!isReception) return;
    fetch("/api/hospital/rooms", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.rooms) {
          setConsultationRooms((data.rooms || []).filter((r) => r.template === "consultation"));
        }
      })
      .catch(() => {});
  }, [isReception]);

  const handleAssignRoom = async (patient, room) => {
    try {
      const r = await fetch("/api/hospital/assign-room", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: patient.roomId, consultationRoomId: room.id }),
      });
      const data = await r.json();
      if (data.success) {
        setWaitingPatients((prev) => prev.filter((p) => p.roomId !== patient.roomId));
        setAssignDropdownRoomId(null);
      }
    } catch {}
  };

  const handleRequestEntry = (patient, consultationRoomName) => {
    socket.emit("hospital:request-consultation-entry", {
      roomId: patient.roomId,
      consultationRoomId,
      consultationRoomName: consultationRoomName || null,
    });
  };

  const handleStartInterpretation = async (patient) => {
    localStorage.setItem("myLang", selectedLang);
    const inputMode = template === "reception" ? "ptt" : "vad";
    let sessionId = null;
    try {
      const delRes = await fetch(`/api/hospital/waiting/${encodeURIComponent(patient.roomId)}`, { method: "DELETE" });
      const delData = await delRes.json().catch(() => ({}));
      sessionId = delData.sessionId ?? null;
    } catch {}
    if (sessionId == null) {
      try {
        const sessRes = await fetch(`/api/hospital/sessions?roomId=${encodeURIComponent(patient.roomId)}`);
        const sessData = await sessRes.json().catch(() => ({}));
        sessionId = sessData.sessionId ?? null;
      } catch {}
    }
    setWaitingPatients((prev) => prev.filter((p) => p.roomId !== patient.roomId));
    setAcceptedRoomIds((prev) => { const s = new Set(prev); s.delete(patient.roomId); return s; });
    navTo(`/fixed-room/${patient.roomId}`, {
      state: {
        fromLang: selectedLang,
        localName: "",
        role: "Doctor",
        isCreator: true,
        siteContext: `hospital_${selectedDept.id}`,
        roomType: "oneToOne",
        hospitalDept: selectedDept,
        hospitalTemplate: template,
        saveMode,
        patientToken: patient.patientToken ?? null,
        inputMode,
        ...(sessionId ? { sessionId } : {}),
      },
    });
  };

  useEffect(() => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); }, []);

  const displayTitle = roomName || selectedDept.labelKo;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="flex-none px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between max-w-[600px] mx-auto">
          <HospitalLogo />
          <span className="px-3 py-1 rounded-full bg-[#DBEAFE] text-[#1D4ED8] text-[11px] font-semibold">
            <Monitor size={12} className="inline mr-1" /> {template === "reception" ? "접수 모드" : "상담 모드"}
          </span>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center px-6 py-6 max-w-[600px] mx-auto w-full">
        <div className="text-center mb-6">
          <span className="text-[48px] block mb-2">{selectedDept.icon}</span>
          <h2 className="text-[22px] font-bold mb-1">{displayTitle}</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">{selectedDept.label}</p>
        </div>
        <div className="w-full max-w-[360px] mb-4">
          <LanguageFlagPicker selectedLang={selectedLang} showGrid={showLangGrid} onToggleGrid={() => setShowLangGrid((p) => !p)}
            onSelect={(code) => { setSelectedLang(code); localStorage.setItem("myLang", code); setShowLangGrid(false); }} />
        </div>
        <div className="w-full max-w-[360px] mb-4 flex items-center gap-3">
          <button type="button" onClick={() => setSaveMode(!saveMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium ${saveMode ? "bg-[#DBEAFE] text-[#1D4ED8] border border-[#3B82F6]" : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"}`}>
            {saveMode ? <Shield size={14} /> : <ShieldOff size={14} />}{saveMode ? "대화 저장 ON" : "무기록 모드"}
          </button>
        </div>
        {!showLangGrid && (
          <>
            <div className={`w-full max-w-[400px] mb-4 flex items-center gap-2 px-4 py-2 rounded-[10px] text-[12px] font-medium ${staffJoined ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border border-green-200" : "bg-yellow-50 dark:bg-yellow-950 text-yellow-700 border border-yellow-200"}`}>
              <span className={`w-2 h-2 rounded-full ${staffJoined ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
              {staffJoined ? "대기 중 — 환자 QR 스캔을 기다리고 있습니다" : "연결 중..."}
            </div>
            {waitingPatients.length > 0 && (
              <div className="w-full max-w-[400px] mb-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Bell size={16} className="text-[#F59E0B] animate-bounce" />
                  <span className="text-[14px] font-semibold">
                    {isConsultationRoom ? "대기 환자 (진료실 배정됨)" : "대기 중인 환자"} ({waitingPatients.length}명)
                  </span>
                </div>
                {waitingPatients.map((patient, idx) => {
                  const waitSec = Math.floor((Date.now() - new Date(patient.createdAt).getTime()) / 1000);
                  const langInfo = getLanguageByCode(patient.language);
                  const accepted = isConsultationRoom && acceptedRoomIds.has(patient.roomId);
                  const showAssignDropdown = isReception && assignDropdownRoomId === patient.roomId;
                  return (
                    <div key={patient.roomId || idx} className="flex flex-col p-4 rounded-[14px] border-2 border-[#F59E0B] bg-[#FFFBEB] dark:bg-[#422006]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[28px]">🧑‍⚕️</span>
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold font-mono">{patient.roomId}</p>
                            <p className="text-[11px] text-[var(--color-text-secondary)]">
                              입장 {patient.createdAt ? new Date(patient.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-"}
                              {!isConsultationRoom && langInfo && ` · ${langInfo.name}`}
                              {!isConsultationRoom && waitSec > 0 && ` · 대기 ${waitSec < 60 ? `${waitSec}초` : `${Math.floor(waitSec / 60)}분`}`}
                            </p>
                            {accepted && <p className="text-[11px] text-green-600 dark:text-green-400 font-medium mt-0.5">✓ 진료실 입장 수락됨</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isReception && (
                            <>
                              <button type="button" onClick={() => setAssignDropdownRoomId(showAssignDropdown ? null : patient.roomId)}
                                className="px-3 py-2 rounded-[10px] bg-amber-500 text-white text-[12px] font-medium hover:bg-amber-600">
                                진료실 배정
                              </button>
                              <button type="button" onClick={() => handleStartInterpretation(patient)}
                                className="px-4 py-2 rounded-[12px] bg-[#3B82F6] text-white text-[13px] font-semibold hover:bg-[#2563EB] flex items-center gap-2">
                                <Monitor size={14} /> 통역 시작
                              </button>
                            </>
                          )}
                          {isConsultationRoom && (
                            <>
                              <button type="button" onClick={() => handleRequestEntry(patient, patient.consultationRoomName)}
                                className="px-3 py-2 rounded-[10px] border border-[var(--color-border)] text-[12px] font-medium hover:bg-[var(--color-bg-secondary)]">
                                입장 요청
                              </button>
                              <button type="button" onClick={() => handleStartInterpretation(patient)}
                                className="px-4 py-2 rounded-[12px] bg-[#3B82F6] text-white text-[13px] font-semibold hover:bg-[#2563EB] flex items-center gap-2">
                                <Monitor size={14} /> 통역 시작
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {showAssignDropdown && consultationRooms.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800 flex flex-wrap gap-2">
                          {consultationRooms.map((room) => (
                            <button key={room.id} type="button" onClick={() => handleAssignRoom(patient, room)}
                              className="px-3 py-1.5 rounded-[8px] bg-white dark:bg-[var(--color-bg)] border border-[var(--color-border)] text-[12px] font-medium hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]">
                              {room.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {waitingPatients.length === 0 && (
              <div className="w-full max-w-[400px] mb-4 p-6 rounded-[16px] border border-dashed border-[var(--color-border)] text-center">
                <Users size={32} className="mx-auto mb-3 text-[var(--color-text-secondary)] opacity-40" />
                <p className="text-[14px] text-[var(--color-text-secondary)]">대기 중인 환자가 없습니다</p>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">태블릿 QR을 환자가 스캔하면 여기에 표시됩니다</p>
              </div>
            )}
            <button type="button" onClick={onBack} className="mt-4 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">← 대시보드로 돌아가기</button>
          </>
        )}
      </div>
      <div className="flex-none py-3 text-center"><p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p></div>
    </div>
  );
}
