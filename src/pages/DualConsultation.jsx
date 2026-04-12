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
  const orgCode = routerSearchParams.get("org");
  const urlRoomName = routerSearchParams.get("roomName") || "";
  const modeParam = routerSearchParams.get("mode");
  const isConsultationSingle =
    modeParam === "single" || modeParam === "vad" || modeParam === "webspeech";
  const LANG_TO_LABEL = {en:"ENG",ko:"KOR",zh:"CHN",ja:"JPN",vi:"VNM",th:"THA",id:"IDN",ms:"MYS",tl:"PHL",my:"MMR",km:"KHM",ne:"NPL",mn:"MNG",uz:"UZB",ru:"RUS",es:"ESP",pt:"PRT",fr:"FRA",de:"DEU",ar:"ARA"};
  const [ptNumber, setPtNumber] = useState("");
  const [connected, setConnected] = useState(false);
  /** Socket participant id — synced to hooks via state so useVADPipeline always gets a defined participantId after Connect (ref alone does not update hook props). */
  const [sessionParticipantId, setSessionParticipantId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [staffLang, setStaffLang] = useState("ko");
  const [patientLang, setPatientLang] = useState("en");
  const [staffDeviceId, setStaffDeviceId] = useState("");
  const [patientDeviceId, setPatientDeviceId] = useState("");
  const [devices, setDevices] = useState([]);
  const [micRefreshSpin, setMicRefreshSpin] = useState(false);
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
  const inputMode = "ptt";
  const [pttKeys, setPttKeys] = useState({ staffKey: null, patientKey: null });
  const [vadActive, setVadActive] = useState(false);
  const vadActiveRef = useRef(false);
  const wasVadActiveRef = useRef(false);
  const isConsultationSingleRef = useRef(isConsultationSingle);
  const [showDisplayPanel, setShowDisplayPanel] = useState(false);

  useEffect(() => {
    if (!orgCode) return;
    const saved = localStorage.getItem(`mono_ptt_devices_${orgCode}`);
    if (saved) {
      try {
        setPttKeys(JSON.parse(saved));
      } catch {
        // ignore invalid localStorage JSON
      }
    }
  }, [orgCode]);
  const [copiedMonitor, setCopiedMonitor] = useState(false);
  const [copiedTablet, setCopiedTablet] = useState(false);
  const staffRecordingRef = useRef(false);
  const patientRecordingRef = useRef(false);

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

  useEffect(() => {
    isConsultationSingleRef.current = isConsultationSingle;
  }, [isConsultationSingle]);

  useEffect(() => {
    staffLangRef.current = staffLang;
  }, [staffLang]);
  useEffect(() => {
    patientLangRef.current = patientLang;
  }, [patientLang]);

  useEffect(() => {
    patientRecordingRef.current = patientRecording;
  }, [patientRecording]);

  /** Re-bind participantId ↔ socket on every VAD start/restart (mic device change, pause/resume, tab visibility). Dual mode registers staff + patient PIDs. */
  const emitJoinForVadListen = useCallback(() => {
    const rid = roomIdRef.current;
    const pid = participantIdRef.current;
    if (!rid || !pid || !connectedRef.current) return;
    const siteContext = "hospital_plastic_surgery";
    const orgCode = getRegistrationOrgCode();
    socket.emit("join", {
      roomId: rid,
      participantId: pid,
      fromLang: staffLangRef.current,
      roleHint: "host",
      localName: "Staff",
      siteContext,
      orgCode,
    });
    if (!isConsultationSingleRef.current) {
      socket.emit("join", {
        roomId: rid,
        participantId: `${pid}-pt`,
        fromLang: patientLangRef.current,
        roleHint: "guest",
        localName: "Patient",
        siteContext,
        orgCode,
      });
    }
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

  const {
    userSpeaking: vadSpeakingStaff,
    listening: vadListeningStaff,
    loading: vadLoadingStaff,
    start: vadStartStaff,
    pause: vadPauseStaff,
  } = useVADPipeline({
    roomId: roomId || undefined,
    participantId: sessionParticipantId || undefined,
    lang: isConsultationSingle ? "auto" : staffLang,
    vadStaffLang: staffLang,
    vadPatientLang: patientLang,
    deviceId: staffDeviceId || undefined,
    roleHint: "host",
    disableServerStt: false,
    onVadListenStart: emitJoinForVadListen,
  });

  const {
    userSpeaking: vadSpeakingPatient,
    listening: vadListeningPatient,
    loading: vadLoadingPatient,
    start: vadStartPatient,
    pause: vadPausePatient,
  } = useVADPipeline({
    roomId: roomId || undefined,
    participantId:
      sessionParticipantId && !isConsultationSingle ? `${sessionParticipantId}-pt` : undefined,
    lang: isConsultationSingle ? "auto" : patientLang,
    vadStaffLang: staffLang,
    vadPatientLang: patientLang,
    deviceId: patientDeviceId || undefined,
    roleHint: "guest",
    disableServerStt: isConsultationSingle,
    onVadListenStart: emitJoinForVadListen,
  });

  const vadListening = isConsultationSingle
    ? vadListeningStaff
    : vadListeningStaff && vadListeningPatient;
  const vadSpeaking = vadSpeakingStaff || (!isConsultationSingle && vadSpeakingPatient);
  const vadInitializing =
    vadActive &&
    (vadLoadingStaff ||
      !vadListeningStaff ||
      (!isConsultationSingle && (vadLoadingPatient || !vadListeningPatient)));

  const { notifyNewMessage } = useTabNotification();

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
    setSessionParticipantId(pid);
    connectedRef.current = true;
    setRoomId(pt);
    const siteContext = "hospital_plastic_surgery";
    const orgCode = getRegistrationOrgCode();
    socket.emit("join", {
      roomId: pt,
      participantId: pid,
      fromLang: staffLang,
      roleHint: "host",
      localName: "Staff",
      siteContext,
      orgCode,
    });
    if (!isConsultationSingle) {
      socket.emit("join", {
        roomId: pt,
        participantId: `${pid}-pt`,
        fromLang: patientLang,
        roleHint: "guest",
        localName: "Patient",
        siteContext,
        orgCode,
      });
    }
    setConnected(true);
  }, [ptNumber, staffLang, patientLang, isConsultationSingle]);

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
      const base = participantIdRef.current;
      const pendingStaff = pendingSenderRef.current === "staff";
      if (pendingSenderRef.current) pendingSenderRef.current = null;
      let msgIsStaff;
      if (!isConsultationSingle && base) {
        if (senderPidResolved === `${base}-pt`) msgIsStaff = false;
        else if (senderPidResolved === base) msgIsStaff = true;
        else msgIsStaff = pendingStaff;
      } else {
        msgIsStaff = senderPidResolved === base ? pendingStaff : false;
      }
      if (base) {
        if (isConsultationSingle) {
          if (senderPidResolved !== base) notifyNewMessage();
        } else if (senderPidResolved !== base && senderPidResolved !== `${base}-pt`) {
          notifyNewMessage();
        }
      } else if (senderPidResolved) {
        notifyNewMessage();
      }
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
              isStaff: msgIsStaff,
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
            isStaff: msgIsStaff,
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
      const base = participantIdRef.current;
      const pendingStaff = pendingSenderRef.current === "staff";
      let streamIsStaff;
      if (!isConsultationSingle && base) {
        if (senderPid === `${base}-pt`) streamIsStaff = false;
        else if (senderPid === base) streamIsStaff = true;
        else streamIsStaff = pendingStaff;
      } else {
        streamIsStaff = senderPid === base ? pendingStaff : false;
      }
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
            isStaff: streamIsStaff,
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
        isStaff: serverIsStaff,
      } = payload || {};
      if (incomingRoomId && incomingRoomId !== rid) return;
      if (!text || !final) return;
      const base = participantIdRef.current;
      let isStaff;
      if (inputModeRef.current === "vad") {
        if (base && incomingPid === `${base}-pt`) {
          isStaff = false;
        } else if (base && incomingPid === base) {
          isStaff = true;
        } else if (serverIsStaff != null) {
          isStaff = Boolean(serverIsStaff);
        } else {
          isStaff = false;
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
  }, [roomId, scrollToBottom, isConsultationSingle]);

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
    patientRecordingRef.current = false;
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
      const cleanStaffName =
        typeof staffName === "string" && staffName.trim()
          ? staffName.trim().slice(0, 100)
          : null;
      const payload = {
        roomId: rid,
        participantId: pid,
        lang,
        toLang,
        audio: base64Audio,
        mimeType,
        senderRole: isStaff ? "host" : "guest",
        orgCode: getRegistrationOrgCode(),
        staffName: cleanStaffName,
      };
      if (inputModeRef.current === "vad") {
        payload.vadStaffLang = staffLangRef.current;
        payload.vadPatientLang = patientLangRef.current;
      }
      socket.emit("stt:whisper", payload, (ack) => {
        if (!ack?.ok && ack?.error) console.warn("[DualConsultation] stt ack:", ack.error);
      });
    },
    [connected, roomId, patientLang, staffLang, staffName]
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
    if (patientRecordingRef.current) {
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
        patientRecordingRef.current = false;
        setPatientRecording(false);
      };
      recorder.start(300);
      patientRecorderRef.current = recorder;
      setPatientRecording(true);
      patientRecordingRef.current = true;
    } catch (e) {
      console.warn("[DualConsultation] patient mic error:", e?.message);
      patientStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      patientStreamRef.current = null;
      patientRecorderRef.current = null;
      patientRecordingRef.current = false;
      setPatientRecording(false);
    }
  }, [staffRecording, patientDeviceId, patientLang, sendWhisper, stopPatientRecording, stopStaffRecording]);

  // Bluetooth remote / keyboard: staff/patient PTT keys from dashboard localStorage; PTT tab only.
  useEffect(() => {
    if (inputMode !== "ptt") return;
    const staffKeyCode = pttKeys.staffKey?.code;
    const patientKeyCode = pttKeys.patientKey?.code || "AudioVolumeUp";
    const onKeyDown = (e) => {
      if (e.code === staffKeyCode || e.key === staffKeyCode) {
        e.preventDefault();
        e.stopPropagation();
        startStaffRecording();
        return;
      }
      if (e.code === patientKeyCode || e.key === patientKeyCode) {
        e.preventDefault();
        e.stopPropagation();
        startPatientRecording();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputMode, pttKeys, startStaffRecording, startPatientRecording]);

  const handleVADToggle = useCallback(() => {
    if (vadActive) {
      vadPauseStaff();
      if (!isConsultationSingle) vadPausePatient();
      vadActiveRef.current = false;
      setVadActive(false);
    } else {
      vadStartStaff();
      if (!isConsultationSingle) vadStartPatient();
      vadActiveRef.current = true;
      setVadActive(true);
    }
  }, [vadActive, vadStartStaff, vadPauseStaff, vadStartPatient, vadPausePatient, isConsultationSingle]);

  useEffect(() => {
    if (inputMode !== "vad") {
      vadPauseStaff();
      if (!isConsultationSingleRef.current) vadPausePatient();
      vadActiveRef.current = false;
      setVadActive(false);
    }
  }, [inputMode, vadPauseStaff, vadPausePatient]);

  useEffect(() => {
    if (inputMode !== "vad") {
      wasVadActiveRef.current = false;
      return;
    }
    const onVisibility = () => {
      if (document.hidden) {
        if (vadActiveRef.current) {
          vadPauseStaff();
          if (!isConsultationSingleRef.current) vadPausePatient();
          wasVadActiveRef.current = true;
        }
      } else if (wasVadActiveRef.current) {
        vadStartStaff();
        if (!isConsultationSingleRef.current) vadStartPatient();
        wasVadActiveRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [inputMode, vadStartStaff, vadPauseStaff, vadStartPatient, vadPausePatient]);

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
                              <QRCode value={tabletUrl} size={260} bgColor="#FFFFFF" fgColor="#0B1E3F" level="M" style={{ display: "block", margin: "12px auto" }} />
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
                  display: "grid",
                  gridTemplateColumns: isConsultationSingle ? "1fr" : "1fr 1fr",
                  gap: "12px",
                  fontSize: "12px",
                }}
              >
                <div>
                  <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Staff Mic</label>
                  <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
                    <select
                      value={staffDeviceId}
                      onChange={(e) => {
                        console.log('[Dual][diag] mic selected:', e.target.value);
                        setStaffDeviceId(e.target.value);
                      }}
                      style={{ flex: 1, borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      title="마이크 목록 새로고침"
                      onClick={async () => {
                        try {
                          // Request permission first so labels become visible
                          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
                          s.getTracks().forEach((t) => t.stop());
                        } catch (err) {
                          console.warn('[Dual] mic permission request failed:', err?.name);
                        }
                        refreshAudioDevices();
                        setMicRefreshSpin(true);
                        setTimeout(() => setMicRefreshSpin(false), 800);
                      }}
                      style={{
                        width: "32px",
                        minWidth: "32px",
                        borderRadius: "4px",
                        border: "1px solid #d1d5db",
                        background: "#f9fafb",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "14px",
                        color: "#4b5563",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          transition: "transform 0.8s ease",
                          transform: micRefreshSpin ? "rotate(360deg)" : "rotate(0deg)",
                        }}
                      >
                        ↻
                      </span>
                    </button>
                  </div>
                </div>
                {!isConsultationSingle && (
                  <div>
                    <label style={{ marginBottom: "4px", display: "block", fontWeight: 500, color: "#4b5563" }}>Patient Mic</label>
                    <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
                      <select
                        value={patientDeviceId}
                        onChange={(e) => setPatientDeviceId(e.target.value)}
                        style={{ flex: 1, borderRadius: "4px", border: "1px solid #d1d5db", background: "#fff", padding: "6px 8px" }}
                      >
                        {devices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title="마이크 목록 새로고침"
                        onClick={async () => {
                          try {
                            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
                            s.getTracks().forEach((t) => t.stop());
                          } catch (err) {
                            console.warn('[Dual] mic permission request failed:', err?.name);
                          }
                          refreshAudioDevices();
                          setMicRefreshSpin(true);
                          setTimeout(() => setMicRefreshSpin(false), 800);
                        }}
                        style={{
                          width: "32px",
                          minWidth: "32px",
                          borderRadius: "4px",
                          border: "1px solid #d1d5db",
                          background: "#f9fafb",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "14px",
                          color: "#4b5563",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            transition: "transform 0.8s ease",
                            transform: micRefreshSpin ? "rotate(360deg)" : "rotate(0deg)",
                          }}
                        >
                          ↻
                        </span>
                      </button>
                    </div>
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
      </main>

      {/* Mic buttons - full width */}
      <footer style={{ display: "flex", flexShrink: 0, gap: "8px", borderTop: "1px solid #e5e7eb", background: "#fff", padding: "12px" }}>
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
