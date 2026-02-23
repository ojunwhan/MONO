import React, { useEffect, useMemo, useCallback, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { useNavigate } from "react-router-dom";
import socket from "../socket";

const QRCodeBox = ({ roomId, fromLang, participantId, siteContext, role, localName, roomType }) => {
  const navigate = useNavigate();
  const movedRef = useRef(false);
  const createdRef = useRef(false);
  const [guestJoined, setGuestJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const roomIdRef = useRef(roomId);
  const pidRef = useRef(participantId);
  const langRef = useRef(fromLang);
  const roleRef = useRef(role);
  const localNameRef = useRef(localName);
  const siteContextRef = useRef(siteContext || "general");
  const roomTypeRef = useRef(roomType || "oneToOne");

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { pidRef.current = participantId; }, [participantId]);
  useEffect(() => { langRef.current = fromLang; }, [fromLang]);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { localNameRef.current = localName; }, [localName]);
  useEffect(() => { siteContextRef.current = siteContext || "general"; }, [siteContext]);
  useEffect(() => { roomTypeRef.current = roomType || "oneToOne"; }, [roomType]);

  // ── Invitation link ──
  const link = useMemo(() => {
    const base = new URL(`${window.location.origin}/`);
    base.searchParams.set("roomId", roomId);
    base.searchParams.set("siteContext", siteContext || "general");
    base.searchParams.set("roomType", roomType || "oneToOne");
    base.searchParams.set("v", Date.now().toString());
    return base.toString();
  }, [roomId, siteContext, roomType]);

  const saveSessionState = useCallback(() => {
    try {
      sessionStorage.setItem("mono_session", JSON.stringify({
        roomId: roomIdRef.current || "",
        userId: pidRef.current || "",
        language: langRef.current || "",
        isHost: true,
        isInChat: movedRef.current === true,
      }));
    } catch {}
  }, []);

  const emitHostCreateAndJoin = useCallback((reason = "manual") => {
    const rid = roomIdRef.current;
    const pid = pidRef.current;
    const lang = langRef.current;
    const r = roleRef.current;
    if (!rid || !lang || !pid || !r) return;
    console.log(`[HOST] emit create-room/join (${reason}) rid=${rid} connected=${socket.connected}`);
    socket.emit("create-room", {
      roomId: rid,
      fromLang: lang,
      participantId: pid,
      siteContext: siteContextRef.current || "general",
      role: r,
      localName: localNameRef.current || "",
      roomType: roomTypeRef.current || "oneToOne",
    });
    socket.emit("join", {
      roomId: rid,
      fromLang: lang,
      participantId: pid,
      role: r,
      localName: localNameRef.current || "",
      roleHint: "owner",
    });
    saveSessionState();
  }, [saveSessionState]);

  const emitHostRejoin = useCallback((reason = "rejoin") => {
    const rid = roomIdRef.current;
    const pid = pidRef.current;
    const lang = langRef.current;
    if (!rid || !pid) return;
    console.log(`[HOST] emit rejoin-room (${reason}) rid=${rid} connected=${socket.connected}`);
    socket.emit("rejoin-room", {
      roomId: rid,
      userId: pid,
      language: lang,
      isHost: true,
    });
    socket.emit("join", {
      roomId: rid,
      fromLang: lang,
      participantId: pid,
      role: roleRef.current,
      localName: localNameRef.current || "",
      roleHint: "owner",
    });
    saveSessionState();
  }, [saveSessionState]);

  // ── Host: create room + join ──
  useEffect(() => {
    if (!roomId || !fromLang || !participantId || !role) return;
    createdRef.current = false;
  }, [roomId, fromLang, participantId, role]);

  useEffect(() => {
    if (!roomId || !fromLang || !participantId || !role) return;
    if (createdRef.current) return;
    createdRef.current = true;
    if (socket.connected) emitHostCreateAndJoin("initial");
    else socket.connect();
  }, [roomId, fromLang, participantId, siteContext, role, localName, roomType, emitHostCreateAndJoin]);

  // Re-join safety for unstable networks while host stays on QR screen
  useEffect(() => {
    const onConnect = () => {
      if (createdRef.current) emitHostRejoin("connect");
    };
    const onReconnect = () => {
      if (createdRef.current) emitHostRejoin("reconnect");
    };
    const onReconnectAttempt = (n) => {
      console.log("[MONO] 🔄 Reconnecting... attempt", n);
    };
    const onConnectError = (err) => {
      console.log("[MONO] ⚠️ Connection error:", err?.message || err);
    };
    socket.on("connect", onConnect);
    socket.on("reconnect", onReconnect);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on("connect_error", onConnectError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("reconnect", onReconnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("connect_error", onConnectError);
    };
  }, [emitHostRejoin]);

  const notifyNative = (title, body) => {
    try {
      if ("Notification" in window) {
        if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
        if (Notification.permission === "granted" && document.hidden) {
          new Notification(title || "MONO", { body: body || "" });
        }
      }
      if (navigator?.vibrate) navigator.vibrate([120, 60, 120]);
    } catch (_) {}
  };

  // ── Guest joins → navigate host to chat ──
  useEffect(() => {
    const moveToChat = (reason) => {
      console.log(`[HOST] move to chat: ${reason}`);
      if (movedRef.current) return;
      notifyNative("참가자 입장", "대화를 시작합니다.");
      setGuestJoined(true);
      movedRef.current = true;
      navigate(`/room/${roomIdRef.current}`, {
        state: {
          fromLang: langRef.current,
          localName: localNameRef.current,
          role: roleRef.current,
          isCreator: true,
          siteContext: siteContextRef.current,
          roomType: roomTypeRef.current,
        },
      });
    };

    const onJoined = (data) => {
      if (data?.socketId === socket.id) return;
      console.log(`[HOST] Socket state: ${socket.connected}, Room: ${roomIdRef.current}, Peer: connected`);
      moveToChat("guest:joined");
    };
    const onPartnerJoined = (data) => {
      console.log("[HOST] partner-joined:", data);
      moveToChat("partner-joined");
    };
    const onSyncRoomState = (data) => {
      if ((data?.memberCount || 0) > 1) moveToChat("sync-room-state");
    };
    const onRoomStatus = (data) => {
      if (data?.status === "room-gone") {
        emitHostCreateAndJoin("room-gone-recover");
      }
    };
    const onRoomMembers = (data) => {
      if (data?.roomId !== roomIdRef.current) return;
      if (Array.isArray(data?.members) && data.members.length > 0) {
        moveToChat("room-members");
      }
    };
    const onHeartbeatAck = (data) => {
      if (data?.timestamp) {
        // Intentionally no UI update; debug for connectivity only.
        console.log("[HOST] heartbeat-ack", data.timestamp);
      }
    };

    socket.on("guest:joined", onJoined);
    socket.on("user-joined", onJoined);
    socket.on("partner-joined", onPartnerJoined);
    socket.on("sync-room-state", onSyncRoomState);
    socket.on("room-status", onRoomStatus);
    socket.on("room-members", onRoomMembers);
    socket.on("heartbeat-ack", onHeartbeatAck);
    return () => {
      socket.off("guest:joined", onJoined);
      socket.off("user-joined", onJoined);
      socket.off("partner-joined", onPartnerJoined);
      socket.off("sync-room-state", onSyncRoomState);
      socket.off("room-status", onRoomStatus);
      socket.off("room-members", onRoomMembers);
      socket.off("heartbeat-ack", onHeartbeatAck);
    };
  }, [navigate, emitHostCreateAndJoin]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (socket.connected && roomIdRef.current && pidRef.current) {
        socket.emit("heartbeat", { roomId: roomIdRef.current, userId: pidRef.current });
      }
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!roomIdRef.current || !pidRef.current) return;
      socket.emit("who-is-in-room", { roomId: roomIdRef.current, userId: pidRef.current });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const copyToClipboard = useCallback(async () => {
    const showCopySuccess = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    try {
      await navigator.clipboard.writeText(link);
      showCopySuccess();
      return;
    } catch {}

    try {
      const textArea = document.createElement("textarea");
      textArea.value = link;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (ok) showCopySuccess();
    } catch (err) {
      console.error("[MONO] Copy failed:", err);
    }
  }, [link]);

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* QR */}
      <div className="bg-white p-4 border-2 border-[#E5E7EB] rounded-xl">
        <QRCode
          value={link}
          size={200}
          bgColor="#FFFFFF"
          fgColor="#059669"
          level="M"
        />
      </div>

      <p className="text-[13px] text-[#111] text-center font-medium">상대방에게 보여주세요</p>
      <p className="text-[12px] text-[#666] text-center">Show this to your partner</p>

      <button
        type="button"
        onClick={copyToClipboard}
        className="mono-btn px-4 py-2 border border-[#E5E7EB] bg-white text-[#374151] text-[14px]"
      >
        {copied ? "✅ 복사됨!" : "📋 링크 복사"}
      </button>

      <p className="text-[11px] text-[#888] text-center">
        {guestJoined ? "상대방이 입장했습니다." : "게스트가 입장하면 자동으로 대화방으로 이동합니다."}
      </p>
    </div>
  );
};

export default QRCodeBox;
