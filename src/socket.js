// src/socket.js — 소켓 초기화 (경쟁 핸들러 제거, 순수 연결만 담당)
import { io } from "socket.io-client";

const envSocketUrl = String(import.meta.env.VITE_SOCKET_URL || "").trim();
let WS_ORIGIN =
  window.location.hostname && window.location.protocol.startsWith("https")
    ? `wss://${window.location.host}`
    : `http://127.0.0.1:3174`;
let WS_PATH = "/socket.io/";

if (envSocketUrl) {
  try {
    const parsed = new URL(envSocketUrl);
    WS_ORIGIN = `${parsed.protocol}//${parsed.host}`;
    WS_PATH = parsed.pathname && parsed.pathname !== "/" ? `${parsed.pathname.replace(/\/+$/, "")}/` : "/socket.io/";
  } catch {
    // ignore invalid env URL and use defaults
  }
}

const socket = io(WS_ORIGIN, {
  path: WS_PATH,
  transports: ["websocket", "polling"],
  upgrade: true,
  withCredentials: false,
  autoConnect: true,
  forceNew: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 20000,
  pingInterval: 25000,
  pingTimeout: 20000,
});

export default socket;
