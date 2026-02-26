import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useLocation } from "react-router-dom";
import QRCodeBox from "../components/QRCodeBox";
import { LANGUAGE_PROFILES, detectUserLanguage, getLanguageProfileByCode } from "../constants/languageProfiles";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { fetchAuthMe } from "../auth/session";

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

function LanguageDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = getLanguageProfileByCode(value) || LANGUAGE_PROFILES[0];

  useEffect(() => {
    const onDocClick = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full max-w-[320px] z-20">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full px-4 text-left flex items-center justify-between bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[8px] h-[48px]"
      >
        <img className="flag" src={selected.flagUrl} alt={selected.name} />
        <span className="flex-1 ml-3 text-[15px] font-medium text-[var(--color-text)]">
          {selected.name}
        </span>
        <ChevronDown size={16} className={`text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 max-h-[300px] overflow-y-auto bg-[var(--color-bg)] rounded-[8px] border border-[var(--color-border)] shadow-[0_4px_20px_rgba(0,0,0,0.1)] z-[100]">
          {LANGUAGE_PROFILES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                onChange(l.code);
                setOpen(false);
              }}
              className={`w-full px-4 text-left h-[44px] flex items-center gap-3 hover:bg-[var(--color-bg-secondary)] ${
                l.code === selected.code ? "bg-[#EEF4FF]" : ""
              }`}
            >
              <img className="flag" src={l.flagUrl} alt={l.name} />
              <span className="text-[15px] text-[var(--color-text)]">{l.name}</span>
              {l.code === selected.code && <span className="ml-auto text-[var(--color-primary)]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const detected = useMemo(() => detectUserLanguage(), []);
  const initialLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    if (saved && getLanguageProfileByCode(saved)) return saved;
    return detected?.code || "ko";
  }, [detected]);

  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [roomId, setRoomId] = useState("");
  const [hostPid, setHostPid] = useState("");
  const [isGuest, setIsGuest] = useState(false);

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

  const handleHostLangChange = (code) => {
    setSelectedLang(code);
    localStorage.setItem("myLang", code);
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
              aria-label="뒤로가기"
            >
              <ChevronLeft size={24} />
            </button>
          </div>
        ) : null}
        <div className="mb-8"><MonoLogo /></div>
        <LanguageDropdown
          value={selectedLang}
          onChange={isGuest ? setSelectedLang : handleHostLangChange}
        />

        {!isGuest ? (
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
        ) : (
          <div className="mt-6 w-full max-w-[320px]">
            <button
              type="button"
              onClick={handleGuestStart}
              className="mono-btn w-full h-[48px] px-4 text-[16px] font-medium border bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
            >
              {me.startLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
