// src/audio/ttsPlayer.js — TTS playback abstraction layer
// Handles: queue management, room-aware cancellation, mode-aware playback

let audioCtx = null;
let currentSource = null;
let currentRoomId = null;
const queue = [];
let playing = false;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/** Unlock AudioContext (must be called on user gesture) */
export function unlockAudio() {
  const ctx = getCtx();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

/** Set current active room. Cancels playback if room changed. */
export function setActiveRoom(roomId) {
  if (currentRoomId !== roomId) {
    cancelAll();
  }
  currentRoomId = roomId;
}

/** Cancel all queued and playing TTS */
export function cancelAll() {
  queue.length = 0;
  if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource = null;
  }
  playing = false;
}

/**
 * Enqueue a TTS audio buffer for playback.
 * @param {ArrayBuffer} audioBuffer - raw audio data (mp3/ogg)
 * @param {string} roomId - which room this audio belongs to
 * @param {Object} [options]
 * @param {string} [options.senderPid] - who sent this
 */
export function enqueueTts(audioBuffer, roomId, options = {}) {
  // Discard if not for the active room
  if (roomId !== currentRoomId) return;
  queue.push({ audioBuffer, roomId, ...options });
  playNext();
}

async function playNext() {
  if (playing) return;
  const next = queue.shift();
  if (!next) return;

  // Skip if room has changed
  if (next.roomId !== currentRoomId) {
    playNext();
    return;
  }

  const ctx = getCtx();
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return; }
  }

  try {
    playing = true;
    const decoded = await ctx.decodeAudioData(next.audioBuffer);
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    currentSource = src;
    src.onended = () => {
      currentSource = null;
      playing = false;
      // 300ms pause between segments (TTS prosody rule)
      setTimeout(playNext, 300);
    };
    src.start(0);
  } catch (e) {
    console.warn("[ttsPlayer] decode error:", e);
    playing = false;
    currentSource = null;
    playNext();
  }
}

/** Check if TTS is currently playing */
export function isPlaying() {
  return playing;
}

/** Get queue length */
export function queueLength() {
  return queue.length;
}

export default {
  unlockAudio,
  setActiveRoom,
  cancelAll,
  enqueueTts,
  isPlaying,
  queueLength,
};
