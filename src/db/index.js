// src/db/index.js — IndexedDB adapter via Dexie
// Persists ONLY room metadata, user identity, and outbox queue.
// NO message content is stored (privacy-first).
import Dexie from "dexie";

const db = new Dexie("MonoDB");

db.version(1).stores({
  // ── User identity (single row, key = "me") ──
  // canonicalName: native-language name as entered by user
  // lang: user's selected language code
  // userId: stable internal ID (auto-generated once)
  identity: "key",

  // ── Rooms: minimal metadata for "Recent Conversations" ──
  // Indexed by roomId; sorted by lastActiveAt
  rooms: "roomId, roomType, lastActiveAt",

  // ── Outbox: queued messages for offline send ──
  // Auto-incrementing id; indexed by roomId for flush order
  outbox: "++id, roomId, createdAt",

  // ── Pronunciation aliases cache ──
  // Key: `${userId}:${targetLang}` → alias string
  aliases: "[userId+targetLang], userId",
});

// v2: message store + expanded room metadata for messenger-style chat list
db.version(2)
  .stores({
    identity: "key",
    rooms: "roomId, roomType, lastActiveAt, updatedAt, pinned",
    outbox: "++id, roomId, createdAt",
    aliases: "[userId+targetLang], userId",
    messages: "id, roomId, timestamp, senderId, status, type",
  })
  .upgrade(async (tx) => {
    await tx.table("rooms").toCollection().modify((room) => {
      room.updatedAt = room.updatedAt || room.lastActiveAt || Date.now();
      if (typeof room.pinned !== "boolean") room.pinned = false;
    });
  });

// ═══════════════════════════════════════
// IDENTITY
// ═══════════════════════════════════════

export async function getMyIdentity() {
  return db.identity.get("me");
}

export async function setMyIdentity({ userId, canonicalName, lang }) {
  return db.identity.put({ key: "me", userId, canonicalName, lang, updatedAt: Date.now() });
}

export async function clearMyIdentity() {
  return db.identity.delete("me");
}

// ═══════════════════════════════════════
// ROOMS
// ═══════════════════════════════════════

/**
 * @typedef {Object} RoomMeta
 * @property {string} roomId
 * @property {"1to1"|"broadcast"} roomType
 * @property {string} peerUserId
 * @property {string} peerCanonicalName
 * @property {string} peerAlias - pronunciation alias in MY language
 * @property {string} peerLang
 * @property {number} lastActiveAt
 * @property {number} unreadCount
 * @property {string} [siteContext]
 */

export async function upsertRoom(roomMeta) {
  const existing = await db.rooms.get(roomMeta.roomId);
  const merged = {
    ...existing,
    ...roomMeta,
    lastActiveAt: roomMeta.lastActiveAt || Date.now(),
    updatedAt: roomMeta.updatedAt || Date.now(),
    pinned: typeof roomMeta.pinned === "boolean" ? roomMeta.pinned : (existing?.pinned || false),
  };
  return db.rooms.put(merged);
}

export async function getRoom(roomId) {
  return db.rooms.get(roomId);
}

export async function getAllRooms() {
  return db.rooms.orderBy("lastActiveAt").reverse().toArray();
}

export async function deleteRoom(roomId) {
  await db.rooms.delete(roomId);
  await db.outbox.where("roomId").equals(roomId).delete();
}

export async function incrementUnread(roomId) {
  const room = await db.rooms.get(roomId);
  if (room) {
    await db.rooms.update(roomId, { unreadCount: (room.unreadCount || 0) + 1 });
  }
}

export async function clearUnread(roomId) {
  await db.rooms.update(roomId, { unreadCount: 0 });
}

export async function touchRoom(roomId) {
  const now = Date.now();
  await db.rooms.update(roomId, { lastActiveAt: now, updatedAt: now });
}

