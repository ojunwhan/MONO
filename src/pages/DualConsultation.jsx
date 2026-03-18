/**
 * DualConsultation — Standalone in-clinic bilingual interpretation page.
 * Full-screen messenger: PT number + Connect, two mic selectors, two lang selectors,
 * scrollable message area (staff right, patient left), two bottom mic buttons.
 * Uses existing socket events: join, stt:whisper, receive-message, receive-message-stream, receive-message-stream-end.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import socket from "../socket";

const LANG_OPTIONS = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "th", label: "ไทย" },
  { value: "id", label: "Bahasa" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
];

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

  const participantIdRef = useRef("");
  const roomIdRef = useRef("");
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

  // Socket: join on Connect
  const handleConnect = useCallback(() => {
    const pt = String(ptNumber).trim();
    if (!pt) return;
    const pid = "dc-" + crypto.randomUUID();
    participantIdRef.current = pid;
    setRoomId(pt);
    const siteContext = "hospital_plastic_surgery";
    socket.emit("join", {
      roomId: pt,
      participantId: pid,
      fromLang: staffLang,
      roleHint: "host",
      localName: "직원",
      siteContext,
    });
    setConnected(true);
  }, [ptNumber, staffLang]);

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

    socket.on("receive-message", onReceiveMessage);
    socket.on("receive-message-stream", onStream);
    socket.on("receive-message-stream-end", onStreamEnd);
    return () => {
      socket.off("receive-message", onReceiveMessage);
      socket.off("receive-message-stream", onStream);
      socket.off("receive-message-stream-end", onStreamEnd);
    };
  }, [roomId, scrollToBottom]);

  const stopStaffRecording = useCallback(() => {
    if (staffRecorderRef.current && staffRecorderRef.current.state !== "inactive") {
      staffRecorderRef.current.stop();
    }
    staffStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    staffStreamRef.current = null;
    staffRecorderRef.current = null;
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
      const pid = participantIdRef.current;
      const rid = roomIdRef.current;
      if (!pid || !rid) return;
      pendingSenderRef.current = asStaff ? "staff" : "patient";
      socket.emit(
        "stt:whisper",
        { roomId: rid, participantId: pid, lang: fromLang, audio: base64Audio, mimeType },
        (ack) => {
          if (!ack?.ok && ack?.error) console.warn("[DualConsultation] stt ack:", ack.error);
        }
      );
    },
    []
  );

  const startStaffRecording = useCallback(async () => {
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
        setStaffRecording(false);
      };
      recorder.start(300);
      staffRecorderRef.current = recorder;
      setStaffRecording(true);
    } catch (e) {
      console.warn("[DualConsultation] staff mic error:", e?.message);
    }
  }, [staffRecording, staffDeviceId, staffLang, sendWhisper, stopStaffRecording]);

  const startPatientRecording = useCallback(async () => {
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
  }, [patientRecording, patientDeviceId, patientLang, sendWhisper, stopPatientRecording]);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", flexDirection: "column", background: "#f5f5f5" }}>
      {/* Top bar */}
      <header style={{ display: "flex", flexShrink: 0, flexDirection: "column", gap: "8px", borderBottom: "1px solid #e5e7eb", background: "#fff", padding: "12px", boxShadow: "0 1px 2px 0 rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="text"
            placeholder="PT 번호"
            value={ptNumber}
            onChange={(e) => setPtNumber(e.target.value)}
            style={{ flex: 1, borderRadius: "8px", border: "1px solid #d1d5db", padding: "8px 12px", fontSize: "14px" }}
            disabled={connected}
          />
          <button
            type="button"
            onClick={handleConnect}
            disabled={connected || !ptNumber.trim()}
            style={{ borderRadius: "8px", background: "#2563EB", padding: "8px 16px", fontSize: "14px", fontWeight: 500, color: "#fff", opacity: connected || !ptNumber.trim() ? 0.5 : 1 }}
          >
            {connected ? "연결됨" : "Connect"}
          </button>
        </div>
        {connected && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "12px" }}>
              <div>
                <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>직원 마이크</label>
                <select
                  value={staffDeviceId}
                  onChange={(e) => setStaffDeviceId(e.target.value)}
                  style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `마이크 ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>환자 마이크</label>
                <select
                  value={patientDeviceId}
                  onChange={(e) => setPatientDeviceId(e.target.value)}
                  style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `마이크 ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "12px" }}>
              <div>
                <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>직원 언어</label>
                <select
                  value={staffLang}
                  onChange={(e) => setStaffLang(e.target.value)}
                  style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>환자 언어</label>
                <select
                  value={patientLang}
                  onChange={(e) => setPatientLang(e.target.value)}
                  style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </header>

      {/* Message area */}
      <main style={{ flex: 1, overflowY: "auto", padding: "16px 12px" }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: "12px",
              marginLeft: m.isStaff ? "32px" : 0,
              marginRight: m.isStaff ? 0 : "32px",
              display: "flex",
              justifyContent: m.isStaff ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                borderRadius: "16px",
                padding: "8px 16px",
                background: m.isStaff ? "#2563EB" : "#fff",
                color: m.isStaff ? "#fff" : "#111827",
                boxShadow: m.isStaff ? "none" : "0 1px 3px 0 rgba(0,0,0,0.1)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "16px" }}>
                {m.translatedText || (m.streaming ? "…" : "")}
              </div>
              {(m.originalText || "").trim() && (
                <div style={{ marginTop: "4px", fontSize: "12px", color: m.isStaff ? "#bfdbfe" : "#6b7280" }}>
                  {m.originalText}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Bottom bar: two mic buttons */}
      <footer style={{ display: "flex", flexShrink: 0, gap: "8px", borderTop: "1px solid #e5e7eb", background: "#fff", padding: "12px" }}>
        <button
          type="button"
          onClick={startStaffRecording}
          style={{
            flex: 1,
            borderRadius: "12px",
            padding: "16px",
            fontSize: "14px",
            fontWeight: 500,
            background: staffRecording ? "#ef4444" : "#f3f4f6",
            color: staffRecording ? "#fff" : "#1f2937",
          }}
        >
          {staffRecording ? "녹음 중…" : "🎤 직원"}
        </button>
        <button
          type="button"
          onClick={startPatientRecording}
          style={{
            flex: 1,
            borderRadius: "12px",
            padding: "16px",
            fontSize: "14px",
            fontWeight: 500,
            background: patientRecording ? "#ef4444" : "#f3f4f6",
            color: patientRecording ? "#fff" : "#1f2937",
          }}
        >
          {patientRecording ? "녹음 중…" : "🎤 환자"}
        </button>
      </footer>
    </div>
  );
}
