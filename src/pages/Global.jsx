import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import { getMyIdentity, upsertRoom } from "../db";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function GlobalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [identity, setIdentity] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const categories = ["All", "Free Talk", "Language Exchange", "Travel", "Business", "Culture"];
  const mockRooms = [
    { id: "global-lobby", name: "Global Lobby", category: "Free Talk", members: 23, preview: "Welcome! Start multilingual conversations." },
  ];
  const filteredRooms =
    selectedCategory === "All" ? mockRooms : mockRooms.filter((r) => r.category === selectedCategory);
  const GLOBAL_ROOM_ID = "global-lobby";

  useEffect(() => {
    let cancelled = false;
    getMyIdentity()
      .then((me) => {
        if (cancelled) return;
        if (!me?.userId) {
          setError(t("global.needLogin"));
          return;
        }
        setIdentity(me);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("global.loadMeFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const enterGlobal = () => {
    if (!identity?.userId || loading) return;
    setLoading(true);
    setError("");
    setStatusText(t("global.connectPreparing"));

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
      fail(t("global.timeout"));
    }, 5000);

    setStatusText(t("global.joining"));
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
          fail(t("global.joinFail"));
          return;
        }
        setStatusText(t("global.joinedMoving"));
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
        <h1 className="text-[18px] font-semibold">{t("global.title")}</h1>
        <button
          type="button"
          onClick={() => alert(t("global.createSoon"))}
          className="w-10 h-10 flex items-center justify-center text-[var(--color-text)]"
          aria-label={t("global.createRoomAria")}
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
              <p className="text-[15px]">{t("global.noPublicRooms")}</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{t("global.createNewRoom")}</p>
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

