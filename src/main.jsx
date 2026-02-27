// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import "./i18n";
import { initNotificationSound, unlockNotificationSound } from "./audio/notificationSound";

// ✅ React 앱 렌더링
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

initNotificationSound();
const unlockOnce = () => {
  unlockNotificationSound();
  window.removeEventListener("pointerdown", unlockOnce);
  window.removeEventListener("touchstart", unlockOnce);
  window.removeEventListener("keydown", unlockOnce);
};
window.addEventListener("pointerdown", unlockOnce, { passive: true });
window.addEventListener("touchstart", unlockOnce, { passive: true });
window.addEventListener("keydown", unlockOnce);

// ✅ Service Worker 등록 (push notification + offline)
// DEV에서는 캐시로 인한 구버전 화면 문제를 막기 위해 SW를 해제하고,
// PROD에서만 SW를 등록한다.
if ("serviceWorker" in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("✅ Service Worker registered:", registration.scope);

          // Notification permission 요청 (첫 방문 시)
          if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().then((perm) => {
              console.log("[push] Notification permission:", perm);
            });
          }
        })
        .catch((err) => console.error("❌ SW registration failed:", err));
    });
  }
}
