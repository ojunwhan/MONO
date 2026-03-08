/**
 * useVADPipeline — Silero VAD 기반 자동 음성 감지 + 서버 STT 파이프라인
 *
 * 경로: stt:open → stt:audio → stt:segment_end
 *       → server.js transcribePcm16 → fastTranslate → hqTranslate → receive-message
 *
 * MicButton.jsx를 수정하지 않고, 동일한 서버 파이프라인을 사용합니다.
 */
import { useMicVAD } from "@ricky0123/vad-react";
import { useRef, useCallback } from "react";
import socket from "../socket";

// ─── Float32Array → Int16 PCM 변환 (정밀도 최대) ───
function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return int16;
}

// ─── Int16Array → base64 변환 ───
function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 24000샘플(1.5초 @16kHz) 단위 청크 분할 — server.js 기존 청크 크기와 동일
const CHUNK_SIZE = 24000;

/**
 * @param {{ roomId: string, participantId: string, lang: string }} opts
 */
export function useVADPipeline({ roomId, participantId, lang }) {
  const sessionActiveRef = useRef(false);

  const sendAudioToServer = useCallback(
    (audioFloat32) => {
      if (!roomId || !participantId || !lang) return;

      // 1. stt:open — 세션 등록 (server.js STT_SESSIONS.set)
      socket.emit("stt:open", {
        roomId,
        participantId,
        lang,
        sampleRateHz: 16000,
      });

      // 2. Float32 → Int16 PCM 변환
      const int16 = float32ToInt16(audioFloat32);

      // 3. CHUNK_SIZE 단위로 분할 전송 (stt:audio)
      for (let offset = 0; offset < int16.length; offset += CHUNK_SIZE) {
        const chunk = int16.slice(offset, offset + CHUNK_SIZE);
        const base64 = int16ToBase64(chunk);
        socket.emit("stt:audio", {
          roomId,
          participantId,
          lang,
          audio: base64,
          sampleRateHz: 16000,
        });
      }

      // 4. 전송 완료 신호 → server.js 풀파이프라인 시작
      //    transcribePcm16() → fastTranslate → hqTranslate → receive-message
      socket.emit("stt:segment_end", {
        roomId,
        participantId,
      });
    },
    [roomId, participantId, lang]
  );

  const vad = useMicVAD({
    startOnLoad: false,

    // ─── ONNX/WASM/모델 파일 경로 (dist 루트에서 서빙) ───
    baseAssetPath: "/",
    onnxWASMBasePath: "/",

    onSpeechStart: () => {
      sessionActiveRef.current = true;
    },

    onSpeechEnd: (audioFloat32) => {
      if (!sessionActiveRef.current) return;
      sessionActiveRef.current = false;

      // RMS 저음량 필터 (환각 방지 — server.js 기존 정책과 동일)
      const rms = Math.sqrt(
        audioFloat32.reduce((sum, v) => sum + v * v, 0) / audioFloat32.length
      );
      if (rms < 0.01) return;

      // 최소 녹음 길이 필터 (0.5초 미만 폐기 — 16kHz 기준 8000샘플)
      if (audioFloat32.length < 8000) return;

      sendAudioToServer(audioFloat32);
    },

    // ─── getUserMedia 오디오 옵션 — 에코/노이즈 제거 강제 활성화 ───
    additionalAudioConstraints: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 16000,
    },

    // ─── Silero VAD 파라미터 — 조용한 환경(상담실/조사실) 최적화 ───
    positiveSpeechThreshold: 0.5, // 말소리 판정 임계값
    negativeSpeechThreshold: 0.35, // 낮출수록 묵음 감지 예민
    redemptionMs: 600, // 침묵 판정 대기 (~0.6초)
    minSpeechMs: 250, // 최소 발화 길이 (노이즈 제거)
    preSpeechPadMs: 300, // 발화 시작 전 여유분
    submitUserSpeechOnPause: true, // pause 시 진행 중인 발화 전송
  });

  return {
    listening: vad.listening,
    loading: vad.loading,
    userSpeaking: vad.userSpeaking,
    errored: vad.errored,
    start: vad.start,
    pause: vad.pause,
    toggle: vad.toggle,
  };
}
