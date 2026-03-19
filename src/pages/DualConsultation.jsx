/**
 * DualConsultation ? Standalone in-clinic bilingual interpretation page.
 * Full-screen messenger: PT number + Connect, two mic selectors, two lang selectors,
 * scrollable message area (staff right, patient left), two bottom mic buttons.
 * Uses existing socket events: join, stt:whisper, receive-message, receive-message-stream, receive-message-stream-end.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import socket from "../socket";
import LanguageFlagPicker from "../components/LanguageFlagPicker";

async function toBase64FromBlob(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export default function DualConsultation() {
  const LANG_TO_FLAG = {en:"us",ko:"kr",zh:"cn",ja:"jp",vi:"vn",th:"th",id:"id",ms:"my",tl:"ph",my:"mm",km:"kh",ne:"np",mn:"mn",uz:"uz",ru:"ru",es:"es",pt:"pt",fr:"fr",de:"de",ar:"sa"};
  const LANG_TO_LABEL = {en:"ENG",ko:"KOR",zh:"CHN",ja:"JPN",vi:"VNM",th:"THA",id:"IDN",ms:"MYS",tl:"PHL",my:"MMR",km:"KHM",ne:"NPL",mn:"MNG",uz:"UZB",ru:"RUS",es:"ESP",pt:"PRT",fr:"FRA",de:"DEU",ar:"ARA"};
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
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [showStaffGrid, setShowStaffGrid] = useState(false);
  const [showPatientGrid, setShowPatientGrid] = useState(false);
  const [inputMode, setInputMode] = useState("ptt"); // "ptt" = dual mic, "vad" = single mic auto (manual start/stop for now)
  const [vadActive, setVadActive] = useState(false);

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
  const inputModeRef = useRef(inputMode);
  const staffLangRef = useRef(staffLang);
  const patientLangRef = useRef(patientLang);

  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);
  useEffect(() => {
    staffLangRef.current = staffLang;
  }, [staffLang]);
  useEffect(() => {
    patientLangRef.current = patientLang;
  }, [patientLang]);

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
      localName: "Staff",
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
      const { roomId: incomingRoomId, participantId: incomingPid, text, translatedText: payloadTranslated, final, fromLang } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!text || !final) return;
      let isStaff;
      if (inputModeRef.current === "vad") {
        const detectedLang = fromLang || "";
        const patientLang = patientLangRef.current || "";
        if (detectedLang === patientLang || detectedLang.startsWith(patientLang)) {
          isStaff = false;
        } else {
          isStaff = true;
        }
      } else {
        isStaff = pendingSenderRef.current === "staff";
      }
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

  const handleVADToggle = () => {
    if (vadActive) {
      if (staffRecording) stopStaffRecording();
      setVadActive(false);
    } else {
      setVadActive(true);
      startStaffRecording();
    }
  };

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
      <header style={{ display: "flex", flexShrink: 0, flexDirection: "column", gap: "8px", borderBottom: "1px solid #e5e7eb", background: "#fff", padding: "12px", boxShadow: "0 1px 2px 0 rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", flex: "1 1 120px", minWidth: 0, border: "1px solid #d1d5db", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
            <input
              type="text"
              placeholder="PT Number"
              value={ptNumber}
              onChange={(e) => setPtNumber(e.target.value)}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "8px 12px", fontSize: "14px" }}
              disabled={connected}
            />
            <img
              src={`https://flagcdn.com/w40/${LANG_TO_FLAG[patientLang] || "us"}.png`}
              width={24}
              height={16}
              style={{ borderRadius: 2, marginLeft: 12 }}
              alt=""
            />
            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {LANG_TO_LABEL[patientLang] || "ENG"}
            </span>
            <span style={{ fontSize: 13, color: "#374151", marginLeft: 8, flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Sarah Johnson</span>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connected || !ptNumber.trim()}
            style={{ borderRadius: "8px", background: "#2563EB", padding: "8px 16px", fontSize: "14px", fontWeight: 500, color: "#fff", opacity: connected || !ptNumber.trim() ? 0.5 : 1 }}
          >
            {connected ? "Connected" : "Connect"}
          </button>
          {connected && (
            <button
              type="button"
              onClick={() => setSettingsExpanded((p) => !p)}
              title={settingsExpanded ? "Collapse" : "Expand"}
              style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", fontSize: "14px", color: "#4b5563" }}
            >
              {settingsExpanded ? "?" : "?"}
            </button>
          )}
        </div>
        {connected && settingsExpanded && (
          <>
            <div
              onClick={() => setSettingsOpen((prev) => !prev)}
              style={{ padding: "6px 16px", cursor: "pointer", textAlign: "center", fontSize: 13, color: "#6b7280", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", userSelect: "none" }}
            >
              {settingsOpen ? "Settings \u25BC" : "Settings \u25B6"}
            </div>
            <div style={{ maxHeight: settingsOpen ? "500px" : "0", overflow: "hidden", transition: "max-height 300ms ease" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 0" }}>
                <button
                  type="button"
                  onClick={() => setInputMode("ptt")}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 20,
                    border: "1px solid #d1d5db",
                    background: inputMode === "ptt" ? "#3B82F6" : "white",
                    color: inputMode === "ptt" ? "white" : "#374151",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Dual Mic (PTT)
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("vad")}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 20,
                    border: "1px solid #d1d5db",
                    background: inputMode === "vad" ? "#3B82F6" : "white",
                    color: inputMode === "vad" ? "white" : "#374151",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Single Mic (Auto)
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: inputMode === "vad" ? "1fr" : "1fr 1fr", gap: "12px", fontSize: "12px" }}>
                <div>
                  <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Staff Mic</label>
                  <select
                    value={staffDeviceId}
                    onChange={(e) => setStaffDeviceId(e.target.value)}
                    style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                  >
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
                {inputMode === "ptt" ? (
                  <div>
                    <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Patient Mic</label>
                    <select
                      value={patientDeviceId}
                      onChange={(e) => setPatientDeviceId(e.target.value)}
                      style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "12px", marginTop: "12px" }}>
                <div>
                  <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Staff Lang</label>
                  <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 30 }} className="[&_p]:hidden">
                    <LanguageFlagPicker
                      selectedLang={staffLang}
                      showGrid={showStaffGrid}
                      onToggleGrid={() => setShowStaffGrid((prev) => !prev)}
                      onSelect={(code) => {
                        setStaffLang(code);
                        setShowStaffGrid(false);
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Patient Lang</label>
                  <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 30 }} className="[&_p]:hidden">
                    <LanguageFlagPicker
                      selectedLang={patientLang}
                      showGrid={showPatientGrid}
                      onToggleGrid={() => setShowPatientGrid((prev) => !prev)}
                      onSelect={(code) => {
                        setPatientLang(code);
                        setShowPatientGrid(false);
                      }}
                    />
                  </div>
                </div>
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
                {m.translatedText || (m.streaming ? "..." : "")}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} style={{ height: 1, pointerEvents: "none" }} />
      </main>

      {/* Mic buttons - full width */}
      <footer style={{ display: "flex", flexShrink: 0, gap: "8px", borderTop: "1px solid #e5e7eb", background: "#fff", padding: "12px" }}>
        {inputMode === "ptt" ? (
          <>
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
              {staffRecording ? "Stop" : "Staff"}
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
              {patientRecording ? "Stop" : "Patient"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleVADToggle}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 12,
              border: "none",
              background: vadActive ? "#ef4444" : "#3B82F6",
              color: "white",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {vadActive ? "Stop Listening" : "Start Listening"}
          </button>
        )}
      </footer>

      {/* Text input bar - at very bottom */}
      {connected && (
        <div style={{ flexShrink: 0, display: "flex", gap: "8px", padding: "8px 12px", borderTop: "1px solid #e5e7eb", background: "#fff" }}>
          <input
            type="text"
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendText()}
            placeholder="Type message..."
            style={{ flex: 1, minWidth: 0, borderRadius: "8px", border: "1px solid #d1d5db", padding: "10px 12px", fontSize: "14px" }}
            disabled={!connected}
          />
          <button
            type="button"
            onClick={handleSendText}
            disabled={!connected || !textInputValue.trim()}
            style={{ borderRadius: "8px", background: "#2563EB", color: "#fff", padding: "10px 16px", fontSize: "14px", fontWeight: 500 }}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
