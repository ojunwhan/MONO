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
              Google로 계속하기
            </a>
            <a
              href="/auth/kakao?next=/home"
              className="mono-btn w-full h-[48px] px-4 rounded-[8px] border border-[#E6C200] bg-[#FEE500] text-[#191919] flex items-center justify-center font-medium"
            >
              카카오로 계속하기
            </a>
            <a
              href="/auth/apple?next=/home"
              className="mono-btn w-full h-[48px] px-4 rounded-[8px] border border-[#111] bg-[#111] text-white flex items-center justify-center font-medium"
            >
              Apple로 계속하기
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

