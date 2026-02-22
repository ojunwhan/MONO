import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useLocation } from "react-router-dom";
import QRCodeBox from "../components/QRCodeBox";
import { LANGUAGE_PROFILES, detectUserLanguage, getLanguageProfileByCode } from "../constants/languageProfiles";

function MonoLogo() {
  return (
    <div className="text-[20px] font-bold tracking-[0.25em] leading-none">
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
        className="w-full px-4 text-left flex items-center justify-between bg-white border border-[#E5E7EB] rounded-[12px] h-[48px]"
      >
        <img className="flag" src={selected.flagUrl} alt={selected.name} />
        <span className="flex-1 ml-3 text-[16px] font-medium text-[#374151]">
          {selected.name}
        </span>
        <span className="text-[12px] text-[#666]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 max-h-[300px] overflow-y-auto bg-white rounded-[12px] border border-[#E5E7EB] shadow-[0_4px_20px_rgba(0,0,0,0.1)] z-[100]">
          {LANGUAGE_PROFILES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                onChange(l.code);
                setOpen(false);
              }}
              className={`w-full px-4 text-left h-[44px] flex items-center gap-3 hover:bg-[#F9FAFB] ${
                l.code === selected.code ? "bg-[#F3F4FF]" : ""
              }`}
            >
              <img className="flag" src={l.flagUrl} alt={l.name} />
              <span className="text-[15px] text-[#374151]">{l.name}</span>
              {l.code === selected.code && <span className="ml-auto text-[#7C6FEB]">✓</span>}
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
  }, [location.search]);

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

  return (
    <div className="min-h-[100dvh] text-[#111] bg-[#FAFAFF]">
      <div className="mx-auto w-full max-w-[380px] min-h-[100dvh] px-4 py-4 box-border flex flex-col items-center justify-center overflow-hidden">
        <div className="mb-4"><MonoLogo /></div>
        <LanguageDropdown
          value={selectedLang}
          onChange={isGuest ? setSelectedLang : handleHostLangChange}
        />

        {!isGuest ? (
          <div className="mt-4 w-full flex flex-col items-center">
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
          <div className="mt-5 w-full max-w-[320px]">
            <button
              type="button"
              onClick={handleGuestStart}
              className="mono-btn w-full px-4 py-3 text-[16px] font-medium border bg-[#7C6FEB] text-white border-[#7C6FEB]"
            >
              {me.startLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
