import React, { useEffect, useMemo, useState, useCallback } from "react";
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

// ── Hospital mode: "환자" translated per language ──
const PATIENT_LABEL = {
  ko: "환자",
  en: "Patient",
  ja: "患者",
  zh: "患者",
  vi: "Bệnh nhân",
  th: "ผู้ป่วย",
  id: "Pasien",
  tl: "Pasyente",
  mn: "Өвчтөн",
  uz: "Bemor",
  ru: "Пациент",
  ar: "مريض",
  es: "Paciente",
  ne: "बिरामी",
  my: "လူနာ",
  km: "អ្នកជំងឺ",
};

async function getPatientLabel(langCode) {
  const code = String(langCode || "en").toLowerCase().split("-")[0];
  if (PATIENT_LABEL[code]) return PATIENT_LABEL[code];
  // Fallback: ask GPT-4o via server API
  try {
    const lang = getLanguageByCode(code);
    const langName = lang?.name || code;
    const r = await fetch("/api/translate-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: "환자", targetLang: langName }),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.translated) return data.translated;
    }
  } catch { /* ignore – fall through */ }
  return "Patient"; // ultimate fallback
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
  const isHospitalMode = String(siteContext).startsWith("hospital_");

  // ── Hospital: chart number + revisit flow ──
  const [hospitalStep, setHospitalStep] = useState("chart"); // 'chart' | 'lang' | 'connecting'
  const [chartNumber, setChartNumber] = useState("");
  const [chartError, setChartError] = useState("");
  const [isRevisit, setIsRevisit] = useState(false);
  const [patientInfo, setPatientInfo] = useState(null);

  useEffect(() => {
    const normalized = String(selectedLang || "").toLowerCase();
    if (!getLanguageByCode(normalized)) setSelectedLang("en");
  }, [selectedLang]);

  // Hospital: lookup chart number for revisit
  const handleChartLookup = useCallback(async () => {
    if (!chartNumber.trim()) {
      // Skip chart → go to language selection (new patient without chart)
      setHospitalStep("lang");
      return;
    }
    try {
      const r = await fetch(`/api/hospital/patients/${encodeURIComponent(chartNumber.trim())}`);
      if (r.ok) {
        const data = await r.json();
        if (data.found && data.patient) {
          setPatientInfo(data.patient);
          setIsRevisit(true);
          // Auto-set saved language
          if (data.patient.language) {
            const code = getLanguageByCode(data.patient.language)?.code;
            if (code) {
              setSelectedLang(code);
              setLangConfirmed(true);
              setShowLangGrid(false);
            }
          }
        }
      }
    } catch { /* ignore */ }
    setHospitalStep("lang");
  }, [chartNumber]);

  // Hospital: skip chart (first visit, no chart number)
  const handleSkipChart = useCallback(() => {
    setChartNumber("");
    setHospitalStep("lang");
  }, []);

  const startGuestSession = async () => {
    if (!roomId) return;
    // 같은 방에 대한 기존 세션이 있으면 guestId 재사용 (재접속 시 서버에서 동일인으로 인식)
    const existingSession = getGuestSession();
    const guestId = (existingSession?.roomId === roomId && existingSession?.guestId)
      ? existingSession.guestId
      : `guest_${uuidv4().slice(0, 8)}`;
    const cleanName = isHospitalMode
      ? await getPatientLabel(selectedLang)
      : t("common.guest");
    saveGuestSession(roomId, selectedLang, cleanName, guestId, siteContext, roomType);
    localStorage.setItem("myLang", selectedLang);

    // Hospital: register patient if chart number provided
    if (isHospitalMode && chartNumber.trim()) {
      try {
        await fetch("/api/hospital/patients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chartNumber: chartNumber.trim(), language: selectedLang }),
        });
      } catch { /* ignore */ }
    }

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
        chartNumber: chartNumber.trim() || undefined,
      },
    });
  };

  // ── Hospital mode: patient-specific UI with chart flow ──
  if (isHospitalMode) {
    return (
      <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] px-6 py-8 flex flex-col">
          {/* Hospital header */}
          <div className="flex-none flex flex-col items-center justify-center text-center pt-4 pb-6">
            <div className="flex items-center gap-3 mb-2">
              <MonoLogo />
              <div className="flex flex-col text-left">
                <span className="text-[10px] font-semibold tracking-[2px] text-[#7C6FEB] uppercase">
                  Hospital
                </span>
                <span className="text-[9px] text-[var(--color-text-secondary)]">
                  Medical Interpreter
                </span>
              </div>
            </div>
          </div>

          {/* Step 1: Chart Number Input */}
          {hospitalStep === "chart" && (
            <div className="flex-1 flex flex-col items-center justify-start">
              <div className="w-full max-w-[360px] space-y-4">
                <div className="text-center mb-2">
                  <p className="text-[15px] font-semibold text-[var(--color-text)]">
                    📋 차트번호 입력
                  </p>
                  <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
                    Enter your chart number / 차트번호를 입력하세요
                  </p>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={chartNumber}
                  onChange={(e) => {
                    setChartNumber(e.target.value.replace(/\D/g, ""));
                    setChartError("");
                  }}
                  placeholder="Chart Number"
                  className="w-full h-[52px] px-4 rounded-[12px] border-2 border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[18px] text-center font-mono tracking-[4px] focus:outline-none focus:border-[#3B82F6] transition-colors"
                  autoFocus
                />
                {chartError && (
                  <p className="text-[12px] text-red-500 text-center">{chartError}</p>
                )}
                <button
                  type="button"
                  onClick={handleChartLookup}
                  className="w-full h-[48px] rounded-[12px] text-[15px] font-semibold bg-[#3B82F6] text-white border-0 active:scale-[0.98] transition-transform"
                >
                  {chartNumber.trim() ? "확인 / Confirm" : "차트번호 없이 진행 / Continue without chart"}
                </button>
                <button
                  type="button"
                  onClick={handleSkipChart}
                  className="w-full h-[40px] rounded-[12px] text-[13px] text-[var(--color-text-secondary)] bg-transparent border border-[var(--color-border)] active:scale-[0.98] transition-transform"
                >
                  건너뛰기 / Skip
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Language Selection */}
          {hospitalStep === "lang" && (
            <div className="flex-1 flex flex-col items-center justify-start">
              <div className="w-full max-w-[360px] space-y-4">
                {/* Revisit badge */}
                {isRevisit && patientInfo && (
                  <div className="p-3 rounded-[12px] bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-center">
                    <p className="text-[13px] font-medium text-green-700 dark:text-green-300">
                      ✅ 재방문 환자 / Returning Patient
                    </p>
                    <p className="text-[11px] text-green-600 dark:text-green-400 mt-0.5">
                      차트 #{patientInfo.chart_number} · 이전 언어: {patientInfo.language?.toUpperCase()}
                    </p>
                  </div>
                )}

                <p className="text-[14px] text-[var(--color-text-secondary)] text-center">
                  Select your language / 언어를 선택하세요
                </p>

                <LanguageFlagPicker
                  selectedLang={selectedLang}
                  showGrid={showLangGrid}
                  onToggleGrid={() => {
                    setShowLangGrid((prev) => {
                      if (prev) setLangConfirmed(true);
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
                    className="w-full h-[52px] rounded-[12px] text-[16px] font-semibold bg-[#3B82F6] text-white border-0 active:scale-[0.98] transition-transform"
                  >
                    🏥 통역 시작
                  </button>
                ) : null}

                {/* Back to chart step */}
                <button
                  type="button"
                  onClick={() => setHospitalStep("chart")}
                  className="w-full h-[36px] text-[12px] text-[var(--color-text-secondary)] bg-transparent"
                >
                  ← 차트번호 다시 입력 / Re-enter chart number
                </button>
              </div>
            </div>
          )}

          <div className="pt-4 pb-2 text-center text-[10px] text-[var(--color-text-secondary)]">
            Powered by MONO Medical Interpreter
          </div>
        </div>
      </div>
    );
  }

  // ── General mode: standard guest join UI ──
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
