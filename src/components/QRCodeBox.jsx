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

  // ── Invitation link ──
  const link = useMemo(() => {
    const base = new URL(`${window.location.origin}/`);
    base.searchParams.set("roomId", roomId);
    base.searchParams.set("siteContext", siteContext || "general");
    base.searchParams.set("roomType", roomType || "oneToOne");
    base.searchParams.set("v", Date.now().toString());
    return base.toString();
  }, [roomId, siteContext, roomType]);

  // ── Host: create room + join ──
  useEffect(() => {
    if (!roomId || !fromLang || !participantId || !role) return;
    createdRef.current = false;
  }, [roomId, fromLang, participantId, role]);

  useEffect(() => {
    if (!roomId || !fromLang || !participantId || !role) return;
    if (createdRef.current) return;
    createdRef.current = true;
    socket.emit("create-room", {
      roomId,
      fromLang,
      participantId,
      siteContext: siteContext || "general",
      role,
      localName: localName || "",
      roomType: roomType || "oneToOne",
    });
    socket.emit("join", {
      roomId,
      fromLang,
      participantId,
      role,
      localName: localName || "",
      roleHint: "owner",
    });
  }, [roomId, fromLang, participantId, siteContext, role, localName, roomType]);

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
    const onJoined = (data) => {
      if (data?.socketId === socket.id) return;
      notifyNative("참가자 입장", "대화를 시작합니다.");
      if (movedRef.current) return;
      setGuestJoined(true);
      movedRef.current = true;
      navigate(`/room/${roomId}`, {
        state: { fromLang, localName, role, isCreator: true, siteContext, roomType },
      });
    };

    socket.on("guest:joined", onJoined);
    socket.on("user-joined", onJoined);
    return () => {
      socket.off("guest:joined", onJoined);
      socket.off("user-joined", onJoined);
    };
  }, [navigate, roomId, fromLang, localName, role, siteContext, roomType]);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
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
