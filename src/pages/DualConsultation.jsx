/**
 * DualConsultation ? Standalone in-clinic bilingual interpretation page.
 * Full-screen messenger: PT number + Connect, two mic selectors, two lang selectors,
 * scrollable message area (staff right, patient left), two bottom mic buttons.
 * Uses existing socket events: join, stt:whisper, receive-message, receive-message-stream, receive-message-stream-end.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import socket from "../socket";
import LanguageFlagPicker from "../components/LanguageFlagPicker";
import { getFlagUrlByLang } from "../constants/languageProfiles";
import { getLanguageByCode, LANGUAGES } from "../constants/languages";
import { useVADPipeline } from "../hooks/useVADPipeline";
import { useWebSpeechSTT } from "../hooks/useWebSpeechSTT";
import useTabNotification from "../hooks/useTabNotification";
import QRCode from "react-qr-code";

function twemojiFlagSvgUrl(flag) {
  const codePoints = Array.from(String(flag || ""))
    .map((ch) => ch.codePointAt(0)?.toString(16))
    .filter(Boolean);
  if (!codePoints.length) return "";
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join("-")}.svg`;
}

/** Same order as LanguageFlagPicker: Twemoji from language emoji, else flagcdn. */
function patientTopBarFlagFallbackUrl(langCode) {
  const key = String(langCode || "").toLowerCase().split("-")[0];
  const lang = getLanguageByCode(key);
  return (lang?.flag && twemojiFlagSvgUrl(lang.flag)) || getFlagUrlByLang(key);
}

/** Full MONO language list for registration/edit dropdowns; sorted A?Z by English name. */
const REGISTRATION_LANG_OPTIONS = [...LANGUAGES]
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
  .map((l) => {
    const name = l.name || l.code;
    const native = String(l.nativeName || "").trim();
    const label = native && native !== String(name).trim() ? `${name} (${l.nativeName})` : name;
    return { value: l.code, label };
  });

function getRegistrationOrgCode() {
  if (typeof window === "undefined") return "ORG-0001";
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("orgCode") || p.get("org") || "ORG-0001";
  } catch {
    return "ORG-0001";
  }
}

const MONO_CONSULTATION_PATIENT_LANG_KEY = "mono_consultation_patient_lang";

function readStoredPatientLang() {
  if (typeof window === "undefined") return "en";
  try {
    const raw = localStorage.getItem(MONO_CONSULTATION_PATIENT_LANG_KEY);
    if (!raw || !String(raw).trim()) return "en";
    const code = String(raw).trim().toLowerCase().split("-")[0];
    return getLanguageByCode(code) ? code : "en";
  } catch {
    return "en";
  }
}

