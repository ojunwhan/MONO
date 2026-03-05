import React from "react";
import { useNavigate } from "react-router-dom";

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-[600px] px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-[14px] text-[var(--color-primary)] flex items-center gap-1"
      >
        ← Back
      </button>

      <h1 className="text-[22px] font-bold mb-6">이용약관 (Terms of Service)</h1>

      <div className="space-y-6 text-[14px] leading-relaxed text-[var(--color-text-primary)]">
        <section>
          <h2 className="text-[16px] font-semibold mb-2">제1조 (목적)</h2>
          <p>
            본 약관은 MONO (이하 "서비스")가 제공하는 실시간 통역 서비스의 이용과 관련하여
            서비스와 이용자 간의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">제2조 (서비스의 내용)</h2>
          <p>서비스는 다음의 기능을 제공합니다:</p>
          <ul className="list-disc ml-5 mt-1 space-y-1">
            <li>실시간 음성 인식(STT) 및 텍스트 번역</li>
            <li>다국어 실시간 통역 채팅</li>
            <li>QR 코드 기반 세션 공유</li>
            <li>병원 키오스크 모드 (차트번호 기반 세션 관리)</li>
            <li>텍스트 음성 변환(TTS)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">제3조 (이용자의 의무)</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>이용자는 서비스를 불법적인 목적으로 사용해서는 안 됩니다.</li>
            <li>타인의 개인정보를 무단으로 수집하거나 도용해서는 안 됩니다.</li>
            <li>서비스의 안정적 운영을 방해하는 행위를 해서는 안 됩니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">제4조 (서비스 이용 제한)</h2>
          <p>
            서비스는 이용자가 본 약관을 위반하거나 서비스 운영에 지장을 초래하는 경우
            사전 통보 없이 서비스 이용을 제한할 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">제5조 (면책 조항)</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>AI 기반 번역의 정확성을 100% 보장하지 않습니다.</li>
            <li>네트워크 장애 등 불가항력으로 인한 서비스 중단에 대해 책임지지 않습니다.</li>
            <li>이용자 간 대화 내용에 대한 책임은 이용자에게 있습니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">제6조 (약관의 변경)</h2>
          <p>
            서비스는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은
            서비스 내 공지를 통해 효력이 발생합니다.
          </p>
        </section>

        <p className="text-[12px] text-[#999] mt-8">
          시행일: 2026년 1월 1일
        </p>
      </div>
    </div>
  );
}
