import React, { useEffect, useRef } from "react";

export default function AudioWaveform({ stream, isActive, height = 40 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const smoothRef = useRef([]);

  useEffect(() => {
    if (!isActive || !stream || !canvasRef.current) return undefined;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return undefined;

    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    sourceRef.current = source;
    analyserRef.current = analyser;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 240;
    const h = Math.max(20, height);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    const barCount = 38;
    const barW = 3;
    const gap = 2;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    smoothRef.current = new Array(barCount).fill(0);

    const draw = () => {
      if (!analyserRef.current || !canvasRef.current) return;
      analyserRef.current.getByteFrequencyData(freq);
      const cw = canvas.clientWidth || width;
      const ch = h;
      const total = barCount * barW + (barCount - 1) * gap;
      const startX = Math.max(0, (cw - total) / 2);
      const centerY = ch / 2;
      const maxHalf = ch * 0.4;
      const minHalf = 1.5;

      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = "#3B82F6";

      for (let i = 0; i < barCount; i++) {
        const bin = Math.floor((i / barCount) * freq.length);
        const v = (freq[bin] || 0) / 255;
        const target = minHalf + v * (maxHalf - minHalf);
        const prev = smoothRef.current[i] || minHalf;
        const next = prev + (target - prev) * 0.28;
        smoothRef.current[i] = next;

        const x = startX + i * (barW + gap);
        const y = centerY - next;
        const hBar = Math.max(3, next * 2);
        const r = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + hBar - r);
        ctx.quadraticCurveTo(x + barW, y + hBar, x + barW - r, y + hBar);
        ctx.lineTo(x + r, y + hBar);
        ctx.quadraticCurveTo(x, y + hBar, x, y + hBar - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try { sourceRef.current?.disconnect?.(); } catch {}
      try { analyserRef.current?.disconnect?.(); } catch {}
      sourceRef.current = null;
      analyserRef.current = null;
      smoothRef.current = [];
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [stream, isActive, height]);

  return <canvas ref={canvasRef} className="w-full block" style={{ height }} aria-hidden="true" />;
}

