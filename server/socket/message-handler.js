// server/socket/message-handler.js (새 파일)
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 아주 단순한 번역 헬퍼 (형님이 쓰는 한-영 위주, 필요시 확대)
async function translate(text, targetLang = "ko") {
  // gpt-4o-mini 번역 1패스
  const prompt = `Translate to ${targetLang}. Only translation: ${text}`;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });
  return res.choices[0]?.message?.content?.trim() || text;
}

export function attachMessageHandler(io) {
  io.on("connection", (socket) => {
    socket.on("join", ({ roomId }) => {
      if (roomId) socket.join(roomId);
    });

    socket.on("message", async (msg) => {
      try {
        const { id, roomId, text, srcLang, targetLang } = msg;
        if (!roomId || !text) return;

        // 호스트/게스트 상대방이 보는 언어로 서버에서 번역
        // (기존 방에 저장된 상대 언어가 있으면 그걸 쓰고, 없으면 msg.targetLang 사용)
        const toLang = targetLang || "en";
        const translatedText = await translate(text, toLang);

        const payload = {
          ...msg,
          translatedText,
          ts: Date.now(),
        };

        // 방 전체에 브로드캐스트(자기 자신 포함 필요 시 바꾸세요)
        io.to(roomId).emit("message", payload);
      } catch (e) {
        console.error("[message.translate]", e.message);
      }
    });

    socket.on("readAll", ({ roomId, lastTs }) => {
      if (!roomId || !lastTs) return;
      socket.to(roomId).emit("peerRead", { lastTs });
    });
  });
}
