const STORAGE_KEY = "mono_chat_history";
const MAX_SESSIONS = 10;
const MAX_AGE_HOURS = 24;

function safeParse(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function cleanOldSessions(history) {
  const now = Date.now();
  const maxAge = MAX_AGE_HOURS * 60 * 60 * 1000;
  const next = { ...history };

  Object.keys(next).forEach((roomId) => {
    if (!next[roomId] || now - (next[roomId].createdAt || now) > maxAge) {
      delete next[roomId];
    }
  });

  const sessions = Object.entries(next).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  if (sessions.length > MAX_SESSIONS) {
    sessions.slice(MAX_SESSIONS).forEach(([roomId]) => {
      delete next[roomId];
    });
  }

  return next;
}

export function saveSessionMessages(roomId, messages = []) {
  if (!roomId) return;
  try {
    const history = safeParse(localStorage.getItem(STORAGE_KEY));
    const cleaned = cleanOldSessions(history);
    cleaned[roomId] = {
      createdAt: cleaned[roomId]?.createdAt || Date.now(),
      updatedAt: Date.now(),
      messages: Array.isArray(messages) ? messages : [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanOldSessions(cleaned)));
  } catch (e) {
    console.warn("[MONO] localStorage save failed:", e?.message || e);
  }
}

export function loadSessionMessages(roomId) {
  if (!roomId) return [];
  try {
    const history = cleanOldSessions(safeParse(localStorage.getItem(STORAGE_KEY)));
    const result = history[roomId]?.messages;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export function clearSession(roomId) {
  if (!roomId) return;
  try {
    const history = safeParse(localStorage.getItem(STORAGE_KEY));
    delete history[roomId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {}
}

export function clearAllHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

