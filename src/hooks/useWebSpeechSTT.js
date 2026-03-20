import { useRef, useState, useCallback, useEffect } from "react";

/**
 * useWebSpeechSTT — continuous Web Speech API with auto-restart and filtering
 *
 * @param {Object} options
 * @param {string} options.lang — BCP-47 language code (e.g. "ko-KR", "en-US", "ja-JP")
 * @param {boolean} options.active — when true, recognition runs; when false, stops
 * @param {function} options.onFinal — callback(text, confidence) called when a final transcript passes all filters
 * @param {function} options.onInterim — callback(text) called with interim transcript for real-time display
 * @param {number} [options.confidenceThreshold=0.5] — minimum confidence to accept (0-1)
 * @param {number} [options.minTextLength=2] — minimum character length to accept
 * @returns {{ isListening: boolean, interimText: string, error: string|null }}
 */
export function useWebSpeechSTT({
  lang = "ko-KR",
  active = false,
  onFinal,
  onInterim,
  confidenceThreshold = 0.5,
  minTextLength = 2,
}) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const activeRef = useRef(active);
  const restartTimerRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);

  // Keep callback refs fresh without re-creating recognition
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Whisper hallucination patterns — reuse from server logic
  const HALLUCINATION_PATTERNS = useRef([
    /시청해\s*주셔서\s*감사합니다/i,
    /구독과\s*좋아요/i,
    /thanks?\s*for\s*watching/i,
    /please\s*subscribe/i,
    /like\s*and\s*subscribe/i,
    /MBC|SBS|KBS|YTN/i,
    /global\s*village/i,
    /www\./i,
    /\.com/i,
    /자막/i,
    /subtitles?/i,
  ]).current;

  const isHallucination = useCallback((text) => {
    return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
  }, [HALLUCINATION_PATTERNS]);

  const createRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Web Speech API not supported in this browser");
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        const confidence = result[0].confidence;

        if (result.isFinal) {
          // === TRIPLE FILTER ===
          // Filter 1: confidence threshold
          if (confidence > 0 && confidence < confidenceThreshold) {
            console.log(`[WebSpeechSTT] Filtered (low confidence ${confidence.toFixed(2)}): "${transcript}"`);
            continue;
          }
          // Filter 2: min text length
          if (transcript.length < minTextLength) {
            console.log(`[WebSpeechSTT] Filtered (too short ${transcript.length}): "${transcript}"`);
            continue;
          }
          // Filter 3: hallucination patterns
          if (isHallucination(transcript)) {
            console.log(`[WebSpeechSTT] Filtered (hallucination): "${transcript}"`);
            continue;
          }

          console.log(`[WebSpeechSTT] Final (conf=${confidence.toFixed(2)}): "${transcript}"`);
          onFinalRef.current?.(transcript, confidence);
          setInterimText("");
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        setInterimText(interimTranscript);
        onInterimRef.current?.(interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      console.log(`[WebSpeechSTT] Error: ${event.error}`);
      if (event.error === "no-speech") {
        // Normal — just means silence, will auto-restart via onend
        return;
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission denied");
        setIsListening(false);
        return;
      }
      if (event.error === "aborted") {
        // Often happens during restart, ignore
        return;
      }
      setError(event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");

      // Auto-restart if still active (Chrome randomly stops recognition)
      if (activeRef.current) {
        // Clear any existing restart timer
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (activeRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
              console.log("[WebSpeechSTT] Auto-restarted");
            } catch (e) {
              console.log("[WebSpeechSTT] Auto-restart failed:", e.message);
            }
          }
        }, 100);
      }
    };

    return recognition;
  }, [lang, confidenceThreshold, minTextLength, isHallucination]);

  // Main effect: start/stop based on active flag
  useEffect(() => {
    if (active) {
      // Start
      const recognition = createRecognition();
      if (!recognition) return;
      recognitionRef.current = recognition;
      try {
        recognition.start();
        console.log(`[WebSpeechSTT] Started (lang=${lang})`);
      } catch (e) {
        console.log("[WebSpeechSTT] Start failed:", e.message);
      }
    } else {
      // Stop
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore
        }
        recognitionRef.current = null;
      }
      setIsListening(false);
      setInterimText("");
    }

    // Cleanup on unmount
    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [active, lang, createRecognition]);

  return { isListening, interimText, error };
}
