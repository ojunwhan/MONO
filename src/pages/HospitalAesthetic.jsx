// src/pages/HospitalAesthetic.jsx
// 성형외과 / 피부과 / 피부미용시술 클리닉 전용 랜딩 페이지
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import MonoLogo from "../components/MonoLogo";
import QRCodeBox from "../components/QRCodeBox";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import { detectUserLanguage } from "../constants/languageProfiles";
import { getLanguageByCode } from "../constants/languages";
import { RotateCcw, ChevronLeft } from "lucide-react";

// ── 병원명 (나중에 교체 가능) ──
const CLINIC_NAME = "성형/피부 클리닉";
const SITE_CONTEXT = "hospital_plastic_surgery";

export default function HospitalAesthetic() {
  const navigate = useNavigate();

  // ── View state ──
  const [view, setView] = useState("landing"); // "landing" | "consultation"

  // ── Language ──
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const saved = localStorage.getItem("myLang");
    if (saved) return getLanguageByCode(saved)?.code || "";
    return "";
  }, []);
  const initialLang = useMemo(
    () => savedLang || detected?.code || "ko",
    [detected, savedLang]
  );
  const [selectedLang, setSelectedLang] = useState(initialLang);
  const [showLangGrid, setShowLangGrid] = useState(false);

  // ── Room (host QR) ──
  const [roomId, setRoomId] = useState(() => uuidv4());
  const [hostPid, setHostPid] = useState(
    () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  );

  const handleNewSession = () => {
    setRoomId(uuidv4());
    setHostPid(
      crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
    );
  };

  // ═══════════════════════════════════════════
  // VIEW: CONSULTATION (상담실 모드 — QR 즉시 표시)
  // ═══════════════════════════════════════════
  if (view === "consultation") {
    return (
      <div className="min-h-[100dvh] bg-white dark:bg-[#111] text-[var(--color-text)]">
        <div className="mx-auto w-full max-w-[520px] px-4 py-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => setView("landing")}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronLeft size={24} />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <MonoLogo className="!text-[24px]" />
              </div>
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                {CLINIC_NAME} · 상담 통역
              </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-[#F3E8FF] text-[#7C3AED] text-[11px] font-semibold">
              💎 상담실 모드
            </span>
          </div>

          {/* 언어 선택 */}
          <div className="mb-4">
            <LanguageFlagPicker
              selectedLang={selectedLang}
              showGrid={showLangGrid}
              onToggleGrid={() => setShowLangGrid((prev) => !prev)}
              onSelect={(code) => {
                setSelectedLang(code);
                localStorage.setItem("myLang", code);
                setShowLangGrid(false);
              }}
            />
          </div>

          {!showLangGrid && (
            <>
              {/* 안내 */}
              <div className="mb-4 px-3 py-2 rounded-[10px] bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800">
                <p className="text-[11px] text-purple-600 dark:text-purple-400">
                  💎 <strong>{CLINIC_NAME}</strong> 전문 통역 프롬프트 적용 중
                </p>
                <p className="text-[10px] text-purple-500 mt-0.5">
                  환자가 QR을 스캔하면 바로 1:1 통역이 시작됩니다
                </p>
              </div>

              {/* QRCodeBox — 기존 MONO 호스트 플로우 그대로 */}
              <div className="flex flex-col items-center">
                <QRCodeBox
                  key={roomId}
                  roomId={roomId}
                  fromLang={selectedLang}
                  participantId={hostPid}
                  siteContext={SITE_CONTEXT}
                  role="Doctor"
                  localName=""
                  roomType="oneToOne"
                />
              </div>

              {/* 새 QR 생성 */}
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <RotateCcw size={14} /> 새 QR 생성
                </button>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-[10px] text-[var(--color-text-secondary)]">
              Powered by MONO Medical Interpreter
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // VIEW: LANDING (메인 — 버튼 2개)
  // ═══════════════════════════════════════════
  return (
    <div className="min-h-[100dvh] bg-white dark:bg-[#111] flex flex-col items-center justify-center px-6 py-12">
      {/* Logo */}
      <div className="mb-3">
        <MonoLogo />
      </div>

      {/* Subtitle */}
      <p className="text-[16px] font-semibold text-[var(--color-text)] mb-1">
        {CLINIC_NAME}
      </p>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-10">
        성형 · 피부 상담 통역
      </p>

      {/* Icon */}
      <div className="mb-10">
        <span className="text-[72px] block">💎</span>
      </div>

      {/* Buttons */}
      <div className="w-full max-w-[360px] space-y-4">
        {/* 키오스크 모드 */}
        <button
          type="button"
          onClick={() =>
            navigate("/hospital/kiosk/plastic_surgery")
          }
          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-[16px] border-2 border-[var(--color-border)] bg-white dark:bg-[#1a1a1a] hover:border-[#7C6FEB] hover:bg-[#F5F3FF] dark:hover:bg-[#2d2440] transition-all active:scale-[0.97]"
        >
          <span className="text-[28px]">📱</span>
          <div className="text-left">
            <p className="text-[15px] font-semibold text-[var(--color-text)]">
              키오스크 모드
            </p>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              대기실 태블릿 QR 표시용
            </p>
          </div>
        </button>

        {/* 상담실 모드 */}
        <button
          type="button"
          onClick={() => setView("consultation")}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-[16px] border-2 border-[#7C3AED] bg-[#F5F3FF] dark:bg-[#2d2440] hover:bg-[#EDE9FE] dark:hover:bg-[#3d3060] transition-all active:scale-[0.97]"
        >
          <span className="text-[28px]">💬</span>
          <div className="text-left">
            <p className="text-[15px] font-semibold text-[#7C3AED]">
              상담실 모드
            </p>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              QR 생성 → 환자 스캔 → 1:1 통역 시작
            </p>
          </div>
        </button>
      </div>

      {/* Footer */}
      <div className="mt-auto pt-12 text-center">
        <p className="text-[10px] text-[var(--color-text-secondary)]">
          Powered by MONO Medical Interpreter
        </p>
      </div>
    </div>
  );
}
