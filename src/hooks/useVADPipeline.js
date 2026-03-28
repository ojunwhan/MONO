/**
 * useVADPipeline — Silero VAD 기반 자동 음성 감지 + 서버 STT 파이프라인
 *
 * 경로: stt:open → stt:audio → stt:segment_end
 *       → server.js transcribePcm16 → fastTranslate → hqTranslate → receive-message
 *
 * MicButton.jsx를 수정하지 않고, 동일한 서버 파이프라인을 사용합니다.
 *
 * ■ 원격 감도 조절 지원 (vad:gain:update 소켓 이벤트)
 *   - gain: 소프트웨어 게인 (Float32 오디오에 곱하기)
 *   - vadThreshold: RMS 저음량 필터 임계값
 *   - minSpeechMs: 최소 발화 길이 (ms)
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

// 기본값
const DEFAULT_GAIN = 1.0;
const DEFAULT_VAD_THRESHOLD = 0.01;
const DEFAULT_MIN_SPEECH_MS = 250; // ms → 16kHz 기준 4000 samples

const TARGET_SAMPLE_RATE = 16000;
const SPEECH_THRESHOLD = 0.03;
const SILENCE_THRESHOLD = 0.01;
const SILENCE_FRAMES = 5;

/**
 * @param {{ roomId: string, participantId: string, lang: string, roleHint?: string, deviceId?: string, vadStaffLang?: string, vadPatientLang?: string, onVadListenStart?: () => void, disableServerStt?: boolean }} opts
 */
