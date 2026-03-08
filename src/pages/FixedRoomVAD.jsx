/**
 * FixedRoomVAD — 병원 직원용 VAD 자동감지 통역 화면
 *
 * URL: /fixed-room/:roomId
 * 진입: HospitalApp.jsx StaffModePanel → "통역 시작" 클릭
 *
 * 3단계 흐름:
 *   step="waiting"       → 환자 연결 대기
 *   step="ready"         → 환자 연결됨, 통역 시작 버튼
 *   step="interpreting"  → VAD 자동감지 통역 중
 *
 * 환자 측은 기존 ChatScreen (/room/:roomId) 그대로 유지
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useVADPipeline } from "../hooks/useVADPipeline";
import MessageBubble from "../components/MessageBubble";
import socket from "../socket";
import { v4 as uuidv4 } from "uuid";
import { getLanguageProfileByCode } from "../constants/languageProfiles";
import { Mic, MicOff, Loader2, UserCheck, Clock, ArrowLeft, Phone, PhoneOff } from "lucide-react";

const STATUS = {
  IDLE: "대기 중",
  LOADING: "VAD 모델 로딩 중...",
  LISTENING: "🎤 듣는 중",
  SPEAKING: "🎤 음성 감지 중",
  PROCESSING: "번역 중...",
  ERROR: "오류 발생",
};

export default function FixedRoomVAD() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};

  // ── location.state에서 수신 ──
  const siteContext = state.siteContext || "general";
  const hospitalDept = state.hospitalDept || null;
  const patientToken = state.patientToken || null;
  const fromLang = state.fromLang || localStorage.getItem("myLang") || "ko";

  // ── participantId: 안정적으로 유지 ──
  const pidKey = `mono.fixedroom.pid.${roomId}`;
  const participantId = useMemo(() => {
    let id = localStorage.getItem(pidKey);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(pidKey, id);
    }
    return id;
  }, [pidKey]);

  // ── 3단계 step ──
  const [step, setStep] = useState("waiting"); // "waiting" | "ready" | "interpreting"
  const [status, setStatus] = useState(STATUS.IDLE);
  const [messages, setMessages] = useState([]);
  const [partnerInfo, setPartnerInfo] = useState(null); // { lang, name, flagUrl }
  const [patientData, setPatientData] = useState(null); // API에서 가져온 환자 정보
  const messagesEndRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const processingRef = useRef(false);
  const [active, setActive] = useState(false);

  // ── VAD Pipeline ──
  const vad = useVADPipeline({
    roomId,
    participantId,
    lang: fromLang,
  });

  // ── 환자 정보 로드 (patientToken이 있을 때) ──
  useEffect(() => {
    if (!patientToken) return;
    fetch(`/api/hospital/patient/${encodeURIComponent(patientToken)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setPatientData(data);
      })
      .catch(() => {});
  }, [patientToken]);

  // ── 소켓: 방 입장 (join as owner) ──
  useEffect(() => {
    if (!roomId || !participantId) return;

    // join as owner
    socket.emit("join", {
      roomId,
      fromLang,
      participantId,
      role: "Doctor",
      localName: "",
      roleHint: "owner",
      siteContext,
      isCreator: true,
    });

    return () => {
      socket.emit("leave-room", {
        roomId,
        participantId,
        reason: "fixed-room-vad-cleanup",
      });
    };
  }, [roomId, participantId, fromLang, siteContext]);

  // ── 소켓: 이벤트 수신 ──
  useEffect(() => {
    // 상대방 입장
    const onPartnerJoined = (payload) => {
      const profile = getLanguageProfileByCode(payload?.peerLang || "");
      setPartnerInfo({
        lang: payload?.peerLang || "",
        name: payload?.peerDisplayName || "환자",
        flagUrl: profile?.flagUrl || "",
        langLabel: profile?.shortLabel || payload?.peerLang || "",
      });
      if (step === "waiting") {
        setStep("ready");
      }
    };

    // 참가자 목록 업데이트
    const onParticipants = (payload) => {
      const list = payload?.participants || payload;
      if (!Array.isArray(list)) return;
      // 나 말고 다른 참가자가 있으면 → ready
      const peer = list.find((p) => p.participantId !== participantId);
      if (peer) {
        const profile = getLanguageProfileByCode(peer.lang || "");
        setPartnerInfo({
          lang: peer.lang || "",
          name: peer.displayName || "환자",
          flagUrl: profile?.flagUrl || "",
          langLabel: profile?.shortLabel || peer.lang || "",
        });
        if (step === "waiting") {
          setStep("ready");
        }
      }
    };

    // 상대방 퇴장
    const onPartnerLeft = () => {
      setStep("waiting");
      setPartnerInfo(null);
      // VAD가 돌고 있으면 정지
      if (active) {
        vad.pause();
        setActive(false);
        processingRef.current = false;
        setStatus(STATUS.IDLE);
      }
    };

    // 메시지 수신
    const onReceiveMessage = (payload) => {
      const { id, roomId: incomingRoomId, originalText, translatedText, senderPid } = payload || {};
      if (!id) return;
      if (incomingRoomId && incomingRoomId !== roomId) return;
      if (seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);

      const isMine = senderPid === participantId;
      const eventTs = Number(payload?.timestamp || payload?.at || Date.now());

      setMessages((prev) => [
        ...prev,
        {
          id,
          text: isMine ? originalText : (translatedText || originalText),
          originalText: originalText || "",
          translatedText: translatedText || "",
          mine: isMine,
          senderId: senderPid,
          status: "sent",
          timestamp: eventTs,
        },
      ]);

      if (processingRef.current) {
        processingRef.current = false;
        setStatus(active ? STATUS.LISTENING : STATUS.IDLE);
      }
    };

    // 메시지 수정 (HQ 번역 업데이트)
    const onReviseMessage = (payload) => {
      const { id, translatedText } = payload || {};
      if (!id || !translatedText) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, translatedText, text: m.mine ? m.text : translatedText }
            : m
        )
      );
    };

    // STT 무음
    const onSttNoVoice = () => {
      if (processingRef.current) {
        processingRef.current = false;
        setStatus(active ? STATUS.LISTENING : STATUS.IDLE);
      }
    };

    // 방 만료
    const onRoomExpired = () => {
      setStep("waiting");
      setPartnerInfo(null);
      if (active) {
        vad.pause();
        setActive(false);
        processingRef.current = false;
      }
    };

    socket.on("partner-joined", onPartnerJoined);
    socket.on("participants", onParticipants);
    socket.on("partner-left", onPartnerLeft);
    socket.on("receive-message", onReceiveMessage);
    socket.on("revise-message", onReviseMessage);
    socket.on("stt:no-voice", onSttNoVoice);
    socket.on("room-expired", onRoomExpired);

    return () => {
      socket.off("partner-joined", onPartnerJoined);
      socket.off("participants", onParticipants);
      socket.off("partner-left", onPartnerLeft);
      socket.off("receive-message", onReceiveMessage);
      socket.off("revise-message", onReviseMessage);
      socket.off("stt:no-voice", onSttNoVoice);
      socket.off("room-expired", onRoomExpired);
    };
  }, [roomId, participantId, step, active, vad]);

  // ── 자동 스크롤 ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── VAD 상태 → UI 상태 동기화 ──
  useEffect(() => {
    if (step !== "interpreting") return;
    if (vad.loading) {
      setStatus(STATUS.LOADING);
      return;
    }
    if (vad.errored) {
      setStatus(`${STATUS.ERROR}: ${vad.errored}`);
      return;
    }
    if (!active) {
      setStatus(STATUS.IDLE);
      return;
    }
    if (vad.userSpeaking) {
      setStatus(STATUS.SPEAKING);
    } else if (processingRef.current) {
      setStatus(STATUS.PROCESSING);
    } else {
      setStatus(STATUS.LISTENING);
    }
  }, [vad.userSpeaking, vad.loading, vad.errored, active, step]);

  // ── 말 끝나면 processing 표시 ──
  useEffect(() => {
    if (step !== "interpreting" || !active || vad.userSpeaking || vad.loading) return;
    const timer = setTimeout(() => {
      if (!vad.userSpeaking && active) {
        processingRef.current = true;
        setStatus(STATUS.PROCESSING);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [vad.userSpeaking, active, vad.loading, step]);

  // ── 통역 시작 ──
  const handleStartInterpreting = useCallback(async () => {
    setStep("interpreting");
    await vad.start();
    setActive(true);
    setStatus(STATUS.LISTENING);
  }, [vad]);

  // ── 통역 종료 ──
  const handleStopInterpreting = useCallback(async () => {
    await vad.pause();
    setActive(false);
    processingRef.current = false;
    setStatus(STATUS.IDLE);
    setStep("waiting");
    setMessages([]);
    seenIdsRef.current.clear();
    setPartnerInfo(null);
  }, [vad]);

  // ── 뒤로 가기 ──
  const handleBack = useCallback(() => {
    if (active) {
      vad.pause();
    }
    navigate(-1);
  }, [active, vad, navigate]);

  // ── Keepalive ──
  useEffect(() => {
    const iv = setInterval(() => {
      if (roomId) socket.emit("keepalive", { roomId, t: Date.now() });
    }, 25000);
    return () => clearInterval(iv);
  }, [roomId]);

  // ── Partner language display ──
  const partnerLangDisplay = useMemo(() => {
    if (partnerInfo?.langLabel) return partnerInfo.langLabel;
    if (patientData?.language) {
      const p = getLanguageProfileByCode(patientData.language);
      return p?.shortLabel || patientData.language;
    }
    return "";
  }, [partnerInfo, patientData]);

  const partnerFlagUrl = useMemo(() => {
    if (partnerInfo?.flagUrl) return partnerInfo.flagUrl;
    if (patientData?.language) {
      return getLanguageProfileByCode(patientData.language)?.flagUrl || "";
    }
    return "";
  }, [partnerInfo, patientData]);

  const myProfile = useMemo(() => getLanguageProfileByCode(fromLang), [fromLang]);

  // ═════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "#0f172a",
      color: "white",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* ── 상단 헤더 ── */}
      <div style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: step === "interpreting" && vad.userSpeaking && active
          ? "#dc2626"
          : step === "interpreting" && active
            ? "#1e40af"
            : "#1e293b",
        transition: "background 0.3s ease",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={handleBack}
            style={{
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <span style={{ fontSize: "13px", fontWeight: 600 }}>
            {hospitalDept?.labelKo || "병원 통역"}
          </span>
          {step === "interpreting" && (
            <span style={{
              fontSize: "10px",
              background: "rgba(255,255,255,0.15)",
              padding: "2px 8px",
              borderRadius: "4px",
            }}>
              {status}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {myProfile?.flagUrl && (
            <img src={myProfile.flagUrl} alt="" style={{ width: 18, height: 14, borderRadius: 2 }} />
          )}
          <span style={{ fontSize: "12px", opacity: 0.8 }}>
            {myProfile?.shortLabel || fromLang}
          </span>
          {partnerLangDisplay && (
            <>
              <span style={{ fontSize: "12px", opacity: 0.5 }}>↔</span>
              {partnerFlagUrl && (
                <img src={partnerFlagUrl} alt="" style={{ width: 18, height: 14, borderRadius: 2 }} />
              )}
              <span style={{ fontSize: "12px", opacity: 0.8 }}>
                {partnerLangDisplay}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* STEP: WAITING */}
      {/* ═══════════════════════════════════════ */}
      {step === "waiting" && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          padding: "32px",
        }}>
          {/* 진료과 표시 */}
          {hospitalDept && (
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: "48px" }}>{hospitalDept.icon}</span>
              <h2 style={{ fontSize: "22px", fontWeight: 700, marginTop: "8px" }}>
                {hospitalDept.labelKo}
              </h2>
              <p style={{ fontSize: "13px", opacity: 0.6, marginTop: "2px" }}>
                {hospitalDept.label}
              </p>
            </div>
          )}

          {/* 로딩 스피너 + 대기 메시지 */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}>
            <div style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              border: "3px solid rgba(59, 130, 246, 0.3)",
              borderTopColor: "#3b82f6",
              animation: "spin 1s linear infinite",
            }} />
            <p style={{ fontSize: "16px", fontWeight: 500, opacity: 0.8 }}>
              환자 연결을 기다리는 중...
            </p>
          </div>

          {/* 환자 정보 카드 */}
          {(patientToken || patientData) && (
            <div style={{
              background: "rgba(255,255,255,0.05)",
              borderRadius: "12px",
              padding: "16px 20px",
              width: "100%",
              maxWidth: "320px",
            }}>
              <p style={{ fontSize: "11px", opacity: 0.5, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>
                환자 정보
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {patientData?.language && (
                  <>
                    {getLanguageProfileByCode(patientData.language)?.flagUrl && (
                      <img
                        src={getLanguageProfileByCode(patientData.language).flagUrl}
                        alt=""
                        style={{ width: 22, height: 16, borderRadius: 2 }}
                      />
                    )}
                    <span style={{ fontSize: "14px" }}>
                      {getLanguageProfileByCode(patientData.language)?.shortLabel || patientData.language}
                    </span>
                  </>
                )}
              </div>
              {patientToken && (
                <p style={{ fontSize: "11px", opacity: 0.4, marginTop: "6px", fontFamily: "monospace" }}>
                  ID: {patientToken.slice(0, 12)}...
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* STEP: READY */}
      {/* ═══════════════════════════════════════ */}
      {step === "ready" && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          padding: "32px",
        }}>
          <div style={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            background: "rgba(34, 197, 94, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <UserCheck size={36} color="#22c55e" />
          </div>

          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#22c55e" }}>
              환자가 연결되었습니다 ✅
            </h2>
            {partnerInfo && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "12px",
              }}>
                {partnerInfo.flagUrl && (
                  <img src={partnerInfo.flagUrl} alt="" style={{ width: 24, height: 18, borderRadius: 2 }} />
                )}
                <span style={{ fontSize: "16px", fontWeight: 500 }}>
                  {partnerInfo.langLabel || partnerInfo.lang}
                </span>
                <span style={{ fontSize: "14px", opacity: 0.6 }}>
                  ({partnerInfo.name || "환자"})
                </span>
              </div>
            )}
          </div>

          <button
            onClick={handleStartInterpreting}
            disabled={vad.loading}
            style={{
              padding: "16px 48px",
              borderRadius: "16px",
              border: "none",
              background: vad.loading ? "#4b5563" : "#3b82f6",
              color: "white",
              fontSize: "18px",
              fontWeight: 700,
              cursor: vad.loading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              transition: "background 0.2s",
            }}
          >
            {vad.loading ? (
              <>
                <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
                VAD 로딩 중...
              </>
            ) : (
              <>
                <Phone size={22} />
                통역 시작
              </>
            )}
          </button>

          {vad.errored && (
            <div style={{
              padding: "10px 16px",
              background: "#7f1d1d",
              borderRadius: "8px",
              fontSize: "12px",
              color: "#fca5a5",
              maxWidth: "360px",
              textAlign: "center",
            }}>
              VAD 오류: {String(vad.errored)}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* STEP: INTERPRETING */}
      {/* ═══════════════════════════════════════ */}
      {step === "interpreting" && (
        <>
          {/* 메시지 영역 */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}>
            {messages.length === 0 && (
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: "12px",
                opacity: 0.5,
              }}>
                <Mic size={48} />
                <p style={{ fontSize: "14px" }}>
                  말하면 자동으로 감지 → 번역됩니다
                </p>
                <p style={{ fontSize: "12px", opacity: 0.7 }}>
                  환자의 말도 자동 번역되어 표시됩니다
                </p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id || idx}
                message={msg}
                currentUserId={participantId}
                roomType="oneToOne"
                groupedWithPrev={idx > 0 && messages[idx - 1]?.mine === msg.mine}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 하단: 통역 종료 버튼 */}
          <div style={{
            padding: "16px",
            background: "#111827",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}>
            <button
              onClick={handleStopInterpreting}
              style={{
                width: "100%",
                padding: "16px",
                borderRadius: "12px",
                border: "none",
                background: "#dc2626",
                color: "white",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "background 0.2s ease",
              }}
            >
              <PhoneOff size={20} />
              통역 종료
            </button>
          </div>
        </>
      )}

      {/* CSS animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
