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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRoom({ ownerLang, guestLang, scenario }) {
  const roomId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const guestId = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const A = mkClient();
  const B = mkClient();

  const state = {
    joined: false,
  };

  const cleanup = () => {
    try {
      A.close();
    } catch {}
    try {
      B.close();
    } catch {}
  };

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("join timeout")), 8000);

      A.on("connect", () => {
        A.emit("create-room", {
          roomId,
          participantId: ownerId,
          hostLang: ownerLang,
          siteContext: "general",
          roomType: "oneToOne",
        });
        setTimeout(() => {
          A.emit("join", {
            roomId,
            fromLang: ownerLang,
            participantId: ownerId,
            roleHint: "owner",
          });
        }, 100);
      });

      B.on("connect", () => {
        setTimeout(() => {
          B.emit("join", {
            roomId,
            fromLang: guestLang,
            participantId: guestId,
            roleHint: "guest",
          });
        }, 240);
      });

      A.on("participants", (list) => {
        if (Array.isArray(list) && list.length >= 2) {
          state.joined = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const received = [];
    B.on("receive-message", (payload) => {
      if (payload?.roomId === roomId) {
        received.push({
          id: payload.id,
          originalText: payload.originalText || "",
          translatedText: payload.translatedText || payload.text || "",
          text: payload.text || "",
        });
      }
    });

    const send = async (text) => {
      const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      A.emit("send-message", {
        roomId,
        participantId: ownerId,
        message: { id, text },
      });
      const start = Date.now();
      while (Date.now() - start < 12000) {
        const msg = received.find((m) => m.id === id);
        if (msg) return msg;
        await sleep(120);
      }
      throw new Error(`receive timeout for message: ${text}`);
    };

    await sleep(700);
    const result = await scenario(send);
    return result;
  } finally {
    cleanup();
  }
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text, candidates) {
  const t = normalize(text);
  return candidates.some((c) => t.includes(normalize(c)));
}

async function testPronounContext() {
  return withRoom({
    ownerLang: "ko",
    guestLang: "en",
    scenario: async (send) => {
      await send("김 과장님 어디 갔어?");
      const second = await send("걔한테 전화해봐");
      const out = second.translatedText;
      const ok =
        hasAny(out, ["call", "calling", "give"]) &&
        hasAny(out, ["him", "her", "them"]);
      return {
        name: "T1 대명사 맥락",
        ok,
        output: out,
      };
    },
  });
}

async function testKoreanSlangToEnglish() {
  return withRoom({
    ownerLang: "ko",
    guestLang: "en",
    scenario: async (send) => {
      const msg = await send("ㅇㅇ ㄱㄱ");
      const out = msg.translatedText;
      const ok = hasAny(out, ["yeah", "yep", "ok"]) && hasAny(out, ["let's go", "go go", "let's roll"]);
      return {
        name: "T2 한국어 줄임말 -> 영어",
        ok,
        output: out,
      };
    },
  });
}

async function testEnglishSlangToKorean() {
  return withRoom({
    ownerLang: "en",
    guestLang: "ko",
    scenario: async (send) => {
      const msg = await send("lol nvm idk");
      const out = msg.translatedText;
      const ok = hasAny(out, ["ㅋㅋ", "ㅎㅎ"]) && hasAny(out, ["아니야", "됐어", "신경쓰지마"]) && hasAny(out, ["몰라"]);
      return {
        name: "T3 영어 슬랭 -> 한국어",
        ok,
        output: out,
      };
    },
  });
}

async function testJapaneseSlangToKorean() {
  return withRoom({
    ownerLang: "ja",
    guestLang: "ko",
    scenario: async (send) => {
      const msg = await send("マジwwwそれなwww");
      const out = msg.translatedText;
      const ok = hasAny(out, ["진짜", "ㄹㅇ"]) && hasAny(out, ["ㅋㅋ", "ㅎㅎ"]) && hasAny(out, ["그니까", "맞아"]);
      return {
        name: "T4 일본어 인터넷 용어 -> 한국어",
        ok,
        output: out,
      };
    },
  });
}

async function testTonePreservationCasual() {
  return withRoom({
    ownerLang: "ko",
    guestLang: "en",
    scenario: async (send) => {
      const msg = await send("야 미쳤냐 진짜...");
      const out = msg.translatedText;
      const ok = hasAny(out, ["yo", "you crazy", "are you crazy"]) && hasAny(out, ["..."]);
      return {
        name: "T5 캐주얼/감정 보존",
        ok,
        output: out,
      };
    },
  });
}

async function testTonePreservationFormal() {
  return withRoom({
    ownerLang: "ko",
    guestLang: "en",
    scenario: async (send) => {
      const msg = await send("감사합니다. 확인 부탁드리겠습니다.");
      const out = msg.translatedText;
      const ok =
        hasAny(out, ["thank you"]) &&
        (hasAny(out, ["would appreciate", "please confirm", "kindly", "could you please"]) ||
          (hasAny(out, ["please"]) && hasAny(out, ["check", "confirm", "review"])));
      return {
        name: "T6 격식체 보존",
        ok,
        output: out,
      };
    },
  });
}

async function testEmoticonPreservation() {
  return withRoom({
    ownerLang: "ko",
    guestLang: "en",
    scenario: async (send) => {
      const msg = await send("ㅠㅠ 오늘 진짜 힘들다");
      const out = msg.translatedText;
      const ok = hasAny(out, ["ㅠㅠ", "😢", "tough", "hard"]);
      return {
        name: "T7 이모티콘/감정 보존",
        ok,
        output: out,
      };
    },
  });
}

async function testChineseSlangToEnglish() {
  return withRoom({
    ownerLang: "zh",
    guestLang: "en",
    scenario: async (send) => {
      const msg = await send("666 yyds");
      const out = msg.translatedText;
      const ok = hasAny(out, ["sick", "goat", "legend", "awesome"]);
      return {
        name: "T8 중국어 인터넷 용어 -> 영어",
        ok,
        output: out,
      };
    },
  });
}

(async () => {
  const tests = [
    testPronounContext,
    testKoreanSlangToEnglish,
    testEnglishSlangToKorean,
    testJapaneseSlangToKorean,
    testTonePreservationCasual,
    testTonePreservationFormal,
    testEmoticonPreservation,
    testChineseSlangToEnglish,
  ];

  const results = [];
  for (const run of tests) {
    try {
      const r = await run();
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} -> ${r.output}`);
    } catch (e) {
      results.push({ name: run.name, ok: false, output: `ERROR: ${e.message}` });
      console.log(`FAIL ${run.name} -> ERROR: ${e.message}`);
    }
  }

  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;
  console.log(`\nRESULT: ${passCount}/${results.length} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
  process.exit(0);
})().catch((e) => {
  console.error("context-translation-test failed:", e);
  process.exit(1);
});
