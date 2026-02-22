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

// ═══════════════════════════════════════
// IDENTITY
// ═══════════════════════════════════════

export async function getMyIdentity() {
  return db.identity.get("me");
}

export async function setMyIdentity({ userId, canonicalName, lang }) {
  return db.identity.put({ key: "me", userId, canonicalName, lang, updatedAt: Date.now() });
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
  await db.rooms.update(roomId, { lastActiveAt: Date.now() });
}

// ═══════════════════════════════════════
// OUTBOX (Offline Queue)
// ═══════════════════════════════════════

/**
 * @typedef {Object} OutboxMessage
 * @property {string} roomId
 * @property {string} msgId - client-generated message ID
 * @property {string} text
 * @property {number} createdAt
 */

export async function enqueueMessage({ roomId, msgId, text }) {
  return db.outbox.add({ roomId, msgId, text, createdAt: Date.now() });
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
