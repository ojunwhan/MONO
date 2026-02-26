import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import LanguageSelector from "../components/LanguageSelector";
import MonoLogo from "../components/MonoLogo";
import { LANGUAGES, getLanguageByCode } from "../constants/languages";

function detectBrowserLanguage() {
  const browserLang = (navigator.language || "en").split("-")[0].toLowerCase();
  return LANGUAGES.some((l) => l.code === browserLang) ? browserLang : "en";
}

function saveGuestSession(roomId, lang, name, guestId, siteContext, roomType) {
  sessionStorage.setItem(
    "mono_guest",
    JSON.stringify({
      roomId,
      lang,
      name: name || "게스트",
      guestId,
      siteContext: siteContext || "general",
      roomType: roomType || "oneToOne",
      joinedAt: Date.now(),
    })
  );
}

function getGuestSession() {
  try {
    const raw = sessionStorage.getItem("mono_guest");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function GuestJoinPage() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedLang, setSelectedLang] = useState(detectBrowserLanguage());

  const siteContext = useMemo(() => searchParams.get("siteContext") || "general", [searchParams]);
  const roomType = useMemo(() => searchParams.get("roomType") || "oneToOne", [searchParams]);

  useEffect(() => {
    const session = getGuestSession();
    if (!session || session.roomId !== roomId) return;
    navigate(`/room/${roomId}`, {
      replace: true,
      state: {
        fromLang: session.lang || "en",
        localName: session.name || "게스트",
        role: "Manager",
        isCreator: false,
        siteContext: session.siteContext || "general",
        roomType: session.roomType || "oneToOne",
        isGuest: true,
      },
    });
  }, [navigate, roomId]);

  useEffect(() => {
    const normalized = String(selectedLang || "").toLowerCase();
    if (!getLanguageByCode(normalized)) setSelectedLang("en");
  }, [selectedLang]);

  const startGuestSession = () => {
    if (!roomId) return;
    const guestId = `guest_${uuidv4().slice(0, 8)}`;
    const cleanName = "게스트";
    saveGuestSession(roomId, selectedLang, cleanName, guestId, siteContext, roomType);
    localStorage.setItem("myLang", selectedLang);
    navigate(`/room/${roomId}`, {
      replace: true,
      state: {
        fromLang: selectedLang,
        localName: cleanName,
        role: "Manager",
        isCreator: false,
        siteContext,
        roomType,
        isGuest: true,
        guestId,
      },
    });
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] px-6 py-8 flex flex-col">
        <div className="flex-[0_0_40%] flex flex-col items-center justify-center text-center">
          <MonoLogo />
          <p className="mt-4 text-[16px] text-[var(--color-text-secondary)]">AI 실시간 통역 메신저</p>
        </div>

        <div className="flex-[0_0_60%] flex flex-col items-center justify-center">
          <div className="w-full max-w-[320px] space-y-3">
            <p className="text-[14px] text-[var(--color-text-secondary)] text-center">사용할 언어를 선택해주세요</p>
            <div className="[&_img]:w-6 [&_img]:h-6 [&_img]:min-w-6 [&_img]:min-h-6">
              <LanguageSelector value={selectedLang} onChange={setSelectedLang} />
            </div>
            <button
              type="button"
              onClick={startGuestSession}
              className="w-full h-[48px] rounded-[8px] text-[16px] font-medium bg-[var(--color-primary)] text-white border border-[var(--color-primary)]"
            >
              통역 시작
            </button>
            <p className="text-[14px] text-[var(--color-text-secondary)] text-center">
              앱 설치 없이 바로 통역이 시작됩니다
            </p>
          </div>
        </div>

        <div className="pt-4 text-center text-[12px] text-[var(--color-text-secondary)]">
          링크 입장 시 즉시 통역 화면으로 이동합니다
        </div>
      </div>
    </div>
  );
}
