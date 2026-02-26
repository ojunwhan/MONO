import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import { getMyIdentity, upsertRoom } from "../db";
import { Plus } from "lucide-react";

export default function GlobalPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [identity, setIdentity] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const categories = ["전체", "자유토론", "언어교환", "여행", "비즈니스", "문화"];
  const mockRooms = [
    { id: "global-lobby", name: "Global Lobby", category: "자유토론", members: 23, preview: "환영합니다! 다국어 대화를 시작해보세요." },
  ];
  const filteredRooms =
    selectedCategory === "전체" ? mockRooms : mockRooms.filter((r) => r.category === selectedCategory);
  const GLOBAL_ROOM_ID = "global-lobby";

  useEffect(() => {
    let cancelled = false;
    getMyIdentity()
      .then((me) => {
        if (cancelled) return;
        if (!me?.userId) {
          setError("로그인이 필요합니다.");
          return;
        }
        setIdentity(me);
      })
      .catch(() => {
        if (cancelled) return;
        setError("내 정보 로드 실패");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enterGlobal = () => {
    if (!identity?.userId || loading) return;
    setLoading(true);
    setError("");
    setStatusText("채널 연결 준비 중...");

    const lang = identity?.lang || "en";
    if (!socket.connected) {
      socket.connect();
    }

    let timeout = null;
    const fail = (msg) => {
      setLoading(false);
      setStatusText("");
      setError(msg);
    };
    timeout = setTimeout(() => {
      fail("응답 지연: 네트워크 상태를 확인하고 다시 시도해주세요.");
    }, 5000);

    setStatusText("글로벌 채널 입장 요청 중...");
    socket.emit(
      "join-global",
      {
        roomId: GLOBAL_ROOM_ID,
        participantId: identity.userId,
        fromLang: lang,
        localName: identity.canonicalName || "MONO User",
      },
      (ack) => {
        clearTimeout(timeout);
        if (!ack?.ok || !ack?.roomId) {
          fail("글로벌 채널 준비 실패");
          return;
        }
        setStatusText("채널 입장 완료. 이동 중...");
        upsertRoom({
          roomId: ack.roomId,
          roomType: "broadcast",
          peerUserId: "global-system",
          peerAlias: "Global Channel",
          peerCanonicalName: "Global Channel",
          peerLang: lang,
          unreadCount: 0,
          lastActiveAt: Date.now(),
        }).catch(() => {});
        navigate(`/room/${ack.roomId}`, {
          state: {
            fromLang: lang,
            localName: identity.canonicalName || "MONO User",
            myUserId: identity.userId,
            roomType: "broadcast",
            isCreator: ack.roleHint === "owner",
            role: ack.roleHint === "owner" ? "Manager" : "Tech",
            siteContext: "general",
          },
        });
      }
    );
  };

  return (
    <div className="mx-auto w-full max-w-[480px] min-h-screen bg-[var(--color-bg)]">
      <div className="h-[52px] px-4 border-b border-[var(--color-border)] flex items-center justify-between">
        <h1 className="text-[18px] font-semibold">글로벌</h1>
        <button
          type="button"
          onClick={() => alert("방 만들기 UI는 다음 단계에서 연결됩니다.")}
          className="w-10 h-10 flex items-center justify-center text-[var(--color-text)]"
          aria-label="방 만들기"
        >
          <Plus size={22} />
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`h-[36px] px-4 rounded-[20px] whitespace-nowrap text-[13px] border ${
                selectedCategory === cat
                  ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                  : "bg-[var(--color-bg-secondary)] text-[var(--color-text)] border-[var(--color-border)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {statusText ? <div className="mt-3 text-[12px] text-[var(--color-text-secondary)]">{statusText}</div> : null}
        {error ? <div className="mt-2 text-[12px] text-[#B42318]">{error}</div> : null}

        <div className="mt-3 space-y-3">
          {filteredRooms.length === 0 ? (
            <div className="mono-card p-8 text-center">
              <p className="text-[15px]">공개 채팅방이 없습니다</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">새로운 방을 만들어보세요</p>
            </div>
          ) : (
            filteredRooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={enterGlobal}
                disabled={!identity?.userId || loading}
                className="mono-card w-full p-4 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">{room.name}</span>
                  <span className="text-[12px] text-[var(--color-text-secondary)]">👥 {room.members}</span>
                </div>
                <div className="mt-1 text-[12px] text-[var(--color-primary)]">{room.category}</div>
                <p className="mt-2 text-[13px] text-[var(--color-text-secondary)] truncate">{room.preview}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

