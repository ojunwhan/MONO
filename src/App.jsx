import React, { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import InAppBlocker from "./components/InAppBlocker"; // ✅ 추가
import OnboardingSlides from "./components/OnboardingSlides";
import socket from "./socket";
import { getMyIdentity } from "./db";
import { subscribeToPush } from "./push";

const App = () => {
  const [showOnboarding, setShowOnboarding] = React.useState(
    () => localStorage.getItem("mono.onboardingDone") !== "1"
  );
  const pathname = window.location.pathname;
  const isHospitalExact = pathname === "/hospital";
  const [hospitalAuthGuard, setHospitalAuthGuard] = React.useState(() =>
    isHospitalExact ? { checked: false, ok: false } : { checked: true, ok: true }
  );

  React.useEffect(() => {
    if (!isHospitalExact) return;
    if (hospitalAuthGuard.checked) return;
    let cancelled = false;
    fetch("/api/hospital/auth/me", { credentials: "include" })
      .then((res) => {
        if (cancelled) return;
        setHospitalAuthGuard({ checked: true, ok: res.ok });
        if (!res.ok) window.location.replace("/hospital-login");
      })
      .catch(() => {
        if (!cancelled) setHospitalAuthGuard({ checked: true, ok: false });
        if (!cancelled) window.location.replace("/hospital-login");
      });
    return () => { cancelled = true; };
  }, [isHospitalExact, hospitalAuthGuard.checked]);

  const isGuestJoinRoute = pathname.startsWith("/join/")
    || pathname.startsWith("/hospital/kiosk/")
    || pathname.startsWith("/hospital/join/")
    || pathname.startsWith("/kiosk")
    || pathname.startsWith("/hospital")
    || pathname.startsWith("/fixed-room/")
    || pathname.startsWith("/fixed/")
    || pathname.startsWith("/admin")
    || pathname.startsWith("/org/");

  useEffect(() => {
    const theme = localStorage.getItem("mono.theme");
    document.documentElement.classList.toggle("dark", theme === "dark");

    // Apply font size from settings (mono.fontSize: "small" | "medium" | "large")
    const applyFontSize = () => {
      const fs = localStorage.getItem("mono.fontSize") || "normal";
      const sizeMap = { small: "14px", normal: "16px", large: "20px" };
      document.documentElement.style.fontSize = sizeMap[fs] || "16px";
    };
    applyFontSize();
    window.addEventListener("storage", applyFontSize);
    // Also listen for custom event dispatched from Settings page
    window.addEventListener("mono:fontSizeChanged", applyFontSize);

    let disposed = false;
    let registerHandler = null;
    // App first load: restore identity -> register user -> subscribe push.
    getMyIdentity().then((me) => {
      if (disposed || !me?.userId) return;
      registerHandler = () => {
        socket.emit("register-user", {
          userId: me.userId,
          canonicalName: me.canonicalName,
          lang: me.lang,
        });
      };
      if (socket.connected) registerHandler();
      socket.on("connect", registerHandler);
      subscribeToPush(me.userId).catch(() => {});
    }).catch(() => {});

    return () => {
      disposed = true;
      if (registerHandler) socket.off("connect", registerHandler);
      window.removeEventListener("storage", applyFontSize);
      window.removeEventListener("mono:fontSizeChanged", applyFontSize);
    };
  }, []);

  if (isHospitalExact && !hospitalAuthGuard.checked) {
    return (
      <>
        <InAppBlocker />
        <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
          <span>로그인 확인 중...</span>
        </div>
      </>
    );
  }
  if (isHospitalExact && hospitalAuthGuard.checked && !hospitalAuthGuard.ok) {
    return <InAppBlocker />;
  }

  return (
    <>
      <InAppBlocker />   {/* ✅ 인앱 브라우저 차단 */}
      <RouterProvider router={router} />
      {!isGuestJoinRoute ? (
        <OnboardingSlides
          open={showOnboarding}
          onClose={() => {
            localStorage.setItem("mono.onboardingDone", "1");
            setShowOnboarding(false);
          }}
        />
      ) : null}
    </>
  );
};

export default App;
