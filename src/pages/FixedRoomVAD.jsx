/**
 * FixedRoomVAD — 병원 VAD 자동감지 통역 화면 (채팅형 UI)
 *
 * URL: /fixed-room/:roomId
 *
 * ■ 핵심 원칙: 직원(owner)이 모든 걸 제어한다.
 *   - 환자(guest)는 버튼 없음. 직원 명령에 따라 자동으로 움직인다.
 *
 * ■ 채팅형 UI (interpreting 단계)
 *   - 상단: 진료과명 + VAD 상태
 *   - 중앙: 메시지 말풍선 (내 발화 오른쪽, 상대 발화 왼쪽)
 *   - 말풍선에 원문 + 번역 같이 표시
 *   - 스크롤 자동 하단 고정
 *   - 하단: 직원(owner)은 "통역 종료" 버튼, 환자(guest)는 상태 표시만
 *
 * ■ 소켓 이벤트
 *   fixed-room:start → 양쪽 VAD 시작
 *   fixed-room:end   → 양쪽 VAD 종료
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useVADPipeline } from "../hooks/useVADPipeline";
import socket from "../socket";
import { v4 as uuidv4 } from "uuid";
import { getLanguageProfileByCode, getFlagUrlByLang } from "../constants/languageProfiles";
import { Mic, Loader2, UserCheck, ArrowLeft, Phone, PhoneOff, CheckCircle, History, ChevronDown, ChevronUp } from "lucide-react";

const STATUS = {
  IDLE: "대기 중",
  LOADING: "VAD 모델 로딩 중...",
  LISTENING: "🎤 듣는 중",
  SPEAKING: "🎤 음성 감지 중",
  PROCESSING: "번역 중...",
  ERROR: "오류 발생",
};

// ── 채팅 말풍선 컴포넌트 ──
function ChatBubble({ originalText, translatedText, mine, flagUrl, langLabel, streaming }) {
  const displayText = (translatedText || originalText) + (streaming ? "▋" : "");
  return (
    <div style={{
      display: "flex",
      justifyContent: mine ? "flex-end" : "flex-start",
      marginBottom: "10px",
      padding: "0 16px",
    }}>
      <div style={{ maxWidth: "80%" }}>
        {/* 국기 + 언어명 라벨 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          marginBottom: "3px",
          justifyContent: mine ? "flex-end" : "flex-start",
        }}>
          {flagUrl && (
            <img src={flagUrl} alt="" style={{ width: 16, height: 12, borderRadius: 1, objectFit: "cover" }} />
          )}
          {langLabel && (
            <span style={{ fontSize: "0.65rem", opacity: 0.5, fontWeight: 500 }}>
              {langLabel}
            </span>
          )}
        </div>
        {/* 말풍선 본체 */}
        <div style={{
          padding: "10px 14px",
          borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: mine ? "#3b82f6" : "rgba(255,255,255,0.1)",
          color: "white",
          wordBreak: "keep-all",
        }}>
          {/* 번역문 (주 텍스트) */}
          <p style={{
            fontSize: "0.95rem",
            fontWeight: 600,
            margin: "0 0 4px 0",
            lineHeight: 1.4,
          }}>
            {displayText}
          </p>
          {/* 원문 (번역이 있을 때만, 작게 표시) */}
          {translatedText && originalText && translatedText !== originalText && (
            <p style={{
              fontSize: "0.78rem",
              margin: 0,
              opacity: 0.55,
              lineHeight: 1.3,
            }}>
              {originalText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 서버 메시지 저장 헬퍼 (sessionId = hospital_sessions.id UUID, roomId = PT-XXXXXX) ──
function saveMessageToServer({ sessionId, roomId, patientToken, senderRole, originalText, translatedText, senderLang, translatedLang }) {
  if (!sessionId || !roomId) return;
  fetch("/api/hospital/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      roomId,
      senderRole: senderRole || "guest",
      senderLang: senderLang || "",
      originalText: originalText || "",
      translatedText: translatedText || "",
      translatedLang: translatedLang || "",
    }),
  }).catch(() => { /* 저장 실패 무시 — 통역에 영향 없음 */ });
}

