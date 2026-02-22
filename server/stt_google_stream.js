// server/stt_google_stream.js (CJS)
const { SpeechClient } = require("@google-cloud/speech");

function bindGoogleSTT(io) {
  io.on("connection", (s) => {
    let sttStream = null;
    const client = new SpeechClient(); // GOOGLE_APPLICATION_CREDENTIALS로 인증

    function startStream({ lang = "ko-KR", sampleRateHz = 16000 } = {}) {
      if (sttStream) { try { sttStream.end(); } catch {} sttStream = null; }

      sttStream = client
        .streamingRecognize({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: sampleRateHz,
            languageCode: lang,
            enableAutomaticPunctuation: true,
            model: "latest_short",
          },
          interimResults: true,
        })
        .on("error", () => { /* 필요시 로깅 */ })
        .on("data", (data) => {
          const r = data.results?.[0];
          const alt = r?.alternatives?.[0];
          if (alt?.transcript) {
            s.emit("stt:result", { text: alt.transcript, final: !!r?.isFinal });
          }
        });

      s.emit("stt:ready");
    }

    s.on("stt:start", (opts) => startStream(opts));
    s.on("stt:audio", ({ chunkBase64 }) => {
      if (sttStream && chunkBase64) {
        sttStream.write({ audioContent: Buffer.from(chunkBase64, "base64") });
      }
    });
    s.on("stt:stop", () => {
      if (sttStream) { try { sttStream.end(); } catch {} sttStream = null; }
    });
    s.on("disconnect", () => {
      if (sttStream) { try { sttStream.end(); } catch {} sttStream = null; }
    });
  });
}

module.exports = { bindGoogleSTT };
