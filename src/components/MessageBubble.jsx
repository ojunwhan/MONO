// src/components/MessageBubble.jsx
// Shows: sender display name (others only) + message content (in user's language)
// No targeting indicators, no routing logic exposed
import React from "react";

function MessageBubble({ message, onPlay }) {
  const {
    text,
    originalText,
    translatedText,
    mine,
    system,
    senderFlagUrl,
    queued,
  } = message;

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
  const displayText = mine ? sourceText : targetText;

  return (
    <div className={`w-full flex ${mine ? "justify-end" : "justify-start"} mb-2`}>
      <div className="max-w-[80%]">
        {!mine && senderFlagUrl && (
          <div className="mb-0.5 px-1">
            <img className="flag" src={senderFlagUrl} alt="" />
          </div>
        )}
        <div
          dir="auto"
          className={`px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap border rounded-2xl shadow-sm ${
            mine
              ? "bg-[#111] text-white border-[#111] rounded-br-sm"
              : "bg-white text-[#111] border-[#d1d5db] rounded-bl-sm"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{displayText}</span>
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
        {/* Offline queued indicator */}
        {mine && queued && (
          <div className="text-[10px] text-[#AAA] text-right mt-0.5 px-1">
            ⏳ 전송 대기 중
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
