/**
 * DualConsultation — Standalone in-clinic bilingual interpretation page.
 * Full-screen messenger: PT number + Connect, two mic selectors, two lang selectors,
 * scrollable message area (staff right, patient left), two bottom mic buttons.
 * Uses existing socket events: join, stt:whisper, receive-message, receive-message-stream, receive-message-stream-end.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import socket from "../socket";
import { getTier1Languages, getLanguageByCode } from "../constants/languages";
import { getFlagUrlByLang, getLabelFromCode } from "../constants/languageProfiles";

async function toBase64FromBlob(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export default function DualConsultation() {
  const [ptNumber, setPtNumber] = useState("");
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [staffLang, setStaffLang] = useState("ko");
  const [patientLang, setPatientLang] = useState("en");
  const [staffDeviceId, setStaffDeviceId] = useState("");
  const [patientDeviceId, setPatientDeviceId] = useState("");
  const [devices, setDevices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [staffRecording, setStaffRecording] = useState(false);
  const [patientRecording, setPatientRecording] = useState(false);
  const [textInputValue, setTextInputValue] = useState("");
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [micSwapped, setMicSwapped] = useState(false);

  const LANG_OPTIONS = getTier1Languages();
  const patientProfile = getLanguageByCode(patientLang);

  const FlagGrid = ({ selectedLang, onSelectLang }) => {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
        {LANG_OPTIONS.map((p) => {
          const isSelected = p.code === selectedLang;
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => onSelectLang?.(p.code)}
              style={{
                borderRadius: 14,
                border: isSelected ? "2px solid #3B82F6" : "1px solid rgba(17,24,39,0.10)",
                background: isSelected ? "#EFF6FF" : "#FFFFFF",
                boxShadow: isSelected ? "0 10px 30px rgba(59,130,246,0.12)" : "none",
                padding: "10px 6px",
                cursor: "pointer",
                transition: "transform 200ms ease, box-shadow 200ms ease, background 200ms ease",
              }}
            >
              <img
                src={getFlagUrlByLang(p.code)}
                alt={`${getLabelFromCode(p.code)} flag`}
                width={40}
                height={28}
                style={{ width: 40, height: 28, borderRadius: 10, objectFit: "cover", display: "block", margin: "0 auto" }}
                loading="lazy"
              />
              <div style={{ marginTop: 8, textAlign: "center", fontSize: 12, fontWeight: 800, color: "#111827" }}>
                {getLabelFromCode(p.code)}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const participantIdRef = useRef("");
  const roomIdRef = useRef("");
  const connectedRef = useRef(false);
  const messagesEndRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const staffStreamRef = useRef(null);
  const patientStreamRef = useRef(null);
  const staffRecorderRef = useRef(null);
  const patientRecorderRef = useRef(null);
  const staffChunksRef = useRef([]);
  const patientChunksRef = useRef([]);
  const staffMimeRef = useRef("audio/webm");
  const patientMimeRef = useRef("audio/webm");
  /** Tracks which button sent the last whisper so we can align next received message (staff=right, patient=left). */
  const pendingSenderRef = useRef(null); // 'staff' | 'patient' | null

  // List audio devices
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        if (cancelled) return;
        const audio = list.filter((d) => d.kind === "audioinput");
        setDevices(audio);
        if (audio.length > 0 && !staffDeviceId) setStaffDeviceId(audio[0].deviceId);
        if (audio.length > 1 && !patientDeviceId) setPatientDeviceId(audio[1].deviceId);
        else if (audio.length === 1 && !patientDeviceId) setPatientDeviceId(audio[0].deviceId);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // Socket: join only when user clicks Connect (never on mount)
  const handleConnect = useCallback(() => {
    if (!ptNumber.trim()) return;
    const pt = String(ptNumber).trim();
    const uuid =
      typeof crypto !== "undefined" && crypto?.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const pid = "dc-" + uuid;
    participantIdRef.current = pid;
    console.log("[Dual] handleConnect pid set:", participantIdRef.current);
    const siteContext = "hospital_plastic_surgery";
    socket.emit("join", {
      roomId: pt,
      fromLang: staffLang,
      participantId: pid,
      role: "host",
      roleHint: "owner",
      localName: "직원",
      siteContext,
      inputMode: "ptt",
    });
    // 서버 이벤트 대기 없이 즉시 UI를 connected 상태로 전환합니다.
    connectedRef.current = true;
    setRoomId(pt);
    setConnected(true);
  }, [ptNumber, staffLang]);

  // Unmount: leave room if we had connected
  useEffect(() => {
    return () => {
      if (connectedRef.current && roomIdRef.current) {
        socket.emit("leave-room", { roomId: roomIdRef.current });
      }
      connectedRef.current = false;
    };
  }, []);

  // Socket: receive-message, receive-message-stream, receive-message-stream-end
  useEffect(() => {
    if (!roomId) return;
    const rid = roomId;

    const onReceiveMessage = (payload) => {
      const { id, roomId: incomingRoomId, originalText, translatedText, senderPid } = payload || {};
      if (!id || (incomingRoomId && incomingRoomId !== rid)) return;
      if (seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      const isStaff = pendingSenderRef.current === "staff";
      if (pendingSenderRef.current) pendingSenderRef.current = null;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx >= 0) {
          return prev.map((m, i) => (i === idx ? { ...m, translatedText: translatedText ?? m.translatedText, streaming: false } : m));
        }
        return [
          ...prev,
          {
            id,
            originalText: originalText || "",
            translatedText: translatedText || "",
            isStaff: senderPid === participantIdRef.current ? isStaff : false,
            senderPid,
            timestamp: Date.now(),
            streaming: false,
          },
        ];
      });
      setTimeout(scrollToBottom, 50);
    };

    const onStream = (payload) => {
      const { roomId: incomingRoomId, messageId, chunk, senderPid, originalText } = payload || {};
      if (!messageId || !chunk || (incomingRoomId && incomingRoomId !== rid)) return;
      const isStaff = pendingSenderRef.current === "staff";
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
            isStaff: senderPid === participantIdRef.current ? isStaff : false,
            senderPid,
            timestamp: Date.now(),
            streaming: true,
          },
        ];
      });
      setTimeout(scrollToBottom, 50);
    };

    const onStreamEnd = (payload) => {
      const { roomId: incomingRoomId, messageId, fullText } = payload || {};
      if (!messageId || (incomingRoomId && incomingRoomId !== rid)) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, translatedText: fullText ?? m.translatedText, streaming: false } : m))
      );
      setTimeout(scrollToBottom, 50);
    };

    const onSttResult = (payload) => {
      const { roomId: incomingRoomId, participantId: incomingPid, text, translatedText: payloadTranslated, final } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!text || !final) return;
      const pending = pendingSenderRef.current;
      const isStaff = pending ? pending === "staff" : incomingPid === participantIdRef.current;
      if (pendingSenderRef.current) pendingSenderRef.current = null;
      const msgId = `stt-result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      seenIdsRef.current.add(msgId);
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          originalText: text,
          translatedText: payloadTranslated ?? text,
          isStaff,
          senderPid: incomingPid,
          timestamp: Date.now(),
          streaming: false,
        },
      ]);
      setTimeout(scrollToBottom, 50);
    };

    socket.on("receive-message", onReceiveMessage);
    socket.on("receive-message-stream", onStream);
    socket.on("receive-message-stream-end", onStreamEnd);
    socket.on("stt:result", onSttResult);
    return () => {
      socket.off("receive-message", onReceiveMessage);
      socket.off("receive-message-stream", onStream);
      socket.off("receive-message-stream-end", onStreamEnd);
      socket.off("stt:result", onSttResult);
    };
  }, [roomId, scrollToBottom]);

  const stopStaffRecording = useCallback(() => {
    if (staffRecorderRef.current && staffRecorderRef.current.state !== "inactive") {
      staffRecorderRef.current.stop();
    }
    setStaffRecording(false);
  }, []);

  const stopPatientRecording = useCallback(() => {
    if (patientRecorderRef.current && patientRecorderRef.current.state !== "inactive") {
      patientRecorderRef.current.stop();
    }
    patientStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    patientStreamRef.current = null;
    patientRecorderRef.current = null;
    setPatientRecording(false);
  }, []);

  const sendWhisper = useCallback(
    (base64Audio, mimeType, fromLang, asStaff) => {
      const isStaff = asStaff;
      console.log("[Dual] sendWhisper called, isStaff:", isStaff, "connected:", connected, "roomId:", roomId);
      const pid = participantIdRef.current;
      const rid = roomIdRef.current;
      console.log("[Dual] sendWhisper pid:", pid, "rid:", rid);
      if (!pid || !rid) return;
      pendingSenderRef.current = asStaff ? "staff" : "patient";
      const toLang = asStaff ? patientLang : staffLang;
      socket.emit(
        "stt:whisper",
        { roomId: rid, participantId: pid, lang: fromLang, toLang, audio: base64Audio, mimeType },
        (ack) => {
          if (!ack?.ok && ack?.error) console.warn("[DualConsultation] stt ack:", ack.error);
        }
      );
    },
    [connected, roomId, patientLang, staffLang]
  );

  const startStaffRecording = useCallback(async () => {
    console.log("[Dual] startStaffRecording called, staffRecording:", staffRecording, "connected:", connected);
    if (patientRecording) {
      stopPatientRecording();
      return;
    }
    if (staffRecording) {
      stopStaffRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: staffDeviceId ? { deviceId: { exact: staffDeviceId } } : true,
      });
      staffStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      staffMimeRef.current = recorder.mimeType || mimeType;
      staffChunksRef.current = [];
      recorder.ondataavailable = (e) => e?.data?.size > 0 && staffChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const chunks = staffChunksRef.current || [];
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: staffMimeRef.current || "audio/webm" });
          if (blob.size > 0) {
            const base64 = await toBase64FromBlob(blob);
            sendWhisper(base64, staffMimeRef.current || "audio/webm", staffLang, true);
          }
        }
        staffStreamRef.current?.getTracks?.().forEach((t) => t.stop());
        staffStreamRef.current = null;
        staffRecorderRef.current = null;
        setStaffRecording(false);
      };
      recorder.start(100);
      staffRecorderRef.current = recorder;
      setStaffRecording(true);
    } catch (e) {
      console.error("[DualConsultation] staff mic error:", e);
    }
  }, [staffRecording, patientRecording, staffDeviceId, staffLang, sendWhisper, stopStaffRecording, stopPatientRecording, connected]);

  const startPatientRecording = useCallback(async () => {
    if (staffRecording) {
      stopStaffRecording();
      return;
    }
    if (patientRecording) {
      stopPatientRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: patientDeviceId ? { deviceId: { exact: patientDeviceId } } : true,
      });
      patientStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      patientMimeRef.current = recorder.mimeType || mimeType;
      patientChunksRef.current = [];
      recorder.ondataavailable = (e) => e?.data?.size > 0 && patientChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        const chunks = patientChunksRef.current || [];
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: patientMimeRef.current || "audio/webm" });
          if (blob.size > 0) {
            const base64 = await toBase64FromBlob(blob);
            sendWhisper(base64, patientMimeRef.current || "audio/webm", patientLang, false);
          }
        }
        patientStreamRef.current?.getTracks?.().forEach((t) => t.stop());
        patientStreamRef.current = null;
        setPatientRecording(false);
      };
      recorder.start(300);
      patientRecorderRef.current = recorder;
      setPatientRecording(true);
    } catch (e) {
      console.warn("[DualConsultation] patient mic error:", e?.message);
    }
  }, [patientRecording, staffRecording, patientDeviceId, patientLang, sendWhisper, stopPatientRecording, stopStaffRecording]);

  const handleSendText = useCallback(() => {
    const trimmed = textInputValue.trim();
    if (!trimmed || !connected || !roomIdRef.current || !participantIdRef.current) return;
    const msgId = `dc-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        originalText: trimmed,
        translatedText: trimmed,
        isStaff: true,
        senderPid: participantIdRef.current,
        timestamp: Date.now(),
        streaming: false,
      },
    ]);
    setTextInputValue("");
    socket.emit("send-message", {
      roomId: roomIdRef.current,
      participantId: participantIdRef.current,
      message: { id: msgId, text: trimmed },
    });
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [textInputValue, connected]);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", flexDirection: "column", background: "#fff", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" }}>
      <style>{`
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGlowStaff {
          0% { transform: translateZ(0) scale(1); box-shadow: 0 0 0 rgba(102,126,234,0.0); }
          50% { transform: translateZ(0) scale(1.01); box-shadow: 0 0 0 8px rgba(102,126,234,0.18); }
          100% { transform: translateZ(0) scale(1); box-shadow: 0 0 0 rgba(102,126,234,0.0); }
        }
        @keyframes pulseGlowPatient {
          0% { transform: translateZ(0) scale(1); box-shadow: 0 0 0 rgba(245,87,108,0.0); }
          50% { transform: translateZ(0) scale(1.01); box-shadow: 0 0 0 8px rgba(245,87,108,0.18); }
          100% { transform: translateZ(0) scale(1); box-shadow: 0 0 0 rgba(245,87,108,0.0); }
        }
      `}</style>

      {/* Top bar */}
      <header style={{ display: "flex", flexShrink: 0, flexDirection: "column", gap: "10px", padding: "12px", background: "#fff" }}>
        {/* PT Info Card */}
        <div
          style={{
            background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            borderRadius: 16,
            margin: "12px 0 0",
            padding: "14px 14px",
            border: "1px solid rgba(0,0,0,0.04)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* PT box (PT + 환자 언어 + 환자명 + 연결 상태) */}
          <div
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              borderRadius: 12,
              padding: "12px 16px",
              background: "#E8F5E9",
              boxShadow: "0 10px 24px rgba(16,185,129,0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <input
              type="text"
              placeholder="PT-TEST01"
              value={ptNumber}
              onChange={(e) => setPtNumber(e.target.value)}
              disabled={connected}
              style={{
                flex: "0 0 auto",
                width: 130,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 14,
                fontWeight: 600,
                color: "#2E1065",
                letterSpacing: 0.2,
              }}
            />

            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, minWidth: 70 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{patientProfile?.flag || "🌐"}</span>
              <span style={{ fontSize: 12, fontWeight: 900, color: "#374151", whiteSpace: "nowrap" }}>
                {getLabelFromCode(patientLang)}
              </span>
            </div>

            <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13, fontWeight: 700, color: "#111827", whiteSpace: "nowrap" }}>
              환자 이름 미등록
            </div>

            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", fontSize: 13, fontWeight: 900, color: connected ? "#047857" : "#B91C1C" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: connected ? "#10B981" : "#EF4444",
                }}
              />
              {connected ? "연결됨" : "연결 끊김"}
            </div>
          </div>
        </div>

        {/* Connect CTA */}
        {!connected && (
          <button
            type="button"
            onClick={() => handleConnect()}
            disabled={!ptNumber.trim()}
            style={{
              marginTop: 2,
              alignSelf: "center",
              border: "none",
              borderRadius: 26,
              padding: "12px 18px",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 800,
              boxShadow: "0 12px 30px rgba(118,75,162,0.22)",
              opacity: !ptNumber.trim() ? 0.55 : 1,
              transition: "transform 200ms ease, opacity 200ms ease",
            }}
          >
            Connect
          </button>
        )}

        {/* Settings panel */}
        {connected && (
          <div style={{ width: "100%" }}>
            <button
              type="button"
              onClick={() => setSettingsExpanded((p) => !p)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 16,
                border: "1px solid rgba(0,0,0,0.06)",
                background: "#fff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                fontSize: 14,
                fontWeight: 900,
                color: "#374151",
                transition: "transform 200ms ease",
              }}
            >
              <span>⚙️ 설정</span>
            <span style={{ color: "#6B7280", fontWeight: 800 }}>{settingsExpanded ? "▲" : ""}</span>
            </button>

            <div
              style={{
                marginTop: 10,
                overflow: "hidden",
                maxHeight: settingsExpanded ? 720 : 0,
                opacity: settingsExpanded ? 1 : 0,
                pointerEvents: settingsExpanded ? "auto" : "none",
                transition: "max-height 300ms ease, opacity 300ms ease",
              }}
            >
              <div
                style={{
                  borderRadius: 16,
                  background: "#fff",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
                  border: "1px solid rgba(0,0,0,0.04)",
                  padding: 14,
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {/* Staff mic */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>직원 마이크</div>
                    <select
                      value={staffDeviceId}
                      onChange={(e) => setStaffDeviceId(e.target.value)}
                      style={{ width: "100%", borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", padding: "10px 12px", fontSize: 14 }}
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `마이크 ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Patient mic */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>환자 마이크</div>
                    <select
                      value={patientDeviceId}
                      onChange={(e) => setPatientDeviceId(e.target.value)}
                      style={{ width: "100%", borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", padding: "10px 12px", fontSize: 14 }}
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `마이크 ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Staff language */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>직원 언어</div>
                    <FlagGrid selectedLang={staffLang} onSelectLang={(code) => setStaffLang(code)} />
                  </div>

                  {/* Patient language */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>환자 언어</div>
                    <FlagGrid selectedLang={patientLang} onSelectLang={(code) => setPatientLang(code)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Single unified chat area */}
      <main style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "16px 12px", background: "linear-gradient(180deg, #FFF5F5 0%, #FFFFFF 50%, #F0FFF4 100%)" }}>
        {messages.map((m) => {
          const staffOnLeft = !micSwapped;
          const isLeft = m.isStaff ? staffOnLeft : !staffOnLeft;
          const label = m.isStaff ? "👩‍⚕️ 직원" : "🧑‍🦰 환자";
          const bubbleBg = m.isStaff ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
          const borderRadius = isLeft ? "20px 20px 20px 6px" : "20px 20px 6px 20px";
          return (
            <div key={m.id} style={{ marginBottom: 14, display: "flex", justifyContent: isLeft ? "flex-start" : "flex-end" }}>
              <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", alignItems: isLeft ? "flex-start" : "flex-end" }}>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#9CA3AF",
                    fontWeight: 900,
                    marginBottom: 8,
                    textAlign: isLeft ? "left" : "right",
                    width: "100%",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    background: bubbleBg,
                    color: "#fff",
                    padding: "14px 18px",
                    borderRadius,
                    boxShadow: "0 12px 30px rgba(0,0,0,0.07)",
                    animation: "bubbleIn 200ms ease both",
                  }}
                >
                  {(m.originalText || "").trim() && (
                    <div style={{ fontSize: "0.8rem", opacity: 0.7, marginBottom: 6 }}>{m.originalText}</div>
                  )}
                  <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>
                    {m.translatedText || (m.streaming ? "…" : "")}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} style={{ height: 1, pointerEvents: "none" }} />
      </main>

      {/* Mic buttons - full width */}
      <footer style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 12, borderTop: "1px solid #f0f0f0", background: "#fff", padding: "12px 16px" }}>
        {/* Left button */}
        {!micSwapped ? (
          <button
            type="button"
            onClick={startStaffRecording}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 26,
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 900,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              boxShadow: "0 16px 34px rgba(118,75,162,0.22)",
              transition: "transform 200ms ease",
              animation: staffRecording ? "pulseGlowStaff 1.2s ease-in-out infinite" : "none",
              padding: "0 16px",
            }}
          >
            {staffRecording ? "녹음 중..." : "🎤 직원"}
          </button>
        ) : (
          <button
            type="button"
            onClick={startPatientRecording}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 26,
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 900,
              background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
              boxShadow: "0 16px 34px rgba(245,87,108,0.22)",
              transition: "transform 200ms ease",
              animation: patientRecording ? "pulseGlowPatient 1.2s ease-in-out infinite" : "none",
              padding: "0 16px",
            }}
          >
            {patientRecording ? "녹음 중..." : "🎤 환자"}
          </button>
        )}

        {/* Swap control */}
        <button
          type="button"
          onClick={() => setMicSwapped((p) => !p)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            border: "1px solid rgba(0,0,0,0.06)",
            background: "#fff",
            boxShadow: "0 10px 22px rgba(0,0,0,0.05)",
            color: "#6B7280",
            fontSize: 18,
            fontWeight: 900,
            transition: "transform 200ms ease",
          }}
          aria-label="swap mic buttons"
          title="Swap"
        >
          ⇄
        </button>

        {/* Right button */}
        {!micSwapped ? (
          <button
            type="button"
            onClick={startPatientRecording}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 26,
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 900,
              background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
              boxShadow: "0 16px 34px rgba(245,87,108,0.22)",
              transition: "transform 200ms ease",
              animation: patientRecording ? "pulseGlowPatient 1.2s ease-in-out infinite" : "none",
              padding: "0 16px",
            }}
          >
            {patientRecording ? "녹음 중..." : "🎤 환자"}
          </button>
        ) : (
          <button
            type="button"
            onClick={startStaffRecording}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 26,
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 900,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              boxShadow: "0 16px 34px rgba(118,75,162,0.22)",
              transition: "transform 200ms ease",
              animation: staffRecording ? "pulseGlowStaff 1.2s ease-in-out infinite" : "none",
              padding: "0 16px",
            }}
          >
            {staffRecording ? "녹음 중..." : "🎤 직원"}
          </button>
        )}
      </footer>

      {/* Text input bar - at very bottom */}
      {connected && (
        <div style={{ flexShrink: 0, display: "flex", gap: 12, padding: "12px 16px 16px", background: "#fff" }}>
          <input
            type="text"
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendText()}
            placeholder="메시지 입력..."
            style={{
              flex: 1,
              minWidth: 0,
              height: 44,
              borderRadius: 22,
              border: "1px solid rgba(0,0,0,0.08)",
              background: "#fff",
              padding: "0 16px",
              fontSize: 14,
              fontWeight: 600,
              boxShadow: "0 12px 26px rgba(0,0,0,0.04)",
              outline: "none",
              transition: "transform 200ms ease, box-shadow 200ms ease",
            }}
            disabled={!connected}
          />
          <button
            type="button"
            onClick={handleSendText}
            disabled={!connected || !textInputValue.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              border: "none",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 900,
              boxShadow: "0 16px 34px rgba(118,75,162,0.22)",
              opacity: !textInputValue.trim() ? 0.6 : 1,
              transition: "transform 200ms ease, opacity 200ms ease",
            }}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
