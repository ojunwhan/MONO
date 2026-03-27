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
import { useMicVAD } from "@ricky0123/vad-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Stable reference for useMicVAD — avoid new object each render */
const ADDITIONAL_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000,
};

/** Silero VAD params — stable reference */
const MIC_VAD_SILERO_OPTIONS = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 350,
  minSpeechMs: 250,
  preSpeechPadMs: 300,
  submitUserSpeechOnPause: true,
};

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
  const sessionActiveRef = useRef(false);
  const perfT1Ref = useRef(0); // [PERF] T1 시점 (onSpeechEnd 진입)
  const prevDeviceIdRef = useRef(deviceId);
  const prewarmedStreamRef = useRef(null);

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
  }, []);

  const onSpeechEndStable = useCallback(
    (audioFloat32) => {
      const t1 = Date.now(); // [PERF] T1: VAD 발화종료 감지
      console.log("[PERF] T1 VAD speech end detected");
      if (!sessionActiveRef.current) return;
      sessionActiveRef.current = false;
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

  const micVadOptions = useMemo(
    () => ({
      startOnLoad: false,
      getStream: async () => {
        console.log('[VAD][diag] getStream called, deviceId:', deviceId);
        if (prewarmedStreamRef.current) {
          return prewarmedStreamRef.current;
        }
        return navigator.mediaDevices.getUserMedia({
          audio: {
            ...ADDITIONAL_AUDIO_CONSTRAINTS,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
        });
      },

      processorType: "ScriptProcessor",
      ortConfig: (ort) => {
        ort.env.logLevel = "error";
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
      },

      // ─── ONNX/WASM/모델 파일 경로 (dist 루트에서 서빙) ───
      baseAssetPath: "/",
      onnxWASMBasePath: "/",

      onSpeechStart: onSpeechStartStable,

      onSpeechEnd: onSpeechEndStable,

      ...MIC_VAD_SILERO_OPTIONS,
    }),
    [onSpeechStartStable, onSpeechEndStable, deviceId]
  );

  const vad = useMicVAD(micVadOptions);

  const stopPrewarmedStream = useCallback(() => {
    const stream = prewarmedStreamRef.current;
    if (!stream) return;
    stream.getTracks?.().forEach((track) => track.stop());
    prewarmedStreamRef.current = null;
  }, []);

  const preparePrewarmedStream = useCallback(async () => {
    stopPrewarmedStream();
    prewarmedStreamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...ADDITIONAL_AUDIO_CONSTRAINTS,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
  }, [deviceId, stopPrewarmedStream]);

  const start = useCallback(() => {
    console.log("[VAD][diag] start() called", { listening: vad.listening, loading: vad.loading, errored: vad.errored });
    onVadListenStartRef.current?.();
    const ret = (async () => {
      await preparePrewarmedStream();
      return vad.start();
    })();
    if (ret?.then) {
      ret
        .then(() => {
          console.log("[VAD][diag] start() resolved", { listening: vad.listening, loading: vad.loading, errored: vad.errored });
        })
        .catch((err) => {
          console.warn("[VAD][diag] start() rejected", { err: err?.message || err, listening: vad.listening, loading: vad.loading, errored: vad.errored });
        });
    } else {
      console.log("[VAD][diag] start() returned (non-promise)", { listening: vad.listening, loading: vad.loading, errored: vad.errored });
    }
    return ret;
  }, [vad.start, preparePrewarmedStream]);

  useEffect(() => {
    if (prevDeviceIdRef.current !== deviceId && vad.listening) {
      console.log("[VAD][diag] device change restart: pause() before", {
        prevDeviceId: prevDeviceIdRef.current,
        nextDeviceId: deviceId,
        listening: vad.listening,
        loading: vad.loading,
        errored: vad.errored,
      });
      vad.pause();
      stopPrewarmedStream();
      console.log("[VAD][diag] device change restart: pause() after", { listening: vad.listening, loading: vad.loading, errored: vad.errored });
      onVadListenStartRef.current?.();
      console.log("[VAD][diag] device change restart: start() before", { listening: vad.listening, loading: vad.loading, errored: vad.errored });
      const restartRet = (async () => {
        await preparePrewarmedStream();
        return vad.start();
      })();
      if (restartRet?.then) {
        restartRet
          .then(() => {
            console.log("[VAD][diag] device change restart: start() resolved", { listening: vad.listening, loading: vad.loading, errored: vad.errored });
          })
          .catch((err) => {
            console.warn("[VAD][diag] device change restart: start() rejected", {
              err: err?.message || err,
              listening: vad.listening,
              loading: vad.loading,
              errored: vad.errored,
            });
          });
      } else {
        console.log("[VAD][diag] device change restart: start() returned (non-promise)", {
          listening: vad.listening,
          loading: vad.loading,
          errored: vad.errored,
        });
      }
    }
    prevDeviceIdRef.current = deviceId;
  }, [deviceId, preparePrewarmedStream, stopPrewarmedStream]);

  useEffect(() => {
    return () => {
      stopPrewarmedStream();
    };
  }, [stopPrewarmedStream]);

  return {
    listening: vad.listening,
    loading: vad.loading,
    userSpeaking: vad.userSpeaking,
    errored: vad.errored,
    start,
    pause: vad.pause,
    toggle: vad.toggle,
    speechEndTimestamp,
    // 현재 감도 설정값 읽기 (UI 표시용)
    gainRef,
    vadThresholdRef,
    minSpeechSamplesRef,
  };
}
