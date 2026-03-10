import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { startKakaoLogin } from "../auth/kakaoLogin";
import { Building2, User } from "lucide-react";

function MonoLogo() {
  return (
    <div className="text-[40px] font-bold tracking-[0.2em] leading-none">
      <span style={{ color: "#7C6FEB" }}>M</span>
      <span style={{ color: "#F472B6" }}>O</span>
      <span style={{ color: "#34D399" }}>N</span>
      <span style={{ color: "#FBBF24" }}>O</span>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  const [purpose, setPurpose] = useState(null); // null | "personal" | "organization"
  const nextPath = purpose === "organization" ? "/org-setup" : "/home";

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] px-6 py-8 flex flex-col">
        <div className="flex-[0_0_35%] flex flex-col items-center justify-center text-center">
          <MonoLogo />
          <p className="mt-4 text-[16px] text-[var(--color-text-secondary)]">{t("login.subtitle")}</p>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center">
          {purpose == null ? (
            <>
              <p className="text-[15px] font-semibold text-[var(--color-text)] mb-4">
                어떤 용도로 사용하시나요?
              </p>
              <div className="w-full max-w-[348px] space-y-3">
                <button
                  type="button"
                  onClick={() => setPurpose("personal")}
                  className="w-full flex items-center justify-center gap-3 py-4 px-4 border-2 border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] hover:border-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] text-left transition-colors"
                >
                  <span className="flex items-center justify-center w-12 h-12 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A5F]">
                    <User size={24} className="text-[#3B82F6]" />
                  </span>
                  <div className="flex-1 text-left">
                    <span className="block text-[15px] font-semibold text-[var(--color-text)]">개인 사용자</span>
                    <span className="block text-[12px] text-[var(--color-text-secondary)]">일반 MONO 메신저·통역</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPurpose("organization")}
                  className="w-full flex items-center justify-center gap-3 py-4 px-4 border-2 border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] hover:border-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] text-left transition-colors"
                >
                  <span className="flex items-center justify-center w-12 h-12 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A5F]">
                    <Building2 size={24} className="text-[#3B82F6]" />
                  </span>
                  <div className="flex-1 text-left">
                    <span className="block text-[15px] font-semibold text-[var(--color-text)]">기관 (병원·기업)</span>
                    <span className="block text-[12px] text-[var(--color-text-secondary)]">병원 대시보드·키오스크 등</span>
                  </div>
                </button>
              </div>
            </>
          ) : (
            <div className="w-full max-w-[348px] space-y-3">
              <button
                type="button"
                onClick={() => setPurpose(null)}
                className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-2"
              >
                ← 다른 용도 선택
              </button>
              <a
                href={`/auth/google?next=${encodeURIComponent(nextPath)}`}
                className="w-full flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-xl bg-white text-[#111] font-medium"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                {t("login.googleLogin")}
              </a>
              <button
                type="button"
                onClick={() => startKakaoLogin(nextPath)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#FEE500] text-[#000000D9] font-medium"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#000000" aria-hidden="true">
                  <path d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.86 5.22 4.65 6.6-.15.53-.96 3.41-.99 3.63 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.7-2.44 4.28-2.86.55.08 1.13.12 1.73.12 5.52 0 10-3.58 10-7.9C22 6.58 17.52 3 12 3z"/>
                </svg>
                {t("login.kakaoLogin")}
              </button>
            </div>
          )}

          {purpose === "personal" && (
            <a href="/interpret" className="mt-5 text-[14px] text-[var(--color-primary)]">
              {t("login.instantQR")}
            </a>
          )}
        </div>

        <div className="pt-4 text-center text-[12px] text-[var(--color-text-secondary)]">
          {t("login.termsAgree")}{" "}
          <a href="/terms" className="underline">{t("login.terms")}</a>{" / "}
          <a href="/privacy" className="underline">{t("login.privacy")}</a>
        </div>
      </div>
    </div>
  );
}
