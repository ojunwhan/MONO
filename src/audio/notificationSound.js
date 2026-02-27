let audioEl = null;
let audioUnlocked = false;
let lastPlayedAt = 0;
let fallbackCtx = null;

function isNotificationSoundEnabled() {
  try {
    const v = localStorage.getItem("notificationSound");
    if (v === null) {
      const legacy = localStorage.getItem("mono.notif.sound");
      if (legacy === null) return true;
      return legacy !== "0";
    }
    return v !== "0" && v !== "false";
  } catch {
    return true;
  }
}

function ensureAudioElement() {
  if (audioEl) return audioEl;
  const el = new Audio("/sounds/notification.mp3");
  el.preload = "auto";
  el.volume = 0.9;
  audioEl = el;
  return el;
}

function playFallbackBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!fallbackCtx || fallbackCtx.state === "closed") fallbackCtx = new Ctx();
    const ctx = fallbackCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1046;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {}
}

export function initNotificationSound() {
  if (typeof window === "undefined") return;
  ensureAudioElement();
}

export async function unlockNotificationSound() {
  if (audioUnlocked || typeof window === "undefined") return;
  const el = ensureAudioElement();
  try {
    el.muted = true;
    el.currentTime = 0;
    await el.play();
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    audioUnlocked = true;
  } catch {
    // iOS/Safari may still block until a stronger user gesture.
  }
}

export function playNotificationSound() {
  if (typeof window === "undefined") return;
  if (!isNotificationSoundEnabled()) return;
  const now = Date.now();
  if (now - lastPlayedAt < 1000) return; // debounce for burst messages
  lastPlayedAt = now;

  const el = ensureAudioElement();
  try {
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => playFallbackBeep());
    }
  } catch {
    playFallbackBeep();
  }
}

