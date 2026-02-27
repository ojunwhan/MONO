import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
          {t("inAppBlocker.title")}
        </h2>
        <p style={{ fontSize: 14 }}>
          {t("inAppBlocker.body1")}<br />
          {t("inAppBlocker.body2")}
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
          {t("inAppBlocker.openBrowser")}
        </button>

        <p style={{ marginTop: 16, fontSize: 14 }}>
          {t("inAppBlocker.hint")}
        </p>
      </div>
    </div>
  );
}
