// src/pages/HospitalApp.jsx
// /hospital?template=&room= ? ?? PC ?? ??
// /hospital?template=&room=&kiosk=true ? ???? QR ??
// ? ? /hospital ? /hospital-dashboard ?????
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
  Copy,
  Download,
  RotateCcw,
  Check,
  Monitor,
  Bell,
  Users,
  FolderOpen,
  LogOut,
} from "lucide-react";

function HospitalLogo() {
  return (
    <div className="flex items-center gap-3">
      <MonoLogo />
      <div className="flex flex-col min-w-0">
        <span className="text-[12px] font-bold text-[#7C6FEB] whitespace-nowrap">?? ??</span>
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
  const dept = (deptLabel || "??").replace(/[/\\?*:|"<>]/g, "_");
  return `MONO_??_${d}_${t}_${dept}.txt`;
}

function buildFileContent(messages, deptLabel, lang) {
  const now = new Date();
  const lines = [
    `=== MONO Hospital - ?? ?? ?? ===`,
    `??: ${now.toLocaleDateString()}`, `??: ${now.toLocaleTimeString()}`,
    `???: ${deptLabel || "N/A"}`, `??: ${lang || "N/A"}`,
    `?? ?: ${messages.filter((m) => m.text || m.original).length}?`,
    `${"?".repeat(40)}`, "",
    ...messages.filter((m) => m.text || m.original).map((m) => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : "";
      const speaker = m.isMine ? "???" : "??";
      const orig = m.original || m.text || "";
      const translated = m.translated || "";
      return translated ? `[${time}] ${speaker}: ${orig}\n         ? ${translated}` : `[${time}] ${speaker}: ${orig}`;
    }),
    "", `${"?".repeat(40)}`, `Powered by MONO Medical Interpreter`,
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
  return <p className="mt-6 text-[18px] font-medium text-[var(--color-text-secondary)] text-center">Scan QR Code to Start</p>;
}

// ????: ?? QR ??? ?? (???/??? ??. orgCode? ??)
function ConsultationKioskView({ template, urlRoom, roomName, staffDept, authUser, searchParams }) {
  const urlOrg = searchParams.get("org") || (authUser?.accountType === "organization" && authUser?.id ? authUser.id : "");
  const [qrSize, setQrSize] = useState(280);
  useEffect(() => {
    const update = () => setQrSize(Math.min(280, Math.min(window.innerWidth, window.innerHeight) * 0.45));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const qrUrl = `${window.location.origin}/hospital/join/${encodeURIComponent(urlOrg || "reception")}`;

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-white dark:bg-[#111] text-[var(--color-text)] p-4 sm:p-6 md:p-8 box-border">
      <div className="w-full max-w-[420px] flex flex-col items-center">
        <div className="mb-4 sm:mb-6 w-full flex justify-center">
          <MonoLogo />
        </div>

        {/* International Patients Only ? 3D marquee (two spans, seamless loop) */}
        <div className="w-full mb-4 sm:mb-6" style={{ perspective: "800px", overflowX: "hidden", overflowY: "visible" }}>
          <div className="relative kiosk-marquee-container">
            <span
              className="kiosk-marquee text-2xl sm:text-3xl font-bold whitespace-nowrap"
              style={{ color: "#F97316", transformStyle: "preserve-3d" }}
            >
              International Patients Only
            </span>
            <span
              className="kiosk-marquee kiosk-marquee-2 text-2xl sm:text-3xl font-bold whitespace-nowrap"
              style={{ color: "#F97316", transformStyle: "preserve-3d" }}
            >
              International Patients Only
            </span>
          </div>
        </div>

        {/* Guide steps ? larger, no icon block */}
        <div className="text-center max-w-[320px] sm:max-w-[360px] mb-4 sm:mb-6 space-y-2 sm:space-y-2.5" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
          <p className="text-base sm:text-lg text-[var(--color-text)] font-medium leading-relaxed">1?? Scan the QR code with your phone</p>
          <p className="text-base sm:text-lg text-[var(--color-text)] font-medium leading-relaxed">2?? Select your language</p>
          <p className="text-base sm:text-lg text-[var(--color-text)] font-medium leading-relaxed">3?? Tap ?? to speak ? tap again when done</p>
          <p className="text-sm sm:text-base text-[var(--color-text-secondary)] mt-3">No app download needed. Just scan.</p>
        </div>

        {/* QR ? responsive size */}
        <div className="p-4 sm:p-6 rounded-[20px] bg-white dark:bg-[#1a1a1a] shadow-lg" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.10)" }}>
          <QRCode value={qrUrl} size={qrSize} bgColor="#FFFFFF" fgColor="#3B82F6" level="M" />
        </div>

        <KioskGuideText />
      </div>

      <style>{`
        @keyframes kioskMarquee {
          0% { transform: translateX(calc(50vw - 50%)) translateZ(0) rotateY(0deg); opacity: 1; }
          45% { transform: translateX(100vw) translateZ(0) rotateY(0deg); opacity: 1; }
          50% { transform: translateX(100vw) translateZ(0) rotateY(90deg); opacity: 0; }
          51% { transform: translateX(-100%) translateZ(0) rotateY(-90deg); opacity: 0; }
          53% { transform: translateX(-100%) translateZ(0) rotateY(0deg); opacity: 1; }
          100% { transform: translateX(calc(50vw - 50%)) translateZ(0) rotateY(0deg); opacity: 1; }
        }
        .kiosk-marquee {
          position: absolute;
          left: 0;
          top: 0;
          animation: kioskMarquee 14s ease-in-out infinite;
          backface-visibility: hidden;
          line-height: 1.5;
        }
        .kiosk-marquee-2 {
          animation-delay: -7s;
        }
        .kiosk-marquee-container {
          min-height: 2.75em;
          padding: 0.35em 0;
          overflow: visible;
        }
      `}</style>
    </div>
  );
}

export default function HospitalApp() {
  const location = useLocation();
  const navTo = useNav();
  const [searchParams] = useSearchParams();

  const template = searchParams.get("template") || "reception";
  const kiosk = searchParams.get("kiosk") === "true";
  const urlRoom = searchParams.get("room") || "";

  const hasStaffParams = template === "reception" || searchParams.get("room") !== null;
  const hasKioskParams = template && urlRoom && kiosk;
  const shouldRedirect = !hasStaffParams && !hasKioskParams && !kiosk;

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
  const [hospitalOrgCode, setHospitalOrgCode] = useState("");
  const [hospitalAuthChecked, setHospitalAuthChecked] = useState(false);
  const [saveMode, setSaveMode] = useState(false);
  const [summaryMessages, setSummaryMessages] = useState([]);
  const [summaryDept, setSummaryDept] = useState(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [hasSaveDir, setHasSaveDir] = useState(false);
  const [saveDirName, setSaveDirName] = useState("");
  const [autoSaveResult, setAutoSaveResult] = useState("");
  const autoSaveTriggered = useRef(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);

  const staffDept = useMemo(
    () => (template === "reception" ? { id: "reception", labelKo: "?? ??", label: "Interpretation Standby", icon: "???" } : { id: "consultation", labelKo: "???", label: "Consultation", icon: "??" }),
    [template]
  );

  useEffect(() => {
    if (shouldRedirect) {
      navTo("/hospital-dashboard", { replace: true });
      return;
    }
  }, [shouldRedirect, navTo]);

  // kiosk=true URL ?? ? QR ??? ?? (???/??? ??, orgCode ??)
  // (??: 768px ???? join?? ??????? ?? ?? ? ???? QR ?? ?? ???? ???? ?? ??)

  useEffect(() => {
    if (kiosk) return;
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
  }, [hasStaffParams, hasKioskParams, urlRoom, kiosk]);

  useEffect(() => {
    loadDirHandle().then((h) => { if (h) { setHasSaveDir(true); setSaveDirName(h.name || ""); } });
  }, []);

  useEffect(() => {
    if (kiosk) return;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { if (data?.user) setAuthUser(data.user); })
      .catch(() => {});
  }, [kiosk]);

  useEffect(() => {
    if (kiosk) { setHospitalAuthChecked(true); return; }
    fetch("/api/hospital/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.org_code) setHospitalOrgCode(data.org_code);
        setHospitalAuthChecked(true);
      })
      .catch(() => setHospitalAuthChecked(true));
  }, [kiosk]);

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
    const deptLabel = summaryDept?.labelKo || staffDept?.labelKo || "??";
    autoSaveFile(buildFileContent(summaryMessages, deptLabel, selectedLang), buildFileName(deptLabel))
      .then(setAutoSaveResult).catch(() => setAutoSaveResult("none"));
  }, [step, summaryMessages, summaryDept, staffDept, selectedLang]);

  if (shouldRedirect) return null;

  const isHospitalAdmin = !!hospitalOrgCode || (authUser && (authUser.accountType === "organization" || authUser.org_code || authUser.orgCode));
  if (!kiosk && hospitalAuthChecked && !isHospitalAdmin) return null;

  if (step === "summary") {
    const handleNewSession = () => { setSummaryMessages([]); setSummaryDept(null); setStep("choose"); navTo("/hospital-dashboard", { replace: true }); };
    const handleCopySummary = () => {
      const text = summaryMessages.filter((m) => m.text || m.original).map((m) => `[${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ""}] ${m.isMine ? "???" : "??"}: ${m.original || m.text || ""}`).join("\n");
      navigator.clipboard?.writeText(text).catch(() => {});
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    };
    const handleDownloadSummary = () => {
      const deptLabel = summaryDept?.labelKo || staffDept?.labelKo || "??";
      autoSaveFile(buildFileContent(summaryMessages, deptLabel, selectedLang), buildFileName(deptLabel)).then(() => {}).catch(() => {});
    };
    return (
      <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
        <div className="mx-auto max-w-[520px] px-4 py-6">
          <div className="flex justify-between mb-6">
            <HospitalLogo />
            <button type="button" onClick={handleNewSession} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#3B82F6] text-white text-[13px] font-medium hover:bg-[#2563EB]">
              <RotateCcw size={14} /> ? ??
            </button>
          </div>
          <div className="p-4 rounded-[16px] border border-[var(--color-border)] mb-4">
            <h2 className="text-[16px] font-semibold mb-2">?? ?? ?? ??</h2>
            <p className="text-[12px] text-[var(--color-text-secondary)]">???: {summaryDept?.labelKo || "N/A"} ? ?? {summaryMessages.filter((m) => m.text || m.original).length}?</p>
          </div>
          <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
            {summaryMessages.filter((m) => m.text || m.original).map((m, i) => (
              <div key={i} className="p-3 rounded-[12px] border border-[var(--color-border)]">
                <p className="text-[13px]">{m.original || m.text}</p>
                {m.translated && <p className="text-[12px] text-[#3B82F6] mt-1">? {m.translated}</p>}
              </div>
            ))}
          </div>
          {autoSaveResult === "folder" && <div className="mb-3 px-3 py-2 rounded-[8px] bg-green-50 dark:bg-green-950 border border-green-200"><p className="text-[11px] text-green-700 dark:text-green-400">? ?? ??? ???</p></div>}
          {autoSaveResult === "download" && <div className="mb-3 px-3 py-2 rounded-[8px] bg-blue-50 dark:bg-blue-950 border border-blue-200"><p className="text-[11px] text-blue-700 dark:text-blue-400">? ???? ??? ???</p></div>}
          <div className="flex gap-2">
            <button type="button" onClick={handleCopySummary} className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] border border-[var(--color-border)] text-[13px] font-medium">
              {copiedSummary ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}{copiedSummary ? "???" : "??? ??"}
            </button>
            <button type="button" onClick={handleDownloadSummary} className="flex-1 flex items-center justify-center gap-1.5 h-[44px] rounded-[12px] bg-[#3B82F6] text-white text-[13px] font-medium"><Download size={14} /> ?? ????</button>
          </div>
          <button type="button" onClick={async () => { try { const h = await window.showDirectoryPicker?.({ mode: "readwrite" }); if (h) { await saveDirHandle(h); setHasSaveDir(true); setSaveDirName(h.name || ""); } } catch {} }}
            className="mt-3 w-full flex items-center justify-center gap-1.5 h-[40px] rounded-[12px] border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-text-secondary)]">
            <FolderOpen size={14} /> {hasSaveDir ? `?? ??: ${saveDirName || "???"}` : "?? ?? ??"}
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
      />
    );
  }

  if (hasStaffParams) {
    const org = searchParams.get("org") || authUser?.org_code || authUser?.orgCode || hospitalOrgCode || "";

    if (!kiosk && !urlRoom && isHospitalAdmin) {
      const handleCreateRoom = async (e) => {
        e.preventDefault();
        if (!newRoomName.trim() || creatingRoom) return;
        setCreatingRoom(true);
        try {
          const res = await fetch("/api/hospital/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name: newRoomName.trim() }),
          });
          const data = await res.json();
          if (data?.success && data?.room?.id) {
            navTo(`/hospital?template=reception&room=${encodeURIComponent(data.room.id)}${org ? `&org=${encodeURIComponent(org)}` : ""}`, { replace: true });
          }
        } catch {
          // ignore
        } finally {
          setCreatingRoom(false);
        }
      };
      return (
        <div className="min-h-dvh flex items-center justify-center bg-[var(--color-bg)]">
          <form onSubmit={handleCreateRoom} className="w-full max-w-sm mx-auto px-6">
            <HospitalLogo />
            <h2 className="mt-8 text-lg font-bold text-[var(--color-text)]">Create Room</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Enter a name for this room</p>
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="e.g. Reception, Consultation 1"
              className="mt-4 w-full h-[48px] px-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text)] text-sm outline-none focus:ring-2 focus:ring-[#7C6FEB]"
              autoFocus
            />
            <button
              type="submit"
              disabled={!newRoomName.trim() || creatingRoom}
              className="mt-4 w-full h-[48px] rounded-[12px] bg-[#7C6FEB] text-white font-semibold text-sm disabled:opacity-40"
            >
              {creatingRoom ? "Creating..." : "Start"}
            </button>
          </form>
        </div>
      );
    }

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const returnToReceptionUrl =
      template === "reception" && urlRoom
        ? `${origin}/hospital?template=reception&room=${encodeURIComponent(urlRoom)}${org ? `&org=${encodeURIComponent(org)}` : ""}`
        : null;
    return (
      <StaffModePanel
        template={template}
        selectedDept={staffDept}
        roomName={roomName}
        consultationRoomId={urlRoom || null}
        returnToReceptionUrl={returnToReceptionUrl}
        orgCode={org}
        selectedLang={selectedLang}
        setSelectedLang={setSelectedLang}
        showLangGrid={showLangGrid}
        setShowLangGrid={setShowLangGrid}
        saveMode={saveMode}
        setSaveMode={setSaveMode}
        navTo={navTo}
        onBack={() => navTo("/hospital-dashboard")}
        kiosk={kiosk}
      />
    );
  }

  return null;
}

