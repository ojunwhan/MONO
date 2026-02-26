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
  const isGuestJoinRoute = window.location.pathname.startsWith("/join/");

  useEffect(() => {
    const theme = localStorage.getItem("mono.theme");
    document.documentElement.classList.toggle("dark", theme === "dark");

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
    };
  }, []);

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
