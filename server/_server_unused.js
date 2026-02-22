const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
require('dotenv').config();

const PORT = process.env.PORT || 3174;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ─────────────────────────────────────────────────────────────
// In‑Memory Stores (무기록: 본문은 저장 안함)
// ─────────────────────────────────────────────────────────────
const ROOMS = new Map();
// roomId -> { ownerToken, createdAt, ttlSec, isPublic }

function roomAlive(room) {
  if (!room) return false;
  const ageSec = (Date.now() - room.createdAt) / 1000;
  return ageSec < room.ttlSec;
}

// 일정 주기로 만료 방 정리
setInterval(() => {
  for (const [id, r] of ROOMS.entries()) {
    if (!roomAlive(r)) ROOMS.delete(id);
  }
}, 60 * 1000);

// ─────────────────────────────────────────────────────────────
// Auth: 게스트 1회 세션 (HttpOnly Cookie)
// ─────────────────────────────────────────────────────────────
app.post('/api/auth/guest', (req, res) => {
  const guestId = uuidv4();
  res.cookie('guest_session_id', guestId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true
  });
  res.json({ ok: true, guestId });
});

// 설치 사용자 식별(로컬 토큰) — 없으면 발급
app.post('/api/auth/owner', (req, res) => {
  let token = req.cookies['owner_token'];
  if (!token) {
    token = uuidv4();
    res.cookie('owner_token', token, { httpOnly: true, sameSite: 'lax', secure: true });
  }
  res.json({ ok: true, ownerToken: token });
});

// ─────────────────────────────────────────────────────────────
// 방 생성 / QR
// ─────────────────────────────────────────────────────────────
app.post('/api/rooms', async (req, res) => {
  const ownerToken = req.cookies['owner_token'] || uuidv4();
  if (!req.cookies['owner_token']) {
    res.cookie('owner_token', ownerToken, { httpOnly: true, sameSite: 'lax', secure: true });
  }

  const { ttlSec = 24 * 3600, isPublic = true } = req.body || {};
  const roomId = uuidv4().slice(0, 8);
  ROOMS.set(roomId, { ownerToken, createdAt: Date.now(), ttlSec, isPublic });

  const origin = req.headers['x-forwarded-proto'] && req.headers['x-forwarded-host']
    ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`
    : `http://localhost:${PORT}`;

  const inviteUrl = `${origin}/join/${roomId}`;
  const qrDataUrl = await QRCode.toDataURL(inviteUrl, { margin: 1, scale: 6 });

  res.json({ ok: true, roomId, inviteUrl, qrDataUrl, ttlSec });
});

app.get('/api/rooms/:roomId/validate', (req, res) => {
  const { roomId } = req.params;
  const room = ROOMS.get(roomId);
  if (!room || !roomAlive(room)) return res.status(404).json({ ok: false });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Socket.IO (릴레이 전용 — 본문 저장 없음)
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, user }) => {
    const room = ROOMS.get(roomId);
    if (!roomAlive(room)) return socket.emit('room-closed');
    socket.join(roomId);
    io.to(roomId).emit('presence', { type: 'join', user, at: Date.now() });
  });

  socket.on('leave-room', ({ roomId, user }) => {
    socket.leave(roomId);
    io.to(roomId).emit('presence', { type: 'leave', user, at: Date.now() });
  });

  socket.on('message', ({ roomId, from, payload }) => {
    // 번역/자막 등은 클라에서 처리 후 릴레이만
    socket.to(roomId).emit('message', { from, payload, at: Date.now() });
  });

  socket.on('disconnecting', () => {
    // 방별 presence 알림은 클라가 leave-room 호출하는 쪽을 권장
  });
});

// ─────────────────────────────────────────────────────────────
// 정적 서빙 (Vite build 결과)
// ─────────────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Mr.O server listening on :${PORT}`);
});