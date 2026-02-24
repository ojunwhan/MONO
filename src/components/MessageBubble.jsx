// src/components/MessageBubble.jsx
import React, { useMemo, useState } from "react";

function MessageBubble({ message, onPlay }) {
  const {
    text,
    originalText,
    translatedText,
    mine,
    system,
    senderFlagUrl,
    senderDisplayName,
    senderLabel,
    queued,
    status,
    timestamp,
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

  const sourceText = (originalText || text || "").trim();
  const targetText = (translatedText || text || "").trim();
  const title = senderDisplayName && !["unknown", "null", "undefined"].includes(String(senderDisplayName).toLowerCase())
    ? senderDisplayName
    : (mine ? "나" : "상대");
  const canToggle = sourceText && targetText && sourceText !== targetText;
  const timeText = useMemo(() => {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [timestamp]);

  const statusText = queued
    ? "⏳"
    : status === "sending"
    ? "🕒"
    : status === "translated"
    ? "🌐"
    : status === "read"
    ? "✓✓"
    : "✓";

  const renderMain = () => {
    if (viewMode === "translated") return targetText || sourceText;
    if (viewMode === "original") return sourceText || targetText;
    return targetText || sourceText;
  };
  const renderSub = () => {
    if (viewMode !== "both") return "";
    if (!sourceText || !targetText || sourceText === targetText) return "";
    return mine ? sourceText : sourceText;
  };

  return (
    <div className={`w-full flex ${mine ? "justify-end" : "justify-start"} mb-2`}>
      <div className="max-w-[80%]">
        {!mine && (
          <div className="mb-0.5 px-1 flex items-center gap-1 text-[11px] text-[#6b7280]">
            {senderFlagUrl ? <img className="flag" src={senderFlagUrl} alt="" /> : null}
            {senderLabel ? <span>{senderLabel}</span> : null}
            <span>{title}</span>
          </div>
        )}
        <div
          dir="auto"
          role="button"
          tabIndex={0}
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
          className={`px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap border rounded-2xl shadow-sm ${
            mine
              ? "bg-[#111] text-white border-[#111] rounded-br-sm"
              : "bg-white text-[#111] border-[#d1d5db] rounded-bl-sm"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={`text-[15px] leading-6 ${mine ? "text-white" : "text-[#111]"} break-words`}>
                {renderMain()}
              </div>
              {renderSub() ? (
                <div className={`mt-1 text-[12px] leading-5 ${mine ? "text-white/80" : "text-[#6b7280]"} break-words`}>
                  {renderSub()}
                </div>
              ) : null}
            </div>
            {!mine && typeof onPlay === "function" && (
              <button
                type="button"
                onClick={onPlay}
                className="text-[12px] text-[#6b7280] hover:text-[#111]"
                title="메시지 음성 재생"
                aria-label="메시지 음성 재생"
              >
                ▶
              </button>
            )}
          </div>
        </div>
        <div className={`mt-0.5 px-1 text-[10px] ${mine ? "text-right text-[#9ca3af]" : "text-left text-[#9ca3af]"}`}>
          <span>{timeText}</span>
          {mine ? <span className="ml-1">{statusText}</span> : null}
          {mine && queued ? <span className="ml-1">전송 대기 중</span> : null}
        </div>
      </div>
    </div>
  );
}

export default MessageBubble;
