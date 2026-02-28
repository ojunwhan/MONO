// src/pages/RoomList.jsx — Recent conversations + new chat
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Search, SquarePen, Users as UsersIcon } from "lucide-react";
import BottomSheet from "../components/BottomSheet";
import {
  getMyIdentity,
  setMyIdentity,
  getAllRooms,
  getRoom,
  upsertRoom,
  recordRoomActivity,
  incrementUnread,
  deleteRoom,
  deleteMessages,
  clearUnread,
} from "../db";
import socket from "../socket";
import useNetworkStatus from "../hooks/useNetworkStatus";
import { subscribeToPush } from "../push";
import { fetchAuthMe } from "../auth/session";
import { useTranslation } from "react-i18next";

export default function RoomList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isConnected } = useNetworkStatus();
  const [me, setMe] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [friendCandidates, setFriendCandidates] = useState([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [actionRoom, setActionRoom] = useState(null);
  const [newChatStep, setNewChatStep] = useState("type");
  const [newChatType, setNewChatType] = useState("dm");
  const registeredRef = useRef(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  const formatListTime = useCallback((ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
    }
    const sameYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
      if (sameYesterday) return "Yesterday";
    return d.toLocaleDateString();
  }, []);

  const getAvatarColor = useCallback((name = "") => {
    const palette = ["#F59E0B", "#10B981", "#8B5CF6", "#EF4444", "#06B6D4", "#F97316", "#84CC16"];
    const key = String(name || "MONO");
    const sum = Array.from(key).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return palette[sum % palette.length];
  }, []);

  // ── Load identity ──
  useEffect(() => {
    let cancelled = false;
    async function loadIdentity() {
      const identity = await getMyIdentity();
      if (identity?.userId) {
        if (!cancelled) setMe(identity);
        return;
      }
      // OAuth login can set cookie before local IndexedDB identity exists.
      // In that case, restore local identity from /api/auth/me.
      const auth = await fetchAuthMe();
      if (auth?.authenticated && auth?.user?.id) {
        const restored = {
          userId: auth.user.id,
          canonicalName: auth.user.nickname || "MONO User",
          lang: auth.user.nativeLanguage || "ko",
        };
        await setMyIdentity(restored).catch(() => {});
        if (!cancelled) setMe(restored);
        return;
      }
      if (!cancelled) navigate("/interpret", { replace: true });
    }
    loadIdentity().catch(() => {
      if (!cancelled) navigate("/interpret", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // ── Register with server on connect + push subscription ──
  useEffect(() => {
    if (!me?.userId) return;
    const doRegister = () => {
      socket.emit("register-user", {
        userId: me.userId,
        canonicalName: me.canonicalName,
        lang: me.lang,
      });
      registeredRef.current = true;
      // Subscribe to push (non-blocking)
      subscribeToPush(me.userId).catch(() => {});
    };
    if (socket.connected) doRegister();
    socket.on("connect", doRegister);
    return () => socket.off("connect", doRegister);
  }, [me]);

  // ── Load rooms from IndexedDB ──
  const loadRooms = useCallback(async () => {
    const allRooms = await getAllRooms();
    setRooms(allRooms);
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // ── Listen for room-created events ──
  useEffect(() => {
    const onRoomCreated = async (payload) => {
      const { roomId, roomType, peerUserId, peerDisplayName, peerCanonicalName, peerLang } = payload;
      await upsertRoom({
        roomId,
        roomType: roomType || "1to1",
        peerUserId,
        peerCanonicalName: peerCanonicalName || peerDisplayName,
        peerAlias: peerDisplayName || peerCanonicalName,
        peerLang,
        unreadCount: 0,
      });
      loadRooms();
    };

    const onReceiveMessage = async (payload) => {
      const targetRoomId = payload?.roomId;
      if (!targetRoomId) return;
      const eventTs = Number(payload?.timestamp || payload?.at || Date.now());
      const normalizedRoomType =
        payload?.roomType === "oneToOne" ? "1to1" : (payload?.roomType || "1to1");
      const preview = String(
        payload?.translatedText || payload?.originalText || payload?.text || ""
      )
        .trim()
        .slice(0, 120);

      const mine = payload?.senderPid && payload.senderPid === me?.userId;
      await recordRoomActivity(targetRoomId, {
        lastMessagePreview: preview,
        lastMessageAt: eventTs,
        lastMessageMine: !!mine,
      });
      if (!mine) await incrementUnread(targetRoomId);

      const existing = await getRoom(targetRoomId);
      if (!existing) {
        await upsertRoom({
          roomId: targetRoomId,
          roomType: normalizedRoomType,
          unreadCount: mine ? 0 : 1,
          peerAlias: payload?.senderDisplayName || payload?.senderCallSign || "Unknown",
          peerCanonicalName: payload?.senderDisplayName || payload?.senderCallSign || "Unknown",
        });
      }
      loadRooms();
    };

    socket.on("room-created", onRoomCreated);
    socket.on("receive-message", onReceiveMessage);
    return () => {
      socket.off("room-created", onRoomCreated);
      socket.off("receive-message", onReceiveMessage);
    };
  }, [loadRooms, me?.userId]);

  // ── Request user list for new chat ──
  const loadFriendCandidates = async () => {
    setLoadingFriends(true);
    try {
      const res = await fetch("/api/contacts/friends", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setFriendCandidates(Array.isArray(data?.friends) ? data.friends : []);
      } else {
        setFriendCandidates([]);
      }
    } catch {
      setFriendCandidates([]);
    } finally {
      setLoadingFriends(false);
    }
  };

  const openNewChat = async () => {
    setNewChatStep("type");
    setNewChatType("dm");
    setShowNewChat(true);
  };

  const selectNewChatType = async (type) => {
    setNewChatType(type);
    if (type === "group") {
      return;
    }
    setNewChatStep("friends");
    await loadFriendCandidates();
  };

  // ── Start 1:1 chat ──
  const startChat = (peerUserId) => {
    if (!me?.userId) return;
    socket.emit("create-1to1", {
      myUserId: me.userId,
      peerUserId,
      siteContext: "general",
    });
    setShowNewChat(false);
  };

  // ── Navigate to room ──
  const openRoom = async (room) => {
    await clearUnread(room.roomId);
    navigate(`/room/${room.roomId}`, {
      state: {
        fromLang: me?.lang || "ko",
        localName: me?.canonicalName || "",
        myUserId: me?.userId || "",
        isCreator: true,
        roomType: room.roomType || "1to1",
        peerDisplayName: room.peerAlias || room.peerCanonicalName,
        peerLang: room.peerLang || "",
      },
    });
  };

  const copyRoomInviteLink = useCallback(async (room) => {
    if (!room?.roomId) return;
    const url = `https://lingora.chat/join/${encodeURIComponent(room.roomId)}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(t("chat.inviteCopied"));
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      alert(t("chat.inviteCopied"));
    } finally {
      setActionRoom(null);
    }
  }, [t]);

  const deleteRoomFromContextMenu = useCallback(async (room) => {
    if (!room?.roomId || !me?.userId) return;
    const ok = window.confirm(t("roomList.deleteRoomConfirm"));
    if (!ok) return;

    const normalizedType = String(room.roomType || "").toLowerCase();
    const isOneToOne = normalizedType === "1to1" || normalizedType === "onetoone";

    if (isOneToOne) {
      socket.emit("delete-room", {
        roomId: room.roomId,
        participantId: me.userId,
      });
    } else {
      socket.emit("leave-room", {
        roomId: room.roomId,
        participantId: me.userId,
        reason: "roomlist-context-delete",
      });
    }

    await deleteMessages(room.roomId);
    await deleteRoom(room.roomId);
    setActionRoom(null);
    await loadRooms();
  }, [deleteRoom, deleteMessages, loadRooms, me?.userId, t]);

  // ── Delete room ──
  const handleDeleteRoom = async (roomId, e) => {
    e.stopPropagation();
    await deleteRoom(roomId);
    loadRooms();
  };

  // ── Handle legacy QR/link join ──
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const incomingRoomId = query.get("roomId");
    if (incomingRoomId) {
      // Redirect to legacy Home for QR-based join
      navigate(`/?${query.toString()}`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const onRoomDeleted = async ({ roomId }) => {
      if (!roomId) return;
      await deleteMessages(roomId);
      await deleteRoom(roomId);
      await loadRooms();
    };
    socket.on("room-deleted", onRoomDeleted);
    return () => socket.off("room-deleted", onRoomDeleted);
  }, [deleteMessages, deleteRoom, loadRooms]);

  if (!me) {
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 py-5 space-y-3">
        <div className="h-[52px] rounded-[12px] bg-[var(--color-bg-secondary)] animate-pulse" />
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="h-[72px] rounded-[12px] bg-[var(--color-bg-secondary)] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="mono-shell min-h-screen text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[480px] min-h-screen flex flex-col bg-[var(--color-bg)]">
        {/* Header */}
        <div className="h-[52px] px-4 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-between">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[20px] font-bold tracking-[0.02em]">
                <span style={{ color: "#7C6FEB" }}>M</span>
                <span style={{ color: "#F472B6" }}>O</span>
                <span style={{ color: "#34D399" }}>N</span>
                <span style={{ color: "#FBBF24" }}>O</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
      onClick={() => alert(t("roomList.searchSoon"))}
              className="h-[44px] w-[44px] -mr-2 flex items-center justify-center text-[var(--color-text)]"
              aria-label={t("contacts.search")}
            >
              <Search size={24} />
            </button>
            <button
              type="button"
              onClick={openNewChat}
              className="h-[44px] w-[44px] -mr-2 flex items-center justify-center text-[var(--color-text)]"
              aria-label={t("roomList.newChat")}
            >
              <SquarePen size={24} />
            </button>
          </div>
        </div>

        {/* Room List */}
        <div className="mono-scroll flex-1 overflow-y-auto">
          {!isConnected ? (
            <div className="px-4 py-2 text-[12px] text-[#B42318] bg-[#FEE4E2] border-b border-[#FECACA]">
              {t("roomList.internetUnstable")}
            </div>
          ) : null}
          {rooms.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] flex items-center justify-center">
                <MessageCircle size={24} />
              </div>
              <p className="mt-4 text-[16px] text-[var(--color-text)]">{t("roomList.noConversation")}</p>
              <p className="mt-1 text-[14px] text-[var(--color-text-secondary)]">{t("roomList.startWithFriend")}</p>
              <button
                type="button"
                onClick={() => navigate("/contacts")}
                className="mono-btn mt-5 h-[40px] px-4 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[14px]"
              >
                {t("roomList.addFriend")}
              </button>
            </div>
          ) : (
            <div>
              {rooms.map((room) => (
                <div
                  key={room.roomId}
                  onClick={() => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    openRoom(room);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActionRoom(room);
                  }}
                  onTouchStart={() => {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = window.setTimeout(() => {
                      longPressTriggeredRef.current = true;
                      setActionRoom(room);
                    }, 550);
                  }}
                  onTouchEnd={() => window.clearTimeout(longPressTimerRef.current)}
                  onTouchCancel={() => window.clearTimeout(longPressTimerRef.current)}
                  className="relative h-[72px] px-4 flex items-center justify-between cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <div className="absolute left-[76px] right-0 top-0 h-px bg-[var(--color-border)]" />
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Avatar */}
                    <div
                      className="w-12 h-12 rounded-full text-white flex items-center justify-center text-[18px] font-semibold flex-shrink-0 relative"
                      style={{ backgroundColor: getAvatarColor(room.peerAlias || room.peerCanonicalName || "MONO") }}
                    >
                      {(room.peerAlias || room.peerCanonicalName || "M").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold truncate">
                        {room.peerAlias || room.peerCanonicalName || t("roomList.unknownUser")}
                      </div>
                      <div className="text-[14px] text-[var(--color-text-secondary)] truncate">
                        {room.lastMessagePreview
                          ? `${room.lastMessageMine ? t("roomList.mePrefix") : ""}${room.lastMessagePreview}`
                          : t("roomList.noMessage")}
                      </div>
                    </div>
                  </div>
                  <div className="h-full py-3 flex flex-col items-end justify-between">
                    <div className="text-[12px] text-[var(--color-text-secondary)]">
                      {formatListTime(room.lastMessageAt || room.lastActiveAt)}
                    </div>
                    <div className="flex items-center gap-2">
                      {room.unreadCount > 0 && (
                        <span className="min-w-[20px] h-[20px] px-[6px] rounded-full bg-[var(--color-unread)] text-white text-[11px] font-semibold leading-[20px] text-center">
                          {room.unreadCount > 99 ? "99+" : room.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteRoom(room.roomId, e)}
                    className="absolute right-2 top-2 text-[11px] text-[#AAA] hover:text-[#FF5252] px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New Chat Modal */}
        <BottomSheet open={showNewChat} onClose={() => setShowNewChat(false)} title={newChatStep === "type" ? t("roomList.newChat") : t("roomList.selectPartner")}>
          <div className="mono-scroll max-h-[78vh] overflow-y-auto">
                {newChatStep === "type" ? (
                  <div className="p-4 space-y-3">
                    <button
                      type="button"
                      onClick={() => selectNewChatType("dm")}
                      className="w-full h-[52px] px-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)] text-left text-[15px] font-medium"
                    >
                      {t("roomList.dm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectNewChatType("group")}
                      className="w-full h-[52px] px-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)] text-left text-[15px] font-medium"
                    >
                      {t("roomList.group")}
                    </button>
                    {newChatType === "group" ? (
                      <p className="text-[13px] text-[var(--color-text-secondary)]">
                        {t("roomList.groupSoon")}
                      </p>
                    ) : null}
                  </div>
                ) : loadingFriends ? (
                  <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
                    {t("roomList.loadingFriends")}
                  </div>
                ) : friendCandidates.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
                    {t("roomList.noFriends")}
                    <br />
                    {t("roomList.addFriendsInContacts")}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--color-border)]">
                    {friendCandidates.map((u) => (
                      <div
                        key={u.id}
                        onClick={() => startChat(u.id)}
                        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
                      >
                        <div
                          className="w-11 h-11 rounded-full text-white flex items-center justify-center text-[16px] font-semibold flex-shrink-0"
                          style={{ backgroundColor: getAvatarColor(u.nickname || u.monoId || "MONO") }}
                        >
                          {(u.nickname || "M").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] font-medium truncate">
                            {u.nickname || t("roomList.unknownUser")}
                          </div>
                          <div className="text-[13px] text-[var(--color-text-secondary)] truncate">
                            @{u.monoId || ""}
                          </div>
                        </div>
                        <UsersIcon size={16} className="text-[var(--color-text-secondary)]" />
                      </div>
                    ))}
                  </div>
                )}
          </div>
        </BottomSheet>
        <BottomSheet open={!!actionRoom} onClose={() => setActionRoom(null)} title={t("chat.inviteRoom")}>
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={() => copyRoomInviteLink(actionRoom)}
              className="w-full h-[52px] px-3 text-left text-[15px] border-b border-[var(--color-border)]"
            >
              🔗 {t("chat.copyInviteLink")}
            </button>
            <button
              type="button"
              onClick={() => deleteRoomFromContextMenu(actionRoom)}
              className="w-full h-[52px] px-3 text-left text-[15px] text-[#DC2626] border-b border-[var(--color-border)]"
            >
              🗑️ {t("roomList.deleteRoom")}
            </button>
            <button
              type="button"
              onClick={() => setActionRoom(null)}
              className="w-full h-[52px] px-3 text-left text-[15px]"
            >
              {t("common.close")}
            </button>
          </div>
        </BottomSheet>
      </div>
    </div>
  );
}
