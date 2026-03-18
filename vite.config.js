import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// VAD ONNX/WASM 파일을 dist로 복사하는 커스텀 플러그인
function copyVadAssets() {
  return {
    name: 'copy-vad-assets',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const copies = [
        // ONNX Runtime WASM
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', dest: 'ort-wasm-simd-threaded.wasm' },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', dest: 'ort-wasm-simd-threaded.mjs' },
        // Silero VAD 모델
        { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx', dest: 'silero_vad_legacy.onnx' },
        { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx', dest: 'silero_vad_v5.onnx' },
        // VAD Worklet
        { src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dest: 'vad.worklet.bundle.min.js' },
      ];
      for (const { src, dest } of copies) {
        const srcPath = path.resolve(__dirname, src);
        const destPath = path.resolve(distDir, dest);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log(`[copy-vad-assets] ✅ ${dest}`);
        } else {
          console.warn(`[copy-vad-assets] ⚠ not found: ${src}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    copyVadAssets(),
  ],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 3176}`,
        changeOrigin: true,
      },
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@ricky0123/vad-web'],
  },
});
