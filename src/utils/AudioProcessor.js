// AudioProcessor.js
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
    this.vad = {
      threshold: typeof vad.threshold === "number" ? vad.threshold : 0.01,
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
