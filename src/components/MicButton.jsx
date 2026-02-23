import React, { useEffect, useRef, useState } from "react";
import AudioProcessor from "../utils/AudioProcessor";
import socket from "../socket";

export default function MicButton({
  roomId,
  participantId,
  lang = "auto",
  onListeningChange,
  onUserGesture,
}) {
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState(false);
  const processorRef = useRef(null);
  const hasAudioRef = useRef(false);

  useEffect(() => {
    return () => {
      hasAudioRef.current = false;
      processorRef.current?.stop();
      processorRef.current = null;
    };
  }, []);

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

  const startCapture = async () => {
    onUserGesture?.();
    const devId = await getPreferredDeviceId();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: devId ? { exact: devId } : undefined,
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    try {
      const track = stream.getAudioTracks?.()[0];
      console.log("[MONO] ✅ Microphone access granted");
      console.log("[MONO] Audio tracks:", stream.getAudioTracks?.().length || 0);
      console.log("[MONO] Track state:", track?.readyState || "unknown");
    } catch {}

    processorRef.current = new AudioProcessor({
      onAudio: (pcm) => {
        if (!roomId || !participantId) return;
        hasAudioRef.current = true;
        const audio = int16ToBase64(pcm);
        console.log("[MONO] Audio data sent, size:", audio?.length || 0);
        socket.emit("stt:audio", { roomId, participantId, lang, audio, sampleRateHz: 16000 });
      },
    });

    await processorRef.current.start(stream);
  };

  const stopCapture = () => {
    // Send one final segment at stop only (no mid-speech split).
    if (hasAudioRef.current && roomId && participantId) {
      socket.emit("stt:segment_end", { roomId, participantId });
    }
    hasAudioRef.current = false;
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
        await startCapture();
        socket.emit("stt:open", { roomId, participantId, lang, sampleRateHz: 16000 });
      } catch (e) {
        console.error("[MONO] ❌ Microphone access denied:", e?.name, e?.message);
        setListening(false);
        onListeningChange?.(false);
        window.dispatchEvent(new Event("mro:mic:stop"));
      } finally {
        setPending(false);
      }
    } else {
      setPending(true);
      stopCapture();
      socket.emit("stt:close", { roomId, participantId });
      setListening(false);
      onListeningChange?.(false);
      window.dispatchEvent(new Event("mro:mic:stop"));
      window.dispatchEvent(new Event("mro:mic:level:reset"));
      setPending(false);
    }
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={listening}
      disabled={pending}
      className={`w-14 h-14 rounded-full border-0 flex items-center justify-center shadow-md transition-all ${
        pending
          ? "bg-[#9ca3af]"
          : listening
            ? "bg-[#FF3B30] mic-pulse"
            : "bg-[#111111]"
      }`}
      title={listening ? "녹음 중지" : "녹음 시작"}
    >
      {pending ? (
        <span className="text-white text-[16px]">■</span>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="white" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
