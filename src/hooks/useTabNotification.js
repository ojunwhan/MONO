import { useEffect, useRef, useCallback } from "react";

const ORIGINAL_TITLE = document.title;
let notificationCount = 0;

export default function useTabNotification() {
  const audioRef = useRef(null);

  useEffect(() => {
    // Create a short beep sound using AudioContext (no external file needed)
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioRef.current = new AudioCtx();
    } catch (e) { /* no audio support */ }

    const handleVisibility = () => {
      if (!document.hidden) {
        // Tab regained focus — reset title and count
        notificationCount = 0;
        document.title = ORIGINAL_TITLE;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      notificationCount = 0;
      document.title = ORIGINAL_TITLE;
    };
  }, []);

  const notifyNewMessage = useCallback(() => {
    if (!document.hidden) return; // tab is focused, no need
    notificationCount += 1;
    document.title = `(${notificationCount}) 새 메시지 - MONO`;

    // Play a short beep
    try {
      const ctx = audioRef.current;
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (ctx) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch (e) { /* ignore audio errors */ }
  }, []);

  return { notifyNewMessage };
}
