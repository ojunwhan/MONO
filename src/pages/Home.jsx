import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useLocation } from "react-router-dom";
import QRCodeBox from "../components/QRCodeBox";
import { LANGUAGE_PROFILES, detectUserLanguage, getLanguageProfileByCode } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import { ChevronLeft } from "lucide-react";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import { fetchAuthMe } from "../auth/session";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

const monoToI18n = { ko: "ko", en: "en", ja: "ja", zh: "zh", vi: "vi", th: "th", ru: "ru", ar: "ar", fr: "fr", es: "es", cn: "zh" };

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
    if (saved) return getLanguageByCode(saved)?.code || "";
    // Fallback to preferred language from Settings
    const preferred = localStorage.getItem("mono.preferredLang");
    return getLanguageByCode(preferred)?.code || "";
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

  useEffect(() => {
    const storedLang = localStorage.getItem("myLang");
    if (storedLang) {
      i18n.changeLanguage(storedLang);
    }
  }, []);

  const handleHostLangChange = (code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
    i18n.changeLanguage(monoToI18n[code] || code);
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
                i18n.changeLanguage(monoToI18n[code] || code);
                setShowLangGrid(false);
              } else {
                handleHostLangChange(code);
              }
            }}
          />
        </div>

        {!isGuest && !showLangGrid ? (
          <div className="mt-6 w-full flex flex-col items-center">
            {!!roomId && !!hostPid && (
              <QRCodeBox
                key={roomId}
                roomId={roomId}
                fromLang={selectedLang}
                participantId={hostPid}
                siteContext="general"
                role="Manager"
                localName=""
                roomType="oneToOne"
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
              {t("home.startInterpret")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
