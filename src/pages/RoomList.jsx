// src/pages/RoomList.jsx — Recent conversations + new chat
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMyIdentity,
  setMyIdentity,
  getAllRooms,
  getRoom,
  upsertRoom,
  recordRoomActivity,
  incrementUnread,
  deleteRoom,
  clearUnread,
} from "../db";
import socket from "../socket";
import useNetworkStatus from "../hooks/useNetworkStatus";
import { subscribeToPush } from "../push";
import { fetchAuthMe } from "../auth/session";

export default function RoomList() {
  const navigate = useNavigate();
  const { isConnected } = useNetworkStatus();
  const [me, setMe] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [friendCandidates, setFriendCandidates] = useState([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const registeredRef = useRef(false);
  const [loadingFriends, setLoadingFriends] = useState(false);

  const formatListTime = useCallback((ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString();
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
  const openNewChat = async () => {
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
    setShowNewChat(true);
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

  if (!me) return null;

  return (
    <div className="mono-shell min-h-screen text-[#111]">
      <div className="mx-auto w-full max-w-md min-h-screen flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[#d1d5db] bg-[#f8fafc] backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[20px] font-bold tracking-[0.15em]">MONO</span>
              <span className="ml-2 text-[12px] text-[#555]">· {me.canonicalName}</span>
            </div>
            <div className="flex items-center gap-2">
              {!isConnected && (
                <span className="mono-chip bg-[#FF5252] text-white">
                  오프라인
                </span>
              )}
              <button
                onClick={() => navigate("/settings")}
                className="text-[12px] text-[#555] underline"
              >
                설정
              </button>
            </div>
          </div>
        </div>

        {/* Room List */}
        <div className="mono-scroll flex-1 overflow-y-auto px-3 py-3">
          {rooms.length === 0 ? (
            <div className="mono-card px-4 py-12 text-center text-[14px] text-[#888]">
              대화가 없습니다.
              <br />
              아래 버튼으로 새 대화를 시작하세요.
            </div>
          ) : (
            <div className="space-y-2">
              {rooms.map((room) => (
                <div
                  key={room.roomId}
                  onClick={() => openRoom(room)}
                  className="mono-card px-4 py-4 flex items-center justify-between cursor-pointer hover:bg-[#f9fafb] active:bg-[#f3f4f6] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-[#111] text-white flex items-center justify-center text-[16px] font-bold flex-shrink-0">
                      {(room.peerAlias || room.peerCanonicalName || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium truncate">
                        {room.peerAlias || room.peerCanonicalName || "Unknown"}
                      </div>
                      <div className="text-[12px] text-[#666] truncate">
                        {room.lastMessagePreview
                          ? `${room.lastMessageMine ? "나: " : ""}${room.lastMessagePreview}`
                          : "메시지 없음"}
                      </div>
                      <div className="text-[11px] text-[#888] truncate flex items-center gap-1 mt-1">
                        <span className="mono-chip bg-[#eef2f7] text-[#4b5563]">
                          {room.roomType === "broadcast" ? "방송" : "1:1"}
                        </span>
                        {(room.lastMessageAt || room.lastActiveAt) && (
                          <span className="ml-1">
                            · {formatListTime(room.lastMessageAt || room.lastActiveAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {room.unreadCount > 0 && (
                      <span className="mono-chip bg-[#FF5252] text-white min-w-[20px] text-center">
                        {room.unreadCount > 99 ? "99+" : room.unreadCount}
                      </span>
                    )}
                    <button
                      onClick={(e) => handleDeleteRoom(room.roomId, e)}
                      className="text-[11px] text-[#AAA] hover:text-[#FF5252] px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New Chat Button */}
        <div className="px-4 py-3 border-t border-[#d1d5db] bg-[#f8fafc]">
          <button
            onClick={openNewChat}
            className="mono-btn w-full py-3 bg-[#111] text-white text-[15px] font-medium border border-[#111]"
          >
            + 새 대화
          </button>
        </div>

        {/* New Chat Modal */}
        {showNewChat && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
            <div className="w-full max-w-md bg-white border border-[#d1d5db] rounded-t-2xl max-h-[72vh] flex flex-col shadow-2xl">
              <div className="px-4 py-3 border-b border-[#DDD] flex items-center justify-between">
                <span className="text-[16px] font-bold">새 대화 시작</span>
                <button
                  onClick={() => setShowNewChat(false)}
                  className="text-[14px] text-[#555]"
                >
                  닫기
                </button>
              </div>
              <div className="mono-scroll flex-1 overflow-y-auto">
                {loadingFriends ? (
                  <div className="px-4 py-8 text-center text-[13px] text-[#888]">
                    친구 목록 불러오는 중...
                  </div>
                ) : friendCandidates.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-[#888]">
                    친구가 없습니다.
                    <br />
                    연락처 탭에서 친구를 추가해주세요.
                  </div>
                ) : (
                  <div className="divide-y divide-[#EEE]">
                    {friendCandidates.map((u) => (
                      <div
                        key={u.id}
                        onClick={() => startChat(u.id)}
                        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[#F5F5F5] active:bg-[#EEE]"
                      >
                        <div className="w-9 h-9 bg-[#111] text-white flex items-center justify-center text-[14px] font-bold flex-shrink-0">
                          {(u.nickname || "?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[14px] font-medium">
                            {u.nickname || "Unknown"}
                          </div>
                          <div className="text-[11px] text-[#888]">
                            @{u.monoId || ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
