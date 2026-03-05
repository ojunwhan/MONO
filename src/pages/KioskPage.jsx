import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import socket from "../socket";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";

// ── Wake Lock helper ──
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      const lock = await navigator.wakeLock.request("screen");
      console.log("[kiosk] 🔒 Wake Lock acquired");
      return lock;
    }
  } catch (e) {
    console.warn("[kiosk] Wake Lock failed:", e?.message);
  }
  return null;
}

export default function KioskPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const stationId = searchParams.get("stationId") || "default";

  // Language selection
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("kioskLang");
    return getLanguageByCode(saved)?.code || "";
  }, []);
  const initialLang = useMemo(() => savedLang || detected?.code || "ko", [detected, savedLang]);
  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [showGrid, setShowGrid] = useState(!savedLang);

  // Session state
  const [sessionData, setSessionData] = useState(null); // { roomId, sessionId, chartNumber, hostLang }
  const [status, setStatus] = useState("idle"); // idle | waiting | joining | in-session | ended
  const [error, setError] = useState("");
  const wakeLockRef = useRef(null);
  const joinedRef = useRef(false);
  const resetTimerRef = useRef(null);

  // ── Wake Lock ──
  useEffect(() => {
    requestWakeLock().then((lock) => {
      wakeLockRef.current = lock;
    });
    const onVisChange = async () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        wakeLockRef.current = await requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // ── Join kiosk station channel ──
  useEffect(() => {
    if (!stationId) return;
    const join = () => {
      socket.emit("kiosk:join-station", { stationId });
      console.log(`[kiosk] 📺 Joined station channel: ${stationId}`);
      setStatus("waiting");
    };

    if (socket.connected) join();
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
    };
  }, [stationId]);

  // ── Listen for session events ──
  useEffect(() => {
    const onSessionReady = (data) => {
      console.log("[kiosk] 🏥 Session ready:", data);
      setSessionData(data);
      setStatus("joining");
      joinedRef.current = false;
      setError("");
    };

    const onSessionEnded = (data) => {
      console.log("[kiosk] 🔚 Session ended:", data);
      setStatus("ended");
      // Auto-reset after 3 seconds
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setSessionData(null);
        setStatus("waiting");
        joinedRef.current = false;
        setShowGrid(!savedLang);
      }, 3000);
    };

    socket.on("kiosk:session-ready", onSessionReady);
    socket.on("kiosk:session-ended", onSessionEnded);

    return () => {
      socket.off("kiosk:session-ready", onSessionReady);
      socket.off("kiosk:session-ended", onSessionEnded);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [savedLang]);

  // ── Check for existing session on mount ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/hospital/kiosk/status?stationId=${encodeURIComponent(stationId)}`);
        const data = await res.json();
        if (data.active) {
          setSessionData(data);
          setStatus("joining");
        } else {
          setStatus("waiting");
        }
      } catch {
        setStatus("waiting");
      }
    })();
  }, [stationId]);

  // ── Language selection → auto-join when session is ready ──
  const handleLangSelect = useCallback(
    (code) => {
      setSelectedLang(code);
      localStorage.setItem("kioskLang", code);
      setShowGrid(false);
    },
    []
  );

  // ── Join room when language is selected and session is ready ──
  useEffect(() => {
    if (status !== "joining" || !sessionData?.roomId || showGrid || joinedRef.current) return;
    joinedRef.current = true;
    setStatus("in-session");

    // Navigate to chat room as guest (kiosk)
    navigate(`/room/${sessionData.roomId}`, {
      state: {
        fromLang: selectedLang,
        localName: "",
        role: "Patient",
        isCreator: false,
        siteContext: "hospital",
        roomType: "oneToOne",
        isKiosk: true,
        chartNumber: sessionData.chartNumber,
        stationId,
      },
    });
  }, [status, sessionData, showGrid, selectedLang, navigate, stationId]);

  // ── Render ──
  return (
    <div className="min-h-[100dvh] bg-white flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="text-[48px] font-light leading-none mb-2" style={{ letterSpacing: "6px" }}>
          <span style={{ color: "#7C6FEB" }}>M</span>
          <span style={{ color: "#F472B6" }}>O</span>
          <span style={{ color: "#34D399" }}>N</span>
          <span style={{ color: "#FBBF24" }}>O</span>
        </div>
        <p className="text-[14px] text-gray-500">
          {stationId !== "default" ? `📍 ${stationId}` : ""}
        </p>
      </div>

      {/* Status indicator */}
      {status === "waiting" && !sessionData && (
        <div className="mb-6 px-4 py-2 rounded-full bg-gray-100 text-gray-600 text-[13px]">
          ⏳ 직원이 세션을 시작할 때까지 대기 중...
        </div>
      )}

      {status === "ended" && (
        <div className="mb-6 px-4 py-3 rounded-[12px] bg-green-50 border border-green-200 text-green-700 text-[14px] text-center">
          ✅ 진료가 종료되었습니다. 잠시 후 초기화됩니다...
        </div>
      )}

      {status === "joining" && sessionData && (
        <div className="mb-4 px-4 py-3 rounded-[12px] bg-blue-50 border border-blue-200 text-blue-700 text-[14px] text-center">
          🏥 차트번호: <strong>{sessionData.chartNumber}</strong> — 언어를 선택해주세요
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2 rounded-[8px] bg-red-50 text-red-600 text-[13px]">
          {error}
        </div>
      )}

      {/* Language Picker — always visible when idle/waiting/joining */}
      {(status === "idle" || status === "waiting" || status === "joining") && (
        <div className="w-full max-w-[400px]">
          <LanguageFlagPicker
            selectedLang={selectedLang}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((p) => !p)}
            onSelect={handleLangSelect}
          />
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto pt-6 text-center text-[11px] text-gray-400">
        MONO Hospital Kiosk v1.0
      </div>
    </div>
  );
}