async function toBase64FromBlob(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export default function DualConsultation() {
  const [routerSearchParams] = useSearchParams();
  const urlRoomName = routerSearchParams.get("roomName") || "";
  const modeParam = routerSearchParams.get("mode");
  const isConsultationSingle = modeParam === "vad" || modeParam === "webspeech";
  const initialInputMode =
    modeParam === "vad" ? "vad" : modeParam === "webspeech" ? "webspeech" : "ptt";
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
  const [staffName] = useState(() => {
    const fromUrl = (new URLSearchParams(window.location.search).get("roomName") || "").trim();
    if (fromUrl) return fromUrl;
    try {
      return localStorage.getItem("mono_staff_name") || "";
    } catch {
      return "";
    }
  });
  const [patientDisplayName, setPatientDisplayName] = useState("");
  const [regPatientName, setRegPatientName] = useState("");
  const [regPatientLang, setRegPatientLang] = useState("en");
  const [patientEditOpen, setPatientEditOpen] = useState(false);
  const [editPatientName, setEditPatientName] = useState("");
  const [editPatientLang, setEditPatientLang] = useState("en");
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [showStaffGrid, setShowStaffGrid] = useState(false);
  const [showPatientGrid, setShowPatientGrid] = useState(false);
  const [inputMode, setInputMode] = useState(initialInputMode); // "ptt" | "vad" | "webspeech"
  const [vadActive, setVadActive] = useState(false);
  const vadActiveRef = useRef(false);
  const wasVadActiveRef = useRef(false);
  const [sttProvider, setSttProvider] = useState("webspeech");
  const [webSpeechSpeaker, setWebSpeechSpeaker] = useState("staff"); // "staff" | "patient"
  const [webSpeechActive, setWebSpeechActive] = useState(false);
  const [showDisplayPanel, setShowDisplayPanel] = useState(false);
  const [copiedMonitor, setCopiedMonitor] = useState(false);
  const [copiedTablet, setCopiedTablet] = useState(false);
  const staffRecordingRef = useRef(false);

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
  const patientLangHeaderDropdownRef = useRef(null);

  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);

  // ?????(consultation_single) URL? Web Speech ??? ?? ?? ? ??? ?? ??
  useEffect(() => {
    if (!isConsultationSingle) return;
    setWebSpeechActive(false);
  }, [isConsultationSingle]);
  useEffect(() => {
    staffLangRef.current = staffLang;
  }, [staffLang]);
  useEffect(() => {
    patientLangRef.current = patientLang;
  }, [patientLang]);

  /** Re-bind participantId ↔ socket on every VAD start/restart (mic device change, pause/resume, tab visibility). */
  const emitJoinForVadListen = useCallback(() => {
    const rid = roomIdRef.current;
    const pid = participantIdRef.current;
    if (!rid || !pid || !connectedRef.current) return;
    socket.emit("join", {
      roomId: rid,
      participantId: pid,
      fromLang: staffLangRef.current,
      roleHint: "host",
      localName: "Staff",
      siteContext: "hospital_plastic_surgery",
      orgCode: getRegistrationOrgCode(),
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MONO_CONSULTATION_PATIENT_LANG_KEY, patientLang);
    } catch {
      /* ignore */
    }
  }, [patientLang]);

  useEffect(() => {
    if (isConsultationSingle) {
      setPatientDeviceId(staffDeviceId);
    }
  }, [isConsultationSingle, staffDeviceId]);

  // Silero VAD + stt:open / stt:audio / stt:segment_end (useVADPipeline uses startOnLoad: false ? waits for vadStart).
  // vadStaffLang/vadPatientLang are sent on each stt:open; if user changes langs mid-session, stop and restart VAD.
  console.log('[Dual][diag] staffDeviceId passed to VAD:', staffDeviceId);
  const {
    userSpeaking: vadSpeaking,
    listening: vadListening,
    start: vadStart,
    pause: vadPause,
    speechEndTimestamp,
  } = useVADPipeline({
    roomId: roomId || undefined,
    participantId: participantIdRef.current || undefined,
    lang: isConsultationSingle ? "auto" : "ko",
    vadStaffLang: staffLang,
    vadPatientLang: patientLang,
    deviceId: staffDeviceId || undefined,
    roleHint: "staff",
    disableServerStt: inputMode === "webspeech",
    onVadListenStart: emitJoinForVadListen,
  });

  const {
    start: startPatientVad,
    pause: stopPatientVad,
  } = useVADPipeline({
    roomId: roomId || undefined,
    participantId: participantIdRef.current || undefined,
    lang: patientLang || "en",
    vadStaffLang: staffLang,
    vadPatientLang: patientLang,
    deviceId: patientDeviceId || undefined,
    roleHint: "patient",
    disableServerStt: inputMode === "webspeech",
    onVadListenStart: emitJoinForVadListen,
  });

  const langToBcp47 = (lang) => {
    const key = String(lang || "").toLowerCase().split("-")[0];
    const map = {
      ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN",
      vi: "vi-VN", th: "th-TH", ru: "ru-RU", de: "de-DE",
      fr: "fr-FR", es: "es-ES", pt: "pt-BR", hi: "hi-IN",
      ar: "ar-SA", id: "id-ID", ms: "ms-MY", tl: "tl-PH",
      mn: "mn-MN", my: "my-MM", ne: "ne-NP", uz: "uz-UZ",
    };
    return map[key] || (key.length ? `${key}-KR` : "ko-KR");
  };
  const webSpeechLang = isConsultationSingle
    ? "ko-KR"
    : webSpeechSpeaker === "staff"
      ? langToBcp47(staffLang)
      : langToBcp47(patientLang);

  const onWebSpeechFinal = useCallback(
    (text, confidence) => {
      if (!roomIdRef.current || !participantIdRef.current || !String(text || "").trim()) return;

      const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g;
      const koreanChars = (text.match(koreanRegex) || []).length;
      const totalChars = text.replace(/[\s\d.,!?'"()-]/g, "").length || 1;
      const koreanRatio = koreanChars / totalChars;

      // Auto-detect: if Korean ratio > 0.3 → staff, else → patient
      const autoSpeaker = koreanRatio > 0.3 ? "staff" : "patient";
      const fromLang = autoSpeaker === "staff" ? staffLang : patientLang;
      const role = autoSpeaker;
      const isStaffSide = autoSpeaker === "staff";

      console.log(
        `[WebSpeech] Final (${role}, from=${fromLang}, conf=${confidence?.toFixed(2)}): "${text}"`
      );
      const msgId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      pendingSenderRef.current = isStaffSide ? "staff" : "patient";
      seenIdsRef.current.add(msgId);
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          originalText: text.trim(),
          translatedText: "",
          isStaff: isStaffSide,
          senderPid: participantIdRef.current,
          timestamp: Date.now(),
          streaming: false,
        },
      ]);
      socket.emit("send-message", {
        roomId: roomIdRef.current,
        participantId: participantIdRef.current,
        message: { id: msgId, text: text.trim() },
        toLang: isStaffSide ? (patientLangRef.current || "en") : (staffLangRef.current || "ko"),
        senderRole: isStaffSide ? "host" : "guest",
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
    [staffLang, patientLang]
  );

  const {
    isListening: webSpeechListening,
    interimText: webSpeechInterim,
    error: webSpeechError,
  } = useWebSpeechSTT({
    lang: webSpeechLang,
    active: inputMode === "webspeech" && webSpeechActive,
    confidenceThreshold: 0.5,
    minTextLength: 2,
    onFinal: onWebSpeechFinal,
    onInterim: () => {},
  });

  const { notifyNewMessage } = useTabNotification();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = ptNumber.trim();
        const url = q
          ? `/api/hospital/stt-provider?orgCode=${encodeURIComponent(q)}`
          : "/api/hospital/stt-provider";
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        let prov = data?.sttProvider || "webspeech";
        if (typeof window !== "undefined" && !window.SpeechRecognition && !window.webkitSpeechRecognition) {
          prov = "groq";
        }
        setSttProvider(prov);
      } catch {
        if (!cancelled) {
          setSttProvider(
            typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)
              ? "webspeech"
              : "groq"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ptNumber]);

  useEffect(() => {
    setPatientEditOpen(false);
    setRegPatientName("");
    setRegPatientLang("en");
    setRegisterError("");
  }, [ptNumber]);

  useEffect(() => {
    const q = ptNumber.trim();
    if (!q) {
      setPatientDisplayName("");
      return;
    }
    let cancelled = false;
    fetch(`/api/hospital/patient-by-room/${encodeURIComponent(q)}/history`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const n = data?.patient_name;
        setPatientDisplayName(typeof n === "string" && n.trim() ? n.trim() : "");
        const pl = data?.patient_lang;
        if (typeof pl === "string" && pl.trim()) {
          const code = pl.trim().toLowerCase().split("-")[0];
          if (LANG_TO_LABEL[code] !== undefined) setPatientLang(code);
        }
      })
      .catch(() => {
        if (!cancelled) setPatientDisplayName("");
      });
    return () => {
      cancelled = true;
    };
  }, [ptNumber]);

  const submitPatientUpsert = useCallback(async ({ name, lang }) => {
    const token = ptNumber.trim();
    const trimmedName = String(name || "").trim();
    if (!token || !trimmedName) return false;
    setRegisterSubmitting(true);
    setRegisterError("");
    try {
      const res = await fetch("/api/hospital/patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientToken: token,
          name: trimmedName,
          lang,
          orgCode: getRegistrationOrgCode(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setRegisterError(data?.error || data?.message || "Registration failed");
        return false;
      }
      setPatientDisplayName(trimmedName);
      setPatientLang(lang);
      return true;
    } catch (e) {
      setRegisterError(e?.message || "Network error");
      return false;
    } finally {
      setRegisterSubmitting(false);
    }
  }, [ptNumber]);

  const handleRegisterPatient = useCallback(async () => {
    const ok = await submitPatientUpsert({ name: regPatientName, lang: regPatientLang });
    if (ok) {
      setRegPatientName("");
      setRegPatientLang("en");
    }
  }, [regPatientName, regPatientLang, submitPatientUpsert]);

  const handleSavePatientEdit = useCallback(async () => {
    const ok = await submitPatientUpsert({ name: editPatientName, lang: editPatientLang });
    if (ok) setPatientEditOpen(false);
  }, [editPatientName, editPatientLang, submitPatientUpsert]);

  // List audio devices (refresh on mount and when hardware is plugged/unplugged)
  const refreshAudioDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        const audio = list.filter((d) => d.kind === "audioinput");
        const hardwareAudio = audio.filter(
          (d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"
        );
        setDevices(hardwareAudio);
        setStaffDeviceId((prev) => {
          if (prev && hardwareAudio.some((d) => d.deviceId === prev)) return prev;
          return hardwareAudio[0]?.deviceId ?? "";
        });
        setPatientDeviceId((prev) => {
          if (prev && hardwareAudio.some((d) => d.deviceId === prev)) return prev;
          if (hardwareAudio.length > 1) return hardwareAudio[1].deviceId;
          return hardwareAudio[0]?.deviceId ?? "";
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAudioDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    md.addEventListener("devicechange", refreshAudioDevices);
    return () => {
      md.removeEventListener("devicechange", refreshAudioDevices);
    };
  }, [refreshAudioDevices]);

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
      orgCode: getRegistrationOrgCode(),
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

    const onReceiveMessage = (data) => {
      console.log("[Recv] receive-message:", JSON.stringify(data).slice(0, 300));
      const { id, roomId: incomingRoomId, originalText, translatedText, senderPid, participantId: payloadParticipantId } = data || {};
      const senderPidResolved = senderPid ?? payloadParticipantId;
      if (!id || (incomingRoomId && incomingRoomId !== rid)) return;
      const isStaff = pendingSenderRef.current === "staff";
      if (pendingSenderRef.current) pendingSenderRef.current = null;
      if (senderPidResolved !== participantIdRef.current) notifyNewMessage();
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx >= 0) {
          return prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  translatedText: translatedText || data.text || m.translatedText,
                  streaming: false,
                }
              : m
          );
        }
        const tText = translatedText || data.text || "";
        if (seenIdsRef.current.has(id)) {
          return [
            ...prev.filter((m) => m.id !== id),
            {
              id,
              originalText: originalText || "",
              translatedText: tText,
              isStaff: senderPidResolved === participantIdRef.current ? isStaff : false,
              senderPid: senderPidResolved,
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
            isStaff: senderPidResolved === participantIdRef.current ? isStaff : false,
            senderPid: senderPidResolved,
            timestamp: Date.now(),
            streaming: false,
          },
        ];
      });
      setTimeout(scrollToBottom, 50);
    };

    const onStream = (data) => {
      console.log("[Stream] receive-message-stream:", JSON.stringify(data).slice(0, 300));
      const { roomId: incomingRoomId, messageId, chunk, senderPid, originalText } = data || {};
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

    const onStreamEnd = (data) => {
      console.log("[StreamEnd] receive-message-stream-end:", JSON.stringify(data).slice(0, 300));
      const { roomId: incomingRoomId, messageId, fullText } = data || {};
      if (!messageId || (incomingRoomId && incomingRoomId !== rid)) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, translatedText: fullText ?? m.translatedText, streaming: false } : m))
      );
      setTimeout(scrollToBottom, 50);
    };

    const onReviseMessage = (payload) => {
      console.log("[Revise] revise-message:", JSON.stringify(payload).slice(0, 300));
      const { id: messageId, translatedText: revisedText, roomId: incomingRoomId } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!messageId || revisedText == null || String(revisedText).trim() === "") return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, translatedText: revisedText } : m))
      );
      setTimeout(scrollToBottom, 50);
    };

    const onSttResult = (payload) => {
      const {
        roomId: incomingRoomId,
        participantId: incomingPid,
        text,
        translatedText: payloadTranslated,
        final,
        fromLang,
        isStaff: serverIsStaff,
      } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!text || !final) return;
      let isStaff;
      if (inputModeRef.current === "vad") {
        isStaff = serverIsStaff != null ? Boolean(serverIsStaff) : false;
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

    const onDualConsultationEnded = () => {
      window.location.href = "/hospital-dashboard";
    };

    const onViewerJoined = () => {
      setShowDisplayPanel(false);
    };

    socket.on("receive-message", onReceiveMessage);
    socket.on("receive-message-stream", onStream);
    socket.on("receive-message-stream-end", onStreamEnd);
    socket.on("revise-message", onReviseMessage);
    socket.on("stt:result", onSttResult);
    socket.on("dual-consultation:ended", onDualConsultationEnded);
    socket.on("display:viewer-joined", onViewerJoined);
    return () => {
      socket.off("receive-message", onReceiveMessage);
      socket.off("receive-message-stream", onStream);
      socket.off("receive-message-stream-end", onStreamEnd);
      socket.off("revise-message", onReviseMessage);
      socket.off("stt:result", onSttResult);
      socket.off("dual-consultation:ended", onDualConsultationEnded);
      socket.off("display:viewer-joined", onViewerJoined);
    };
  }, [roomId, scrollToBottom]);

  const stopStaffRecording = useCallback(() => {
    staffRecordingRef.current = false;
    if (staffRecorderRef.current && staffRecorderRef.current.state !== "inactive") {
      staffRecorderRef.current.stop();
    } else {
      staffStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      staffStreamRef.current = null;
      staffRecorderRef.current = null;
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
      const lang = inputModeRef.current === "vad" ? "auto" : (asStaff ? staffLang : patientLang);
      const toLang =
        inputModeRef.current === "vad"
          ? null
          : asStaff
            ? (patientLangRef.current || "en")
            : (staffLang || "ko");
      const payload = {
        roomId: rid,
        participantId: pid,
        lang,
        toLang,
        audio: base64Audio,
        mimeType,
        senderRole: isStaff ? "host" : "guest",
        orgCode: getRegistrationOrgCode(),
      };
      if (inputModeRef.current === "vad") {
        payload.vadStaffLang = staffLangRef.current;
        payload.vadPatientLang = patientLangRef.current;
      }
      socket.emit("stt:whisper", payload, (ack) => {
        if (!ack?.ok && ack?.error) console.warn("[DualConsultation] stt ack:", ack.error);
      });
    },
    [connected, roomId, patientLang, staffLang]
  );

  const startStaffRecording = useCallback(async () => {
    console.log("[Dual] startStaffRecording called, staffRecording:", staffRecording, "connected:", connected);
    if (patientRecording) {
      stopPatientRecording();
      return;
    }
    if (staffRecordingRef.current) {
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
        staffRecordingRef.current = false;
        setStaffRecording(false);
      };
      recorder.start(100);
      staffRecorderRef.current = recorder;
      staffRecordingRef.current = true;
      setStaffRecording(true);
    } catch (e) {
      console.error("[DualConsultation] staff mic error:", e);
      staffRecordingRef.current = false;
      staffStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      staffStreamRef.current = null;
      staffRecorderRef.current = null;
      setStaffRecording(false);
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
      patientStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      patientStreamRef.current = null;
      patientRecorderRef.current = null;
      setPatientRecording(false);
    }
  }, [patientRecording, staffRecording, patientDeviceId, patientLang, sendWhisper, stopPatientRecording, stopStaffRecording]);

  // Bluetooth remote / keyboard: Volume Up toggles patient PTT (same as patient mic button); PTT tab only.
  useEffect(() => {
    if (inputMode !== "ptt") return;
    const onKeyDown = (e) => {
      if (e.key !== "AudioVolumeUp") return;
      e.preventDefault();
      startPatientRecording();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputMode, startPatientRecording]);

  const handleVADToggle = useCallback(() => {
    if (vadActive) {
      vadPause();
      if (!isConsultationSingle) {
        stopPatientVad();
      }
      vadActiveRef.current = false;
      setVadActive(false);
    } else {
      vadStart();
      if (!isConsultationSingle) {
        startPatientVad();
      }
      vadActiveRef.current = true;
      setVadActive(true);
    }
  }, [vadActive, vadStart, vadPause, isConsultationSingle, startPatientVad, stopPatientVad]);

  // Pause Silero VAD when switching back to PTT / Web Speech (hook always mounted).
  useEffect(() => {
    if (inputMode !== "vad") {
      vadPause();
      if (!isConsultationSingle) {
        stopPatientVad();
      }
      vadActiveRef.current = false;
      setVadActive(false);
    }
  }, [inputMode, vadPause, isConsultationSingle, stopPatientVad]);

  useEffect(() => {
    if (inputMode !== "vad") {
      wasVadActiveRef.current = false;
      return;
    }
    const onVisibility = () => {
      if (document.hidden) {
        if (vadListening) {
          vadPause();
          if (!isConsultationSingle) {
            stopPatientVad();
          }
          wasVadActiveRef.current = true;
        }
      } else if (wasVadActiveRef.current) {
        vadStart();
        if (!isConsultationSingle) {
          startPatientVad();
        }
        wasVadActiveRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [inputMode, vadListening, vadStart, vadPause, isConsultationSingle, startPatientVad, stopPatientVad]);

  const handleSendText = useCallback(() => {
    const trimmed = textInputValue.trim();
    if (!trimmed || !connected || !roomIdRef.current || !participantIdRef.current) return;
    const msgId = `msg-${Date.now()}`;
    pendingSenderRef.current = "staff";
    seenIdsRef.current.add(msgId);
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        originalText: trimmed,
        translatedText: "",
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
      toLang: patientLangRef.current || "en",
      senderRole: "host",
    });
    console.log("[TextInput] send-message emitted, msgId:", msgId, "text:", trimmed);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [textInputValue, connected]);

  const handleEndSession = useCallback(() => {
    if (!window.confirm("\uC0C1\uB2F4\uC744 \uC885\uB8CC\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?")) return;
    const rid = roomIdRef.current;
    if (rid && socket) {
      socket.emit("dual-consultation:end", { roomId: rid });
    }
    window.location.href = "/hospital-dashboard";
  }, []);

  const handleCopy = (url, setCopied) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setShowDisplayPanel(false);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", flexDirection: "column", background: "#f5f5f5" }}>
      <style>{`
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @keyframes dual-vad-spin {
    to { transform: rotate(360deg); }
  }
`}</style>
      {/* Top bar */}
      <header style={{ display: "flex", flexShrink: 0, flexDirection: "column", gap: "8px", borderBottom: "1px solid #e5e7eb", background: "#fff", padding: "12px", boxShadow: "0 1px 2px 0 rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", width: "100%" }}>
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
              key={patientLang}
              src={`/icons/flags/${String(patientLang || "en").toLowerCase().split("-")[0]}.svg`}
              width={24}
              height={16}
              style={{ borderRadius: 2, marginLeft: 12, objectFit: "cover" }}
              alt=""
              onError={(e) => {
                const el = e.currentTarget;
                if (el.dataset.flagFallback) return;
                el.dataset.flagFallback = "1";
                el.src = patientTopBarFlagFallbackUrl(patientLang);
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {LANG_TO_LABEL[patientLang] || "ENG"}
            </span>
            <span style={{ fontSize: 13, color: "#374151", marginLeft: 8, flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {patientDisplayName || "\u2014"}
            </span>
            {patientDisplayName ? (
              <button
                type="button"
                title="Edit patient"
                onClick={() => {
                  setPatientEditOpen(true);
                  setEditPatientName(patientDisplayName);
                  setEditPatientLang(patientLang);
                  setRegisterError("");
                }}
                style={{
                  flexShrink: 0,
                  marginRight: 6,
                  padding: "4px 6px",
                  border: "none",
                  borderRadius: 4,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                  color: "#6b7280",
                }}
              >
                {"\u270E"}
              </button>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
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
                {settingsExpanded ? "\u25BC" : "\u25B6"}
              </button>
            )}
            {connected && (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  title="\uB514\uC2A4\uD50C\uB808\uC774 \uB9C1\uD06C"
                  onClick={() => setShowDisplayPanel((p) => !p)}
                  style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", fontSize: "14px", color: "#4b5563", cursor: "pointer" }}
                >
                  {"\uD83D\uDCFA"}
                </button>
                {showDisplayPanel ? (
                  <>
                    <div
                      role="presentation"
                      aria-hidden
                      onClick={() => setShowDisplayPanel(false)}
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 999,
                        background: "transparent",
                      }}
                    />
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        marginTop: 8,
                        background: "#fff",
                        borderRadius: 12,
                        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                        padding: 20,
                        zIndex: 1000,
                        minWidth: 340,
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{"\uC678\uBD80 \uBAA8\uB2C8\uD130 (\uB9C8\uC774\uD06C \uC5C6\uC74C)"}</div>
                        <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{"\uB9C8\uC774\uD06C \uC5C6\uC774 \uBC88\uC5ED \uD654\uBA74\uB9CC \uD45C\uC2DC"}</div>
                        <div style={{ fontSize: 11, color: "#666", background: "#f5f5f5", padding: "6px 8px", borderRadius: 6, wordBreak: "break-all", marginBottom: 8 }}>
                          {`${window.location.origin}/consultation-display/${roomId}?lang=${encodeURIComponent(patientLang)}&mic=false`}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(
                              `${window.location.origin}/consultation-display/${roomId}?lang=${encodeURIComponent(patientLang)}&mic=false`,
                              setCopiedMonitor
                            )
                          }
                          style={{ padding: "6px 14px", background: "#4a9eff", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                        >
                          {copiedMonitor ? "\uBCF5\uC0AC\uB428!" : "\uB9C1\uD06C \uBCF5\uC0AC"}
                        </button>
                      </div>
                      {!isConsultationSingle && (
                      <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 16, paddingTop: 16 }}>
                        {(() => {
                          const tabletUrl = `${window.location.origin}/consultation-display/${roomId}?lang=${encodeURIComponent(patientLang)}&mic=true`;
                          return (
                            <>
                              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{"\uD0DC\uBE14\uB9BF \uC5F0\uACB0 (\uB9C8\uC774\uD06C \uC0AC\uC6A9)"}</div>
                              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{"\uD0DC\uBE14\uB9BF\uC73C\uB85C \uC544\uB798 QR\uC744 \uC2A4\uCE94\uD558\uC138\uC694"}</div>
                              <QRCode value={tabletUrl} size={200} bgColor="#FFFFFF" fgColor="#ec407a" level="M" style={{ display: "block", margin: "12px auto", borderRadius: 8 }} />
                              <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", wordBreak: "break-all" }}>{tabletUrl}</div>
                            </>
                          );
                        })()}
                      </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            )}
            {connected && (
              <button
                type="button"
                onClick={handleEndSession}
                style={{ padding: "6px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
              >
                {"\uC0C1\uB2F4 \uC885\uB8CC"}
              </button>
            )}
          </div>
        </div>
        {ptNumber.trim() && !patientDisplayName ? (
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              paddingTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#4b5563", minWidth: 96 }}>Patient Name:</span>
              <input
                type="text"
                placeholder="Patient name (English)"
                value={regPatientName}
                onChange={(e) => setRegPatientName(e.target.value)}
                style={{
                  flex: "1 1 200px",
                  minWidth: 160,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  padding: "8px 10px",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#4b5563", minWidth: 96 }}>Language:</span>
              <select
                value={regPatientLang}
                onChange={(e) => setRegPatientLang(e.target.value)}
                style={{
                  minWidth: 200,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  padding: "8px 10px",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {REGISTRATION_LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleRegisterPatient}
                disabled={registerSubmitting || !regPatientName.trim()}
                style={{
                  borderRadius: 8,
                  background: registerSubmitting || !regPatientName.trim() ? "#9ca3af" : "#059669",
                  color: "#fff",
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  border: "none",
                  cursor: registerSubmitting || !regPatientName.trim() ? "not-allowed" : "pointer",
                }}
              >
                {registerSubmitting ? "Registering\u2026" : "Register Patient"}
              </button>
            </div>
            {registerError ? <div style={{ fontSize: 12, color: "#b91c1c" }}>{registerError}</div> : null}
          </div>
        ) : null}
        {ptNumber.trim() && patientDisplayName && patientEditOpen ? (
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              paddingTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#4b5563", minWidth: 96 }}>Patient Name:</span>
              <input
                type="text"
                placeholder="Patient name (English)"
                value={editPatientName}
                onChange={(e) => setEditPatientName(e.target.value)}
                style={{
                  flex: "1 1 200px",
                  minWidth: 160,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  padding: "8px 10px",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#4b5563", minWidth: 96 }}>Language:</span>
              <select
                value={editPatientLang}
                onChange={(e) => setEditPatientLang(e.target.value)}
                style={{
                  minWidth: 200,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  padding: "8px 10px",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {REGISTRATION_LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleSavePatientEdit}
                disabled={registerSubmitting || !editPatientName.trim()}
                style={{
                  borderRadius: 8,
                  background: registerSubmitting || !editPatientName.trim() ? "#9ca3af" : "#2563EB",
                  color: "#fff",
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  border: "none",
                  cursor: registerSubmitting || !editPatientName.trim() ? "not-allowed" : "pointer",
                }}
              >
                {registerSubmitting ? "Saving\u2026" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPatientEditOpen(false);
                  setRegisterError("");
                }}
                disabled={registerSubmitting}
                style={{
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 500,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#374151",
                  cursor: registerSubmitting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
            </div>
            {registerError ? <div style={{ fontSize: 12, color: "#b91c1c" }}>{registerError}</div> : null}
          </div>
        ) : null}
        {connected && settingsExpanded && (
          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setInputMode("ptt");
                    setWebSpeechActive(false);
                  }}
                  style={{
                    flex: isConsultationSingle ? "1 1 120px" : "1 1 90px",
                    padding: "10px 6px",
                    borderRadius: 8,
                    border: inputMode === "ptt" ? "2px solid #4A90D9" : "1px solid #ddd",
                    background: inputMode === "ptt" ? "#EBF3FC" : "#fff",
                    fontWeight: inputMode === "ptt" ? 700 : 400,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {"\uD83C\uDFA4 PTT"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputMode("vad");
                    setWebSpeechActive(false);
                  }}
                  style={{
                    flex: isConsultationSingle ? "1 1 120px" : "1 1 90px",
                    padding: "10px 6px",
                    borderRadius: 8,
                    border: inputMode === "vad" ? "2px solid #4A90D9" : "1px solid #ddd",
                    background: inputMode === "vad" ? "#EBF3FC" : "#fff",
                    fontWeight: inputMode === "vad" ? 700 : 400,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  VAD
                </button>
              </div>
              {inputMode === "vad" && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={handleVADToggle}
                    disabled={!connected || (vadActive && !vadListening)}
                    style={{
                      width: "100%",
                      padding: "12px 0",
                      borderRadius: 8,
                      border: "none",
                      background:
                        !connected || (vadActive && !vadListening)
                          ? "#9ca3af"
                          : vadActive
                            ? "#EF4444"
                            : "#22C55E",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 16,
                      cursor: !connected || (vadActive && !vadListening) ? "not-allowed" : "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {vadActive
                      ? "\u23F9 \uC74C\uC131\uC778\uC2DD \uC911\uC9C0"
                      : "\u25B6 \uC74C\uC131\uC778\uC2DD \uC2DC\uC791"}
                  </button>
                  {vadActive && !vadListening ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "#92400e",
                        textAlign: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 14,
                          height: 14,
                          border: "2px solid #ca8a04",
                          borderTopColor: "transparent",
                          borderRadius: "50%",
                          animation: "dual-vad-spin 0.7s linear infinite",
                        }}
                      />
                      Initializing microphone\u2026
                    </div>
                  ) : null}
                </div>
              )}
              {inputMode === "webspeech" && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() => setWebSpeechActive((prev) => !prev)}
                    style={{
                      width: "100%",
                      padding: "12px 0",
                      borderRadius: 8,
                      border: "none",
                      background: webSpeechActive ? "#EF4444" : "#22C55E",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 16,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {webSpeechActive
                      ? "\u23F9 \uC74C\uC131\uC778\uC2DD \uC911\uC9C0"
                      : "\u25B6 \uC74C\uC131\uC778\uC2DD \uC2DC\uC791"}
                  </button>
                  {webSpeechActive && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setWebSpeechSpeaker("staff")}
                        style={{
                          flex: 1,
                          padding: "10px 0",
                          borderRadius: 8,
                          border: webSpeechSpeaker === "staff" ? "2px solid #3B82F6" : "1px solid #ddd",
                          background: webSpeechSpeaker === "staff" ? "#DBEAFE" : "#fff",
                          fontWeight: webSpeechSpeaker === "staff" ? 700 : 400,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        {"\uD83E\uDE7A \uC9C1\uC6D0 ("}
                        {staffLang}
                        {")"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWebSpeechSpeaker("patient")}
                        style={{
                          flex: 1,
                          padding: "10px 0",
                          borderRadius: 8,
                          border: webSpeechSpeaker === "patient" ? "2px solid #F59E0B" : "1px solid #ddd",
                          background: webSpeechSpeaker === "patient" ? "#FEF3C7" : "#fff",
                          fontWeight: webSpeechSpeaker === "patient" ? 700 : 400,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        {"\uD83E\uDDD1\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1 \uD658\uC790 ("}
                        {patientLang}
                        {")"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isConsultationSingle ? "1fr" : "1fr 1fr",
                  gap: "12px",
                  fontSize: "12px",
                }}
              >
                <div>
                  <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Staff Mic</label>
                  <select
                    value={staffDeviceId}
                    onChange={(e) => {
                      console.log('[Dual][diag] mic selected:', e.target.value);
                      setStaffDeviceId(e.target.value);
                    }}
                    style={{ width: "100%", borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                  >
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
                {!isConsultationSingle && (
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
                )}
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
        )}
      </header>

      {/* Single unified chat area */}
      <main style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "12px", display: "flex", flexDirection: "column" }}>
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
                maxWidth: "60%",
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
                {m.streaming
                  ? "..."
                  : (m.translatedText || "").trim()
                    ? m.translatedText
                    : (m.originalText || "").trim()
                      ? "\uBC88\uC5ED \uC911..."
                      : ""}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} style={{ height: 1, pointerEvents: "none" }} />
        {inputMode === "webspeech" && webSpeechActive && (
          <div
            style={{
              marginTop: "auto",
              padding: "8px 16px",
              background: webSpeechSpeaker === "staff" ? "#EFF6FF" : "#FFFBEB",
              borderTop: "1px solid #e5e7eb",
              minHeight: 40,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {webSpeechListening && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#EF4444",
                  animation: "pulse 1.5s infinite",
                }}
              />
            )}
            <span style={{ color: "#6B7280", fontSize: 14, fontStyle: "italic" }}>
              {webSpeechInterim ||
                (webSpeechListening
                  ? "\uC74C\uC131 \uB300\uAE30 \uC911..."
                  : "\uC2DC\uC791 \uBC84\uD2BC\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694")}
            </span>
            {webSpeechError && (
              <span style={{ color: "#EF4444", fontSize: 12, marginLeft: "auto" }}>
                {"\u26A0 "} {webSpeechError}
              </span>
            )}
          </div>
        )}
        {inputMode === "vad" && vadActive && vadListening && (
          <div
            style={{
              marginTop: "auto",
              padding: "8px 16px",
              background: vadSpeaking ? "#FEF2F2" : "#F0FDF4",
              borderTop: "1px solid #e5e7eb",
              minHeight: 40,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#22C55E",
                  animation: "pulse 1.5s infinite",
                }}
              />
              <span style={{ color: "#166534", fontSize: 14, fontWeight: 600 }}>
                {"\uD83C\uDF99\uFE0F \uC790\uB3D9 \uC778\uC2DD \uC911..."}
              </span>
            </div>
            {vadSpeaking ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#B91C1C", fontWeight: 600 }}>
                <span aria-hidden>{"\uD83D\uDD34 "}</span>
                <span>{"\uC74C\uC131 \uAC10\uC9C0 \uC911..."}</span>
              </div>
            ) : null}
          </div>
        )}
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
              {staffRecording ? "Stop" : urlRoomName.trim() || staffName.trim() || "Staff"}
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
              {patientRecording ? "Stop" : patientDisplayName.trim() || "Patient"}
            </button>
          </>
        ) : null}
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
