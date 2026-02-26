// src/components/MessageBubble.jsx
import React, { useMemo, useState } from "react";
import { Check, CheckCheck, Clock3, Volume2 } from "lucide-react";

function MessageBubble({
  message,
  onPlay,
  onOpenMenu,
  currentUserId = "",
  roomType = "oneToOne",
  groupedWithPrev = false,
}) {
  const {
    text,
    originalText,
    translatedText,
    mine,
    system,
    senderFlagUrl,
    senderDisplayName,
    senderLabel,
    senderAvatarText,
    senderId,
    queued,
    status,
    timestamp,
    replySnippet,
    replyAuthor,
  } = message;
  const [viewMode, setViewMode] = useState("both"); // both | translated | original

  if (system) {
    return (
      <div className="w-full flex justify-center mb-2">
        <div className="px-3 py-1 text-[11px] text-[#555] bg-[#ECECEC] border border-[#CCC]">
          {text}
        </div>
      </div>
    );
  }

  const isMine = !!mine || (!!senderId && String(senderId) === String(currentUserId));
  const isGroupRoom = roomType !== "oneToOne";
  const sourceText = (originalText || text || "").trim();
  const targetText = (translatedText || text || "").trim();
  const title = senderDisplayName && !["unknown", "null", "undefined"].includes(String(senderDisplayName).toLowerCase())
    ? senderDisplayName
    : "알 수 없는 사용자";
  const canToggle = sourceText && targetText && sourceText !== targetText;
  const timeText = useMemo(() => {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [timestamp]);

  const StatusIcon = queued || status === "sending" ? Clock3 : status === "read" ? CheckCheck : Check;

  const renderMain = () => {
    if (viewMode === "translated") return targetText || sourceText;
    if (viewMode === "original") return sourceText || targetText;
    return targetText || sourceText;
  };
  const renderSub = () => {
    if (viewMode !== "both") return "";
    if (!sourceText || !targetText || sourceText === targetText) return "";
    return sourceText;
  };

  return (
    <div className={`w-full flex ${isMine ? "justify-end" : "justify-start"} ${groupedWithPrev ? "mt-[4px]" : "mt-[16px]"}`}>
      {!isMine && isGroupRoom ? (
        <div className="w-9 h-9 rounded-full bg-[#D9D9DE] text-[#555] text-[13px] font-semibold flex items-center justify-center mr-2 mt-1">
          {String(senderAvatarText || title.charAt(0) || "?").slice(0, 2)}
        </div>
      ) : null}
      <div className="max-w-[75%]">
        {!isMine && isGroupRoom && !groupedWithPrev ? (
          <div className="mb-1 px-1 flex items-center gap-1 text-[12px] text-[#8E8E93]">
            {senderFlagUrl ? <img className="flag" src={senderFlagUrl} alt="" /> : null}
            {senderLabel ? <span>{senderLabel}</span> : null}
            <span className="truncate">{title}</span>
          </div>
        ) : null}
        <div
          dir="auto"
          role="button"
          tabIndex={0}
          onContextMenu={(e) => {
            e.preventDefault();
            onOpenMenu?.(message);
          }}
          onClick={() => {
            if (!canToggle) return;
            setViewMode((prev) =>
              prev === "both" ? "translated" : prev === "translated" ? "original" : "both"
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!canToggle) return;
              setViewMode((prev) =>
                prev === "both" ? "translated" : prev === "translated" ? "original" : "both"
              );
            }
          }}
          className={`px-[14px] py-[10px] text-[14px] break-words whitespace-pre-wrap rounded-[16px] transition-all ${
            isMine
              ? "bg-[#3B82F6] text-white rounded-br-[4px]"
              : "bg-[#F0F0F0] text-[#1A1A1A] rounded-bl-[4px]"
          }`}
        >
          {replySnippet ? (
            <div className={`mb-2 rounded-[8px] border-l-[3px] px-2 py-1 text-[12px] ${
              isMine ? "border-white/70 bg-white/15 text-white/90" : "border-[#3B82F6] bg-white/60 text-[#8E8E93]"
            }`}>
              <div className="font-semibold">{replyAuthor || "답장"}</div>
              <div className="truncate">{replySnippet}</div>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={`text-[15px] leading-[1.45] ${isMine ? "text-white" : "text-[#1A1A1A]"} break-words`}>
                {renderMain()}
              </div>
              {renderSub() ? (
                <div className={`mt-1 text-[12px] leading-[1.4] ${isMine ? "text-white/60" : "text-[#8E8E93]"} break-words`}>
                  {renderSub()}
                </div>
              ) : null}
            </div>
            {typeof onPlay === "function" && (
              <button
                type="button"
                onClick={onPlay}
                className={`${isMine ? "text-white/90 hover:text-white" : "text-[#8E8E93] hover:text-[#1A1A1A]"}`}
                title="메시지 음성 재생"
                aria-label="메시지 음성 재생"
              >
                <Volume2 size={16} />
              </button>
            )}
          </div>
        </div>
        <div className={`mt-0.5 px-1 text-[11px] text-[#8E8E93] inline-flex items-center gap-1 ${isMine ? "justify-start" : "justify-end"} w-full`}>
          {isMine ? (
            <>
              <span>{timeText}</span>
              <StatusIcon
                size={12}
                className={`${status === "read" ? "text-[#3B82F6]" : "text-[#8E8E93]"} inline-block`}
              />
              {queued ? <span>전송 대기 중</span> : null}
            </>
          ) : (
            <span>{timeText}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default MessageBubble;
