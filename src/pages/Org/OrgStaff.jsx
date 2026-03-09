/**
 * OrgStaff — 기관/부서 전용 직원 화면
 * URL: /org/:orgCode/:deptCode/staff
 *
 * 파이프라인 config 로드 후:
 * - input === 'kiosk_qr' → 대기 목록 방식 (환자 QR 스캔 대기)
 * - input === 'staff_ptt' → PTT 버튼 방식 (향후 확장)
 *
 * 대기 목록 방식은 기존 HospitalApp.jsx StaffModePanel 동작과 동일.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import MonoLogo from "../../components/MonoLogo";
import LanguageFlagPicker from "../../components/LanguageFlagPicker";
import { getLanguageByCode } from "../../constants/languages";
import { detectUserLanguage } from "../../constants/languageProfiles";
import socket from "../../socket";
import { playNotificationSound } from "../../audio/notificationSound";
import { Monitor, Bell, Users } from "lucide-react";

export default function OrgStaff() {
  const { orgCode, deptCode } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Language
  const detected = useMemo(() => detectUserLanguage(), []);
  const savedLang = useMemo(() => {
    const s = localStorage.getItem("myLang");
    return getLanguageByCode(s)?.code || "";
  }, []);
  const [selectedLang, setSelectedLang] = useState(savedLang || detected?.code || "ko");
  const [showLangGrid, setShowLangGrid] = useState(false);

  // Staff state
  const [waitingPatients, setWaitingPatients] = useState([]);
  const [staffJoined, setStaffJoined] = useState(false);
  const joinedRef = useRef(false);

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

  // ── 대기 환자 소켓 구독 ──
  useEffect(() => {
    if (!config || joinedRef.current) return;
    joinedRef.current = true;

    // deptCode를 department로 사용하여 기존 hospital:watch 소켓과 호환
    const doWatch = () => {
      console.log(`[org-staff] Watching: ${orgCode}/${deptCode}`);
      socket.emit("hospital:watch", { department: deptCode, orgCode });
      setStaffJoined(true);
    };

    if (socket.connected) doWatch();
    else socket.connect();

    const onConnect = () => doWatch();
    socket.on("connect", onConnect);

    return () => {
      socket.off("connect", onConnect);
      if (socket.connected) {
        socket.emit("hospital:unwatch", { department: deptCode, orgCode });
      }
      joinedRef.current = false;
    };
  }, [config, orgCode, deptCode]);

  // ── 환자 대기 알림 수신 ──
  useEffect(() => {
    if (!config) return;

    const onPatientWaiting = (data) => {
      console.log("[org-staff] Patient waiting:", data);
      playNotificationSound();
      try {
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          new Notification("MONO", { body: "환자가 대기 중입니다" });
        }
        if (navigator?.vibrate) navigator.vibrate([200, 100, 200]);
      } catch {}
      setWaitingPatients((prev) => {
        if (prev.some((p) => p.roomId === data?.roomId)) return prev;
        return [...prev, {
          roomId: data?.roomId,
          department: data?.department || deptCode,
          language: data?.language || "unknown",
          patientToken: data?.patientToken || null,
          createdAt: data?.createdAt || new Date().toISOString(),
        }];
      });
    };

    const onPatientPicked = (data) => {
      setWaitingPatients((prev) => prev.filter((p) => p.roomId !== data?.roomId));
    };

    socket.on("hospital:patient-waiting", onPatientWaiting);
    socket.on("hospital:patient-picked", onPatientPicked);

    return () => {
      socket.off("hospital:patient-waiting", onPatientWaiting);
      socket.off("hospital:patient-picked", onPatientPicked);
    };
  }, [config, deptCode]);

  // ── Notification 권한 ──
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ── 통역 시작 ──
  const handleStartInterpretation = useCallback(async (patient) => {
    localStorage.setItem("myLang", selectedLang);
    const targetRoomId = patient.roomId;

    try {
      await fetch(`/api/hospital/waiting/${encodeURIComponent(targetRoomId)}`, { method: "DELETE" });
    } catch {}

    setWaitingPatients((prev) => prev.filter((p) => p.roomId !== targetRoomId));

    // 번역 컨텍스트 결정
    const translateBlock = config?.pipeline?.translate || "gpt4o_general";
    let siteContext = "general";
    if (translateBlock.includes("hospital")) siteContext = `hospital_${deptCode}`;
    else if (translateBlock.includes("legal")) siteContext = `legal_${deptCode}`;
    else if (translateBlock.includes("industrial")) siteContext = `industrial_${deptCode}`;
    else siteContext = `org_${deptCode}`;

    // output 타입에 따라 다른 화면으로 진입
    const outputType = config?.pipeline?.output;
    const runtime = config?.pipeline?.runtime || {};
    const saveMessages = runtime.storageMode === "db";
    const summaryOnly = runtime.storageMode === "summary";

    const targetPath = outputType === "subtitle" || outputType === "chat_bubble"
      ? `/fixed-room/${targetRoomId}`
      : `/room/${targetRoomId}`;

    navigate(targetPath, {
      state: {
        fromLang: selectedLang,
        localName: "",
        role: "Doctor",
        isCreator: true,
        siteContext,
        roomType: "oneToOne",
        hospitalDept: { id: deptCode, labelKo: config?.deptName, label: config?.deptNameEn || deptCode },
        patientToken: patient.patientToken || null,
        orgCode,
        deptCode,
        contextInject: runtime.contextInject === true,
        saveMessages,
        summaryOnly,
      },
    });
  }, [config, deptCode, navigate, orgCode, selectedLang]);

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg, #fff)" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #e5e7eb", borderTopColor: "#3B82F6", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Error ──
  if (error || !config) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff", padding: "32px 24px" }}>
        <MonoLogo />
        <p style={{ marginTop: 24, fontSize: 16, color: "#DC2626", fontWeight: 500 }}>⚠️ {error || "설정 불러오기 실패"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between max-w-[600px] mx-auto">
          <div className="flex items-center gap-3">
            <MonoLogo />
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-bold text-[var(--color-text)] truncate">{config.orgName}</span>
              <span className="text-[11px] text-[var(--color-text-secondary)]">{config.deptName}</span>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-[#DBEAFE] text-[#1D4ED8] text-[11px] font-semibold flex items-center gap-1">
            <Monitor size={12} />
            직원 모드
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 py-6 max-w-[600px] mx-auto w-full">
        {/* 언어 선택 */}
        <div className="w-full max-w-[360px] mb-6">
          <LanguageFlagPicker
            selectedLang={selectedLang}
            showGrid={showLangGrid}
            onToggleGrid={() => setShowLangGrid((p) => !p)}
            onSelect={(code) => {
              setSelectedLang(code);
              localStorage.setItem("myLang", code);
              setShowLangGrid(false);
            }}
          />
        </div>

        {!showLangGrid && (
          <>
            {/* 연결 상태 */}
            <div className="w-full max-w-[400px] mb-4">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-[12px] font-medium ${
                staffJoined
                  ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
                  : "bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800"
              }`}>
                <span className={`w-2 h-2 rounded-full ${staffJoined ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
                {staffJoined ? "대기 중 — QR 스캔을 기다리고 있습니다" : "연결 중..."}
              </div>
            </div>

            {/* 대기 중인 환자 목록 */}
            {waitingPatients.length > 0 && (
              <div className="w-full max-w-[400px] mb-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Bell size={16} className="text-[#F59E0B] animate-bounce" />
                  <span className="text-[14px] font-semibold text-[var(--color-text)]">
                    대기 중 ({waitingPatients.length}명)
                  </span>
                </div>
                {waitingPatients.map((patient, idx) => {
                  const waitSec = Math.floor((Date.now() - new Date(patient.createdAt).getTime()) / 1000);
                  const langInfo = getLanguageByCode(patient.language);
                  return (
                    <div
                      key={patient.roomId || idx}
                      className="flex items-center justify-between p-4 rounded-[14px] border-2 border-[#F59E0B] bg-[#FFFBEB] dark:bg-[#422006] animate-pulse"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[28px]">🧑‍⚕️</span>
                        <div>
                          <p className="text-[14px] font-semibold text-[var(--color-text)]">방문자 #{idx + 1}</p>
                          <p className="text-[11px] text-[var(--color-text-secondary)]">
                            언어: {langInfo?.name || patient.language} · 대기 {waitSec < 60 ? `${waitSec}초` : `${Math.floor(waitSec / 60)}분`}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartInterpretation(patient)}
                        className="px-5 py-2.5 rounded-[12px] bg-[#3B82F6] text-white text-[14px] font-semibold hover:bg-[#2563EB] active:scale-[0.97] transition-all flex items-center gap-2"
                      >
                        <Monitor size={16} />
                        통역 시작
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 환자 없을 때 */}
            {waitingPatients.length === 0 && (
              <div className="w-full max-w-[400px] mb-4 p-6 rounded-[16px] border border-dashed border-[var(--color-border)] text-center">
                <Users size={32} className="mx-auto mb-3 text-[var(--color-text-secondary)] opacity-40" />
                <p className="text-[14px] text-[var(--color-text-secondary)]">대기 중인 방문자가 없습니다</p>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                  키오스크의 QR 코드를 스캔하면 여기에 알림이 표시됩니다
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex-none py-3 text-center">
        <p className="text-[10px] text-[var(--color-text-secondary)]">Powered by MONO Interpreter</p>
      </div>
    </div>
  );
}