export function useVADPipeline({
  roomId,
  participantId,
  lang,
  roleHint,
  deviceId,
  vadStaffLang,
  vadPatientLang,
  onVadListenStart,
  disableServerStt = false,
}) {
  const [speechEndTimestamp, setSpeechEndTimestamp] = useState(0);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [errored, setErrored] = useState(false);
  const sessionActiveRef = useRef(false);
  const perfT1Ref = useRef(0); // [PERF] T1 시점 (onSpeechEnd 진입)
  const prevDeviceIdRef = useRef(deviceId);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const workletNodeRef = useRef(null);
  const speechChunksRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const silenceFramesRef = useRef(0);

  const roomIdRef = useRef(roomId);
  const participantIdRef = useRef(participantId);
  const langRef = useRef(lang);
  const vadStaffLangRef = useRef(vadStaffLang);
  const vadPatientLangRef = useRef(vadPatientLang);
  const disableServerSttRef = useRef(disableServerStt);
  const onVadListenStartRef = useRef(onVadListenStart);
  onVadListenStartRef.current = onVadListenStart;

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);
  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    vadStaffLangRef.current = vadStaffLang;
  }, [vadStaffLang]);
  useEffect(() => {
    vadPatientLangRef.current = vadPatientLang;
  }, [vadPatientLang]);
  useEffect(() => {
    disableServerSttRef.current = disableServerStt;
  }, [disableServerStt]);
  // ── 원격 조절 가능한 refs ──
  const gainRef = useRef(DEFAULT_GAIN);
  const vadThresholdRef = useRef(DEFAULT_VAD_THRESHOLD);
  const minSpeechSamplesRef = useRef(Math.round(DEFAULT_MIN_SPEECH_MS * 16)); // ms → samples @16kHz

  // ── vad:gain:update 소켓 리스너 ──
  useEffect(() => {
    const handler = ({ target, gain, vadThreshold, minSpeechMs, roomId: evtRoomId }) => {
      // 이벤트가 현재 방의 것인지 + 나에게 오는 것인지 확인
      if (evtRoomId && evtRoomId !== roomId) return;
      const myRole = roleHint || "guest";
      if (target && target !== myRole) return;

      if (gain !== undefined && gain !== null) {
        gainRef.current = Math.max(0.1, Math.min(5.0, Number(gain) || DEFAULT_GAIN));
      }
      if (vadThreshold !== undefined && vadThreshold !== null) {
        vadThresholdRef.current = Math.max(0.001, Math.min(0.1, Number(vadThreshold) || DEFAULT_VAD_THRESHOLD));
      }
      if (minSpeechMs !== undefined && minSpeechMs !== null) {
        const ms = Math.max(50, Math.min(2000, Number(minSpeechMs) || DEFAULT_MIN_SPEECH_MS));
        minSpeechSamplesRef.current = Math.round(ms * 16); // ms → samples @16kHz
      }
      console.log(`[VAD] gain update: gain=${gainRef.current}, threshold=${vadThresholdRef.current}, minSamples=${minSpeechSamplesRef.current}`);
    };

    socket.on("vad:gain:update", handler);
    return () => socket.off("vad:gain:update", handler);
  }, [roomId, roleHint]);

  const sendAudioToServer = useCallback((audioFloat32) => {
    const rid = roomIdRef.current;
    const pid = participantIdRef.current;
    const lng = langRef.current;
    if (!rid || !pid || !lng) return;

    const staffL = vadStaffLangRef.current;
    const patientL = vadPatientLangRef.current;

    // 1. stt:open — 세션 등록 (server.js STT_SESSIONS.set)
    socket.emit("stt:open", {
      roomId: rid,
      participantId: pid,
      lang: lng,
      sampleRateHz: 16000,
      ...(staffL && { vadStaffLang: staffL }),
      ...(patientL && { vadPatientLang: patientL }),
    });

    // 2. 소프트웨어 게인 적용
    let processed = audioFloat32;
    const currentGain = gainRef.current;
    if (currentGain !== 1.0) {
      processed = new Float32Array(audioFloat32.length);
      for (let i = 0; i < audioFloat32.length; i++) {
        processed[i] = Math.max(-1, Math.min(1, audioFloat32[i] * currentGain));
      }
    }

    // 3. Float32 → Int16 PCM 변환
    const int16 = float32ToInt16(processed);

    // 4. CHUNK_SIZE 단위로 분할 전송 (stt:audio)
    for (let offset = 0; offset < int16.length; offset += CHUNK_SIZE) {
      const chunk = int16.slice(offset, offset + CHUNK_SIZE);
      const base64 = int16ToBase64(chunk);
      socket.emit("stt:audio", {
        roomId: rid,
        participantId: pid,
        lang: lng,
        audio: base64,
        sampleRateHz: 16000,
      });
    }

    // 5. 전송 완료 신호 → server.js 풀파이프라인 시작
    //    transcribePcm16() → fastTranslate → hqTranslate → receive-message
    // [PERF] T2: stt:segment_end emit 직전
    const t1 = perfT1Ref.current;
    console.log(`[PERF] T2 segment_end sent | VAD→Send: ${Date.now() - t1}ms`);
    socket.emit("stt:segment_end", {
      roomId: rid,
      participantId: pid,
    });
  }, []);

  const onSpeechStartStable = useCallback(() => {
    sessionActiveRef.current = true;
    setUserSpeaking(true);
  }, []);

  const onSpeechEndStable = useCallback(
    (audioFloat32) => {
      const t1 = Date.now(); // [PERF] T1: VAD 발화종료 감지
      console.log("[PERF] T1 VAD speech end detected");
      if (!sessionActiveRef.current) return;
      sessionActiveRef.current = false;
      setUserSpeaking(false);
      perfT1Ref.current = t1;

      // RMS 저음량 필터 (환각 방지) — 원격 조절 가능
      const rms = Math.sqrt(
        audioFloat32.reduce((sum, v) => sum + v * v, 0) / audioFloat32.length
      );
      if (rms < vadThresholdRef.current) return;

      // 최소 녹음 길이 필터 — 원격 조절 가능
      if (audioFloat32.length < minSpeechSamplesRef.current) return;

      setSpeechEndTimestamp(Date.now());

      if (disableServerSttRef.current) {
        console.log("[VAD] Speech segment passed filters (server STT disabled)");
        return;
      }
      sendAudioToServer(audioFloat32);
    },
    [sendAudioToServer]
  );

  const resampleTo16kHz = useCallback((input, fromSampleRate) => {
    if (!input?.length) return new Float32Array(0);
    if (fromSampleRate === TARGET_SAMPLE_RATE) return new Float32Array(input);
    const ratio = TARGET_SAMPLE_RATE / fromSampleRate;
    const newLength = Math.max(1, Math.round(input.length * ratio));
    const output = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i / ratio;
      const i0 = Math.floor(srcIndex);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = srcIndex - i0;
      output[i] = input[i0] + (input[i1] - input[i0]) * frac;
    }
    return output;
  }, []);

  const calcRms = useCallback((samples) => {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }, []);

  const teardownAudio = useCallback(async () => {
    try {
      if (workletNodeRef.current) workletNodeRef.current.disconnect();
    } catch {}
    try {
      if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    } catch {}
    try {
      if (streamRef.current) {
        streamRef.current.getTracks?.().forEach((t) => t.stop());
      }
    } catch {}
    try {
      if (audioContextRef.current) await audioContextRef.current.close();
    } catch {}

    workletNodeRef.current = null;
    sourceNodeRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    speechChunksRef.current = [];
    isSpeakingRef.current = false;
    silenceFramesRef.current = 0;
    setUserSpeaking(false);
    setListening(false);
  }, []);

  const start = useCallback(() => {
    console.log("[VAD][diag] start() called", { listening, loading, errored });
    onVadListenStartRef.current?.();
    const ret = (async () => {
      await teardownAudio();
      setLoading(true);
      setErrored(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const audioContext = new AudioContext();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const workletCode = `
class VadProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    this.port.postMessage({ rms, samples: Array.from(samples) });
    return true;
  }
}
registerProcessor('vad-processor', VadProcessor);
`;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      const workletNode = new AudioWorkletNode(audioContext, "vad-processor");

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        const { samples } = event.data;
        const input = Float32Array.from(samples);
        const resampled = resampleTo16kHz(input, audioContext.sampleRate);
        const rms = calcRms(resampled);

        if (!isSpeakingRef.current) {
          if (rms >= SPEECH_THRESHOLD) {
            isSpeakingRef.current = true;
            silenceFramesRef.current = 0;
            speechChunksRef.current = [resampled];
            onSpeechStartStable();
          }
          return;
        }

        speechChunksRef.current.push(resampled);
        if (rms < SILENCE_THRESHOLD) {
          silenceFramesRef.current += 1;
        } else {
          silenceFramesRef.current = 0;
        }

        if (silenceFramesRef.current >= SILENCE_FRAMES) {
          const chunks = speechChunksRef.current;
          let totalLength = 0;
          for (let i = 0; i < chunks.length; i++) totalLength += chunks[i].length;
          const merged = new Float32Array(totalLength);
          let offset = 0;
          for (let i = 0; i < chunks.length; i++) {
            merged.set(chunks[i], offset);
            offset += chunks[i].length;
          }
          speechChunksRef.current = [];
          isSpeakingRef.current = false;
          silenceFramesRef.current = 0;
          onSpeechEndStable(merged);
        }
      };

      sourceNode.connect(workletNode);
      workletNode.connect(audioContext.destination);
      setListening(true);
      setLoading(false);
      return true;
    })();
    if (ret?.then) {
      ret
        .then(() => {
          console.log("[VAD][diag] start() resolved", { listening: true, loading: false, errored: false });
        })
        .catch((err) => {
          setLoading(false);
          setErrored(err?.message || String(err) || "VAD start failed");
          console.warn("[VAD][diag] start() rejected", { err: err?.message || err, listening: false });
        });
    } else {
      console.log("[VAD][diag] start() returned (non-promise)", { listening, loading, errored });
    }
    return ret;
  }, [listening, loading, errored, deviceId, teardownAudio, resampleTo16kHz, calcRms, onSpeechStartStable, onSpeechEndStable]);

  const pause = useCallback(async () => {
    await teardownAudio();
  }, [teardownAudio]);

  const toggle = useCallback(() => {
    if (listening) return pause();
    return start();
  }, [listening, pause, start]);

  useEffect(() => {
    if (prevDeviceIdRef.current !== deviceId && listening) {
      console.log("[VAD][diag] device change restart: pause() before", {
        prevDeviceId: prevDeviceIdRef.current,
        nextDeviceId: deviceId,
        listening,
        loading,
        errored,
      });
      pause();
      console.log("[VAD][diag] device change restart: pause() after", { listening, loading, errored });
      onVadListenStartRef.current?.();
      console.log("[VAD][diag] device change restart: start() before", { listening, loading, errored });
      const restartRet = start();
      if (restartRet?.then) {
        restartRet
          .then(() => {
            console.log("[VAD][diag] device change restart: start() resolved", { listening: true, loading: false, errored: false });
          })
          .catch((err) => {
            console.warn("[VAD][diag] device change restart: start() rejected", {
              err: err?.message || err,
              listening: false,
              loading,
              errored: err?.message || err,
            });
          });
      } else {
        console.log("[VAD][diag] device change restart: start() returned (non-promise)", {
          listening: false,
          loading,
          errored,
        });
      }
    }
    prevDeviceIdRef.current = deviceId;
  }, [deviceId, listening, loading, errored, pause, start]);

  useEffect(() => {
    return () => {
      teardownAudio();
    };
  }, [teardownAudio]);

  return {
    listening,
    loading,
    userSpeaking,
    errored,
    start,
    pause,
    toggle,
    speechEndTimestamp,
    // 현재 감도 설정값 읽기 (UI 표시용)
    gainRef,
    vadThresholdRef,
    minSpeechSamplesRef,
  };
}
