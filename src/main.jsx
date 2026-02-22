// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

// ✅ React 앱 렌더링
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ✅ Service Worker 등록 (push notification + offline)
// NOTE: 기존 SW를 전부 해제하던 코드를 제거 — push subscription이 사라지는 원인이었음
if ("serviceWorker" in navigator) {
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
