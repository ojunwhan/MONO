class VADProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.threshold = typeof opts.threshold === "number" ? opts.threshold : 0.01;
    this.minSpeechMs = typeof opts.minSpeechMs === "number" ? opts.minSpeechMs : 120;
    this.silenceMsToStop = typeof opts.silenceMsToStop === "number" ? opts.silenceMsToStop : 600;
    this.sampleRate = sampleRate;

    this.inSpeech = false;
    this.speechSamples = 0;
    this.silenceSamples = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const speaking = rms >= this.threshold;

    // Reliability-first: always stream PCM while recording so quiet voices
    // or threshold misses do not result in zero STT payload.
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage({ type: "audio", pcm }, [pcm.buffer]);

    if (speaking) {
      if (!this.inSpeech) {
        this.inSpeech = true;
        this.speechSamples = 0;
        this.silenceSamples = 0;
        this.port.postMessage({ type: "speech_start" });
      }

      this.speechSamples += input.length;
    } else if (this.inSpeech) {
      this.silenceSamples += input.length;
      const minSpeechSamples = Math.floor((this.minSpeechMs / 1000) * this.sampleRate);
      const silenceStopSamples = Math.floor((this.silenceMsToStop / 1000) * this.sampleRate);

      if (this.speechSamples >= minSpeechSamples && this.silenceSamples >= silenceStopSamples) {
        this.inSpeech = false;
        this.speechSamples = 0;
        this.silenceSamples = 0;
        this.port.postMessage({ type: "speech_end" });
      }
    }

    this.port.postMessage({ type: "rms", value: rms });
    return true;
  }
}

registerProcessor("vad-processor", VADProcessor);
