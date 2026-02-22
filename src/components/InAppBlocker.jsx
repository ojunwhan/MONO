import React, { useEffect, useMemo } from "react";

function detectInApp() {
  const ua = navigator.userAgent || "";
  const isKakao = /KAKAOTALK/i.test(ua);
  const isFB = /FBAN|FBAV|Instagram/i.test(ua);
  const isLine = /Line/i.test(ua);
  return { isInApp: isKakao || isFB || isLine, isKakao };
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent || "");
}

export default function InAppBlocker() {
  const { isInApp, isKakao } = useMemo(detectInApp, []);
  const android = useMemo(isAndroid, []);

  useEffect(() => {
    // ✅ 안드로이드 + 카톡 인앱이면 자동으로 크롬 강제 오픈
    if (isInApp && isKakao && android) {
      const url = window.location.href.replace(/^https?:\/\//, "");
      const intent = `intent://${url}#Intent;scheme=https;package=com.android.chrome;end`;
      window.location.href = intent;
    }
  }, [isInApp, isKakao, android]);

  if (!isInApp) return null;

  // ✅ iOS 또는 강제 전환 불가 환경 → 안내 화면
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#F5F5F5",
        color: "#111111",
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        lineHeight: 1.6,
      }}
    >
      <div>
        <h2 style={{ marginBottom: 12, fontSize: 20, fontWeight: 700 }}>
          외부 브라우저로 열어주세요
        </h2>
        <p style={{ fontSize: 14 }}>
          현재 브라우저에서는 통화/번역 연결이 자주 끊깁니다.<br />
          아래 버튼을 눌러 Safari 또는 Chrome에서 다시 열어주세요.
        </p>

        <button
          style={{
            marginTop: 18,
            padding: "12px 18px",
            background: "#00E5FF",
            color: "#111111",
            border: "1px solid #111111",
            fontSize: 16,
            fontWeight: 500,
            cursor: "pointer",
          }}
          onClick={() => {
            // iOS: 새 탭 → Safari
            window.open(window.location.href, "_blank");
          }}
        >
          브라우저에서 열기
        </button>

        <p style={{ marginTop: 16, fontSize: 14 }}>
          카톡 우측 상단 ··· → 다른 브라우저에서 열기도 가능합니다
        </p>
      </div>
    </div>
  );
}
