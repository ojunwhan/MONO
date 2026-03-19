/**
 * DualConsultation ??Standalone in-clinic bilingual interpretation page.
 * Full-screen messenger: PT number + Connect, two mic selectors, two lang selectors,
 * scrollable message area (staff right, patient left), two bottom mic buttons.
 * Uses existing socket events: join, stt:whisper, receive-message, receive-message-stream, receive-message-stream-end.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import socket from "../socket";

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
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [micSwapped, setMicSwapped] = useState(false);

  const LANG_FLAG_GRID = [
    { code: "ko", flag: "kr", label: "KOR" },
    { code: "en", flag: "us", label: "ENG" },
    { code: "zh", flag: "cn", label: "CHN" },
    { code: "ja", flag: "jp", label: "JPN" },
    { code: "vi", flag: "vn", label: "VNM" },
    { code: "th", flag: "th", label: "THA" },
    { code: "id", flag: "id", label: "IDN" },
    { code: "ms", flag: "my", label: "MYS" },
    { code: "tl", flag: "ph", label: "PHL" },
    { code: "my", flag: "mm", label: "MMR" },
    { code: "km", flag: "kh", label: "KHM" },
    { code: "ne", flag: "np", label: "NPL" },
    { code: "mn", flag: "mn", label: "MNG" },
    { code: "uz", flag: "uz", label: "UZB" },
    { code: "ru", flag: "ru", label: "RUS" },
    { code: "es", flag: "es", label: "ESP" },
    { code: "pt", flag: "pt", label: "PRT" },
    { code: "fr", flag: "fr", label: "FRA" },
    { code: "de", flag: "de", label: "DEU" },
    { code: "ar", flag: "sa", label: "ARA" },
  ];

  const patientLangMeta =
    LANG_FLAG_GRID.find((x) => x.code === patientLang) ||
    LANG_FLAG_GRID.find((x) => x.code === "en") ||
    LANG_FLAG_GRID[0];

  const FlagGrid = ({ selectedLang, onSelectLang }) => {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, maxHeight: 200, overflowY: "auto" }}>
        {LANG_FLAG_GRID.map((p) => {
          const isSelected = p.code === selectedLang;
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => onSelectLang?.(p.code)}
              style={{
                width: 60,
                borderRadius: 8,
                padding: 4,
                textAlign: "center",
                cursor: "pointer",
                border: isSelected ? "2px solid #3B82F6" : "2px solid transparent",
                background: isSelected ? "rgba(59,130,246,0.06)" : "#fff",
                transition: "border-color 200ms ease, transform 200ms ease, background 200ms ease",
              }}
            >
              <img
                src={`https://flagcdn.com/w40/${p.flag}.png`}
                alt={`${p.label} flag`}
                width={32}
                height={24}
                style={{ borderRadius: 6, objectFit: "cover", display: "block", margin: "0 auto" }}
                loading="lazy"
              />
              <div style={{ fontSize: 11, fontWeight: 800, marginTop: 4, color: "#111827" }}>{p.label}</div>
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
    const pid = "dc-" + crypto.randomUUID();
    participantIdRef.current = pid;
    console.log("[Dual] handleConnect pid set:", participantIdRef.current);
    connectedRef.current = true;
    setRoomId(pt);
    const siteContext = "hospital_plastic_surgery";
    socket.emit("join", {
      roomId: pt,
      participantId: pid,
      fromLang: staffLang,
      roleHint: "host",
      localName: "ÏßÅÏõê",
      siteContext,
    });
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
    <div style={{ display: "flex", height: "100vh", width: "100%", flexDirection: "column", background: "#f5f5f5" }}>
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
          {/* PT box (PT + ?òÏûê ?∏Ïñ¥ + ?òÏûêÎ™?+ ?∞Í≤∞ ?ÅÌÉú) */}
          <div
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              borderRadius: 12,
              padding: "8px 12px",
              background: "#fff",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <input
              type="text"
              placeholder="PT Î≤àÌò∏"
              value={ptNumber}
              onChange={(e) => setPtNumber(e.target.value)}
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

            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>
              <img
                src={`https://flagcdn.com/w40/${patientLangMeta.flag}.png`}
                alt={`${patientLangMeta.label} flag`}
                width={32}
                height={24}
                style={{ borderRadius: 6, objectFit: "cover" }}
                loading="lazy"
              />
              <div style={{ fontSize: 12, fontWeight: 900, color: "#374151", whiteSpace: "nowrap" }}>{patientLangMeta.label}</div>
            </div>

            <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13, fontWeight: 800, color: "#111827", whiteSpace: "nowrap" }}>
              ÍπÄ?òÏßÑ
            </div>

            <button
              type="button"
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                background: "transparent",
                cursor: "default",
                padding: 0,
                whiteSpace: "nowrap",
                fontSize: 13,
                fontWeight: 900,
                color: connected ? "#047857" : "#B91C1C",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: connected ? "#10B981" : "#EF4444",
                }}
              />
              {connected ? "?∞Í≤∞?? : "?∞Í≤∞?äÍ?"}
            </button>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connected || !ptNumber.trim()}
            style={{ borderRadius: "8px", background: "#2563EB", padding: "8px 16px", fontSize: "14px", fontWeight: 500, color: "#fff", opacity: connected || !ptNumber.trim() ? 0.5 : 1 }}
          >
            {connected ? "?∞Í≤∞?? : "Connect"}
          </button>
        )}

        {/* Settings panel */}
        {connected && (
          <div style={{ width: "100%" }}>
            <div
              onClick={() => setSettingsOpen((p) => !p)}
              style={{
                width: "100%",
                background: "#f9fafb",
                padding: "8px 16px",
                cursor: "pointer",
                textAlign: "center",
                fontSize: 13,
                color: "#6b7280",
                borderBottom: "1px solid #e5e7eb",
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontWeight: 900,
              }}
            >
              <span>?ôÔ∏è ?§Ï†ï</span>
              <span>{settingsOpen ? "?? : "??}</span>
            </div>

            <div
              style={{
                overflow: "hidden",
                maxHeight: settingsOpen ? 720 : 0,
                transition: "max-height 300ms ease",
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
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>ÏßÅÏõê ÎßàÏù¥??/div>
                    <select
                      value={staffDeviceId}
                      onChange={(e) => setStaffDeviceId(e.target.value)}
                      style={{ width: "100%", borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", padding: "10px 12px", fontSize: 14 }}
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `ÎßàÏù¥??${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Patient mic */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>?òÏûê ÎßàÏù¥??/div>
                    <select
                      value={patientDeviceId}
                      onChange={(e) => setPatientDeviceId(e.target.value)}
                      style={{ width: "100%", borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", padding: "10px 12px", fontSize: 14 }}
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `ÎßàÏù¥??${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Staff language */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>ÏßÅÏõê ?∏Ïñ¥</div>
                    <FlagGrid selectedLang={staffLang} onSelectLang={(code) => setStaffLang(code)} />
                  </div>

                  {/* Patient language */}
                  <div style={{ background: "#F9FAFB", borderRadius: 16, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6B7280", marginBottom: 8 }}>?òÏûê ?∏Ïñ¥</div>
                    <FlagGrid selectedLang={patientLang} onSelectLang={(code) => setPatientLang(code)} />
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "12px" }}>
              <div>
                <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>ÏßÅÏõê ?∏Ïñ¥</label>
                <select
                  value={staffLang}
                  onChange={(e) => setStaffLang(e.target.value)}
                  style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{o.flag} {o.nativeName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>?òÏûê ?∏Ïñ¥</label>
                <select
                  value={patientLang}
                  onChange={(e) => setPatientLang(e.target.value)}
                  style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{o.flag} {o.nativeName}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </header>

      {/* Single unified chat area */}
      <main style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "12px" }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: "12px",
              display: "flex",
              justifyContent: m.isStaff ? "flex-start" : "flex-end",
            }}
          >
            <div
              style={{
                maxWidth: "70%",
                width: "fit-content",
                borderRadius: m.isStaff ? "16px 16px 16px 4px" : "16px 16px 4px 16px",
                padding: "8px 16px",
                background: m.isStaff ? "#3B82F6" : "#10B981",
                color: "#fff",
                boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
              }}
            >
              {(m.originalText || "").trim() && (
                <div style={{ fontSize: "0.85rem", opacity: 0.8, marginBottom: "4px" }}>{m.originalText}</div>
              )}
              <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>
                {m.translatedText || (m.streaming ? "?? : "")}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} style={{ height: 1, pointerEvents: "none" }} />
      </main>

      {/* Mic buttons - full width */}
      <footer style={{ display: "flex", flexShrink: 0, gap: "8px", borderTop: "1px solid #e5e7eb", background: "#fff", padding: "12px" }}>
        <button
          type="button"
          onClick={startStaffRecording}
          style={{
            flex: 1,
            minHeight: "48px",
            borderRadius: "10px",
            padding: "14px 16px",
            fontSize: "14px",
            fontWeight: 500,
            background: staffRecording ? "#ef4444" : "#EEF2FF",
            color: staffRecording ? "#fff" : "#1f2937",
            border: "2px solid #6366F1",
          }}
        >
          {staffRecording ? "?πÏùå Ï§ë‚Ä? : "?é§ ÏßÅÏõê"}
        </button>
        <button
          type="button"
          onClick={startPatientRecording}
          style={{
            flex: 1,
            minHeight: "48px",
            borderRadius: "10px",
            padding: "14px 16px",
            fontSize: "14px",
            fontWeight: 500,
            background: patientRecording ? "#ef4444" : "#F0FDF4",
            color: patientRecording ? "#fff" : "#1f2937",
            border: "2px solid #22C55E",
          }}
        >
          {patientRecording ? "?πÏùå Ï§ë‚Ä? : "?é§ ?òÏûê"}
        </button>
      </footer>

      {/* Text input bar - at very bottom */}
      {connected && (
        <div style={{ flexShrink: 0, display: "flex", gap: "8px", padding: "8px 12px", borderTop: "1px solid #e5e7eb", background: "#fff" }}>
          <input
            type="text"
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendText()}
            placeholder="Î©îÏãúÏßÄ ?ÖÎ†•..."
            style={{ flex: 1, minWidth: 0, borderRadius: "8px", border: "1px solid #d1d5db", padding: "10px 12px", fontSize: "14px" }}
            disabled={!connected}
          />
          <button
            type="button"
            onClick={handleSendText}
            disabled={!connected || !textInputValue.trim()}
            style={{ borderRadius: "8px", background: "#2563EB", color: "#fff", padding: "10px 16px", fontSize: "14px", fontWeight: 500 }}
          >
            ??
          </button>
        </div>
      )}
    </div>
  );
}
