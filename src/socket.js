// src/socket.js — 소켓 초기화 (경쟁 핸들러 제거, 순수 연결만 담당)
import { io } from "socket.io-client";

const WS_ORIGIN =
  window.location.hostname && window.location.protocol.startsWith("https")
    ? `wss://${window.location.host}`
    : `http://127.0.0.1:3174`;

const WS_PATH = "/socket.io";

const socket = io(WS_ORIGIN, {
  path: `${WS_PATH}/`,
  transports: ["websocket"],
  upgrade: false,
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
  pingTimeout: 10000,
});

export default socket;
