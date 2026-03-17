import React, { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import InAppBlocker from "./components/InAppBlocker";
import socket from "./socket";
import { getMyIdentity } from "./db";
import { subscribeToPush } from "./push";

const App = () => {
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

  return (
    <>
      <InAppBlocker />
      <RouterProvider router={router} />
    </>
  );
};

export default App;
