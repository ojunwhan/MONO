import React from "react";

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
  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] px-6 py-8 flex flex-col">
        <div className="flex-[0_0_40%] flex flex-col items-center justify-center text-center">
          <MonoLogo />
          <p className="mt-4 text-[16px] text-[var(--color-text-secondary)]">AI 실시간 통역 메신저</p>
        </div>

        <div className="flex-[0_0_60%] flex flex-col items-center justify-center">
          <div className="w-full max-w-[348px] space-y-3">
            <a
              href="/auth/google?next=/home"
              className="w-full flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-xl bg-white text-[#111] font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Google로 계속하기
            </a>
            <a
              href="/auth/kakao?next=/home"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#FEE500] text-[#000000D9] font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#000000" aria-hidden="true">
                <path d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.86 5.22 4.65 6.6-.15.53-.96 3.41-.99 3.63 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.7-2.44 4.28-2.86.55.08 1.13.12 1.73.12 5.52 0 10-3.58 10-7.9C22 6.58 17.52 3 12 3z"/>
              </svg>
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

