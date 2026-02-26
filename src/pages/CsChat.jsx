import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, SendHorizontal } from "lucide-react";
import MessageBubble from "../components/MessageBubble";

function getGreetingByLang(lang = "ko") {
  const l = String(lang || "ko").toLowerCase();
  if (l.startsWith("en")) {
    return "Hello! I'm MONO Helper 😊\nFeel free to ask any questions about how to use MONO.";
  }
  if (l.startsWith("ja")) {
    return "こんにちは！MONOヘルパーです 😊\n使い方や気になる点を気軽に聞いてください。";
  }
  if (l.startsWith("zh")) {
    return "您好！我是 MONO 助手 😊\n欢迎随时咨询使用方法或常见问题。";
  }
  if (l.startsWith("vi")) {
    return "Xin chao! Toi la tro ly MONO 😊\nBan co the hoi bat ky dieu gi ve cach su dung.";
  }
  return "안녕하세요! MONO 도우미입니다 😊\n사용법이나 궁금한 점을 자유롭게 물어보세요.";
}

export default function CsChatPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [userLang, setUserLang] = useState("ko");
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);

  const quickChips = useMemo(
    () => ["사용법이 궁금해요", "번역이 안 돼요", "요금제가 궁금해요", "QR 통역 방법"],
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me", { credentials: "include" });
        if (!meRes.ok) {
          navigate("/login", { replace: true });
          return;
        }
        const me = await meRes.json();
        const lang = me?.user?.nativeLanguage || "ko";
        if (cancelled) return;
        setUserLang(lang);
        setMessages([
          {
            id: `bot-welcome-${Date.now()}`,
            senderId: "monobot",
            senderDisplayName: "모노봇",
            senderAvatarText: "🤖",
            text: getGreetingByLang(lang),
            translatedText: getGreetingByLang(lang),
            originalText: "",
            timestamp: Date.now(),
            mine: false,
            status: "translated",
          },
        ]);
      } catch {
        navigate("/login", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {}
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
      }
    };
  }, []);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const sendMessage = useCallback(
    async (rawText) => {
      const text = String(rawText || "").trim();
      if (!text || loading) return;
      const now = Date.now();
      const userMsg = {
        id: `user-${now}`,
        senderId: "me",
        text,
        translatedText: text,
        originalText: text,
        timestamp: now,
        mine: true,
        status: "sent",
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "44px";

      const nextHistory = [...history, { role: "user", content: text }].slice(-10);
      setHistory(nextHistory);
      setLoading(true);
      try {
        const res = await fetch("/api/cs-chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            language: userLang,
            history: nextHistory,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "cs_chat_failed");

        const replyText = String(data?.reply || "").trim();
        if (!replyText) throw new Error("empty_reply");
        const botMsg = {
          id: `bot-${Date.now()}`,
          senderId: "monobot",
          senderDisplayName: "모노봇",
          senderAvatarText: "🤖",
          text: replyText,
          translatedText: replyText,
          originalText: "",
          timestamp: Date.now(),
          mine: false,
          status: "translated",
        };
        setMessages((prev) => [...prev, botMsg]);
        setHistory((prev) => [...prev, { role: "assistant", content: replyText }].slice(-10));
      } catch {
        const fallback =
          "이 문의는 담당자에게 전달해드리겠습니다. 이메일(support@lingora.chat)로 연락 주시면 빠르게 도움드리겠습니다.";
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-fallback-${Date.now()}`,
            senderId: "monobot",
            senderDisplayName: "모노봇",
            senderAvatarText: "🤖",
            text: fallback,
            translatedText: fallback,
            originalText: "",
            timestamp: Date.now(),
            mine: false,
            status: "translated",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [history, loading, userLang]
  );

  const handleBack = useCallback(() => {
    console.log("뒤로가기 클릭됨");
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/settings");
    }
  }, [navigate]);

  const startRecording = useCallback(async () => {
    if (sttBusy || loading) return;
    const preferredMimeType = (() => {
      if (typeof MediaRecorder === "undefined") return "";
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
    })();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined
      );
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setSttBusy(true);
        try {
          const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          chunksRef.current = [];
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {}
          });
          mediaStreamRef.current = null;

          if (!audioBlob || audioBlob.size < 1024) return;
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          formData.append("language", userLang);

          const res = await fetch("/api/stt", {
            method: "POST",
            body: formData,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || "stt_failed");
          const recognized = String(data?.text || "").trim();
          if (!recognized) return;
          setInput(recognized);
          await sendMessage(recognized);
        } catch (err) {
          console.error("STT 실패:", err);
        } finally {
          setSttBusy(false);
          setIsRecording(false);
          mediaRecorderRef.current = null;
        }
      };
      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      console.error("마이크 접근 실패:", err);
      setIsRecording(false);
    }
  }, [loading, sendMessage, sttBusy, userLang]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    try {
      if (recorder && recorder.state === "recording") {
        setIsRecording(false); // UI는 즉시 원복, STT 처리는 onstop에서 계속 진행
        recorder.stop();
      }
    } catch {
      setIsRecording(false);
    }
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxWidth: "480px",
        margin: "0 auto",
        width: "100%",
        position: "relative",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          height: "56px",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #E5E5EA",
          backgroundColor: "#fff",
          boxSizing: "border-box",
        }}
      >
        <button
          type="button"
          onClick={() => {
            console.log("뒤로가기 클릭됨");
            handleBack();
          }}
          className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center"
          style={{ position: "relative", zIndex: 10, cursor: "pointer", minWidth: "44px", minHeight: "44px" }}
          aria-label="뒤로가기"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1 text-center -ml-11">
          <div className="text-[16px] font-semibold inline-flex items-center gap-1">
            <span>🤖</span>
            <span>MONO 도우미</span>
          </div>
          <div className="text-[12px] text-[var(--color-text-secondary)]">AI 고객지원</div>
        </div>
      </div>

      <div
        className="mono-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          backgroundColor: "#F5F5F5",
        }}
      >
        {messages.map((m, idx) => {
          const prev = idx > 0 ? messages[idx - 1] : null;
          const groupedWithPrev = !!prev && prev.senderId === m.senderId;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              currentUserId="me"
              roomType="group"
              groupedWithPrev={groupedWithPrev}
            />
          );
        })}
        {loading ? (
          <div className="w-full flex justify-start mt-[8px]">
            <div className="w-9 h-9 rounded-full bg-[#D9D9DE] text-[#555] text-[13px] font-semibold flex items-center justify-center mr-2 mt-1">
              🤖
            </div>
            <div className="max-w-[75%] rounded-[16px] rounded-bl-[4px] px-[14px] py-[10px] bg-[#F0F0F0] inline-flex items-center gap-1">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        ) : null}

        {messages.length === 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {quickChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => sendMessage(chip)}
                className="h-[36px] px-4 rounded-[20px] border border-[#3B82F6] text-[#3B82F6] text-[13px] bg-white"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        style={{
          flexShrink: 0,
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          borderTop: "1px solid #E5E5EA",
          backgroundColor: "#fff",
          boxSizing: "border-box",
          position: "relative",
        }}
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
      >
        {isRecording && (
          <div
            style={{
              position: "absolute",
              top: "-24px",
              left: "16px",
              fontSize: "12px",
              color: "#FF3B30",
              fontWeight: 500,
            }}
          >
            듣고 있습니다...
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autosize();
          }}
          placeholder={sttBusy ? "음성 인식 중..." : "궁금한 점을 물어보세요..."}
          style={{
            flex: 1,
            resize: "none",
            minHeight: "36px",
            maxHeight: "160px",
            padding: "8px 16px",
            fontSize: "14px",
            lineHeight: "1.45",
            borderRadius: "18px",
            border: "none",
            backgroundColor: "#F0F0F0",
            boxSizing: "border-box",
          }}
        />
        <button
          type={input.trim() ? "submit" : "button"}
          onClick={
            input.trim()
              ? undefined
              : isRecording
                ? stopRecording
                : startRecording
          }
          disabled={loading || sttBusy}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border: "none",
            cursor: "pointer",
            backgroundColor: sttBusy
              ? "#D1D5DB"
              : input.trim()
                ? "#3B82F6"
                : isRecording
                  ? "#FF3B30"
                  : "#D9D9DE",
            color: sttBusy ? "#8E8E93" : input.trim() || isRecording ? "#fff" : "#8E8E93",
          }}
          className={isRecording && !sttBusy ? "mic-pulse" : ""}
        >
          {input.trim() ? <SendHorizontal size={18} /> : <Mic size={18} />}
        </button>
      </form>
    </div>
  );
}

