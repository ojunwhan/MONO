// AudioProcessor.js

/**
 * Map localStorage "mono.mic.sensitivity" (0~100, default 60)
 * to a VAD threshold.  Higher sensitivity → lower threshold.
 *   0   → threshold 0.05  (barely picks up anything)
 *   50  → threshold 0.01  (default, balanced)
 *   100 → threshold 0.002 (very sensitive)
 */
function getMicThresholdFromSettings(fallback = 0.008) {
  try {
    const raw = localStorage.getItem("mono.mic.sensitivity");
    if (raw === null) return fallback;
    const val = Number(raw);
    if (Number.isNaN(val)) return fallback;
    const clamped = Math.max(0, Math.min(100, val));
    // Linear interpolation on a log scale
    // 0 → 0.05,  50 → 0.01,  100 → 0.002
    const logMin = Math.log(0.002);
    const logMax = Math.log(0.05);
    return Math.exp(logMax + (logMin - logMax) * (clamped / 100));
  } catch {
    return fallback;
  }
}

export default class AudioProcessor {
  constructor({
    onAudio,
    onSpeechStart,
    onSpeechEnd,
    onRms,
    sampleRate = 16000,
    vad = {},
  }) {
    this.onAudio = onAudio;
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onRms = onRms;
    this.sampleRate = sampleRate;
    const userThreshold = getMicThresholdFromSettings(0.008);
    this.vad = {
      threshold: typeof vad.threshold === "number" ? vad.threshold : userThreshold,
      minSpeechMs: typeof vad.minSpeechMs === "number" ? vad.minSpeechMs : 120,
      silenceMsToStop: typeof vad.silenceMsToStop === "number" ? vad.silenceMsToStop : 2000,
    };

    this.audioContext = null;
    this.processor = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.silentGain = null;
  }

  async start(stream) {
    if (this.audioContext) return;
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    // Mobile browsers may start AudioContext in suspended state until explicit resume.
    if (this.audioContext.state === "suspended") {
      try { await this.audioContext.resume(); } catch {}
    }
    this.mediaStream = stream;
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    const workletUrl = new URL("../audio/vad-processor.js", import.meta.url);
    await this.audioContext.audioWorklet.addModule(workletUrl);

    this.processor = new AudioWorkletNode(this.audioContext, "vad-processor", {
      processorOptions: {
        threshold: this.vad.threshold,
        minSpeechMs: this.vad.minSpeechMs,
        silenceMsToStop: this.vad.silenceMsToStop,
      },
    });

    this.processor.port.onmessage = (event) => {
      const { type, pcm, value } = event.data || {};
      if (type === "audio" && pcm) {
        this.onAudio?.(pcm);
      } else if (type === "speech_start") {
        this.onSpeechStart?.();
      } else if (type === "speech_end") {
        this.onSpeechEnd?.();
      } else if (type === "rms") {
        this.onRms?.(value);
      }
    };

    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.sourceNode.connect(this.processor).connect(this.silentGain).connect(this.audioContext.destination);
    if (this.audioContext.state === "suspended") {
      try { await this.audioContext.resume(); } catch {}
    }
  }

  stop() {
    try { this.processor?.disconnect(); } catch {}
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.silentGain?.disconnect(); } catch {}
    try { this.mediaStream?.getTracks()?.forEach((t) => t.stop()); } catch {}
    try { this.audioContext?.close(); } catch {}

    this.processor = null;
    this.sourceNode = null;
    this.silentGain = null;
    this.mediaStream = null;
    this.audioContext = null;
  }
}
