import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import MonoLogo from "../components/MonoLogo";
import { getLanguageByCode } from "../constants/languages";
import { detectUserLanguage } from "../constants/languageProfiles";
import { useTranslation } from "react-i18next";

function detectBrowserLanguage() {
  const detected = detectUserLanguage();
  return getLanguageByCode(detected?.code)?.code || "en";
}

function saveGuestSession(roomId, lang, name, guestId, siteContext, roomType) {
  sessionStorage.setItem(
    "mono_guest",
    JSON.stringify({
      roomId,
      lang,
      name: name || "Guest",
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
  const { t } = useTranslation();
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    if (saved) return getLanguageByCode(saved)?.code || "";
    const preferred = localStorage.getItem("mono.preferredLang");
    return getLanguageByCode(preferred)?.code || "";
  }, []);
  const [selectedLang, setSelectedLang] = useState(savedLang || detectBrowserLanguage());
  // 항상 언어 선택 그리드를 보여줌 — 게스트는 매번 본인 언어를 확인/선택해야 함
  const [showLangGrid, setShowLangGrid] = useState(true);
  // 언어 선택 완료 여부 (그리드에서 국기를 탭해야 true)
  const [langConfirmed, setLangConfirmed] = useState(false);

  const siteContext = useMemo(() => searchParams.get("siteContext") || "general", [searchParams]);
  const roomType = useMemo(() => searchParams.get("roomType") || "oneToOne", [searchParams]);

  useEffect(() => {
    const normalized = String(selectedLang || "").toLowerCase();
    if (!getLanguageByCode(normalized)) setSelectedLang("en");
  }, [selectedLang]);

  const startGuestSession = () => {
    if (!roomId) return;
    // 같은 방에 대한 기존 세션이 있으면 guestId 재사용 (재접속 시 서버에서 동일인으로 인식)
    const existingSession = getGuestSession();
    const guestId = (existingSession?.roomId === roomId && existingSession?.guestId)
      ? existingSession.guestId
      : `guest_${uuidv4().slice(0, 8)}`;
    const cleanName = t("common.guest");
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
          <p className="mt-4 text-[16px] text-[var(--color-text-secondary)]">{t("guestJoin.subtitle")}</p>
        </div>

        <div className="flex-[0_0_60%] flex flex-col items-center justify-center">
          <div className="w-full max-w-[320px] space-y-3">
            <LanguageFlagPicker
              selectedLang={selectedLang}
              showGrid={showLangGrid}
              onToggleGrid={() => {
                // 그리드를 닫을 때 = 현재 언어 확정 (상단 버튼 탭으로 닫기)
                setShowLangGrid((prev) => {
                  if (prev) setLangConfirmed(true); // 그리드 열림→닫힘 = 선택 확정
                  return !prev;
                });
              }}
              onSelect={(code) => {
                setSelectedLang(code);
                localStorage.setItem("myLang", code);
                setLangConfirmed(true);
                setShowLangGrid(false);
              }}
            />
            {!showLangGrid && langConfirmed ? (
              <button
                type="button"
                onClick={startGuestSession}
                className="w-full h-[48px] rounded-[8px] text-[16px] font-medium bg-[var(--color-primary)] text-white border border-[var(--color-primary)]"
              >
                {t("guestJoin.startInterpret")}
              </button>
            ) : null}
            <p className="text-[14px] text-[var(--color-text-secondary)] text-center">
              {t("guestJoin.noInstall")}
            </p>
          </div>
        </div>

        <div className="pt-4 text-center text-[12px] text-[var(--color-text-secondary)]">
          {t("guestJoin.linkInfo")}
        </div>
      </div>
    </div>
  );
}
