// src/pages/HospitalKiosk.jsx — 태블릿 거치용 고정 QR 화면
import { useEffect, useState, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import MonoLogo from "../components/MonoLogo";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";

// ── Multilingual guide messages ──
const GUIDE_MESSAGES = [
  "QR을 스캔하세요",
  "Scan QR Code",
  "扫描二维码",
  "Quét mã QR",
  "QRコードをスキャン",
  "คิวอาร์โค้ดสแกน",
  "QR कोड स्क्यान गर्नुहोस्",
  "Сканируйте QR-код",
];

// ── Wake Lock helper ──
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      const lock = await navigator.wakeLock.request("screen");
      console.log("[kiosk] 🔒 Wake Lock acquired");
      return lock;
    }
  } catch (e) {
    console.warn("[kiosk] Wake Lock failed:", e?.message);
  }
  return null;
}

export default function HospitalKiosk() {
  const { department } = useParams();
  const [guideIdx, setGuideIdx] = useState(0);
  const wakeLockRef = useRef(null);

  // Dept info
  const dept = useMemo(
    () => HOSPITAL_DEPARTMENTS.find((d) => d.id === department) || null,
    [department]
  );

  // QR URL — always points to the patient join page (fixed URL)
  const qrUrl = useMemo(() => {
    const base = window.location.origin;
    return `${base}/hospital/join/${encodeURIComponent(department || "general")}`;
  }, [department]);

  // ── Wake Lock ──
  useEffect(() => {
    requestWakeLock().then((lock) => {
      wakeLockRef.current = lock;
    });
    const onVisChange = async () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        wakeLockRef.current = await requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // ── Rotate guide messages every 3 seconds ──
  useEffect(() => {
    const iv = setInterval(() => {
      setGuideIdx((prev) => (prev + 1) % GUIDE_MESSAGES.length);
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        userSelect: "none",
      }}
    >
      {/* Logo */}
      <div style={{ marginBottom: "32px" }}>
        <MonoLogo />
      </div>

      {/* Department Info */}
      {dept && (
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <span style={{ fontSize: "56px", display: "block", marginBottom: "8px" }}>
            {dept.icon}
          </span>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#1a1a1a",
              margin: "0 0 4px 0",
            }}
          >
            {dept.labelKo}
          </h1>
          <p style={{ fontSize: "16px", color: "#6b7280", margin: 0 }}>
            {dept.label}
          </p>
        </div>
      )}

      {/* QR Code */}
      <div
        style={{
          padding: "24px",
          borderRadius: "20px",
          backgroundColor: "#ffffff",
          boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
          marginBottom: "32px",
        }}
      >
        <QRCode
          value={qrUrl}
          size={280}
          bgColor="#FFFFFF"
          fgColor="#3B82F6"
          level="M"
        />
      </div>

      {/* Rotating guide message */}
      <div
        style={{
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p
          key={guideIdx}
          style={{
            fontSize: "20px",
            fontWeight: 500,
            color: "#3B82F6",
            textAlign: "center",
            margin: 0,
            animation: "fadeInUp 0.5s ease-out",
          }}
        >
          {GUIDE_MESSAGES[guideIdx]}
        </p>
      </div>

      {/* Footer */}
      <div style={{ marginTop: "auto", paddingTop: "32px" }}>
        <p style={{ fontSize: "11px", color: "#9ca3af", textAlign: "center" }}>
          Powered by MONO Medical Interpreter
        </p>
      </div>

      {/* CSS animation */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
