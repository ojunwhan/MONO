import React, { useState } from "react";
import { useTranslation } from "react-i18next";

export default function OnboardingSlides({ open, onClose }) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const SLIDES = [
    { title: t("onboarding.slide1Title"), body: t("onboarding.slide1Body"), icon: "💬" },
    { title: t("onboarding.slide2Title"), body: t("onboarding.slide2Body"), icon: "👥" },
    { title: t("onboarding.slide3Title"), body: t("onboarding.slide3Body"), icon: "🔳" },
  ];
  if (!open) return null;
  const isLast = idx === SLIDES.length - 1;
  const current = SLIDES[idx];
  return (
    <div className="fixed inset-0 z-[120] bg-[var(--color-bg)]">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 text-[14px] text-[var(--color-text-secondary)]">
        {t("onboarding.skip")}
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
          {isLast ? t("onboarding.start") : t("onboarding.next")}
        </button>
      </div>
    </div>
  );
}

