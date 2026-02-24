import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import MessageBubble from "./MessageBubble";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import socket from "../socket";
import MicButton from "./MicButton";
import { v4 as uuidv4 } from "uuid";
import InstallBanner from "./InstallBanner";
import SITE_CONTEXTS from "../constants/siteContexts";
import languages from "../constants/languages";
import useNetworkStatus from "../hooks/useNetworkStatus";
import useOutbox from "../hooks/useOutbox";
import { touchRoom, recordRoomActivity, saveMessage, getMessages } from "../db";
import {
  initBrowserTts,
  hasVoiceForMonoLang,
  speakText,
  cancelSpeech,
} from "../audio/browserTts";
import { subscribeToPush } from "../push/index";
import { getFlagUrlByLang, getLabelFromCode, getLanguageProfileByCode } from "../constants/languageProfiles";

// ─── Dedup utilities ───
function dedupeRepeatTokens(s) {
  if (!s) return s;
  let tokens;
  try {
    tokens = s.match(/[\p{L}\p{N}'']+|[.,!?;:。！？、，]+|\S/gu) || [s];
  } catch {
    tokens = s.match(/[A-Za-z0-9'']+|[가-힣]+|[.,!?;:。！？、，]+|\S/g) || [s];
  }
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const remain = tokens.length - i;
    const maxW = Math.min(12, Math.floor(remain / 2));
    let wFound = 0;
    for (let w = maxW; w >= 1; w--) {
      let same = true;
      for (let k = 0; k < w; k++) {
        if (tokens[i + k] !== tokens[i + w + k]) { same = false; break; }
      }
      if (same) { wFound = w; break; }
    }
    if (wFound > 0) {
      for (let k = 0; k < wFound; k++) out.push(tokens[i + k]);
      i += wFound;
      while (i + wFound <= tokens.length) {
        let same = true;
        for (let k = 0; k < wFound; k++) {
          if (tokens[i + k] !== out[out.length - wFound + k]) { same = false; break; }
        }
        if (!same) break;
        i += wFound;
      }
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  let s2 = "";
  for (let t = 0; t < out.length; t++) {
    const cur = out[t];
    const prev = out[t - 1] || "";
    const isPunct = /[.,!?;:。！？、，]/.test(cur);
    const needSpace = t > 0 && !isPunct && !/[([{"'@#$]/.test(cur) && !/[-/]/.test(prev) && !/[([{"'@#$]/.test(prev);
    s2 += (needSpace ? " " : "") + cur;
  }
  return s2.replace(/\s+([,;:])/g, "$1");
}

function dedupeRepeats(s) {
  if (!s) return s;
  const parts = s.split(/(?<=[.!?。！？])\s+/u);
  const out = [];
  let last = "";
  for (const p of parts) {
    const seg = p.trim();
    if (!seg) continue;
    const norm = seg.replace(/\s+/g, " ").toLowerCase();
    if (norm === last) continue;
    out.push(seg);
    last = norm;
  }
  const result = out.join(" ");
  return dedupeRepeatTokens(result);
}

export default function ChatScreen() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // PID
  const pidKey = `mro.pid.${roomId}`;
  const [participantId] = useState(() => {
    // 1:1 room path (RoomList/Setup): use stable userId for server identity + push routing
    const explicitUserId = location.state?.myUserId || "";
    if (explicitUserId) return explicitUserId;
    let id = localStorage.getItem(pidKey);
    if (!id) {
      id = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem(pidKey, id);
    }
    return id;
  });

  const [fromLang] = useState(
    location.state?.fromLang || localStorage.getItem("myLang") || "ko"
  );
  const [localName] = useState(location.state?.localName || "");
  const [selectedRole] = useState(location.state?.role || "Tech");
  const roleHint = location.state?.isCreator ? "owner" : "guest";

  // ── Identity: call sign (broadcast) or partner name (1:1) ──
  const [myCallSign, setMyCallSign] = useState("");
  const [partnerName, setPartnerName] = useState(location.state?.peerDisplayName || "");
  const [siteContext, setSiteContext] = useState(location.state?.siteContext || "general");
  const [roomType, setRoomType] = useState(location.state?.roomType || "oneToOne");
  const [partnerLang, setPartnerLang] = useState(location.state?.peerLang || "");
  const [peerInfo, setPeerInfo] = useState(null);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [micListening, setMicListening] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [typingPeerName, setTypingPeerName] = useState("");
  const [serverWarning, setServerWarning] = useState("");
  const [reconnectState, setReconnectState] = useState("connected");

  // ── Network & Offline queue ──
  const { isConnected, isOnline, isSocketConnected } = useNetworkStatus();
  const { sendOrQueue } = useOutbox();

  // My language label (user-centric, no pairs)
  const myLangLabel = useMemo(() => {
    const found = languages.find(l => l.code === fromLang);
    return found?.label || fromLang || "Auto";
  }, [fromLang]);
  const myFlagUrl = useMemo(() => getLanguageProfileByCode(fromLang)?.flagUrl || getFlagUrlByLang(fromLang), [fromLang]);
  const myShort = useMemo(() => getLanguageProfileByCode(fromLang)?.shortLabel || getLabelFromCode(fromLang), [fromLang]);
  const partnerFlagUrl = useMemo(() => getLanguageProfileByCode(partnerLang)?.flagUrl || getFlagUrlByLang(partnerLang), [partnerLang]);
  const partnerShort = useMemo(() => getLanguageProfileByCode(partnerLang)?.shortLabel || getLabelFromCode(partnerLang), [partnerLang]);
  const resolvedPartnerFlagUrl = peerInfo?.peerFlagUrl || partnerFlagUrl;
  const resolvedPartnerShort = peerInfo?.peerLabel || partnerShort;

  const localizeWarning = useCallback((msg) => {
    const code = String(fromLangRef.current || "en").toLowerCase();
    if (!msg) return "";
    if (msg.includes("quota") || msg.includes("429")) {
      const table = {
        ko: "잠시 후 다시 시도해주세요.",
        vi: "Vui long thu lai sau it phut.",
        zh: "qing shao hou zai shi yi ci.",
        ja: "shibaraku ato de mou ichido oshite kudasai.",
        th: "proat long mai ik khrang nai mai kii naa thii.",
        en: "Please try again in a moment.",
      };
      return table[code] || table.en;
    }
    if (!isOnline || !isSocketConnected) {
      const table = {
        ko: "인터넷 연결을 확인해주세요.",
        vi: "Vui long kiem tra ket noi internet.",
        zh: "qing jian cha wang luo lian jie.",
        ja: "intanetto setsuzoku o kakunin shite kudasai.",
        th: "proat truat sop kan chueam to internet.",
        en: "Please check your internet connection.",
      };
      return table[code] || table.en;
    }
    return msg;
  }, [isOnline, isSocketConnected]);

  // ── TTS auto-play toggle: OFF by default ──
  const voiceEnabledRef = useRef(localStorage.getItem("mono.voice") === "1");
  const [voiceEnabled, setVoiceEnabled] = useState(voiceEnabledRef.current);
  const [canSpeakCurrentLang, setCanSpeakCurrentLang] = useState(false);

  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const wakeLockRef = useRef(null);
  const joinedRef = useRef(false);
  const historyLoadedRef = useRef(false);

  // Stable refs
  const participantIdRef = useRef(participantId);
  const fromLangRef = useRef(fromLang);
  const roleHintRef = useRef(roleHint);
  const selectedRoleRef = useRef(selectedRole);
  const localNameRef = useRef(localName);
  const roomIdRef = useRef(roomId);
  const roomTypeRef = useRef(roomType);
  const partnerNameRef = useRef(partnerName);
  const myFlagRef = useRef(myFlagUrl);
  const partnerFlagRef = useRef(partnerFlagUrl);
  const myShortRef = useRef(myShort);
  const partnerShortRef = useRef(partnerShort);
  // myCallSign stored internally for server communication, not displayed
  const lastPingAtRef = useRef(0);
  const typingActiveRef = useRef(false);
  const typingStopTimerRef = useRef(null);
  const readSentRef = useRef(new Set());
  const messagesRef = useRef([]);

  useEffect(() => {
    roomTypeRef.current = roomType;
  }, [roomType]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    partnerNameRef.current = partnerName;
  }, [partnerName]);

  useEffect(() => {
    myFlagRef.current = myFlagUrl;
  }, [myFlagUrl]);

  useEffect(() => {
    partnerFlagRef.current = partnerFlagUrl;
  }, [partnerFlagUrl]);

  useEffect(() => {
    myShortRef.current = myShort;
  }, [myShort]);

  useEffect(() => {
    partnerShortRef.current = partnerShort;
  }, [partnerShort]);

  useEffect(() => {
    try {
      sessionStorage.setItem("mono_session", JSON.stringify({
        roomId: roomIdRef.current || "",
        userId: participantIdRef.current || "",
        language: fromLangRef.current || "",
        isHost: roleHintRef.current === "owner",
        isInChat: true,
      }));
    } catch {}
  }, [roomId, participantId, fromLang, roleHint]);

  useEffect(() => {
    let cancelled = false;
    if (!roomId) return;
    (async () => {
      const prevMessages = await getMessages(roomId, 100, 0).catch(() => []);
      if (cancelled) return;
      if (prevMessages.length > 0) {
        const hydrated = prevMessages.map((m) => ({
          ...m,
          mine: m.senderId === participantIdRef.current,
          text: m.translatedText || m.originalText || m.text || "",
          senderFlagUrl: m.senderFlagUrl || "",
          senderLabel: m.senderLabel || "",
        }));
        setMessages(hydrated);
        hydrated.forEach((m) => {
          if (m?.id) seenIdsRef.current.add(m.id);
        });
      }
      historyLoadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !historyLoadedRef.current || !messages.length) return;
    const tasks = messages
      .filter((m) => m?.id && !m?.system)
      .map((m) =>
        saveMessage({
          id: m.id,
          roomId,
          senderId: m.mine ? participantIdRef.current : (m.senderId || ""),
          senderName: m.mine ? (localNameRef.current || "나") : (m.senderDisplayName || ""),
          originalText: m.originalText || "",
          translatedText: m.translatedText || m.text || "",
          originalLang: m.mine ? fromLangRef.current : "",
          translatedLang: fromLangRef.current,
          type: "text",
          status: m.status || (m.mine ? "sent" : "translated"),
          timestamp: Number(m.timestamp || Date.now()),
          replyTo: m.replyTo || null,
        }).catch(() => {})
      );
    Promise.all(tasks).catch(() => {});
  }, [roomId, messages]);

  useEffect(() => {
    if (!peerInfo) return;
    if (peerInfo.peerFlagUrl) partnerFlagRef.current = peerInfo.peerFlagUrl;
    if (peerInfo.peerLabel) partnerShortRef.current = peerInfo.peerLabel;
  }, [peerInfo]);

  useEffect(() => {
    if (isConnected) setReconnectState("connected");
    else if (isOnline) setReconnectState("reconnecting");
    else setReconnectState("disconnected");
  }, [isConnected, isOnline]);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };
  const resetHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "40px";
  };

  // ─── Join once ───
  useEffect(() => {
    if (!roomId || joinedRef.current) return;
    // Defer join one tick so socket listeners are attached first.
    const timer = setTimeout(() => {
      joinedRef.current = true;
      console.log("[MONO] join →", roomId, participantId, selectedRole, roleHint);
      socket.emit("join", {
        roomId,
        fromLang,
        participantId,
        role: selectedRole,
        localName: localName || "",
        roleHint,
      });
      // Touch IndexedDB
      touchRoom(roomId).catch(() => {});
      // Subscribe to push notifications (bind to this participantId)
      subscribeToPush(participantId).catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [roomId]);

  // ─── Notification permission ───
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (typingActiveRef.current) {
        socket.emit("typing-stop", {
          roomId: roomIdRef.current,
          participantId: participantIdRef.current,
        });
      }
    };
  }, []);

  // ─── Socket event listeners (register once) ───
  useEffect(() => {
    const onCallSignAssigned = (payload) => {
      const { callSign, siteContext: ctx } = payload || {};
      if (callSign) {
        setMyCallSign(callSign);
        console.log(`[MONO] ✅ Call sign assigned: ${callSign}`);
      }
      if (ctx) setSiteContext(ctx);
    };

    const onRoomContext = (payload) => {
      const { siteContext: ctx, roomType: rt } = payload || {};
      if (ctx) setSiteContext(ctx);
      if (rt) {
        setRoomType(rt);
        roomTypeRef.current = rt;
      }
    };

    const onParticipants = (list) => {
      if (Array.isArray(list)) {
        setParticipants(list);
        // Fallback: derive peer language from participants list in 1:1 rooms.
        if (roomTypeRef.current === "oneToOne") {
          const peer = list.find((p) => p?.pid && p.pid !== participantIdRef.current);
          if (peer?.lang) setPartnerLang(peer.lang);
        }
      }
    };

    const onTypingStart = (payload) => {
      const pid = payload?.participantId;
      if (!pid || pid === participantIdRef.current) return;
      const name = payload?.displayName || partnerNameRef.current || "상대방";
      setTypingPeerName(name);
    };

    const onTypingStop = (payload) => {
      const pid = payload?.participantId;
      if (!pid || pid === participantIdRef.current) return;
      setTypingPeerName("");
    };

    const onMessageStatus = (payload) => {
      const messageId = payload?.messageId;
      const status = String(payload?.status || "");
      if (!messageId || !status) return;
      if (payload?.roomId && payload.roomId !== roomIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (!m?.id || m.id !== messageId) return m;
          if (!m.mine) return m;
          const normalized =
            status === "read"
              ? "read"
              : status === "delivered"
              ? "translated"
              : status === "accepted"
              ? "sent"
              : m.status;
          if (normalized === m.status && !m.queued) return m;
          return { ...m, status: normalized, queued: false };
        })
      );
    };

    const onReceiveMessage = async (payload) => {
      const { id, roomId: incomingRoomId, originalText, translatedText, senderPid, senderCallSign, senderDisplayName } = payload || {};
      if (!id) return;
      if (incomingRoomId && incomingRoomId !== roomIdRef.current) return;
      if (seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      const eventTs = Number(payload?.timestamp || payload?.at || Date.now());

      const isMine = senderPid && senderPid === participantIdRef.current;

      if (isMine) {
        if (originalText) {
          const minePreview = String(originalText || "").trim().slice(0, 120);
          recordRoomActivity(roomIdRef.current, {
            lastMessagePreview: minePreview,
            lastMessageAt: eventTs,
            lastMessageMine: true,
            unreadCount: 0,
          }).catch(() => {});
          setMessages((prev) => [...prev, {
            id,
            text: originalText,
            originalText,
            translatedText: "",
            mine: true,
            senderId: participantIdRef.current,
            status: "sent",
            timestamp: eventTs,
            senderFlagUrl: myFlagRef.current,
            senderLabel: myShortRef.current,
          }]);
        }
        return;
      }

      // Other's message → show translated text (my language)
      const incoming = dedupeRepeats(translatedText || originalText || "");
      if (!incoming) return;
      recordRoomActivity(roomIdRef.current, {
        lastMessagePreview: String(incoming).trim().slice(0, 120),
        lastMessageAt: eventTs,
        lastMessageMine: false,
        unreadCount: 0,
      }).catch(() => {});
      const resolvedSenderName =
        senderDisplayName ||
        (roomTypeRef.current === "oneToOne" ? (partnerNameRef.current || "") : (senderCallSign || ""));
      setMessages((prev) => [...prev, {
        id,
        text: incoming,
        originalText: originalText || "",
        translatedText: incoming,
        mine: false,
        senderId: senderPid || "",
        status: "translated",
        timestamp: eventTs,
        senderDisplayName: resolvedSenderName,
        senderCallSign: senderCallSign || "",
        senderFlagUrl: roomTypeRef.current === "oneToOne" ? partnerFlagRef.current : "",
        senderLabel: roomTypeRef.current === "oneToOne" ? partnerShortRef.current : "",
      }]);

      if (
        voiceEnabledRef.current &&
        document.visibilityState === "visible" &&
        canSpeakCurrentLang
      ) {
        await speakText(incoming, fromLangRef.current, {
          onEnd: () => {},
          onError: () => {},
        });
      }

      // Background notification
      if (document.visibilityState === "hidden" && "serviceWorker" in navigator) {
        const body = incoming.slice(0, 80);
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "SHOW_NOTIFICATION",
            payload: { title: "MONO", body },
          });
        }
      }
    };

    const onReviseMessage = async (payload) => {
      const { id, translatedText, senderPid } = payload || {};
      if (!id || !translatedText) return;
      if (senderPid && senderPid === participantIdRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: translatedText, translatedText } : m)));
    };

    const onRecentMessages = (msgs) => {
      if (!Array.isArray(msgs) || !msgs.length) return;
      setMessages((prev) => {
        const merged = [...prev];
        for (const m of msgs) {
          if (m?.roomId && m.roomId !== roomIdRef.current) continue;
          const mid = m.id || crypto.randomUUID();
          if (seenIdsRef.current.has(mid)) continue;
          seenIdsRef.current.add(mid);
          const isMine = m.senderPid === participantIdRef.current;
          const eventTs = Number(m.timestamp || m.at || Date.now());
          merged.push({
            id: mid,
            text: m.translatedText || m.text || m.originalText || "",
            originalText: m.originalText || m.text || "",
            translatedText: m.translatedText || m.text || "",
            mine: isMine,
            senderId: m.senderPid || (isMine ? participantIdRef.current : ""),
            status: isMine ? "sent" : "translated",
            timestamp: eventTs,
            senderFlagUrl: isMine
              ? myFlagRef.current
              : (roomTypeRef.current === "oneToOne" ? partnerFlagRef.current : ""),
            senderLabel: isMine
              ? myShortRef.current
              : (roomTypeRef.current === "oneToOne" ? partnerShortRef.current : ""),
            senderDisplayName: isMine
              ? ""
              : (
                m.senderDisplayName ||
                (roomTypeRef.current === "oneToOne" ? (partnerNameRef.current || "") : (m.senderCallSign || ""))
              ),
            senderCallSign: isMine ? "" : (m.senderCallSign || ""),
          });
        }
        return merged;
      });
    };

    const onJoined = (payload) => {
      const joinedLang = payload?.lang || payload?.peerLang || "";
      if (roomTypeRef.current === "oneToOne" && joinedLang) {
        setPartnerLang(joinedLang);
        setPeerInfo((prev) => ({
          ...(prev || {}),
          peerLang: joinedLang,
          peerFlagUrl: payload?.peerFlagUrl || getFlagUrlByLang(joinedLang),
          peerLabel: payload?.peerLabel || getLabelFromCode(joinedLang),
        }));
      }
      setMessages((prev) => [...prev, {
        id: uuidv4(),
        text: "참가자 입장",
        system: true,
      }]);
      console.log(`[HOST] Socket state: ${socket.connected}, Room: ${roomIdRef.current}, Peer: connected`);
    };

    const onNotify = (p) => {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(p?.title || "MONO", { body: p?.body || "" });
        }
      } catch {}
      if (navigator?.vibrate) navigator.vibrate([120, 60, 120]);
    };

    const onServerWarning = (payload) => {
      const msg = payload?.message || "";
      if (!msg) return;
      setServerWarning(localizeWarning(msg));
      setTimeout(() => setServerWarning(""), 10000);
    };

    const onRoomFull = () => {
      alert("이 방은 이미 정원이 찼습니다.");
      navigate("/");
    };

    const onPartnerInfo = (payload) => {
      const { partnerName: pn, peerLocalizedName, peerUserId, peerLang } = payload || {};
      const resolvedName = peerLocalizedName || pn;
      const nextPartnerFlag = getLanguageProfileByCode(peerLang)?.flagUrl || getFlagUrlByLang(peerLang) || partnerFlagRef.current;
      if (peerLang) setPartnerLang(peerLang);
      setPeerInfo((prev) => ({
        ...(prev || {}),
        peerLang: peerLang || prev?.peerLang || "",
        peerFlagUrl: nextPartnerFlag || prev?.peerFlagUrl || "",
        peerLabel: getLanguageProfileByCode(peerLang)?.shortLabel || getLabelFromCode(peerLang) || prev?.peerLabel || "",
      }));
      if (resolvedName) {
        setPartnerName(resolvedName);
        partnerNameRef.current = resolvedName;
        setMessages((prev) => prev.map((m) => {
          if (m.mine) return m;
          if (m.senderDisplayName) {
            return { ...m, senderFlagUrl: m.senderFlagUrl || nextPartnerFlag, senderLabel: m.senderLabel || partnerShortRef.current };
          }
          return {
            ...m,
            senderDisplayName: resolvedName,
            senderFlagUrl: m.senderFlagUrl || nextPartnerFlag,
            senderLabel: m.senderLabel || partnerShortRef.current,
          };
        }));
        console.log(`[MONO] Partner: "${resolvedName}" (uid: ${peerUserId || "?"})`);
      }
    };

    const onPartnerJoined = (payload) => {
      if (!payload || roomTypeRef.current !== "oneToOne") return;
      setPeerInfo((prev) => ({
        ...(prev || {}),
        peerLang: payload.peerLang || prev?.peerLang || "",
        peerFlagUrl: payload.peerFlagUrl || prev?.peerFlagUrl || "",
        peerLabel: payload.peerLabel || prev?.peerLabel || "",
      }));
      if (payload.peerLang) setPartnerLang(payload.peerLang);
    };

    socket.on("call-sign-assigned", onCallSignAssigned);
    socket.on("room-context", onRoomContext);
    socket.on("participants", onParticipants);
    socket.on("receive-message", onReceiveMessage);
    socket.on("recent-messages", onRecentMessages);
    socket.on("revise-message", onReviseMessage);
    socket.on("guest:joined", onJoined);
    socket.on("user-joined", onJoined);
    socket.on("notify", onNotify);
    socket.on("server-warning", onServerWarning);
    socket.on("room-full", onRoomFull);
    socket.on("partner-info", onPartnerInfo);
    socket.on("partner-joined", onPartnerJoined);
    socket.on("typing-start", onTypingStart);
    socket.on("typing-stop", onTypingStop);
    socket.on("message-status", onMessageStatus);

    return () => {
      socket.off("call-sign-assigned", onCallSignAssigned);
      socket.off("room-context", onRoomContext);
      socket.off("participants", onParticipants);
      socket.off("receive-message", onReceiveMessage);
      socket.off("recent-messages", onRecentMessages);
      socket.off("revise-message", onReviseMessage);
      socket.off("guest:joined", onJoined);
      socket.off("user-joined", onJoined);
      socket.off("notify", onNotify);
      socket.off("server-warning", onServerWarning);
      socket.off("room-full", onRoomFull);
      socket.off("partner-info", onPartnerInfo);
      socket.off("partner-joined", onPartnerJoined);
      socket.off("typing-start", onTypingStart);
      socket.off("typing-stop", onTypingStop);
      socket.off("message-status", onMessageStatus);
    };
  }, []);

  useEffect(() => {
    initBrowserTts();
    const refresh = () => {
      setCanSpeakCurrentLang(hasVoiceForMonoLang(fromLang));
    };
    refresh();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = refresh;
    }
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [fromLang]);

  // Scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => { autosize(); }, []);

  // Wake Lock
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {}
    };
    requestWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      try { wakeLockRef.current?.release(); } catch {}
    };
  }, []);

  // Keepalive
  useEffect(() => {
    const iv = setInterval(() => {
      if (roomIdRef.current) {
        socket.emit("keepalive", { roomId: roomIdRef.current, t: Date.now() });
      }
    }, 25000);
    return () => clearInterval(iv);
  }, []);

  // Read receipt: when visible, acknowledge latest incoming message once.
  const emitLatestReadReceipt = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (!roomId || !participantId) return;
    const latestIncoming = [...messagesRef.current]
      .reverse()
      .find((m) => !m.mine && !m.system && m.id);
    if (!latestIncoming?.id) return;
    if (readSentRef.current.has(latestIncoming.id)) return;
    readSentRef.current.add(latestIncoming.id);
    socket.emit("message-read", {
      roomId,
      messageId: latestIncoming.id,
      participantId,
    });
  }, [roomId, participantId]);

  useEffect(() => {
    emitLatestReadReceipt();
  }, [messages, emitLatestReadReceipt]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      emitLatestReadReceipt();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [emitLatestReadReceipt]);

  // Reconnect
  const initialConnectRef = useRef(true);
  const lastJoinTsRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    const rejoin = (reason) => {
      const rid = roomIdRef.current;
      const pid = participantIdRef.current;
      if (!rid || !pid) return;
      const now = Date.now();
      if (now - lastJoinTsRef.current < 3000) return;
      lastJoinTsRef.current = now;
      console.log("[MONO] rejoin →", rid, reason);
      socket.emit("rejoin-room", {
        roomId: rid,
        userId: pid,
        language: fromLangRef.current,
        isHost: roleHintRef.current === "owner",
      });
      socket.emit("join", {
        roomId: rid,
        fromLang: fromLangRef.current,
        participantId: pid,
        role: selectedRoleRef.current,
        localName: localNameRef.current || "",
        roleHint: roleHintRef.current,
      });
      socket.emit("set-lang", { roomId: rid, lang: fromLangRef.current });
    };

    const clearRetryTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!isOnline) {
        setReconnectState("disconnected");
        return;
      }
      if (reconnectAttemptsRef.current >= 3) {
        setReconnectState("disconnected");
        return;
      }
      const backoff = [1000, 3000, 10000];
      const delay = backoff[reconnectAttemptsRef.current] || 10000;
      reconnectAttemptsRef.current += 1;
      setReconnectState("reconnecting");
      clearRetryTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (!socket.connected) socket.connect();
      }, delay);
    };

    const onConnect = () => {
      reconnectAttemptsRef.current = 0;
      clearRetryTimer();
      setReconnectState("connected");
      if (initialConnectRef.current) {
        initialConnectRef.current = false;
        return;
      }
      rejoin("reconnect");
    };
    const onDisconnect = () => scheduleReconnect();
    const onConnectError = () => scheduleReconnect();
    const onReconnectAttempt = (attemptNumber) => {
      console.log("[MONO] 🔄 Reconnecting... attempt", attemptNumber);
    };
    const onReconnect = (attemptNumber) => {
      console.log("[MONO] ✅ Reconnected after", attemptNumber, "attempts");
    };
    const onOnline = () => {
      reconnectAttemptsRef.current = 0;
      if (!socket.connected) socket.connect();
      else if (roomIdRef.current && participantIdRef.current) {
        socket.emit("check-room", {
          roomId: roomIdRef.current,
          userId: participantIdRef.current,
        });
      }
    };
    const onOffline = () => setReconnectState("disconnected");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on("reconnect", onReconnect);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("reconnect", onReconnect);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearRetryTimer();
    };
  }, [isOnline]);

  // Mobile background recovery
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!socket.connected) { socket.connect(); return; }
      const rid = roomIdRef.current;
      const pid = participantIdRef.current;
      if (!rid || !pid) return;
      const now = Date.now();
      if (now - lastJoinTsRef.current < 3000) return;
      lastJoinTsRef.current = now;
      socket.emit("join", {
        roomId: rid,
        fromLang: fromLangRef.current,
        participantId: pid,
        role: selectedRoleRef.current,
        localName: localNameRef.current || "",
        roleHint: roleHintRef.current,
      });
      socket.emit("check-room", { roomId: rid, userId: pid });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const conn = navigator.connection;
    if (!conn || !conn.addEventListener) return;
    const onChange = () => {
      if (socket.connected && roomIdRef.current && participantIdRef.current) {
        socket.emit("check-room", {
          roomId: roomIdRef.current,
          userId: participantIdRef.current,
        });
      }
    };
    conn.addEventListener("change", onChange);
    return () => conn.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      if (!socket.connected) return;
      lastPingAtRef.current = Date.now();
      socket.emit("mono-ping", { timestamp: lastPingAtRef.current });
    }, 30000);
    const onPong = (data) => {
      const ts = Number(data?.timestamp || 0);
      if (!ts) return;
      const latency = Date.now() - ts;
      console.log(`[MONO] Latency: ${latency}ms`);
      if (latency > 3000) console.warn("[MONO] ⚠️ High latency detected:", latency, "ms");
    };
    const onRoomStatus = (payload) => {
      if (payload?.status === "room-gone") {
        setReconnectState("disconnected");
      }
    };
    socket.on("mono-pong", onPong);
    socket.on("room-status", onRoomStatus);
    return () => {
      clearInterval(iv);
      socket.off("mono-pong", onPong);
      socket.off("room-status", onRoomStatus);
    };
  }, []);

  const handleLeave = () => {
    cancelSpeech();
    socket.emit("manual-leave");
    navigate("/home");
  };

  const onMicListeningChange = useCallback((listening) => {
    setMicListening(listening);
  }, []);

  const handleUserGesture = useCallback(() => {}, []);

  // ── Voice output toggle ──
  const toggleVoice = useCallback(() => {
    const next = !voiceEnabledRef.current;
    voiceEnabledRef.current = next;
    setVoiceEnabled(next);
    localStorage.setItem("mono.voice", next ? "1" : "0");
    if (next) {
    } else {
      cancelSpeech();
    }
  }, []);

  const playMessageOnce = useCallback(async (message) => {
    const speakable = message?.translatedText || message?.text;
    if (!speakable || !canSpeakCurrentLang) return;
    await speakText(speakable, fromLangRef.current, {
      onEnd: () => {},
      onError: () => {},
    });
  }, [canSpeakCurrentLang]);

  const canSend = inputText.trim().length > 0;

  const sendTypedMessage = async (rawText) => {
    const text = (rawText || "").trim();
    if (!text) return;
    const msgId = uuidv4();
    seenIdsRef.current.add(msgId);
    const queued = !(await sendOrQueue({ roomId, msgId, text, participantId }));
    setMessages((prev) => [...prev, {
      id: msgId,
      text,
      originalText: text,
      translatedText: "",
      mine: true,
      senderId: participantIdRef.current,
      status: queued ? "sending" : "sent",
      timestamp: Date.now(),
      queued,
      senderFlagUrl: myFlagRef.current,
      senderLabel: myShortRef.current,
    }]);
    if (typingActiveRef.current) {
      socket.emit("typing-stop", { roomId, participantId });
      typingActiveRef.current = false;
    }
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    recordRoomActivity(roomId, {
      lastMessagePreview: text.slice(0, 120),
      lastMessageAt: Date.now(),
      lastMessageMine: true,
      unreadCount: 0,
    }).catch(() => {});
    touchRoom(roomId).catch(() => {});
  };

  // Site context label
  const siteLabel = useMemo(() => {
    return SITE_CONTEXTS.find(c => c.id === siteContext)?.labelKo || siteContext;
  }, [siteContext]);

  // Broadcast listeners cannot send
  const isBroadcastListener = roomType === "broadcast" && roleHint !== "owner";
  const partnerOnline = useMemo(
    () => participants.some((p) => p?.pid && p.pid !== participantId && p.online !== false),
    [participants, participantId]
  );

  return (
    <div className="relative">
      <div className="mono-shell h-screen w-screen flex flex-col max-w-screen-sm mx-auto text-[#111]">
        {/* ─── Header ─── */}
        <div className="fixed top-0 left-0 right-0 bg-[#f8fafc] border-b border-[#d1d5db] z-10 max-w-screen-sm mx-auto backdrop-blur">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px] min-w-[92px]">
              <button
                onClick={handleLeave}
                className="text-[18px] text-[#111]"
                aria-label="뒤로가기"
                title="대화목록으로"
              >
                ←
              </button>
              <span className={`${reconnectState === "reconnecting" ? "animate-pulse" : ""}`}>
                {reconnectState === "connected" ? "🟢" : reconnectState === "reconnecting" ? "🟡" : "🔴"}
              </span>
              <span className="text-[#666]">
                {reconnectState === "connected" ? "연결됨" : reconnectState === "reconnecting" ? "재연결 중" : "끊김"}
              </span>
            </div>

            <div className="flex-1 text-center text-[13px] font-medium text-[#111]">
              {roomType === "oneToOne" && (
                <div className="text-[12px] text-[#444] mb-0.5 truncate">
                  {partnerName || "상대방"} · {partnerOnline ? "온라인" : "오프라인"}
                </div>
              )}
              {roomType === "oneToOne" ? (
                <span className="inline-flex items-center gap-1">
                  {myFlagUrl ? <img className="flag" src={myFlagUrl} alt="" /> : null}
                  <span>{myShort || ""}</span>
                  <span>↔</span>
                  {resolvedPartnerFlagUrl && resolvedPartnerShort ? (
                    <>
                      <img className="flag" src={resolvedPartnerFlagUrl} alt="" />
                      <span>{resolvedPartnerShort}</span>
                    </>
                  ) : (
                    <span className="text-[#999]">대기 중...</span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {myFlagUrl ? <img className="flag" src={myFlagUrl} alt="" /> : null}
                  <span>{myShort || ""}</span>
                  <span>· LIVE</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[12px] min-w-[92px] justify-end">
              <button
                className="w-9 h-9 rounded-full border text-[16px] flex items-center justify-center bg-white text-[#6b7280] border-[#c7ccd3]"
                title="방 메뉴"
                aria-label="방 메뉴"
              >
                ⋮
              </button>
              <button
                onClick={toggleVoice}
                className={`w-9 h-9 rounded-full border text-[18px] flex items-center justify-center ${
                  voiceEnabled
                    ? "bg-[#2563eb] text-white border-[#2563eb]"
                    : "bg-white text-[#6b7280] border-[#c7ccd3] opacity-40"
                }`}
                title={voiceEnabled ? "음성 출력 ON" : "음성 출력 OFF"}
                disabled={!canSpeakCurrentLang}
              >
                {voiceEnabled ? "🔊" : "🔇"}
              </button>
            </div>
          </div>
          {/* User count — broadcast only */}
          {roomType === "broadcast" && participants.length > 1 && (
            <div className="px-4 pb-2">
              <span className="text-[11px] text-[#888]">
                {participants.length - 1}명 수신 중
              </span>
            </div>
          )}
        </div>

        {/* ─── Messages ─── */}
        <div className="mono-scroll flex-1 overflow-y-auto px-4 pb-[96px] pt-[64px]">
          {reconnectState === "disconnected" && (
            <button
              type="button"
              onClick={() => socket.connect()}
              className="mb-2 w-full rounded-lg border border-[#ef4444] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#991b1b]"
            >
              연결이 끊어졌습니다. 탭하여 재연결
            </button>
          )}
          {serverWarning && (
            <div className="mb-2 rounded-lg border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]">
              {serverWarning}
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onPlay={() => playMessageOnce(m)} />
          ))}
          {typingPeerName ? (
            <div className="w-full flex justify-start mb-2">
              <div className="max-w-[70%] rounded-2xl rounded-bl-sm border border-[#d1d5db] bg-white px-3 py-2 text-[12px] text-[#6b7280]">
                {typingPeerName} 입력 중...
              </div>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>

        {/* ─── Input (hidden for broadcast listeners) ─── */}
        {!isBroadcastListener && (
          <form
            className="fixed bottom-0 left-0 right-0 px-4 pb-4 bg-[#f8fafc] z-10 max-w-screen-sm mx-auto border-t border-[#d1d5db]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSend) return;
              sendTypedMessage(inputText);
              setInputText("");
              resetHeight();
            }}
          >
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  className="mono-input w-full resize-none h-11 min-h-11 max-h-11 px-4 py-0 text-[14px] leading-[44px] overflow-hidden bg-white focus:outline-none box-border"
                  value={inputText}
                  onChange={(e) => {
                    const nextText = e.target.value;
                    setInputText(nextText);
                    autosize();
                    if (!nextText.trim()) {
                      if (typingActiveRef.current) {
                        socket.emit("typing-stop", { roomId, participantId });
                        typingActiveRef.current = false;
                      }
                      if (typingStopTimerRef.current) {
                        clearTimeout(typingStopTimerRef.current);
                        typingStopTimerRef.current = null;
                      }
                      return;
                    }
                    if (!typingActiveRef.current) {
                      socket.emit("typing-start", {
                        roomId,
                        participantId,
                        displayName: localNameRef.current || "상대방",
                      });
                      typingActiveRef.current = true;
                    }
                    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
                    typingStopTimerRef.current = setTimeout(() => {
                      if (typingActiveRef.current) {
                        socket.emit("typing-stop", { roomId, participantId });
                        typingActiveRef.current = false;
                      }
                    }, 2000);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!canSend) return;
                      sendTypedMessage(inputText);
                      setInputText("");
                      resetHeight();
                    }
                  }}
                  placeholder="메시지 입력..."
                />
                {micListening && (
                  <div className="mt-1 text-[11px] text-[#FF5252] font-medium">● 음성 입력 중</div>
                )}
              </div>
              <button
                type="submit"
                className={`mono-btn h-11 min-w-[64px] px-4 py-0 text-[14px] font-semibold border box-border ${
                  canSend ? "bg-[#7C6FEB] text-white border-[#7C6FEB]" : "bg-[#DDD] text-[#888] border-[#bbb]"
                }`}
              >
                전송
              </button>
            </div>
            <div className="mt-2 flex justify-center">
              <MicButton
                roomId={roomId}
                participantId={participantId}
                lang={fromLang}
                onListeningChange={onMicListeningChange}
                onUserGesture={handleUserGesture}
              />
            </div>
          </form>
        )}

        {/* Broadcast listener: listen-only indicator */}
        {isBroadcastListener && (
          <div className="fixed bottom-0 left-0 right-0 px-4 py-4 bg-[#f8fafc] z-10 max-w-screen-sm mx-auto border-t border-[#d1d5db] text-center">
            <span className="text-[13px] text-[#888]">수신 전용 모드</span>
          </div>
        )}
      </div>
      <InstallBanner />
    </div>
  );
}
