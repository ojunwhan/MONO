import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import socket from "../socket";

async function toBase64FromBlob(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function patientLangFlag(code) {
  const c = String(code || "en").toLowerCase().split("-")[0];
  const map = {
    en: "🇬🇧",
    ko: "🇰🇷",
    ja: "🇯🇵",
    zh: "🇨🇳",
    vi: "🇻🇳",
    th: "🇹🇭",
    ru: "🇷🇺",
    ar: "🇸🇦",
    id: "🇮🇩",
    ms: "🇲🇾",
    tl: "🇵🇭",
    fr: "🇫🇷",
    de: "🇩🇪",
    es: "🇪🇸",
    pt: "🇵🇹",
    tr: "🇹🇷",
    hi: "🇮🇳",
  };
  return map[c] || "🌐";
}

/** 직원(한국어 출발) vs 환자: fromLang 우선, 없으면 본문 한글·환자 언어 코드로 추정 */
function isStaffMessage(data, viewerParticipantId, patientLang) {
  const fromLang = data?.fromLang;
  const senderPid = data?.senderPid ?? data?.participantId;
  const originalText = String(data?.originalText ?? "");
  const fl = String(fromLang || "").toLowerCase();
  const langPrefix = String(patientLang || "en").toLowerCase().split("-")[0];

  if (fl.startsWith("ko")) return true;
  if (fl && fl.split("-")[0] === langPrefix) return false;
  if (/[\uAC00-\uD7AF]/.test(originalText)) return true;
  if (senderPid === viewerParticipantId) return false;
  return false;
}

export default function ConsultationDisplay() {
  const { roomId: roomIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get("lang") || "en";
  const micEnabled = searchParams.get("mic") === "true";

  const roomId = roomIdParam || "";
  const participantIdRef = useRef(null);
  if (participantIdRef.current == null) {
    participantIdRef.current = `display-${crypto.randomUUID()}`;
  }
  const participantId = participantIdRef.current;

  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [micActive, setMicActive] = useState(false);

  const messagesEndRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const langRef = useRef(lang);
  const roomIdRef = useRef(roomId);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef("audio/webm");

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onConn = () => setConnected(true);
    const onDisc = () => setConnected(false);
    socket.on("connect", onConn);
    socket.on("disconnect", onDisc);
    return () => {
      socket.off("connect", onConn);
      socket.off("disconnect", onDisc);
    };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    socket.emit("join", {
      roomId,
      participantId,
      fromLang: lang,
      roleHint: "viewer",
      localName: "PatientDisplay",
      siteContext: "hospital_plastic_surgery",
    });
    setConnected(true);
    return () => {
      socket.emit("leave-room", { roomId });
    };
  }, [roomId, lang, participantId]);

  useEffect(() => {
    if (!roomId) return;
    const rid = roomId;
    const pid = participantId;
    const plang = lang;

    const onReceiveMessage = (data) => {
      const {
        id,
        roomId: incomingRoomId,
        originalText,
        translatedText,
        senderPid,
        participantId: payloadParticipantId,
        fromLang,
      } = data || {};
      const senderPidResolved = senderPid ?? payloadParticipantId;
      if (!id || (incomingRoomId && incomingRoomId !== rid)) return;

      const staff = isStaffMessage(
        { fromLang, originalText, senderPid: senderPidResolved, participantId: payloadParticipantId },
        pid,
        plang
      );

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        const tText = translatedText || data.text || "";
        if (idx >= 0) {
          return prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  translatedText: tText || m.translatedText,
                  streaming: false,
                }
              : m
          );
        }
        if (seenIdsRef.current.has(id)) {
          return [
            ...prev.filter((m) => m.id !== id),
            {
              id,
              originalText: originalText || "",
              translatedText: tText,
              isStaff: staff,
              timestamp: data.timestamp ?? Date.now(),
              streaming: false,
            },
          ];
        }
        seenIdsRef.current.add(id);
        return [
          ...prev,
          {
            id,
            originalText: originalText || "",
            translatedText: tText,
            isStaff: staff,
            timestamp: data.timestamp ?? Date.now(),
            streaming: false,
          },
        ];
      });
      setTimeout(scrollToBottom, 50);
    };

    const onStream = (data) => {
      const { roomId: incomingRoomId, messageId, chunk, senderPid, originalText, fromLang } = data || {};
      if (!messageId || !chunk || (incomingRoomId && incomingRoomId !== rid)) return;
      const staff = isStaffMessage({ fromLang, originalText, senderPid }, pid, plang);

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          return prev.map((m, i) =>
            i === idx ? { ...m, translatedText: (m.translatedText || "") + chunk, streaming: true } : m
          );
        }
        return [
          ...prev,
          {
            id: messageId,
            originalText: originalText || "",
            translatedText: chunk,
            isStaff: staff,
            timestamp: Date.now(),
            streaming: true,
          },
        ];
      });
      setTimeout(scrollToBottom, 50);
    };

    const onStreamEnd = (data) => {
      const { roomId: incomingRoomId, messageId, fullText } = data || {};
      if (!messageId || (incomingRoomId && incomingRoomId !== rid)) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, translatedText: fullText ?? m.translatedText, streaming: false } : m))
      );
      setTimeout(scrollToBottom, 50);
    };

    const onReviseMessage = (payload) => {
      const { id: messageId, translatedText: revisedText, roomId: incomingRoomId } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!messageId || revisedText == null || String(revisedText).trim() === "") return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, translatedText: revisedText } : m)));
      setTimeout(scrollToBottom, 50);
    };

    const onSttResult = (payload) => {
      const {
        roomId: incomingRoomId,
        text,
        translatedText: payloadTranslated,
        fromLang: fl,
        participantId: sttPid,
      } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!text) return;
      const staff = isStaffMessage({ fromLang: fl, originalText: text, senderPid: sttPid }, pid, plang);
      const msgId = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      seenIdsRef.current.add(msgId);
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          originalText: text,
          translatedText: payloadTranslated ?? text,
          isStaff: staff,
          timestamp: Date.now(),
          streaming: false,
        },
      ]);
      setTimeout(scrollToBottom, 50);
    };

    socket.on("receive-message", onReceiveMessage);
    socket.on("receive-message-stream", onStream);
    socket.on("receive-message-stream-end", onStreamEnd);
    socket.on("display:message", onReceiveMessage);
    socket.on("display:stream", onStream);
    socket.on("display:stream-end", onStreamEnd);
    socket.on("revise-message", onReviseMessage);
    socket.on("stt:result", onSttResult);

    return () => {
      socket.off("receive-message", onReceiveMessage);
      socket.off("receive-message-stream", onStream);
      socket.off("receive-message-stream-end", onStreamEnd);
      socket.off("display:message", onReceiveMessage);
      socket.off("display:stream", onStream);
      socket.off("display:stream-end", onStreamEnd);
      socket.off("revise-message", onReviseMessage);
      socket.off("stt:result", onSttResult);
    };
  }, [roomId, participantId, lang, scrollToBottom]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    }
    setMicActive(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!micEnabled || !roomId) return;
    if (recorderRef.current) {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mimeRef.current = recorder.mimeType || mimeType;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e?.data?.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const chunks = chunksRef.current || [];
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeRef.current || "audio/webm" });
          if (blob.size > 0) {
            const base64 = await toBase64FromBlob(blob);
            socket.emit(
              "stt:whisper",
              {
                roomId,
                audio: base64,
                participantId,
                lang: langRef.current || "en",
                mimeType: mimeRef.current || "audio/webm",
                senderRole: "guest",
                toLang: "ko",
              },
              (ack) => {
                if (!ack?.ok && ack?.error) console.warn("[ConsultationDisplay] stt:whisper", ack.error);
              }
            );
          }
        }
        streamRef.current?.getTracks?.().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setMicActive(false);
      };
      recorder.start(300);
      recorderRef.current = recorder;
      setMicActive(true);
    } catch (e) {
      console.warn("[ConsultationDisplay] mic error:", e?.message);
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setMicActive(false);
    }
  }, [micEnabled, roomId, participantId, stopRecording]);

  const onPttDown = useCallback(
    (e) => {
      if (!micEnabled) return;
      e.preventDefault();
      startRecording();
    },
    [micEnabled, startRecording]
  );

  const onPttUp = useCallback(
    (e) => {
      if (!micEnabled) return;
      e.preventDefault();
      stopRecording();
    },
    [micEnabled, stopRecording]
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1a1a2e",
        color: "#eee",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "#ccc" }}>{roomId || "—"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }} title={lang}>
            {patientLangFlag(lang)}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 8,
              background: connected ? "rgba(76,175,80,0.25)" : "rgba(255,80,80,0.2)",
              color: connected ? "#81c784" : "#ff8a80",
            }}
          >
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "16px 16px 100px",
        }}
      >
        {messages.map((m) =>
          m.isStaff ? (
            <div
              key={m.id}
              style={{
                background: "rgba(255,255,255,0.1)",
                borderLeft: "4px solid #4a9eff",
                borderRadius: 12,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 16, color: "#888", marginBottom: 8 }}>{m.originalText}</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: "#fff" }}>{m.translatedText}</div>
            </div>
          ) : (
            <div
              key={m.id}
              style={{
                background: "rgba(76,175,80,0.15)",
                borderRight: "4px solid #4caf50",
                borderRadius: 12,
                padding: 20,
                marginBottom: 16,
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 600, color: "#81c784" }}>{m.originalText}</div>
              <div style={{ fontSize: 16, color: "#888", marginTop: 8 }}>{m.translatedText}</div>
            </div>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {micEnabled && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            aria-pressed={micActive}
            style={{
              pointerEvents: "auto",
              width: 80,
              height: 80,
              borderRadius: "50%",
              border: "none",
              background: micActive ? "#388e3c" : "#4caf50",
              boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
              cursor: "pointer",
              fontSize: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
            }}
            onPointerDown={onPttDown}
            onPointerUp={onPttUp}
            onPointerLeave={onPttUp}
            onPointerCancel={onPttUp}
          >
            🎤
          </button>
        </div>
      )}
    </div>
  );
}
