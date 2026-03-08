/**
 * OrgKiosk — 기관/부서 전용 키오스크 QR 화면
 * URL: /org/:orgCode/:deptCode/kiosk
 *
 * 파이프라인 config 로드 후 QR 표시.
 * QR → /org/:orgCode/:deptCode/join 으로 연결.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import MonoLogo from "../../components/MonoLogo";

// ── 다국어 안내 문구 ──
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

// ── Wake Lock ──
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      const lock = await navigator.wakeLock.request("screen");
      console.log("[org-kiosk] 🔒 Wake Lock acquired");
      return lock;
    }
  } catch (e) {
    console.warn("[org-kiosk] Wake Lock failed:", e?.message);
  }
  return null;
}

export default function OrgKiosk() {
  const { orgCode, deptCode } = useParams();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guideIdx, setGuideIdx] = useState(0);
  const wakeLockRef = useRef(null);

  // ── config 로드 ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/org/${encodeURIComponent(orgCode)}/${encodeURIComponent(deptCode)}/config`);
        if (!res.ok) {
          setError(res.status === 404 ? "기관 또는 부서를 찾을 수 없습니다" : "서버 오류");
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (data.ok) setConfig(data);
        else setError(data.error || "설정 불러오기 실패");
      } catch {
        setError("서버에 연결할 수 없습니다");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgCode, deptCode]);

  // ── Wake Lock ──
  useEffect(() => {
    requestWakeLock().then((lock) => { wakeLockRef.current = lock; });
    const onVis = async () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        wakeLockRef.current = await requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    };
  }, []);

  // ── 안내문구 순환 ──
  useEffect(() => {
    const iv = setInterval(() => setGuideIdx((p) => (p + 1) % GUIDE_MESSAGES.length), 3000);
    return () => clearInterval(iv);
  }, []);

  // QR URL
  const qrUrl = useMemo(() => {
    const base = window.location.origin;
    return `${base}/org/${encodeURIComponent(orgCode)}/${encodeURIComponent(deptCode)}/join`;
  }, [orgCode, deptCode]);

  if (loading) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #e5e7eb", borderTopColor: "#3B82F6", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff", padding: "32px 24px" }}>
        <MonoLogo />
        <p style={{ marginTop: 24, fontSize: 16, color: "#DC2626", fontWeight: 500 }}>⚠️ {error || "설정 불러오기 실패"}</p>
      </div>
    );
  }

  const primaryColor = config.primaryColor || "#3B82F6";

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

      {/* Org & Dept Info */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px 0" }}>
          {config.orgName}
        </h1>
        <p style={{ fontSize: "18px", color: "#6b7280", margin: "0 0 4px 0" }}>
          {config.deptName}
        </p>
        {config.deptNameEn && (
          <p style={{ fontSize: "14px", color: "#9ca3af", margin: 0 }}>{config.deptNameEn}</p>
        )}
      </div>

      {/* Welcome message */}
      {config.welcomeMsg && (
        <p style={{ fontSize: "14px", color: "#374151", textAlign: "center", marginBottom: "20px", maxWidth: "360px" }}>
          {config.welcomeMsg}
        </p>
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
        <QRCode value={qrUrl} size={280} bgColor="#FFFFFF" fgColor={primaryColor} level="M" />
      </div>

      {/* Rotating guide message */}
      <div style={{ minHeight: "48px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p
          key={guideIdx}
          style={{
            fontSize: "20px",
            fontWeight: 500,
            color: primaryColor,
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
          Powered by MONO Interpreter
        </p>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
