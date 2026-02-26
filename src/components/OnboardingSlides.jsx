import React, { useState } from "react";

const SLIDES = [
  { title: "언어가 달라도 대화가 됩니다", body: "실시간 번역으로 자연스럽게 대화해보세요.", icon: "💬" },
  { title: "친구를 추가하고 대화를 시작하세요", body: "MONO ID 검색으로 빠르게 친구를 찾을 수 있습니다.", icon: "👥" },
  { title: "QR코드 하나로 즉시 통역", body: "통역 탭에서 QR을 열고 바로 대화를 시작하세요.", icon: "🔳" },
];

export default function OnboardingSlides({ open, onClose }) {
  const [idx, setIdx] = useState(0);
  if (!open) return null;
  const isLast = idx === SLIDES.length - 1;
  const current = SLIDES[idx];
  return (
    <div className="fixed inset-0 z-[120] bg-[var(--color-bg)]">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 text-[14px] text-[var(--color-text-secondary)]">
        건너뛰기
      </button>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col items-center justify-center px-8 text-center">
        <div className="text-[56px]">{current.icon}</div>
        <h2 className="mt-6 text-[22px] font-semibold">{current.title}</h2>
        <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">{current.body}</p>
        <div className="mt-8 flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full ${i === idx ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => (isLast ? onClose() : setIdx((v) => v + 1))}
          className="mono-btn mt-8 h-[44px] w-full max-w-[280px] border border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
        >
          {isLast ? "시작하기" : "다음"}
        </button>
      </div>
    </div>
  );
}