export async function recordRoomActivity(roomId, patch = {}) {
  if (!roomId) return;
  const existing = await db.rooms.get(roomId);
  const now = Date.now();
  const next = {
    ...(existing || { roomId, roomType: "1to1", unreadCount: 0, pinned: false }),
    ...patch,
    roomId,
    lastActiveAt: patch.lastActiveAt || now,
    updatedAt: patch.updatedAt || now,
  };
  await db.rooms.put(next);
}

// ═══════════════════════════════════════
// MESSAGES (local-only)
// ═══════════════════════════════════════

export async function saveMessage(message) {
  if (!message?.id || !message?.roomId) return;
  const now = Date.now();
  const normalized = {
    ...message,
    id: String(message.id),
    roomId: String(message.roomId),
    senderId: String(message.senderId || ""),
    senderName: String(message.senderName || ""),
    originalText: String(message.originalText || ""),
    translatedText: String(message.translatedText || ""),
    originalLang: String(message.originalLang || ""),
    translatedLang: String(message.translatedLang || ""),
    type: String(message.type || "text"),
    status: String(message.status || "sent"),
    timestamp: Number(message.timestamp || now),
    replyTo: message.replyTo || null,
  };
  await db.messages.put(normalized);
}

export async function getMessages(roomId, limit = 50, offset = 0) {
  if (!roomId) return [];
  const sorted = await db.messages.where("roomId").equals(roomId).sortBy("timestamp");
  if (!sorted.length) return [];
  const safeOffset = Math.max(0, Number(offset || 0));
  const safeLimit = Math.max(1, Number(limit || 50));
  const end = Math.max(0, sorted.length - safeOffset);
  const start = Math.max(0, end - safeLimit);
  return sorted.slice(start, end);
}

export async function deleteMessages(roomId) {
  if (!roomId) return;
  await db.messages.where("roomId").equals(roomId).delete();
}

export async function getStorageUsage() {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    const estimated = await navigator.storage.estimate();
    const usage = Number(estimated?.usage || 0);
    const quota = Number(estimated?.quota || 0);
    return {
      usageBytes: usage,
      quotaBytes: quota,
      usageMB: +(usage / (1024 * 1024)).toFixed(2),
      quotaMB: +(quota / (1024 * 1024)).toFixed(2),
    };
  }

  const [rooms, messages] = await Promise.all([db.rooms.toArray(), db.messages.toArray()]);
  const roughBytes = new Blob([JSON.stringify({ rooms, messages })]).size;
  return {
    usageBytes: roughBytes,
    quotaBytes: 0,
    usageMB: +(roughBytes / (1024 * 1024)).toFixed(2),
    quotaMB: 0,
  };
}

// ═══════════════════════════════════════
// OUTBOX (Offline Queue)
// ═══════════════════════════════════════

/**
 * @typedef {Object} OutboxMessage
 * @property {string} roomId
 * @property {string} msgId - client-generated message ID
 * @property {string} text
 * @property {string} participantId
 * @property {number} createdAt
 */

export async function enqueueMessage({ roomId, msgId, text, participantId }) {
  return db.outbox.add({ roomId, msgId, text, participantId, createdAt: Date.now() });
}

export async function getQueuedMessages(roomId) {
  if (roomId) {
    return db.outbox.where("roomId").equals(roomId).sortBy("createdAt");
  }
  return db.outbox.orderBy("createdAt").toArray();
}

export async function dequeueMessage(id) {
  return db.outbox.delete(id);
}

export async function flushQueue() {
  return db.outbox.orderBy("createdAt").toArray();
}

export async function clearQueue(roomId) {
  if (roomId) {
    return db.outbox.where("roomId").equals(roomId).delete();
  }
  return db.outbox.clear();
}

// ═══════════════════════════════════════
// PRONUNCIATION ALIASES
// ═══════════════════════════════════════

export async function setAlias(userId, targetLang, alias) {
  return db.aliases.put({ userId, targetLang, alias, updatedAt: Date.now() });
}

export async function getAlias(userId, targetLang) {
  const row = await db.aliases.get({ userId, targetLang });
  return row?.alias || null;
}

export async function getAliasesForUser(userId) {
  return db.aliases.where("userId").equals(userId).toArray();
}

export default db;
