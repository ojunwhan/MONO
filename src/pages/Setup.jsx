// src/pages/Setup.jsx — First-time user setup: auto language detect + flag selection
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getMyIdentity, setMyIdentity } from "../db";
import socket from "../socket";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_PROFILES,
  detectUserLanguage,
  getLanguageProfileByCode,
} from "../constants/languageProfiles";

export default function Setup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const detected = useMemo(() => detectUserLanguage(), []);
  const [lang, setLang] = useState(detected?.code || "ko");
  const [showPicker, setShowPicker] = useState(!detected || detected.code === "ko");
  const [loading, setLoading] = useState(true);

  // Check if already set up
  useEffect(() => {
    getMyIdentity().then((me) => {
      if (me?.userId && me?.canonicalName) {
        // Already set up → go to room list
        navigate("/home", { replace: true });
      }
      setLoading(false);
    });
  }, [navigate]);

  const handleStart = async (langOverride) => {
    const selectedLang = langOverride || lang;
    const userId = crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 14);
    const seq = Number(localStorage.getItem("mono.autoNameSeq") || "0") + 1;
    localStorage.setItem("mono.autoNameSeq", String(seq));
    const canonicalName = t("setup.participant", { seq });

    await setMyIdentity({ userId, canonicalName, lang: selectedLang });

    // Register with server
    socket.emit("register-user", { userId, canonicalName, lang: selectedLang });
    localStorage.setItem("myLang", selectedLang);

    navigate("/home", { replace: true });
  };

  if (loading) {
    return (
      <div className="mono-shell min-h-screen flex items-center justify-center">
        <div className="text-[14px] text-[#555]">Loading...</div>
      </div>
    );
  }

  const selectedProfile = getLanguageProfileByCode(lang) || LANGUAGE_PROFILES[0];

  return (
    <div className="mono-shell min-h-screen text-[#111]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
        <header className="mb-8 text-center">
          <div className="text-[34px] font-bold tracking-[0.2em]">MONO</div>
        </header>

        {!showPicker && selectedProfile.code !== "ko" ? (
          <section className="mono-card p-6 text-center">
            <div className="text-[56px] leading-none">{selectedProfile.flag}</div>
            <div className="mt-3 text-[20px] font-semibold">{selectedProfile.confirmText}</div>
            <div className="mt-1 text-[12px] text-[#666]">({selectedProfile.shortLabel || selectedProfile.nativeName})</div>
            <button
              type="button"
              onClick={handleStart}
              className="mono-btn mt-6 w-full px-4 py-3 text-[17px] font-medium border bg-[#111] text-white border-[#111]"
            >
              {selectedProfile.startLabel}
            </button>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="mt-4 text-[12px] text-[#555] underline"
            >
              {selectedProfile.otherText} →
            </button>
          </section>
        ) : (
          <section className="mono-card p-6">
            <div className="text-center mb-4">
              <div className="text-[16px] font-semibold">{t("setup.selectMyLanguage")}</div>
              <div className="text-[13px] text-[#666]">Select Language</div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {LANGUAGE_PROFILES.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => {
                    setLang(p.code);
                    handleStart(p.code);
                  }}
                  className="mono-card px-2 py-3 text-center border border-[#d1d5db] hover:bg-[#f8fafc]"
                >
                  <div className="text-[44px] leading-none">{p.flag}</div>
                  <div className="mt-1 text-[12px] leading-4 font-semibold tracking-wide">{p.shortLabel || p.nativeName}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
