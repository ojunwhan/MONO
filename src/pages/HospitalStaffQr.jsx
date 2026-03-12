// src/pages/HospitalStaffQr.jsx — 스태프 폰 전용: 병원 QR만 크게 표시 (환자가 스태프 폰 QR 스캔)
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import MonoLogo from "../components/MonoLogo";

export default function HospitalStaffQr() {
  const { orgCode } = useParams();
  const qrUrl = useMemo(
    () => `${window.location.origin}/hospital/join/${encodeURIComponent(orgCode || "reception")}`,
    [orgCode]
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <MonoLogo />
      </div>
      <div
        style={{
          padding: "20px",
          borderRadius: "16px",
          backgroundColor: "#fff",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          marginBottom: "24px",
        }}
      >
        <QRCode value={qrUrl} size={260} bgColor="#FFFFFF" fgColor="#3B82F6" level="M" />
      </div>
      <p
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "#374151",
          textAlign: "center",
          margin: 0,
        }}
      >
        환자에게 스캔하게 하세요
      </p>
      <p style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px", textAlign: "center" }}>
        Have patient scan this QR
      </p>
    </div>
  );
}
