// ✅ useMicLevel.js (micLevel 상태 노출용으로 확장)
import { useEffect, useRef, useState } from "react";

export default function useMicLevel(stream) {
  const [micLevel, setMicLevel] = useState(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    audioContextRef.current = new AudioContext();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    const analyser = audioContextRef.current.createAnalyser();
    analyser.fftSize = 32;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);

    analyserRef.current = analyser;
    dataArrayRef.current = dataArray;

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
      setMicLevel(parseFloat((avg / 255).toFixed(3))); // 소수점 3자리로 고정
      requestAnimationFrame(tick);
    };
    tick();

    return () => {
      audioContextRef.current.close();
    };
  }, [stream]);

  return micLevel;
}
