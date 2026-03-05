import React from "react";
import { useNavigate } from "react-router-dom";

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-[600px] px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-[14px] text-[var(--color-primary)] flex items-center gap-1"
      >
        ← Back
      </button>

      <h1 className="text-[22px] font-bold mb-6">개인정보처리방침 (Privacy Policy)</h1>

      <div className="space-y-6 text-[14px] leading-relaxed text-[var(--color-text-primary)]">
        <section>
          <h2 className="text-[16px] font-semibold mb-2">1. 수집하는 개인정보</h2>
          <p>서비스는 다음의 개인정보를 수집합니다:</p>
          <ul className="list-disc ml-5 mt-1 space-y-1">
            <li><strong>소셜 로그인 정보:</strong> 이메일, 이름, 프로필 사진 (Google, Kakao 로그인 시)</li>
            <li><strong>서비스 이용 정보:</strong> 접속 IP, 브라우저 정보, 접속 시간</li>
            <li><strong>대화 데이터:</strong> 음성 인식 텍스트, 번역 텍스트 (세션 중에만 처리)</li>
            <li><strong>병원 모드:</strong> 차트번호 (병원 모드 사용 시에만, 의료기관의 요청에 의해)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">2. 개인정보의 이용 목적</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>실시간 통역 서비스 제공</li>
            <li>서비스 품질 개선 및 오류 분석</li>
            <li>사용자 인증 및 계정 관리</li>
            <li>서비스 이용 통계 분석</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">3. 개인정보의 보유 기간</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li><strong>계정 정보:</strong> 회원 탈퇴 시까지</li>
            <li><strong>대화 데이터:</strong> 일반 모드 - 세션 종료 시 서버에서 자동 삭제</li>
            <li><strong>병원 모드 대화:</strong> 의료기관 보관 정책에 따름</li>
            <li><strong>접속 로그:</strong> 3개월</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">4. 개인정보의 제3자 제공</h2>
          <p>
            서비스는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다.
            단, 다음의 경우 예외로 합니다:
          </p>
          <ul className="list-disc ml-5 mt-1 space-y-1">
            <li>법령에 의한 요청이 있는 경우</li>
            <li>서비스 제공을 위해 필요한 외부 API (Google, OpenAI, Groq) 처리 시
              최소한의 데이터만 전송</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">5. 이용자의 권리</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>개인정보 열람, 수정, 삭제 요청</li>
            <li>계정 삭제 (설정 페이지에서 직접 가능)</li>
            <li>로컬 데이터 초기화 (설정 페이지에서 직접 가능)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">6. 쿠키 및 로컬 스토리지</h2>
          <p>
            서비스는 인증 토큰 저장을 위해 쿠키를 사용하며,
            사용자 설정(언어, 테마, 알림 등)을 localStorage에 저장합니다.
            이는 브라우저 설정에서 삭제할 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-2">7. 개인정보 보호 책임자</h2>
          <p>
            개인정보 관련 문의는 서비스 내 고객센터 채팅 또는 이메일을 통해 접수할 수 있습니다.
          </p>
        </section>

        <p className="text-[12px] text-[#999] mt-8">
          시행일: 2026년 1월 1일
        </p>
      </div>
    </div>
  );
}
