// src/utils/recents.js
const KEY = "mro:recents";
const MAX = 50;

export function loadRecents() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecents(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

/**
 * 최근 목록에 방을 올리고 마지막 사용 시각을 갱신
 * - 없으면 추가, 있으면 맨 앞으로 이동
 */
export function touchRecent({ roomId, myLang, peerLang, myName = "Me", peerName = "Partner" }) {
  if (!roomId) return;
  const now = Date.now();
  const list = loadRecents().filter((r) => r.roomId !== roomId);
  list.unshift({ roomId, myLang, peerLang, myName, peerName, lastSeen: now });
  saveRecents(list);
}

/** 최근 목록에서 방 제거 */
export function removeRecent(roomId) {
  if (!roomId) return;
  const list = loadRecents().filter((r) => r.roomId !== roomId);
  saveRecents(list);
}
