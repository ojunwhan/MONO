const { io } = require("socket.io-client");

const SERVER = process.env.SIM_SERVER || "http://127.0.0.1:3174";
const USER_COUNT = Number(process.env.SIM_USERS || 10);
const DURATION_MS = Number(process.env.SIM_DURATION_MS || 120000);
const SEND_INTERVAL_MS = Number(process.env.SIM_SEND_MS || 1000);
const RECONNECT_INTERVAL_MS = Number(process.env.SIM_RECONNECT_MS || 15000);

const USERS = Array.from({ length: USER_COUNT }, (_, i) => ({
  userId: `stress-u${i + 1}`,
  name: `User${i + 1}`,
  lang: "en",
}));

const state = {
  clients: new Map(),
  rooms: new Map(), // roomId -> {a,b}
  userRoom: new Map(),
  sent: 0,
  received: 0,
  expectedReceives: 0,
  errors: 0,
  reconnects: 0,
  latencies: [],
  duplicates: 0,
  seenMsgIds: new Set(),
};

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function connectUser(user) {
  return new Promise((resolve) => {
    const socket = io(SERVER, {
      transports: ["websocket"],
      upgrade: false,
      path: "/socket.io/",
      reconnection: true,
    });

    const client = { ...user, socket, connected: false, joined: false, roleHint: "guest" };
    state.clients.set(user.userId, client);

    socket.on("connect", () => {
      client.connected = true;
      socket.emit("register-user", {
        userId: user.userId,
        canonicalName: user.name,
        lang: user.lang,
      });
      if (client.roomId) {
        socket.emit("join", {
          roomId: client.roomId,
          fromLang: client.lang,
          participantId: client.userId,
          roleHint: client.roleHint,
          localName: client.name,
        });
      }
    });

    socket.on("disconnect", () => {
      client.connected = false;
    });

    socket.on("connect_error", () => {
      state.errors += 1;
    });

    socket.on("room-created", (p) => {
      if (!p?.roomId) return;
      client.roomId = p.roomId;
      client.roleHint = "owner";
      state.userRoom.set(client.userId, p.roomId);
      if (!state.rooms.has(p.roomId)) state.rooms.set(p.roomId, { a: client.userId, b: null });
      const r = state.rooms.get(p.roomId);
      if (!r.a) r.a = client.userId;
    });

    socket.on("partner-info", () => {
      client.joined = true;
    });

    socket.on("receive-message", (msg) => {
      if (!msg?.id || !(msg?.translatedText || msg?.text || msg?.originalText)) return;
      if (state.seenMsgIds.has(msg.id)) {
        state.duplicates += 1;
        return;
      }
      state.seenMsgIds.add(msg.id);
      state.received += 1;

      const m = /TS:(\d+)/.exec(msg.originalText || msg.translatedText || msg.text || "");
      if (m) {
        const t0 = Number(m[1]);
        if (Number.isFinite(t0)) state.latencies.push(now() - t0);
      }
    });

    socket.on("error", () => {
      state.errors += 1;
    });

    socket.on("user-registered", () => resolve(client));
  });
}

async function setupRooms() {
  for (let i = 0; i < USERS.length; i += 2) {
    const a = state.clients.get(USERS[i].userId);
    const b = state.clients.get(USERS[i + 1].userId);
    if (!a || !b) continue;

    const roomCreatedA = new Promise((res) => a.socket.once("room-created", res));
    const roomCreatedB = new Promise((res) => b.socket.once("room-created", res));

    a.socket.emit("create-1to1", {
      myUserId: a.userId,
      peerUserId: b.userId,
      siteContext: "general",
    });

    const [ra, rb] = await Promise.all([roomCreatedA, roomCreatedB]);
    const roomId = ra.roomId || rb.roomId;
    a.roomId = roomId;
    b.roomId = roomId;
    a.roleHint = "owner";
    b.roleHint = "guest";
    state.userRoom.set(a.userId, roomId);
    state.userRoom.set(b.userId, roomId);
    state.rooms.set(roomId, { a: a.userId, b: b.userId });

    a.socket.emit("join", {
      roomId,
      fromLang: "en",
      participantId: a.userId,
      roleHint: "owner",
      localName: a.name,
    });
    b.socket.emit("join", {
      roomId,
      fromLang: "en",
      participantId: b.userId,
      roleHint: "guest",
      localName: b.name,
    });
  }

  await sleep(1500);
}

function startTraffic() {
  const intv = setInterval(() => {
    for (const client of state.clients.values()) {
      if (!client.connected || !client.roomId) continue;
      const msgId = `stress-${client.userId}-${now()}-${Math.random().toString(36).slice(2, 7)}`;
      const text = `PING from ${client.userId} TS:${now()}`;
      client.socket.emit("send-message", {
        roomId: client.roomId,
        participantId: client.userId,
        message: { id: msgId, text },
      });
      state.sent += 1;
      state.expectedReceives += 1;
    }
  }, SEND_INTERVAL_MS);
  return intv;
}

function startReconnectChaos() {
  const intv = setInterval(async () => {
    const arr = Array.from(state.clients.values()).filter((c) => c.connected);
    if (!arr.length) return;
    const pick = arr[Math.floor(Math.random() * arr.length)];
    try {
      pick.socket.disconnect();
      state.reconnects += 1;
      await sleep(300 + Math.floor(Math.random() * 500));
      pick.socket.connect();
    } catch {
      state.errors += 1;
    }
  }, RECONNECT_INTERVAL_MS);
  return intv;
}

(async () => {
  console.log("--- STRESS SIM START ---");
  const start = now();

  await Promise.all(USERS.map(connectUser));
  console.log("[ok] users connected + registered:", state.clients.size);

  await setupRooms();
  console.log("[ok] rooms ready:", state.rooms.size);

  const t1 = startTraffic();
  const t2 = startReconnectChaos();

  await sleep(DURATION_MS);
  clearInterval(t1);
  clearInterval(t2);
  await sleep(3000);

  for (const c of state.clients.values()) c.socket.close();

  const elapsed = now() - start;
  const deliveryRatio = state.expectedReceives ? state.received / state.expectedReceives : 0;
  const p50 = percentile(state.latencies, 50);
  const p95 = percentile(state.latencies, 95);
  const p99 = percentile(state.latencies, 99);

  const result = {
    elapsedMs: elapsed,
    users: state.clients.size,
    rooms: state.rooms.size,
    sent: state.sent,
    expectedReceives: state.expectedReceives,
    received: state.received,
    deliveryRatio,
    reconnects: state.reconnects,
    errors: state.errors,
    duplicates: state.duplicates,
    latencyMs: { p50, p95, p99, samples: state.latencies.length },
    pass: deliveryRatio >= 0.97 && state.errors < 20,
  };

  console.log("--- STRESS SIM RESULT ---");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
})().catch((e) => {
  console.error("SIM FAILED:", e);
  process.exit(1);
});