export default function FixedRoomVAD() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};

  // ── location.state에서 수신 ──
  const siteContext = state.siteContext || "general";
  const hospitalDept = state.hospitalDept || null;
  const hospitalTemplate = state.hospitalTemplate || "";
  const patientToken = state.patientToken || null;
  const fromLang = state.fromLang || localStorage.getItem("myLang") || "ko";
  const roleHint = state.roleHint || "owner";
  const isCreator = state.isCreator !== undefined ? state.isCreator : true;
  const isGuest = roleHint === "guest";
  const isOwner = !isGuest;
  const saveMessages = state.saveMessages === true;
  const summaryOnly = state.summaryOnly === true;
  const inputModeInitial = state.inputMode || "ptt";
  const [inputMode, setInputMode] = useState(inputModeInitial);
  const autoReset = state.autoReset === true;
  const orgCode = state.orgCode || "";
  const deptCode = state.deptCode || "";
  const stateSessionId = state.sessionId || null;
  const sessionIdRef = useRef(stateSessionId);
  const pendingMessages = state.pendingMessages || [];
  const consultationKioskRoomId = state.consultationKioskRoomId || null;
  const [roomAssignedBanner, setRoomAssignedBanner] = useState(null);
  const [enterConsultationRequest, setEnterConsultationRequest] = useState(null);
  useEffect(() => {
    sessionIdRef.current = stateSessionId;
  }, [stateSessionId]);

  // ── 환자 이력 (직원 + patientToken 있을 때) ──
  const [patientHistory, setPatientHistory] = useState(null);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const fetchHistoryRef = useRef(false);
  useEffect(() => {
    if (!isOwner || !patientToken) return;
    if (fetchHistoryRef.current) return;
    fetchHistoryRef.current = true;
    fetch(`/api/hospital/patient/${encodeURIComponent(patientToken)}/history`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.success && data?.sessions) setPatientHistory(data);
      })
      .catch(() => {})
      .finally(() => { fetchHistoryRef.current = false; });
  }, [isOwner, patientToken]);

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

  // ── 단계: waiting | ready | interpreting | ended ──
  const [step, setStep] = useState(isGuest ? "ready" : "waiting");
  const [status, setStatus] = useState(STATUS.IDLE);
  const [messages, setMessages] = useState([]);
  const [partnerInfo, setPartnerInfo] = useState(null);
  const [patientData, setPatientData] = useState(null);
  const seenIdsRef = useRef(new Set());
  const processingRef = useRef(false);
  const [active, setActive] = useState(false);
  const messagesEndRef = useRef(null);
  const pendingMergedRef = useRef(false);
  const [textInputValue, setTextInputValue] = useState("");

  // ── 입장 시 pending 메시지(직원이 보낸 오프라인 메시지)를 목록에 반영 ──
  useEffect(() => {
    if (pendingMergedRef.current || !Array.isArray(pendingMessages) || pendingMessages.length === 0) return;
    pendingMergedRef.current = true;
    setMessages((prev) => [
      ...pendingMessages.map((m) => ({
        id: m.id || `pending-${m.created_at}`,
        originalText: m.original_text || "",
        translatedText: m.translated_text || m.original_text || "",
        mine: false,
        senderId: "staff",
        timestamp: new Date(m.created_at || 0).getTime(),
      })),
      ...prev,
    ]);
  }, [pendingMessages]);

  // ── VAD Pipeline ──
  const vad = useVADPipeline({
    roomId,
    participantId,
    lang: fromLang,
    roleHint,
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

  // ── partner-joined 시 환자 이력 재조회 ──
  const fetchVisitHistory = useCallback(() => {
    if (!patientToken || !isOwner) return;
    fetch(`/api/hospital/patient/${encodeURIComponent(patientToken)}/history`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.success && data?.sessions) setPatientHistory(data);
        else setPatientHistory(null);
      })
      .catch(() => setPatientHistory(null));
  }, [patientToken, isOwner]);

  // ── 소켓: 방 입장 ──
  useEffect(() => {
    if (!roomId || !participantId) return;

    socket.emit("join", {
      roomId,
      fromLang,
      participantId,
      role: isGuest ? "Patient" : "Doctor",
      localName: isGuest ? (state.localName || "") : "",
      roleHint,
      siteContext,
      isCreator,
      ...(state.guestId ? { guestId: state.guestId } : {}),
      saveMessages,
      summaryOnly,
      inputMode,
    });

    return () => {
      socket.emit("leave-room", {
        roomId,
        participantId,
        reason: "fixed-room-vad-cleanup",
      });
    };
  }, [roomId, participantId, fromLang, siteContext, roleHint, isCreator, isGuest, saveMessages, summaryOnly, inputMode]);

  // ── 통역 시작 공통 로직 ──
  const doStartInterpreting = useCallback(async () => {
    setStep("interpreting");
    await vad.start();
    setActive(true);
    setStatus(STATUS.LISTENING);
  }, [vad]);

  // ── 통역 종료 공통 로직 ──
  const doStopInterpreting = useCallback(async () => {
    await vad.pause();
    setActive(false);
    processingRef.current = false;
    setStatus(STATUS.IDLE);
    setMessages([]);
    seenIdsRef.current.clear();
    setPartnerInfo(null);
  }, [vad]);

  // ── 소켓: 이벤트 수신 ──
  useEffect(() => {
    // 상대방 입장
    const onPartnerJoined = (payload) => {
      const profile = getLanguageProfileByCode(payload?.peerLang || "");
      setPartnerInfo({
        lang: payload?.peerLang || "",
        name: payload?.peerDisplayName || (isOwner ? "환자" : "의료진"),
        flagUrl: profile?.flagUrl || "",
        langLabel: profile?.shortLabel || payload?.peerLang || "",
      });
      if (step === "waiting") {
        setStep("ready");
      }
      if (isOwner && patientToken) fetchVisitHistory();
    };

    // 참가자 목록 업데이트
    const onParticipants = (payload) => {
      const list = payload?.participants || payload;
      if (!Array.isArray(list)) return;
      const peer = list.find((p) => p.participantId !== participantId);
      if (peer) {
        const profile = getLanguageProfileByCode(peer.lang || "");
        setPartnerInfo({
          lang: peer.lang || "",
          name: peer.displayName || (isOwner ? "환자" : "의료진"),
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
      setPartnerInfo(null);
      if (active) {
        vad.pause();
        setActive(false);
        processingRef.current = false;
        setStatus(STATUS.IDLE);
      }
      if (isGuest) {
        setStep("ended");
        if (autoReset && orgCode && deptCode) {
          navigate(`/org/${encodeURIComponent(orgCode)}/${encodeURIComponent(deptCode)}/join`, { replace: true });
        }
      } else {
        setStep("waiting");
      }
    };

    // 스트리밍 청크 수신 (번역 중 실시간 표시)
    const onReceiveMessageStream = (payload) => {
      const { roomId: incomingRoomId, messageId, chunk, senderPid, originalText } = payload || {};
      if (!messageId || !chunk || (incomingRoomId && incomingRoomId !== roomId)) return;
      const isMine = senderPid === participantId;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          return prev.map((m, i) =>
            i === idx
              ? { ...m, translatedText: (m.translatedText || "") + chunk, streaming: true }
              : m
          );
        }
        return [
          ...prev,
          {
            id: messageId,
            originalText: originalText || "",
            translatedText: chunk,
            mine: isMine,
            senderId: senderPid,
            timestamp: Date.now(),
            streaming: true,
          },
        ];
      });
    };

    // 스트리밍 종료 (최종 텍스트 반영, 커서 제거)
    const onReceiveMessageStreamEnd = (payload) => {
      const { roomId: incomingRoomId, messageId, fullText } = payload || {};
      if (!messageId || (incomingRoomId && incomingRoomId !== roomId)) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, translatedText: fullText ?? m.translatedText, streaming: false } : m
        )
      );
    };

    // 메시지 수신 + 서버 기록 저장 (HQ 덮어쓰기 또는 신규)
    const onReceiveMessage = (payload) => {
      // [PERF] T8: receive-message 수신 시점 (말풍선 표시)
      console.log(`[PERF] T8 message received on client | ts: ${Date.now()}`);
      const { id, roomId: incomingRoomId, originalText, translatedText, senderPid } = payload || {};
      if (!id) return;
      if (incomingRoomId && incomingRoomId !== roomId) return;
      const isMine = senderPid === participantId;
      const eventTs = Number(payload?.timestamp || payload?.at || Date.now());

      setMessages((prev) => {
        const existingIdx = prev.findIndex((m) => m.id === id);
        if (existingIdx >= 0) {
          return prev.map((m, i) =>
            i === existingIdx
              ? { ...m, translatedText: translatedText ?? m.translatedText, streaming: false }
              : m
          );
        }
        if (seenIdsRef.current.has(id)) return prev;
        seenIdsRef.current.add(id);
        return [
          ...prev,
          {
            id,
            originalText: originalText || "",
            translatedText: translatedText || "",
            mine: isMine,
            senderId: senderPid,
            timestamp: eventTs,
          },
        ];
      });

      if (saveMessages && sessionIdRef.current) {
        saveMessageToServer({
          sessionId: sessionIdRef.current,
          roomId,
          patientToken,
          senderRole: isMine ? roleHint : (isOwner ? "guest" : "owner"),
          originalText: originalText || "",
          translatedText: translatedText || "",
          senderLang: isMine ? fromLang : (partnerInfo?.lang || ""),
          translatedLang: isMine ? (partnerInfo?.lang || "") : fromLang,
        });
      }

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
          m.id === id ? { ...m, translatedText, streaming: false } : m
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
      setPartnerInfo(null);
      if (active) {
        vad.pause();
        setActive(false);
        processingRef.current = false;
      }
      if (isGuest) {
        setStep("ended");
        if (autoReset && orgCode && deptCode) {
          navigate(`/org/${encodeURIComponent(orgCode)}/${encodeURIComponent(deptCode)}/join`, { replace: true });
        }
      } else {
        setStep("waiting");
      }
    };

    // ── fixed-room:start — 직원이 통역 시작 → 양쪽 VAD 시작 ──
    const onFixedRoomStart = (payload) => {
      if (payload?.roomId !== roomId) return;
      doStartInterpreting();
    };

    // ── fixed-room:end — 직원이 통역 종료 → 양쪽 VAD 종료 ──
    const onFixedRoomEnd = (payload) => {
      if (payload?.roomId !== roomId) return;
      (async () => {
        await doStopInterpreting();
        if (isOwner) {
          const deptId = hospitalDept?.id || "reception";
          const template = hospitalTemplate && (hospitalTemplate === "reception" || hospitalTemplate === "consultation") ? hospitalTemplate : "reception";
          navigate(`/hospital?template=${template}&dept=${deptId}`, { replace: true });
        } else {
          if (consultationKioskRoomId) {
            navigate(`/hospital?template=consultation&room=${encodeURIComponent(consultationKioskRoomId)}&kiosk=true`, { replace: true });
          } else {
            setStep("ended");
          }
        }
      })();
    };

    socket.on("partner-joined", onPartnerJoined);
    socket.on("participants", onParticipants);
    socket.on("partner-left", onPartnerLeft);
    socket.on("receive-message", onReceiveMessage);
    socket.on("receive-message-stream", onReceiveMessageStream);
    socket.on("receive-message-stream-end", onReceiveMessageStreamEnd);
    socket.on("revise-message", onReviseMessage);
    socket.on("stt:no-voice", onSttNoVoice);
    socket.on("room-expired", onRoomExpired);
    socket.on("fixed-room:start", onFixedRoomStart);
    socket.on("fixed-room:end", onFixedRoomEnd);

    return () => {
      socket.off("partner-joined", onPartnerJoined);
      socket.off("participants", onParticipants);
      socket.off("partner-left", onPartnerLeft);
      socket.off("receive-message", onReceiveMessage);
      socket.off("receive-message-stream", onReceiveMessageStream);
      socket.off("receive-message-stream-end", onReceiveMessageStreamEnd);
      socket.off("revise-message", onReviseMessage);
      socket.off("stt:no-voice", onSttNoVoice);
      socket.off("room-expired", onRoomExpired);
      socket.off("fixed-room:start", onFixedRoomStart);
      socket.off("fixed-room:end", onFixedRoomEnd);
    };
  }, [roomId, participantId, step, active, vad, isOwner, isGuest, doStartInterpreting, doStopInterpreting, hospitalDept, hospitalTemplate, navigate, roleHint, fromLang, patientToken, partnerInfo, saveMessages, autoReset, orgCode, deptCode, fetchVisitHistory, consultationKioskRoomId]);

  // ── 환자 전용: 접수→진료실 배정 알림, 진료실 입장 요청 수락 ──
  useEffect(() => {
    if (!isGuest || !roomId) return;
    const onRoomAssigned = (payload) => {
      const name = payload?.consultationRoomName || "진료실";
      setRoomAssignedBanner(name);
      setTimeout(() => setRoomAssignedBanner(null), 8000);
    };
    const onEnterRequest = (payload) => {
      setEnterConsultationRequest({
        roomId: payload?.roomId || roomId,
        consultationRoomName: payload?.consultationRoomName || "진료실",
      });
    };
    socket.on("hospital:room-assigned", onRoomAssigned);
    socket.on("hospital:enter-consultation-request", onEnterRequest);
    return () => {
      socket.off("hospital:room-assigned", onRoomAssigned);
      socket.off("hospital:enter-consultation-request", onEnterRequest);
    };
  }, [isGuest, roomId]);

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

  // ── 직원: 통역 시작 (소켓으로 양쪽에 알림) ──
  const handleStartInterpreting = useCallback(() => {
    socket.emit("fixed-room:start", { roomId });
  }, [roomId]);

  // ── 직원: 통역 종료 (소켓으로 양쪽에 알림) ──
  const handleStopInterpreting = useCallback(() => {
    socket.emit("fixed-room:end", { roomId });
  }, [roomId]);

  // ── 텍스트 메시지 전송 (send-message) ──
  const sendTextMessage = useCallback(() => {
    const trimmed = (textInputValue || "").trim();
    if (!trimmed || !roomId || !participantId) return;
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        originalText: trimmed,
        translatedText: "",
        mine: true,
        timestamp: Date.now(),
      },
    ]);
    setTextInputValue("");
    socket.emit("send-message", {
      roomId,
      participantId,
      message: { id: msgId, text: trimmed },
    });
  }, [roomId, participantId, textInputValue]);

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

  // ── 메시지 추가 시 자동 스크롤 ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    if (partnerInfo?.lang) return getLanguageProfileByCode(partnerInfo.lang)?.flagUrl || getFlagUrlByLang(partnerInfo.lang);
    if (patientData?.language) {
      return getLanguageProfileByCode(patientData.language)?.flagUrl || getFlagUrlByLang(patientData.language);
    }
    return "";
  }, [partnerInfo, patientData]);

  const myProfile = useMemo(() => {
    const profile = getLanguageProfileByCode(fromLang);
    if (profile) return profile;
    // fallback: 최소한 flagUrl과 shortLabel 제공
    return { flagUrl: getFlagUrlByLang(fromLang), shortLabel: String(fromLang || "").toUpperCase() };
  }, [fromLang]);

  // ── VAD 상태 아이콘 색상 ──
  const statusColor = useMemo(() => {
    if (status === STATUS.SPEAKING) return "#ef4444";
    if (status === STATUS.PROCESSING) return "#f59e0b";
    if (status === STATUS.LISTENING) return "#22c55e";
    return "#6b7280";
  }, [status]);

  // ═════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100dvh",
      background: "#0f172a",
      color: "white",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: "hidden",
    }}>

      {/* 환자: 진료실 배정 알림 배너 */}
      {isGuest && roomAssignedBanner && (
        <div style={{
          padding: "10px 16px",
          background: "#1e40af",
          color: "white",
          textAlign: "center",
          fontSize: "14px",
          fontWeight: 600,
        }}>
          {roomAssignedBanner}(으)로 배정되었습니다.
        </div>
      )}

      {/* 환자: 진료실 입장 요청 모달 */}
      {isGuest && enterConsultationRequest && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 24,
        }}>
          <div style={{
            background: "#1e293b",
            borderRadius: 16,
            padding: 24,
            maxWidth: 320,
            width: "100%",
            textAlign: "center",
          }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              진료실 입장 요청
            </p>
            <p style={{ fontSize: 13, opacity: 0.9, marginBottom: 20 }}>
              {enterConsultationRequest.consultationRoomName}(으)로 입장하시겠습니까?
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => {
                  socket.emit("hospital:enter-consultation", { roomId: enterConsultationRequest.roomId });
                  setEnterConsultationRequest(null);
                }}
                style={{
                  padding: "12px 24px",
                  borderRadius: 12,
                  border: "none",
                  background: "#22c55e",
                  color: "white",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                수락
              </button>
              <button
                type="button"
                onClick={() => setEnterConsultationRequest(null)}
                style={{
                  padding: "12px 24px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "transparent",
                  color: "white",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* STEP: WAITING */}
      {/* ═══════════════════════════════════════ */}
      {step === "waiting" && (
        <>
          {/* 헤더 */}
          <div style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "#1e293b",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}>
            <button onClick={handleBack} style={{ background: "none", border: "none", color: "white", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
              <ArrowLeft size={18} />
            </button>
            <span style={{ fontSize: "13px", fontWeight: 600 }}>
              {hospitalDept?.labelKo || "병원 통역"}
            </span>
          </div>

          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "24px",
            padding: "32px",
          }}>
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

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "60px", height: "60px", borderRadius: "50%",
                border: "3px solid rgba(59, 130, 246, 0.3)", borderTopColor: "#3b82f6",
                animation: "spin 1s linear infinite",
              }} />
              <p style={{ fontSize: "16px", fontWeight: 500, opacity: 0.8 }}>
                {isGuest ? "의료진 연결을 기다리는 중..." : "환자 연결을 기다리는 중..."}
              </p>
            </div>

            {isOwner && (patientToken || patientData) && (
              <div style={{
                background: "rgba(255,255,255,0.05)", borderRadius: "12px",
                padding: "16px 20px", width: "100%", maxWidth: "320px",
              }}>
                <p style={{ fontSize: "11px", opacity: 0.5, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>
                  환자 정보
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {patientData?.language && (
                    <>
                      {getLanguageProfileByCode(patientData.language)?.flagUrl && (
                        <img src={getLanguageProfileByCode(patientData.language).flagUrl} alt="" style={{ width: 22, height: 16, borderRadius: 2 }} />
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
        </>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* STEP: READY */}
      {/* ═══════════════════════════════════════ */}
      {step === "ready" && (
        <>
          <div style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "#1e293b",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}>
            <button onClick={handleBack} style={{ background: "none", border: "none", color: "white", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
              <ArrowLeft size={18} />
            </button>
            <span style={{ fontSize: "13px", fontWeight: 600, flex: 1 }}>
              {hospitalDept?.labelKo || "병원 통역"}
            </span>
            {isOwner && patientHistory?.sessions?.length > 0 && (
              <button
                type="button"
                onClick={() => setHistoryPanelOpen((p) => !p)}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)",
                  background: historyPanelOpen ? "rgba(59,130,246,0.2)" : "transparent", color: "white", fontSize: "12px", cursor: "pointer",
                }}
              >
                <History size={14} />
                이력 ({patientHistory.sessions.length})
                {historyPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
          </div>
          {isOwner && historyPanelOpen && patientHistory?.sessions && (
            <div style={{
              background: "#1e293b", borderBottom: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "220px", overflowY: "auto", padding: "12px 16px",
            }}>
              <p style={{ fontSize: "11px", opacity: 0.7, marginBottom: "8px" }}>이전 방문 (최근 {historyShowAll ? patientHistory.sessions.length : Math.min(3, patientHistory.sessions.length)}건)</p>
              {(historyShowAll ? patientHistory.sessions : patientHistory.sessions.slice(0, 3)).map((sess, idx) => (
                <div key={sess.id} style={{ fontSize: "12px", marginBottom: "8px", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
                  <span style={{ fontWeight: 600 }}>{sess.started_at ? new Date(sess.started_at).toLocaleDateString("ko-KR") : "-"}</span>
                  {" · "}{sess.dept || "-"}
                  {" · "}메시지 {Array.isArray(sess.messages) ? sess.messages.length : 0}건
                </div>
              ))}
              {patientHistory.sessions.length > 3 && !historyShowAll && (
                <button type="button" onClick={() => setHistoryShowAll(true)} style={{ marginTop: "4px", padding: "4px 8px", fontSize: "11px", background: "rgba(59,130,246,0.3)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer" }}>더 보기</button>
              )}
            </div>
          )}

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
              width: "72px", height: "72px", borderRadius: "50%",
              background: "rgba(34, 197, 94, 0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <UserCheck size={36} color="#22c55e" />
            </div>

            <div style={{ textAlign: "center" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#22c55e" }}>
                {isGuest ? "의료진과 연결되었습니다 ✅" : "환자가 연결되었습니다 ✅"}
              </h2>
              {partnerInfo && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: "8px", marginTop: "12px",
                }}>
                  {partnerInfo.flagUrl && (
                    <img src={partnerInfo.flagUrl} alt="" style={{ width: 24, height: 18, borderRadius: 2 }} />
                  )}
                  <span style={{ fontSize: "16px", fontWeight: 500 }}>
                    {partnerInfo.langLabel || partnerInfo.lang}
                  </span>
                  <span style={{ fontSize: "14px", opacity: 0.6 }}>
                    ({isGuest ? (partnerInfo.name || "의료진") : (partnerInfo.name || "환자")})
                  </span>
                </div>
              )}
            </div>

            {isOwner && (
              <button
                onClick={handleStartInterpreting}
                disabled={vad.loading}
                style={{
                  padding: "16px 48px", borderRadius: "16px", border: "none",
                  background: vad.loading ? "#4b5563" : "#3b82f6",
                  color: "white", fontSize: "18px", fontWeight: 700,
                  cursor: vad.loading ? "wait" : "pointer",
                  display: "flex", alignItems: "center", gap: "10px",
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
            )}

            {isGuest && (
              <div style={{
                textAlign: "center", padding: "16px 32px",
                background: "rgba(59, 130, 246, 0.1)", borderRadius: "12px",
                border: "1px solid rgba(59, 130, 246, 0.2)",
              }}>
                <Loader2 size={20} style={{ animation: "spin 1s linear infinite", marginBottom: "8px" }} />
                <p style={{ fontSize: "14px", opacity: 0.8 }}>
                  통역 시작을 기다리는 중...
                </p>
                <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "4px" }}>
                  의료진이 통역을 시작하면 자동으로 연결됩니다
                </p>
              </div>
            )}

            {vad.errored && (
              <div style={{
                padding: "10px 16px", background: "#7f1d1d", borderRadius: "8px",
                fontSize: "12px", color: "#fca5a5", maxWidth: "360px", textAlign: "center",
              }}>
                VAD 오류: {String(vad.errored)}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* STEP: INTERPRETING — 채팅형 UI */}
      {/* ═══════════════════════════════════════ */}
      {step === "interpreting" && (
        <>
          {/* ── 상단: 진료과명 + VAD 상태 ── */}
          <div style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: vad.userSpeaking ? "#7f1d1d" : "#1e293b",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            flexShrink: 0,
            transition: "background 0.3s ease",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
              <button onClick={handleBack} style={{ background: "none", border: "none", color: "white", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
                <ArrowLeft size={18} />
              </button>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>
                {hospitalDept?.labelKo || "병원 통역"}
              </span>
              {partnerInfo && (
                <span style={{ fontSize: "11px", opacity: 0.5 }}>
                  {myProfile?.shortLabel || fromLang} ↔ {partnerLangDisplay}
                </span>
              )}
              {isOwner && patientHistory?.sessions?.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistoryPanelOpen((p) => !p)}
                  style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    padding: "4px 8px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.2)",
                    background: historyPanelOpen ? "rgba(59,130,246,0.2)" : "transparent", color: "white", fontSize: "11px", cursor: "pointer", marginLeft: "4px",
                  }}
                >
                  <History size={12} />
                  {historyPanelOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
            </div>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}>
              <div style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: statusColor,
                boxShadow: status === STATUS.SPEAKING ? `0 0 8px ${statusColor}` : "none",
                transition: "all 0.3s ease",
                animation: status === STATUS.SPEAKING ? "pulse 1s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize: "11px", opacity: 0.7 }}>
                {status}
              </span>
            </div>
          </div>
          {isOwner && historyPanelOpen && patientHistory?.sessions && (
            <div style={{
              background: "#1e293b", borderBottom: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "180px", overflowY: "auto", padding: "10px 16px", flexShrink: 0,
            }}>
              <p style={{ fontSize: "11px", opacity: 0.7, marginBottom: "6px" }}>이전 방문 (최근 {historyShowAll ? patientHistory.sessions.length : Math.min(3, patientHistory.sessions.length)}건)</p>
              {(historyShowAll ? patientHistory.sessions : patientHistory.sessions.slice(0, 3)).map((sess) => (
                <div key={sess.id} style={{ fontSize: "11px", marginBottom: "6px", padding: "6px", background: "rgba(0,0,0,0.2)", borderRadius: "6px" }}>
                  {sess.started_at ? new Date(sess.started_at).toLocaleDateString("ko-KR") : "-"} · {sess.dept || "-"} · 메시지 {Array.isArray(sess.messages) ? sess.messages.length : 0}건
                </div>
              ))}
              {patientHistory.sessions.length > 3 && !historyShowAll && (
                <button type="button" onClick={() => setHistoryShowAll(true)} style={{ marginTop: "2px", padding: "2px 6px", fontSize: "10px", background: "rgba(59,130,246,0.3)", border: "none", borderRadius: "4px", color: "white", cursor: "pointer" }}>더 보기</button>
              )}
            </div>
          )}

          {/* ── 중앙: 메시지 말풍선 영역 ── */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 0",
            background: "#0f172a",
          }}>
            {messages.length === 0 ? (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                opacity: 0.2,
                fontSize: "0.95rem",
              }}>
                말하면 자동으로 감지됩니다
              </div>
            ) : (
              messages.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  originalText={msg.originalText}
                  translatedText={msg.translatedText}
                  mine={msg.mine}
                  flagUrl={msg.mine ? (myProfile?.flagUrl || "") : (partnerFlagUrl || "")}
                  langLabel={msg.mine ? (myProfile?.shortLabel || fromLang) : (partnerLangDisplay || "")}
                  streaming={msg.streaming}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ── 하단 고정 바 ── */}
          <div style={{
            padding: "12px 16px",
            background: "#111827",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            flexShrink: 0,
          }}>
            {/* VAD / PTT 전환 토글 */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <span style={{ fontSize: "11px", opacity: 0.7 }}>입력 방식:</span>
              <button
                type="button"
                onClick={() => setInputMode("vad")}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: inputMode === "vad" ? "2px solid #22c55e" : "1px solid rgba(255,255,255,0.2)",
                  background: inputMode === "vad" ? "rgba(34,197,94,0.2)" : "transparent",
                  color: "white",
                  fontSize: "12px",
                  fontWeight: inputMode === "vad" ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                자동 감지 (VAD)
              </button>
              <button
                type="button"
                onClick={() => setInputMode("ptt")}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: inputMode === "ptt" ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.2)",
                  background: inputMode === "ptt" ? "rgba(59,130,246,0.2)" : "transparent",
                  color: "white",
                  fontSize: "12px",
                  fontWeight: inputMode === "ptt" ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                버튼으로 말하기 (PTT)
              </button>
            </div>
            {/* 텍스트 입력창 (항상 표시) */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <input
                type="text"
                value={textInputValue}
                onChange={(e) => setTextInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
                placeholder="텍스트 입력 후 Enter 또는 전송"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "#1e293b",
                  color: "white",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={sendTextMessage}
                disabled={!textInputValue?.trim()}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "none",
                  background: textInputValue?.trim() ? "#3b82f6" : "#4b5563",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: textInputValue?.trim() ? "pointer" : "not-allowed",
                }}
              >
                전송
              </button>
            </div>
            {isOwner ? (
              <button
                onClick={handleStopInterpreting}
                style={{
                  width: "100%", padding: "14px", borderRadius: "12px",
                  border: "none", background: "#dc2626", color: "white",
                  fontSize: "15px", fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  transition: "background 0.2s ease",
                }}
              >
                <PhoneOff size={18} />
                통역 종료
              </button>
            ) : (
              <div style={{
                textAlign: "center", padding: "10px", opacity: 0.6, fontSize: "13px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}>
                <Mic size={14} />
                통역 진행 중 — 말하면 자동 번역됩니다
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* STEP: ENDED (환자만) */}
      {/* ═══════════════════════════════════════ */}
      {step === "ended" && (
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
            width: "80px", height: "80px", borderRadius: "50%",
            background: "rgba(59, 130, 246, 0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <CheckCircle size={40} color="#3b82f6" />
          </div>

          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#3b82f6" }}>
              상담이 종료되었습니다
            </h2>
            <p style={{ fontSize: "14px", opacity: 0.6, marginTop: "8px" }}>
              감사합니다. 이 페이지를 닫아도 됩니다.
            </p>
          </div>

          {hospitalDept && (
            <div style={{
              textAlign: "center", padding: "12px 24px",
              background: "rgba(255,255,255,0.05)", borderRadius: "12px",
            }}>
              <span style={{ fontSize: "32px" }}>{hospitalDept.icon}</span>
              <p style={{ fontSize: "14px", marginTop: "4px", opacity: 0.7 }}>
                {hospitalDept.labelKo}
              </p>
            </div>
          )}
        </div>
      )}

      {/* CSS animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
