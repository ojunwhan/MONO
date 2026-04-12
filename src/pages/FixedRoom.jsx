/**
 * FixedRoom — VAD 자동감지 기반 고정 통역방
 *
 * URL: /fixed/:location
 * 예: /fixed/plastic_surgery, /fixed/investigation, /fixed/court
 *
 * - useVADPipeline 사용 (stt:audio + stt:segment_end 경로)
 * - 서버 풀파이프라인: Groq Whisper → fastTranslate → hqTranslate → receive-message
 * - 기존 MicButton.jsx, ChatScreen.jsx, server.js 수정 없음
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useVADPipeline } from "../hooks/useVADPipeline";
import MessageBubble from "../components/MessageBubble";
import socket from "../socket";
import { v4 as uuidv4 } from "uuid";
import { Mic, MicOff, Loader2 } from "lucide-react";

// ─── location → 고정 roomId 매핑 ───
const LOCATION_ROOMS = {
  plastic_surgery: "fixed-plastic_surgery",
  investigation: "fixed-investigation",
  court: "fixed-court",
  consultation: "fixed-consultation",
};

// ─── location → siteContext 매핑 ───
const LOCATION_CONTEXTS = {
  plastic_surgery: "hospital_plastic_surgery",
  investigation: "general",
  court: "general",
  consultation: "general",
};

// ─── location → 표시 이름 ───
const LOCATION_LABELS = {
  plastic_surgery: "성형외과",
  investigation: "조사실",
  court: "법정",
  consultation: "상담실",
};

const STATUS = {
  IDLE: "대기 중",
  LOADING: "음성 인식 모델 로딩 중...",
  LISTENING: "🎤 듣는 중",
  SPEAKING: "🎤 음성 감지 중",
  PROCESSING: "번역 중...",
  ERROR: "오류 발생",
};

export default function FixedRoom() {
  const { location } = useParams();
  const [searchParams] = useSearchParams();
  const roomId = LOCATION_ROOMS[location] || `fixed-${location}`;
  const siteContext = LOCATION_CONTEXTS[location] || "general";
  const locationLabel = LOCATION_LABELS[location] || location;

  // 안정적인 participantId — 같은 브라우저에서 재접속 시 동일 ID 유지
  const pidKey = `mono.fixed.pid.${roomId}`;
  const participantId = useMemo(() => {
    let id = localStorage.getItem(pidKey);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(pidKey, id);
    }
    return id;
  }, [pidKey]);

  // 언어 설정: URL ?lang=en 또는 localStorage
  const lang = searchParams.get("lang") || localStorage.getItem("myLang") || "ko";

  const [status, setStatus] = useState(STATUS.IDLE);
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState([]);
  const [joined, setJoined] = useState(false);
  const messagesEndRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const processingRef = useRef(false);

  // ─── VAD Pipeline ───
  const vad = useVADPipeline({
    roomId,
    participantId,
    lang,
  });

  // ─── 소켓: 방 입장 (join) ───
  useEffect(() => {
    if (!roomId || !participantId) return;

    // create-room 으로 방 생성 (이미 있으면 서버가 reuse)
    socket.emit("create-room", {
      roomId,
      fromLang: lang,
      participantId,
      siteContext,
      role: "Tech",
      localName: "",
      roomType: "oneToOne",
    });

    // join
    const timer = setTimeout(() => {
      socket.emit("join", {
        roomId,
        fromLang: lang,
        participantId,
        role: "Tech",
        localName: "",
        roleHint: "owner",
      });
      setJoined(true);
    }, 100);

    return () => {
      clearTimeout(timer);
      socket.emit("leave-room", {
        roomId,
        participantId,
        reason: "fixed-room-cleanup",
      });
    };
  }, [roomId, participantId, lang, siteContext]);

  // ─── 소켓: 메시지 수신 ───
  useEffect(() => {
    const onReceiveMessage = (payload) => {
      const {
        id,
        roomId: incomingRoomId,
        originalText,
        translatedText,
        senderPid,
      } = payload || {};
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

      // 번역 완료 → status 복원
      if (processingRef.current) {
        processingRef.current = false;
        setStatus(active ? STATUS.LISTENING : STATUS.IDLE);
      }
    };

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

    const onSttNoVoice = () => {
      if (processingRef.current) {
        processingRef.current = false;
        setStatus(active ? STATUS.LISTENING : STATUS.IDLE);
      }
    };

    socket.on("receive-message", onReceiveMessage);
    socket.on("revise-message", onReviseMessage);
    socket.on("stt:no-voice", onSttNoVoice);

    return () => {
      socket.off("receive-message", onReceiveMessage);
      socket.off("revise-message", onReviseMessage);
      socket.off("stt:no-voice", onSttNoVoice);
    };
  }, [roomId, participantId, active]);

  // ─── 자동 스크롤 ───
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── VAD 상태 → UI 상태 동기화 ───
  useEffect(() => {
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
  }, [vad.userSpeaking, vad.loading, vad.errored, active]);

  // ─── 말 끝나면 processing 상태 ───
  useEffect(() => {
    // userSpeaking이 true → false 로 전환되면 서버에 오디오가 전송된 것
    if (active && !vad.userSpeaking && !vad.loading) {
      // 약간의 딜레이 후 PROCESSING 표시 (발화 종료 직후)
      const timer = setTimeout(() => {
        if (!vad.userSpeaking && active) {
          processingRef.current = true;
          setStatus(STATUS.PROCESSING);
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [vad.userSpeaking, active, vad.loading]);

  // ─── 토글 버튼 ───
  const handleToggle = useCallback(async () => {
    if (active) {
      await vad.pause();
      setActive(false);
      setStatus(STATUS.IDLE);
      processingRef.current = false;
    } else {
      await vad.start();
      setActive(true);
      setStatus(STATUS.LISTENING);
    }
  }, [active, vad]);

  // ─── Keepalive ───
  useEffect(() => {
    const iv = setInterval(() => {
      if (roomId) {
        socket.emit("keepalive", { roomId, t: Date.now() });
      }
    }, 25000);
    return () => clearInterval(iv);
  }, [roomId]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "#0f172a",
      color: "white",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* ── 상단: 상태 표시 바 ── */}
      <div style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: vad.userSpeaking && active
          ? "#dc2626"
          : active
            ? "#1e40af"
            : "#1e293b",
        transition: "background 0.3s ease",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", opacity: 0.7 }}>
            {locationLabel}
          </span>
          <span style={{
            fontSize: "10px",
            background: "rgba(255,255,255,0.15)",
            padding: "2px 6px",
            borderRadius: "4px",
          }}>
            {roomId}
          </span>
        </div>
        <div style={{
          fontSize: "14px",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}>
          {vad.loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          {status}
        </div>
      </div>

      {/* ── 중앙: 메시지 영역 ── */}
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
              통역 시작 버튼을 눌러주세요
            </p>
            <p style={{ fontSize: "12px", opacity: 0.7 }}>
              말하면 자동으로 감지 → 번역됩니다
            </p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id || idx}
            message={msg}
            currentUserId={participantId}
            roomType="oneToOne"
            groupedWithPrev={
              idx > 0 && messages[idx - 1]?.mine === msg.mine
            }
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 하단: 시작/정지 토글 버튼 ── */}
      <div style={{
        padding: "16px",
        background: "#111827",
        borderTop: "1px solid rgba(255,255,255,0.1)",
      }}>
        {!joined ? (
          <div style={{
            textAlign: "center",
            padding: "16px",
            fontSize: "14px",
            opacity: 0.5,
          }}>
            방에 연결 중...
          </div>
        ) : (
          <button
            onClick={handleToggle}
            disabled={vad.loading}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: "12px",
              border: "none",
              background: vad.loading
                ? "#4b5563"
                : active
                  ? "#dc2626"
                  : "#3b82f6",
              color: "white",
              fontSize: "16px",
              fontWeight: 700,
              cursor: vad.loading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "background 0.2s ease",
            }}
          >
            {vad.loading ? (
              <>
                <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                VAD 모델 로딩 중...
              </>
            ) : active ? (
              <>
                <MicOff size={20} />
                통역 중지
              </>
            ) : (
              <>
                <Mic size={20} />
                통역 시작
              </>
            )}
          </button>
        )}

        {vad.errored && (
          <div style={{
            marginTop: "8px",
            padding: "8px 12px",
            background: "#7f1d1d",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#fca5a5",
          }}>
            음성 인식 오류: {vad.errored}
          </div>
        )}
      </div>

      {/* CSS animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
