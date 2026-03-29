class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];

    // RMS calculation
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);

    // Buffer raw samples for segment collection
    this.port.postMessage({ rms, samples: Array.from(samples) });
    return true;
  }
}

registerProcessor("vad-processor", VadProcessor);
