import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useLocation } from "react-router-dom";
import QRCodeBox from "../components/QRCodeBox";
import { LANGUAGE_PROFILES, detectUserLanguage, getLanguageProfileByCode } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import { ChevronLeft, Hospital, X } from "lucide-react";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import { fetchAuthMe } from "../auth/session";
import { useTranslation } from "react-i18next";

function MonoLogo() {
  return (
    <div className="text-[72px] font-light leading-none" style={{ letterSpacing: "8px", paddingLeft: "8px" }}>
      <span style={{ color: "#7C6FEB" }}>M</span>
      <span style={{ color: "#F472B6" }}>O</span>
      <span style={{ color: "#34D399" }}>N</span>
      <span style={{ color: "#FBBF24" }}>O</span>
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    return getLanguageByCode(saved)?.code || "";
  }, []);
  const initialLang = useMemo(() => {
    if (savedLang) return savedLang;
    return detected?.code || "ko";
  }, [detected, savedLang]);

  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [showLangGrid, setShowLangGrid] = useState(!savedLang);
  const [roomId, setRoomId] = useState("");
  const [hostPid, setHostPid] = useState("");
  const [isGuest, setIsGuest] = useState(false);
  const autoGuestStartRef = useRef(false);

  // ── Hospital Mode ──
  const [hospitalMode, setHospitalMode] = useState(() => localStorage.getItem("hospitalMode") === "true");
  const [chartNumber, setChartNumber] = useState("");
  const [stationId] = useState(() => localStorage.getItem("hospitalStation") || "default");
  const [hospitalSession, setHospitalSession] = useState(null);
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [hospitalError, setHospitalError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      // 401 may occur right after browser data clear; allow one retry before redirect.
      for (let i = 0; i < 2; i += 1) {
        const me = await fetchAuthMe();
        if (me?.authenticated) {
          if (cancelled) return;
          setAuthOk(true);
          setAuthReady(true);
          return;
        }
        if (i === 0) await sleep(250);
      }
      if (cancelled) return;
      setAuthOk(false);
      setAuthReady(true);
      navigate("/login", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!authReady || !authOk) return;
    const query = new URLSearchParams(location.search);
    const incomingRoomId = query.get("roomId");
    if (incomingRoomId) {
      setIsGuest(true);
      setRoomId(incomingRoomId);
      return;
    }
    setIsGuest(false);
    const newRoomId = uuidv4();
    setRoomId(newRoomId);
    const pidKey = `mro.pid.${newRoomId}`;
    let pid = localStorage.getItem(pidKey);
    if (!pid) {
      pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem(pidKey, pid);
    }
    setHostPid(pid);
  }, [authOk, authReady, location.search]);

  // ── Hospital: toggle & create session ──
  const toggleHospitalMode = useCallback(() => {
    const next = !hospitalMode;
    setHospitalMode(next);
    localStorage.setItem("hospitalMode", String(next));
    if (!next) {
      setHospitalSession(null);
      setChartNumber("");
      setHospitalError("");
    }
  }, [hospitalMode]);

  const createHospitalSession = useCallback(async () => {
    if (!chartNumber.trim() || !/^\d+$/.test(chartNumber.trim())) {
      setHospitalError(t("hospital.chartNumberInvalid", "차트번호는 숫자만 입력하세요."));
      return;
    }
    setHospitalLoading(true);
    setHospitalError("");
    try {
      const newRoomId = uuidv4();
      const res = await fetch("/api/hospital/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chartNumber: chartNumber.trim(),
          stationId,
          hostLang: selectedLang,
          roomId: newRoomId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "failed");
      setHospitalSession(data);
      setRoomId(data.roomId);
      const pidKey = `mro.pid.${data.roomId}`;
      let pid = localStorage.getItem(pidKey);
      if (!pid) {
        pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
        localStorage.setItem(pidKey, pid);
      }
      setHostPid(pid);
    } catch (e) {
      setHospitalError(e?.message || "세션 생성 실패");
    } finally {
      setHospitalLoading(false);
    }
  }, [chartNumber, stationId, selectedLang, t]);

  const endHospitalSession = useCallback(async () => {
    if (!hospitalSession?.sessionId) return;
    try {
      await fetch(`/api/hospital/session/${hospitalSession.sessionId}/end`, { method: "POST" });
    } catch {}
    setHospitalSession(null);
    setChartNumber("");
    // Generate new room for next patient
    const newRoomId = uuidv4();
    setRoomId(newRoomId);
    const pidKey = `mro.pid.${newRoomId}`;
    const pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    localStorage.setItem(pidKey, pid);
    setHostPid(pid);
  }, [hospitalSession]);

  const handleHostLangChange = (code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    setShowLangGrid(false);
    const newRoomId = uuidv4();
    setRoomId(newRoomId);
    const pidKey = `mro.pid.${newRoomId}`;
    let pid = localStorage.getItem(pidKey);
    if (!pid) {
      pid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem(pidKey, pid);
    }
    setHostPid(pid);
  };

  const handleGuestStart = () => {
    if (!roomId) return;
    localStorage.setItem("myLang", selectedLang);
    navigate(`/room/${roomId}`, {
      state: {
        fromLang: selectedLang,
        localName: "",
        role: "Manager",
        isCreator: false,
        siteContext: "general",
        roomType: "oneToOne",
      },
    });
  };

  useEffect(() => {
    if (!authReady || !authOk || !isGuest) return;
    if (!savedLang || showLangGrid || !roomId) return;
    if (autoGuestStartRef.current) return;
    autoGuestStartRef.current = true;
    handleGuestStart();
  }, [authReady, authOk, isGuest, savedLang, showLangGrid, roomId]);

  const me = getLanguageProfileByCode(selectedLang) || LANGUAGE_PROFILES[0];

  if (!authReady || !authOk) {
    return null;
  }

  return (
    <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
      <div
        className="mx-auto w-full max-w-[480px] px-4 py-4 box-border flex flex-col items-center justify-center overflow-hidden"
        style={{ minHeight: "calc(100dvh - 56px - env(safe-area-inset-bottom))" }}
      >
        {isGuest ? (
          <div className="w-full mb-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text)]"
              aria-label={t("common.back")}
            >
              <ChevronLeft size={24} />
            </button>
          </div>
        ) : null}
        <div className="mb-8"><MonoLogo /></div>
        <div className="w-full max-w-[360px]">
          <LanguageFlagPicker
            selectedLang={selectedLang}
            showGrid={showLangGrid}
            onToggleGrid={() => setShowLangGrid((prev) => !prev)}
            onSelect={(code) => {
              if (isGuest) {
                setSelectedLang(code);
                localStorage.setItem("myLang", code);
                setShowLangGrid(false);
              } else {
                handleHostLangChange(code);
              }
            }}
          />
        </div>

        {/* ── Hospital Mode Toggle (Host only) ── */}
        {!isGuest && !showLangGrid ? (
          <div className="mt-4 w-full max-w-[360px]">
            <button
              type="button"
              onClick={toggleHospitalMode}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
                hospitalMode
                  ? "bg-[#DBEAFE] text-[#1D4ED8] border border-[#3B82F6]"
                  : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
              }`}
            >
              <Hospital size={16} />
              {t("hospital.mode", "병원 모드")}
              {hospitalMode && <span className="ml-1 text-[10px]">ON</span>}
            </button>

            {hospitalMode && !hospitalSession ? (
              <div className="mt-3 p-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)]">
                <label className="block text-[13px] font-medium text-[var(--color-text)] mb-2">
                  {t("hospital.chartNumber", "차트번호")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={chartNumber}
                    onChange={(e) => setChartNumber(e.target.value.replace(/\D/g, ""))}
                    placeholder={t("hospital.chartPlaceholder", "차트번호 입력")}
                    className="flex-1 h-[44px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[15px]"
                  />
                  <button
                    type="button"
                    onClick={createHospitalSession}
                    disabled={hospitalLoading || !chartNumber.trim()}
                    className="h-[44px] px-4 rounded-[8px] bg-[#3B82F6] text-white text-[14px] font-medium disabled:opacity-50"
                  >
                    {hospitalLoading ? "..." : t("hospital.startSession", "세션 시작")}
                  </button>
                </div>
                {hospitalError && <p className="mt-2 text-[12px] text-red-500">{hospitalError}</p>}
                <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                  {t("hospital.stationLabel", "창구")}: {stationId}
                </p>
              </div>
            ) : hospitalMode && hospitalSession ? (
              <div className="mt-3 p-4 rounded-[12px] border border-[#3B82F6] bg-[#EFF6FF]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-medium text-[#1D4ED8]">
                    🏥 {t("hospital.activeSession", "진료 중")} — {t("hospital.chartNumber", "차트번호")}: {hospitalSession.chartNumber}
                  </span>
                  <button
                    type="button"
                    onClick={endHospitalSession}
                    className="w-7 h-7 rounded-full flex items-center justify-center bg-red-100 text-red-500 hover:bg-red-200"
                    title={t("hospital.endSession", "세션 종료")}
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="text-[11px] text-[#1D4ED8]">
                  {t("hospital.stationLabel", "창구")}: {hospitalSession.stationId} | ID: {hospitalSession.sessionId?.substring(0, 8)}...
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isGuest && !showLangGrid ? (
          <div className="mt-6 w-full flex flex-col items-center">
            {!!roomId && !!hostPid && (
              <QRCodeBox
                key={roomId}
                roomId={roomId}
                fromLang={selectedLang}
                participantId={hostPid}
                siteContext={hospitalMode ? "hospital" : "general"}
                role="Manager"
                localName=""
                roomType="oneToOne"
                chartNumber={hospitalSession?.chartNumber || ""}
                stationId={hospitalSession?.stationId || ""}
                hospitalSessionId={hospitalSession?.sessionId || ""}
              />
            )}
          </div>
        ) : isGuest && !showLangGrid ? (
          <div className="mt-6 w-full max-w-[320px]">
            <button
              type="button"
              onClick={handleGuestStart}
              className="mono-btn w-full h-[48px] px-4 text-[16px] font-medium border bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
            >
              {me.startLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