function StaffModePanel({ template, selectedDept, roomName, consultationRoomId, returnToReceptionUrl, orgCode, selectedLang, setSelectedLang, showLangGrid, setShowLangGrid, saveMode, setSaveMode, navTo, onBack, kiosk }) {
  const [waitingPatients, setWaitingPatients] = useState([]);
  const [consultationRooms, setConsultationRooms] = useState([]);
  const [assignDropdownRoomId, setAssignDropdownRoomId] = useState(null);
  const [acceptedRoomIds, setAcceptedRoomIds] = useState(new Set());
  const [staffJoined, setStaffJoined] = useState(false);
  const [qrLinkCopied, setQrLinkCopied] = useState(false);
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
      const department = isReception && orgCode ? orgCode : selectedDept.id;
      const doWatch = () => {
        console.log("hospital:watch emitting", { department, orgCode, isReception, consultationRoomId });
        socket.emit("hospital:watch", { department });
        setStaffJoined(true);
      };
      if (socket.connected) doWatch();
      else socket.connect();
      const onConnect = () => doWatch();
      socket.on("connect", onConnect);
      return () => {
        socket.off("connect", onConnect);
        if (socket.connected && selectedDept) socket.emit("hospital:unwatch", { department });
        joinedRef.current = false;
      };
    }
  }, [selectedDept, isConsultationRoom, consultationRoomId, isReception, orgCode]);

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
          new Notification("MONO Hospital", { body: "??? ?? ????" });
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
              visitCount: data?.visitCount ?? 0,
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
    if (!isReception || kiosk) return;
    fetch("/api/hospital/rooms", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.rooms) {
          setConsultationRooms((data.rooms || []).filter((r) => r.template === "consultation"));
        }
      })
      .catch(() => {});
  }, [isReception, kiosk]);

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
        orgCode: orgCode || "",
        deptCode: selectedDept?.id || "reception",
        ...(sessionId ? { sessionId } : {}),
        ...(returnToReceptionUrl ? { returnToReceptionUrl } : {}),
      },
    });
  };

  useEffect(() => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); }, []);

  const displayTitle = roomName || selectedDept.labelKo;

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden">
      <div className="flex-none px-4 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between max-w-[600px] mx-auto">
          <HospitalLogo />
          <div className="flex items-center gap-2">
            {template !== "reception" && (
              <span className="px-3 py-1 rounded-full bg-[#DBEAFE] text-[#1D4ED8] text-[11px] font-semibold">
                <Monitor size={12} className="inline mr-1" /> ?? ??
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/hospital/logout", { method: "POST", credentials: "include" });
                navTo("/hospital-login");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
              aria-label="????"
            >
              <LogOut size={14} /> ????
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center px-6 py-6 max-w-[600px] mx-auto w-full">
        <div className="text-center mb-6">
          <span className="text-[48px] block mb-2">{selectedDept.icon}</span>
          <h2 className="text-[22px] font-bold mb-1">{displayTitle}</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">{selectedDept.label}</p>
        </div>
        <div className="w-full max-w-[360px] mb-2">
          <LanguageFlagPicker selectedLang={selectedLang} showGrid={showLangGrid} onToggleGrid={() => setShowLangGrid((p) => !p)}
            onSelect={(code) => { setSelectedLang(code); localStorage.setItem("myLang", code); setShowLangGrid(false); }} />
        </div>
        {!showLangGrid && (
          <>
            <div className={`w-full max-w-[400px] mb-2 flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-[11px] font-medium ${staffJoined ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border border-green-200" : "bg-yellow-50 dark:bg-yellow-950 text-yellow-700 border border-yellow-200"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${staffJoined ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
              {staffJoined ? "?? ? ? ?? QR ??? ???? ????" : "?? ?..."}
            </div>
            {waitingPatients.length > 0 && (
              <div className="w-full max-w-[400px] mb-2 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Bell size={14} className="text-[#F59E0B] animate-bounce" />
                  <span className="text-[12px] font-semibold">
                    {isConsultationRoom ? "?? ?? (??? ???)" : "?? ?? ??"} ({waitingPatients.length}?)
                  </span>
                </div>
                {waitingPatients.map((patient, idx) => {
                  const waitSec = Math.floor((Date.now() - new Date(patient.createdAt).getTime()) / 1000);
                  const langInfo = getLanguageByCode(patient.language);
                  const accepted = isConsultationRoom && acceptedRoomIds.has(patient.roomId);
                  const showAssignDropdown = isReception && assignDropdownRoomId === patient.roomId;
                  return (
                    <div key={patient.roomId || idx} className="relative flex flex-col p-2.5 rounded-[10px] border-2 border-[#F59E0B] bg-[#FFFBEB] dark:bg-[#422006]">
                      <button
                        type="button"
                        onClick={() => setWaitingPatients((prev) => prev.filter((p) => p.roomId !== patient.roomId))}
                        className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[12px] leading-none hover:bg-red-600 transition-colors"
                        aria-label="???? ??"
                      >
                        ?
                      </button>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[22px]" title="??">??</span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold font-mono">{patient.roomId}</p>
                            {langInfo && (
                              <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                                {langInfo.flag} {langInfo.name}
                              </p>
                            )}
                            <p className="text-[10px] text-[var(--color-text-secondary)]">
                              ?? {patient.createdAt ? new Date(patient.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-"}
                              {!isConsultationRoom && waitSec > 0 && ` ? ?? ${waitSec < 60 ? `${waitSec}?` : `${Math.floor(waitSec / 60)}?`}`}
                              {(patient.visitCount ?? 0) > 1 && (
                                <span className="ml-1 px-1.5 py-0.5 rounded bg-[#2563EB]/15 text-[#2563EB] text-[10px] font-medium">
                                  ??? ?? ? {(patient.visitCount ?? 0)}? ??
                                </span>
                              )}
                            </p>
                            {accepted && <p className="text-[10px] text-green-600 dark:text-green-400 font-medium mt-0.5">? ??? ?? ???</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {isReception && (
                            <>
                              <button type="button" onClick={() => setAssignDropdownRoomId(showAssignDropdown ? null : patient.roomId)}
                                className="px-2 py-1.5 rounded-[8px] bg-amber-500 text-white text-[11px] font-medium hover:bg-amber-600">
                                ??? ??
                              </button>
                              <button type="button" onClick={() => handleStartInterpretation(patient)}
                                className="px-3 py-1.5 rounded-[10px] bg-[#3B82F6] text-white text-[12px] font-semibold hover:bg-[#2563EB] flex items-center gap-1.5">
                                <Monitor size={12} /> ?? ??
                              </button>
                            </>
                          )}
                          {isConsultationRoom && (
                            <>
                              <button type="button" onClick={() => handleRequestEntry(patient, patient.consultationRoomName)}
                                className="px-2 py-1.5 rounded-[8px] border border-[var(--color-border)] text-[11px] font-medium hover:bg-[var(--color-bg-secondary)]">
                                ?? ??
                              </button>
                              <button type="button" onClick={() => handleStartInterpretation(patient)}
                                className="px-3 py-1.5 rounded-[10px] bg-[#3B82F6] text-white text-[12px] font-semibold hover:bg-[#2563EB] flex items-center gap-1.5">
                                <Monitor size={12} /> ?? ??
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
              <div className="w-full max-w-[400px] mb-2 p-3 rounded-[12px] border border-dashed border-[var(--color-border)] text-center">
                <Users size={24} className="mx-auto mb-1.5 text-[var(--color-text-secondary)] opacity-40" />
                <p className="text-[12px] text-[var(--color-text-secondary)]">?? ?? ??? ????</p>
                <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">??? QR? ??? ???? ??? ?????</p>
              </div>
            )}
            <style>{`@media print { body * { visibility: hidden; } #hospital-qr-print-section, #hospital-qr-print-section * { visibility: visible; } #hospital-qr-print-section { position: absolute; left: 0; top: 0; width: 100%; display: flex !important; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; } }`}</style>
            <div id="hospital-qr-print-section" className="w-full max-w-[400px] mb-2 p-3 rounded-[12px] border border-[var(--color-border)] flex flex-col items-center gap-2">
              <p className="text-[12px] font-semibold text-[var(--color-text)]">?? QR ??</p>
              <p className="text-center text-[11px] text-[var(--color-text)]">Scan QR code to start interpretation</p>
              <QRCode value={`https://hospital.lingora.chat/hospital/join/${orgCode || ""}`} size={160} bgColor="#FFFFFF" fgColor="#000000" level="M" />
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => { const qrUrl = `https://hospital.lingora.chat/hospital/join/${orgCode || ""}`; navigator.clipboard?.writeText(qrUrl).then(() => { setQrLinkCopied(true); setTimeout(() => setQrLinkCopied(false), 2000); }); }} className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border)] text-[11px] font-medium hover:bg-[var(--color-bg-secondary)]">
                  {qrLinkCopied ? "???!" : "?? ??"}
                </button>
                <button type="button" onClick={() => window.print()} className="px-3 py-1.5 rounded-[8px] bg-[#3B82F6] text-white text-[11px] font-medium hover:bg-[#2563EB]">
                  PDF? ??
                </button>
              </div>
            </div>
                      </>
        )}
      </div>
      <div className="flex-none py-2 text-center space-y-1">
        <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Medical Interpreter</p>
        <button type="button" onClick={() => navTo("/hospital-dashboard")} className="text-[11px] text-[var(--color-text-secondary)] hover:text-[#2563EB] underline">
          ????? ??
        </button>
      </div>
    </div>
  );
}
