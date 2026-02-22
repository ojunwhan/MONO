// src/media/getMic.js (새 파일)
let cachedStream = null;
export async function getMicOnce() {
  if (cachedStream) return cachedStream;
  cachedStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true }
  });
  return cachedStream;
}
