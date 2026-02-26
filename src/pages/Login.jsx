import React from "react";

function MonoLogo() {
  return (
    <div className="text-[40px] font-bold tracking-[0.2em] leading-none">
      <span style={{ color: "#3B82F6" }}>M</span>
      <span style={{ color: "#F472B6" }}>O</span>
      <span style={{ color: "#34D399" }}>N</span>
      <span style={{ color: "#FBBF24" }}>O</span>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] px-6 py-8 flex flex-col">
        <div className="flex-[0_0_40%] flex flex-col items-center justify-center text-center">
          <MonoLogo />
          <p className="mt-4 text-[16px] text-[var(--color-text-secondary)]">AI 실시간 통역 메신저</p>
        </div>

        <div className="flex-[0_0_60%] flex flex-col items-center justify-center">
          <div className="w-full max-w-[320px] space-y-3">
            <a
              href="/auth/google?next=/home"
              className="mono-btn w-full h-[48px] px-4 rounded-[8px] border border-[#DADCE0] bg-white text-[#111] flex items-center justify-center font-medium"
            >
              <span className="mr-2 inline-flex items-center" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.651 32.657 29.219 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C34.046 6.053 29.27 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 12 24 12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C34.046 6.053 29.27 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                  <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.219-5.238C29.119 35.091 26.682 36 24 36c-5.16 0-9.549-3.28-11.243-7.864l-6.523 5.025C9.546 39.74 16.227 44 24 44z"/>
                  <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.793 2.237-2.231 4.166-4.113 5.57l6.219 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
                </svg>
              </span>
              Google로 계속하기
            </a>
            <a
              href="/auth/kakao?next=/home"
              className="mono-btn w-full h-[48px] px-4 rounded-[8px] border border-[#E6C200] bg-[#FEE500] text-[#191919] flex items-center justify-center font-medium"
            >
              <span className="mr-2 inline-flex items-center" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    fill="#191919"
                    d="M12 3c-5.247 0-9.5 3.313-9.5 7.4 0 2.58 1.7 4.85 4.278 6.172l-1.051 3.84a.45.45 0 0 0 .689.495l4.58-3.02c.333.033.669.053 1.004.053 5.247 0 9.5-3.313 9.5-7.4C21.5 6.313 17.247 3 12 3z"
                  />
                </svg>
              </span>
              카카오로 계속하기
            </a>
          </div>

          <a href="/interpret" className="mt-5 text-[14px] text-[var(--color-primary)]">
            QR코드로 즉시 통역
          </a>
        </div>

        <div className="pt-4 text-center text-[12px] text-[var(--color-text-secondary)]">
          로그인 시 <a href="/terms" className="underline">이용약관</a> 및{" "}
          <a href="/privacy" className="underline">개인정보처리방침</a>에 동의합니다
        </div>
      </div>
    </div>
  );
}

