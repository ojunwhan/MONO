const { io } = require("socket.io-client");

const SERVER = process.env.SIM_SERVER || "http://127.0.0.1:3174";
const PATH = "/socket.io/";

function mkClient() {
  return io(SERVER, {
    transports: ["websocket"],
    upgrade: false,
    path: PATH,
    forceNew: true,
    reconnection: false,
    timeout: 8000,
  });
}

async function scenarioOneToOneParticipants() {
  const roomId = `qa-s1-${Date.now()}`;
  const a = `qa-a-${Date.now()}`;
  const b = `qa-b-${Date.now()}`;
  const A = mkClient();
  const B = mkClient();
  let ok = false;

  await new Promise((resolve) => {
    A.on("connect", () => {
      A.emit("create-room", {
        roomId,
        participantId: a,
        hostLang: "en",
        siteContext: "general",
        roomType: "oneToOne",
      });
      setTimeout(() => {
        A.emit("join", { roomId, fromLang: "en", participantId: a, roleHint: "owner" });
      }, 80);
    });
    B.on("connect", () => {
      setTimeout(() => {
        B.emit("join", { roomId, fromLang: "ko", participantId: b, roleHint: "guest" });
      }, 180);
    });
    A.on("participants", (list) => {
      if (Array.isArray(list) && list.length >= 2) {
        ok = true;
        resolve();
      }
    });
    setTimeout(resolve, 2500);
  });

  A.close();
  B.close();
  return ok;
}

async function scenarioDeliveredRead() {
  const roomId = `qa-s2-${Date.now()}`;
  const a = `qa-a-${Date.now()}`;
  const b = `qa-b-${Date.now()}`;
  const mid = `m-${Date.now()}`;
  const A = mkClient();
  const B = mkClient();
  let received = false;
  let delivered = false;
  let read = false;

  await new Promise((resolve) => {
    A.on("connect", () => {
      A.emit("create-room", {
        roomId,
        participantId: a,
        hostLang: "en",
        siteContext: "general",
        roomType: "oneToOne",
      });
      setTimeout(() => {
        A.emit("join", { roomId, fromLang: "en", participantId: a, roleHint: "owner" });
      }, 80);
    });
    B.on("connect", () => {
      setTimeout(() => {
        B.emit("join", { roomId, fromLang: "ko", participantId: b, roleHint: "guest" });
      }, 180);
    });
    B.on("receive-message", (p) => {
      if (p?.id === mid) {
        received = true;
        B.emit("message-read", { roomId, messageId: mid, participantId: b });
      }
    });
    A.on("message-status", (p) => {
      if (p?.messageId === mid && p?.status === "delivered") delivered = true;
      if (p?.messageId === mid && p?.status === "read") read = true;
    });
    setTimeout(() => {
      A.emit("send-message", { roomId, participantId: a, message: { id: mid, text: "qa delivered read" } });
    }, 900);
    setTimeout(resolve, 3200);
  });

  A.close();
  B.close();
  return received && delivered && read;
}

async function scenarioUnauthorizedAck() {
  const roomId = `qa-s3-${Date.now()}`;
  const a = `qa-a-${Date.now()}`;
  const b = `qa-b-${Date.now()}`;
  const A = mkClient();
  const B = mkClient();
  let unauthorized = false;

  await new Promise((resolve) => {
    A.on("connect", () => {
      A.emit("create-room", {
        roomId,
        participantId: a,
        hostLang: "en",
        siteContext: "general",
        roomType: "oneToOne",
      });
      setTimeout(() => {
        A.emit("join", { roomId, fromLang: "en", participantId: a, roleHint: "owner" });
      }, 80);
    });
    B.on("connect", () => {
      setTimeout(() => {
        B.emit("join", { roomId, fromLang: "ko", participantId: b, roleHint: "guest" });
      }, 180);
    });
    setTimeout(() => {
      A.emit(
        "send-message",
        { roomId, participantId: "fake-user", message: { id: `m-${Date.now()}`, text: "x" } },
        (ack) => {
          unauthorized = ack?.ok === false && ack?.error === "unauthorized";
        }
      );
    }, 700);
    setTimeout(resolve, 1800);
  });

  A.close();
  B.close();
  return unauthorized;
}

async function scenarioRejoin() {
  const roomId = `qa-s4-${Date.now()}`;
  const a = `qa-a-${Date.now()}`;
  const b = `qa-b-${Date.now()}`;
  const A = mkClient();
  const B = mkClient();
  let B2 = null;
  let rejoined = false;

  await new Promise((resolve) => {
    A.on("connect", () => {
      A.emit("create-room", {
        roomId,
        participantId: a,
        hostLang: "en",
        siteContext: "general",
        roomType: "oneToOne",
      });
      setTimeout(() => {
        A.emit("join", { roomId, fromLang: "en", participantId: a, roleHint: "owner" });
      }, 80);
    });
    B.on("connect", () => {
      setTimeout(() => {
        B.emit("join", { roomId, fromLang: "ko", participantId: b, roleHint: "guest" });
      }, 180);
      setTimeout(() => {
        B.close();
        B2 = mkClient();
        B2.on("connect", () => {
          B2.emit("rejoin-room", { roomId, userId: b, language: "ko", isHost: false });
        });
        B2.on("room-status", (p) => {
          if (p?.status === "rejoined") rejoined = true;
        });
      }, 1000);
    });
    setTimeout(resolve, 3600);
  });

  A.close();
  try {
    B.close();
  } catch {}
  try {
    B2?.close();
  } catch {}
  return rejoined;
}

async function scenarioGlobalBroadcast() {
  const roomId = "global-lobby";
  const a = `qa-ga-${Date.now()}`;
  const b = `qa-gb-${Date.now()}`;
  const A = mkClient();
  const B = mkClient();
  let got = false;

  await new Promise((resolve) => {
    A.on("connect", () => {
      A.emit("join-global", { roomId, participantId: a, fromLang: "en", localName: "A" }, (ack) => {
        if (!ack?.ok) resolve();
      });
    });
    B.on("connect", () => {
      B.emit("join-global", { roomId, participantId: b, fromLang: "en", localName: "B" }, (ack) => {
        if (!ack?.ok) resolve();
      });
    });
    B.on("receive-message", (p) => {
      if (p?.roomId === roomId) got = true;
    });
    setTimeout(() => {
      A.emit("send-message", { roomId, participantId: a, message: { id: `g-${Date.now()}`, text: "global qa" } });
    }, 1200);
    setTimeout(resolve, 3200);
  });

  A.close();
  B.close();
  return got;
}

(async () => {
  const results = [];
  results.push(["S1 oneToOne participants", await scenarioOneToOneParticipants()]);
  results.push(["S2 delivered/read", await scenarioDeliveredRead()]);
  results.push(["S3 unauthorized ack", await scenarioUnauthorizedAck()]);
  results.push(["S4 rejoin", await scenarioRejoin()]);
  results.push(["S5 global broadcast", await scenarioGlobalBroadcast()]);

  for (const [name, ok] of results) {
    console.log(ok ? "PASS" : "FAIL", name);
  }

  const failed = results.filter(([, ok]) => !ok).length;
  if (failed > 0) process.exit(1);
  process.exit(0);
})().catch((e) => {
  console.error("qa-smoke failed:", e);
  process.exit(1);
});
