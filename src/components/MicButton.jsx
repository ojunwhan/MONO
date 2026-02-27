import React, { useEffect, useRef, useState } from "react";
import AudioProcessor from "../utils/AudioProcessor";
import socket from "../socket";

export default function MicButton({
  roomId,
  participantId,
  lang = "auto",
  onListeningChange,
  onUserGesture,
  onSpeechInterim,
  onSpeechFinal,
  compact = false,
  className = "",
}) {
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState(false);
  const processorRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaMimeTypeRef = useRef("audio/webm");
  const recognitionRef = useRef(null);
  const usingWebSpeechRef = useRef(false);
  const usingMediaRecorderRef = useRef(false);
  const listeningRef = useRef(false);
  const webSpeechCommittedRef = useRef("");
  const webSpeechInterimRef = useRef("");
  const webSpeechFinalByIndexRef = useRef(new Map());
  const webSpeechManualStopRef = useRef(false);
  const webSpeechEmittedRef = useRef(false);
  const webSpeechRestartTimerRef = useRef(null);
  const hasAudioRef = useRef(false);
  const pcmChunksRef = useRef([]);
  const pcmSamplesRef = useRef(0);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    return () => {
      hasAudioRef.current = false;
      try { mediaRecorderRef.current?.stop?.(); } catch {}
      try { mediaStreamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      if (webSpeechRestartTimerRef.current) {
        clearTimeout(webSpeechRestartTimerRef.current);
        webSpeechRestartTimerRef.current = null;
      }
      try { recognitionRef.current?.stop?.(); } catch {}
      recognitionRef.current = null;
      processorRef.current?.stop();
      processorRef.current = null;
    };
  }, []);

  const getSpeechRecognitionCtor = () =>
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  const toWebSpeechLocale = (code) => {
    const MAP = {
      ko: "ko-KR",
      en: "en-US",
      ja: "ja-JP",
      vi: "vi-VN",
      zh: "zh-CN",
      th: "th-TH",
      id: "id-ID",
      es: "es-ES",
      fr: "fr-FR",
      de: "de-DE",
      pt: "pt-BR",
      ru: "ru-RU",
      ar: "ar-SA",
      hi: "hi-IN",
    };
    const raw = String(code || "").trim();
    if (!raw || raw === "auto") return "en-US";
    if (MAP[raw]) return MAP[raw];
    const base = raw.split("-")[0].toLowerCase();
    return MAP[base] || raw;
  };

  const getPreferredDeviceId = async () => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("micDeviceId")) || "auto";
    if (!saved || saved === "auto") return undefined;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const ok = devs.some((d) => d.kind === "audioinput" && d.deviceId === saved);
      return ok ? saved : undefined;
    } catch {
      return undefined;
    }
  };

  const int16ToBase64 = (int16) => {
    const u8 = new Uint8Array(int16.buffer);
    let bin = "";
    for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  };

  const getMicStream = async () => {
    const devId = await getPreferredDeviceId();
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: devId ? { exact: devId } : undefined,
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  };

  const startCaptureWorklet = async (stream) => {
    try {
      const track = stream.getAudioTracks?.()[0];
      console.log("[MONO] ✅ Microphone access granted");
      console.log("[MONO] Audio tracks:", stream.getAudioTracks?.().length || 0);
      console.log("[MONO] Track state:", track?.readyState || "unknown");
    } catch {}

    processorRef.current = new AudioProcessor({
      onAudio: (pcm) => {
        if (!roomId || !participantId || !pcm?.length) return;
        // Whisper fallback: keep collecting while mic is on, send only when mic is turned off.
        const copied = new Int16Array(pcm);
        pcmChunksRef.current.push(copied);
        pcmSamplesRef.current += copied.length;
        hasAudioRef.current = true;
      },
    });

    await processorRef.current.start(stream);
  };

  const toBase64FromBlob = async (blob) => {
    const buf = await blob.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  };

  const cleanupMediaRecorder = () => {
    try { mediaStreamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    audioChunksRef.current = [];
    mediaMimeTypeRef.current = "audio/webm";
  };

  const startCaptureMediaRecorder = async (stream) => {
    const candidates = ["audio/webm;codecs=opus", "audio/webm"];
    const mimeType =
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported
        ? candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "audio/webm"
        : "audio/webm";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaMimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";
    mediaRecorderRef.current = recorder;
    mediaStreamRef.current = stream;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e?.data && e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      try {
        const chunks = audioChunksRef.current || [];
        if (chunks.length) {
          const blob = new Blob(chunks, { type: mediaMimeTypeRef.current || "audio/webm" });
          if (blob.size > 0 && roomId && participantId) {
            const audio = await toBase64FromBlob(blob);
            await new Promise((resolve) => {
              socket.emit(
                "stt:whisper",
                {
                  roomId,
                  participantId,
                  lang,
                  audio,
                  mimeType: mediaMimeTypeRef.current || "audio/webm",
                },
                (ack) => {
                  if (ack?.ok && ack?.text) onSpeechFinal?.(String(ack.text).trim());
                  resolve();
                }
              );
            });
          }
        }
      } catch (e) {
        console.warn("[MONO] mobile recorder stop error:", e?.message || e);
      } finally {
        cleanupMediaRecorder();
        setListening(false);
        onListeningChange?.(false);
        window.dispatchEvent(new Event("mro:mic:stop"));
        window.dispatchEvent(new Event("mro:mic:level:reset"));
        setPending(false);
      }
    };

    recorder.start(300);
  };

  const startWebSpeech = async () => {
    onUserGesture?.();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;
    const recognition = new Ctor();
    const isMobile =
      typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    recognition.lang = toWebSpeechLocale(lang);
    // Mobile Chrome can repeatedly re-emit finalized segments in continuous mode.
    // Keep manual-stop UX by auto-restarting onend while button is still active.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    webSpeechCommittedRef.current = "";
    webSpeechInterimRef.current = "";
    webSpeechFinalByIndexRef.current = new Map();
    webSpeechManualStopRef.current = false;
    webSpeechEmittedRef.current = false;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const transcript = String(r?.[0]?.transcript || "").trim();
        if (!transcript) continue;
        if (r.isFinal) {
          webSpeechFinalByIndexRef.current.set(i, transcript);
        }
        else interim += `${transcript} `;
      }
      const committed = Array.from(webSpeechFinalByIndexRef.current.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, txt]) => txt)
        .join(" ")
        .trim();
      webSpeechCommittedRef.current = committed;
      const interimTrimmed = interim.trim();
      webSpeechInterimRef.current = interimTrimmed;
      // Interim is for live preview only; do not accumulate it into final payload.
      onSpeechInterim?.(interimTrimmed);
    };
    recognition.onerror = (e) => {
      console.warn("[MONO] webspeech error:", e?.error || "unknown");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (listeningRef.current && !webSpeechManualStopRef.current) {
        // Browser can end recognition after silence. Keep listening until user taps mic again.
        webSpeechRestartTimerRef.current = setTimeout(() => {
          if (!listeningRef.current || webSpeechManualStopRef.current) {
            // User already stopped — ensure cleanup if not yet done
            if (webSpeechManualStopRef.current && !webSpeechEmittedRef.current) {
              webSpeechEmittedRef.current = true;
              const finalText = String(webSpeechCommittedRef.current || "").trim();
              if (finalText) onSpeechFinal?.(finalText);
            }
            onSpeechInterim?.("");
            setListening(false);
            onListeningChange?.(false);
            window.dispatchEvent(new Event("mro:mic:stop"));
            window.dispatchEvent(new Event("mro:mic:level:reset"));
            setPending(false);
            return;
          }
          try {
            recognition.start();
            recognitionRef.current = recognition;
          } catch {
            // Failed to restart — clean up
            onSpeechInterim?.("");
            setListening(false);
            onListeningChange?.(false);
            window.dispatchEvent(new Event("mro:mic:stop"));
            window.dispatchEvent(new Event("mro:mic:level:reset"));
            setPending(false);
          }
        }, 60);
        return;
      }
      if (webSpeechManualStopRef.current && !webSpeechEmittedRef.current) {
        webSpeechEmittedRef.current = true;
        const finalText = String(webSpeechCommittedRef.current || "").trim();
        if (finalText) onSpeechFinal?.(finalText);
      }
      onSpeechInterim?.("");
      setListening(false);
      onListeningChange?.(false);
      window.dispatchEvent(new Event("mro:mic:stop"));
      window.dispatchEvent(new Event("mro:mic:level:reset"));
      setPending(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    return true;
  };

  const emitBufferedWhisperOnStop = () => {
    if (!hasAudioRef.current || !roomId || !participantId || !pcmSamplesRef.current) return false;
    const total = pcmSamplesRef.current;
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of pcmChunksRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    // Keep each payload under server cap. Dispatch all chunks only after manual stop.
    const maxSamplesPerPacket = 24000; // ~1.5s @16kHz
    for (let i = 0; i < merged.length; i += maxSamplesPerPacket) {
      const slice = merged.subarray(i, Math.min(i + maxSamplesPerPacket, merged.length));
      const audio = int16ToBase64(slice);
      socket.emit("stt:audio", { roomId, participantId, lang, audio, sampleRateHz: 16000 });
    }
    socket.emit("stt:segment_end", { roomId, participantId });
    return true;
  };

  const stopCapture = () => {
    emitBufferedWhisperOnStop();
    hasAudioRef.current = false;
    pcmChunksRef.current = [];
    pcmSamplesRef.current = 0;
    processorRef.current?.stop();
    processorRef.current = null;
  };

  const toggle = async () => {
    if (pending) return;
    if (!listening) {
      setPending(true);
      setListening(true);
      hasAudioRef.current = false;
      onListeningChange?.(true);
      window.dispatchEvent(new Event("mro:mic:start"));
      try {
        const isMobile =
          typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
        const hasWebSpeech =
          "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
        if (!isMobile && hasWebSpeech) {
          usingWebSpeechRef.current = true;
          usingMediaRecorderRef.current = false;
          const started = await startWebSpeech();
          if (!started) throw new Error("webspeech_unavailable");
        } else if (isMobile) {
          usingWebSpeechRef.current = false;
          usingMediaRecorderRef.current = true;
          const stream = await getMicStream();
          await startCaptureMediaRecorder(stream);
        } else {
          usingWebSpeechRef.current = false;
          usingMediaRecorderRef.current = false;
          const stream = await getMicStream();
          await startCaptureWorklet(stream);
          socket.emit("stt:open", { roomId, participantId, lang, sampleRateHz: 16000 });
        }
      } catch (e) {
        console.error("[MONO] ❌ Microphone access denied:", e?.name, e?.message);
        cleanupMediaRecorder();
        setListening(false);
        onListeningChange?.(false);
        window.dispatchEvent(new Event("mro:mic:stop"));
      } finally {
        if (!usingMediaRecorderRef.current) setPending(false);
      }
    } else {
      setPending(true);
      if (usingWebSpeechRef.current) {
        webSpeechManualStopRef.current = true;
        // Clear any pending restart timer first
        if (webSpeechRestartTimerRef.current) {
          clearTimeout(webSpeechRestartTimerRef.current);
          webSpeechRestartTimerRef.current = null;
        }
        if (recognitionRef.current) {
          // Recognition is active → stop() will trigger onend → cleanup happens there
          try { recognitionRef.current.stop(); } catch {}
        } else {
          // Recognition already ended (mobile auto-stop gap) → manual cleanup
          if (!webSpeechEmittedRef.current) {
            webSpeechEmittedRef.current = true;
            const finalText = String(webSpeechCommittedRef.current || "").trim();
            if (finalText) onSpeechFinal?.(finalText);
          }
          onSpeechInterim?.("");
          setListening(false);
          onListeningChange?.(false);
          window.dispatchEvent(new Event("mro:mic:stop"));
          window.dispatchEvent(new Event("mro:mic:level:reset"));
          setPending(false);
        }
      } else if (usingMediaRecorderRef.current) {
        if (webSpeechRestartTimerRef.current) {
          clearTimeout(webSpeechRestartTimerRef.current);
          webSpeechRestartTimerRef.current = null;
        }
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== "inactive") {
          try { recorder.stop(); } catch {}
        } else {
          cleanupMediaRecorder();
          setListening(false);
          onListeningChange?.(false);
          window.dispatchEvent(new Event("mro:mic:stop"));
          window.dispatchEvent(new Event("mro:mic:level:reset"));
          setPending(false);
        }
      } else {
        stopCapture();
        socket.emit("stt:close", { roomId, participantId });
        setListening(false);
        onListeningChange?.(false);
        window.dispatchEvent(new Event("mro:mic:stop"));
        window.dispatchEvent(new Event("mro:mic:level:reset"));
        setPending(false);
      }
    }
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={listening}
      disabled={pending}
      className={`flex items-center justify-center transition-all ${
        compact
          ? `w-10 h-10 rounded-full ${
              pending ? "bg-[#9ca3af]" : listening ? "bg-[#FF3B30] mic-pulse" : "bg-[var(--color-primary)]"
            } ${className}`
          : `w-14 h-14 rounded-full border-0 shadow-md ${
              pending ? "bg-[#9ca3af]" : listening ? "bg-[#FF3B30] mic-pulse" : "bg-[#111111]"
            } ${className}`
      }`}
      title={listening ? "녹음 중지" : "녹음 시작"}
    >
      {pending ? (
        <span className="text-white text-[14px]">■</span>
      ) : (
        <svg width={compact ? "18" : "24"} height={compact ? "18" : "24"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="white" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
