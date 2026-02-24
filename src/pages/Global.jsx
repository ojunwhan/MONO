import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import { getMyIdentity, upsertRoom } from "../db";

export default function GlobalPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [identity, setIdentity] = useState(null);
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
    <div className="mx-auto w-full max-w-[420px] px-4 py-6">
      <div className="mono-card p-5">
        <h1 className="text-[18px] font-semibold">글로벌</h1>
        <p className="mt-2 text-[13px] text-[#666]">공개 채널에 참여해 다국어 방송을 수신할 수 있습니다.</p>
        {statusText ? <div className="mt-3 text-[12px] text-[#4b5563]">{statusText}</div> : null}
        {error ? <div className="mt-3 text-[12px] text-[#b91c1c]">{error}</div> : null}
        <button
          type="button"
          onClick={enterGlobal}
          disabled={!identity?.userId || loading}
          className={`mt-4 mono-btn w-full py-3 text-[14px] font-semibold border ${
            loading || !identity?.userId
              ? "bg-[#DDD] text-[#888] border-[#bbb]"
              : "bg-[#111] text-white border-[#111]"
          }`}
        >
          {loading ? "입장 중..." : "글로벌 채널 입장"}
        </button>
      </div>
    </div>
  );
}

