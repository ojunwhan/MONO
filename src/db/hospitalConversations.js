// src/db/hospitalConversations.js — 환자 폰 로컬 저장 (IndexedDB)
// 키: roomId (PT-XXXXXX) + 날짜 (YYYY-MM-DD). 대화 내용 실시간 저장.

const DB_NAME = "mono_hospital_conversations";
const STORE = "conversations";
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("roomId", "roomId", { unique: false });
        os.createIndex("dateStr", "dateStr", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 대화 한 건 저장 (추가 또는 병합)
 * @param {string} roomId - PT-XXXXXX
 * @param {Array<{id?, originalText?, translatedText?, mine?, timestamp?}>} messages
 */
export async function saveHospitalConversation(roomId, messages) {
  if (!roomId || !Array.isArray(messages)) return;
  const ds = dateStr();
  const id = `${roomId}_${ds}`;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const existing = await new Promise((res, rej) => {
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = rej;
    });
    const merged = existing
      ? { ...existing, messages, updatedAt: Date.now() }
      : { id, roomId, dateStr: ds, messages, updatedAt: Date.now() };
    await new Promise((res, rej) => {
      const r = tx.objectStore(STORE).put(merged);
      r.onsuccess = res;
      r.onerror = rej;
    });
    db.close();
  } catch (e) {
    console.warn("[hospitalConversations] save error", e?.message);
  }
}

/**
 * 해당 roomId의 날짜별 대화 목록 조회 (최신순)
 */
export async function getHospitalConversationsByRoom(roomId) {
  if (!roomId) return [];
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("roomId");
    const req = index.getAll(roomId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        db.close();
        resolve(list);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (e) {
    console.warn("[hospitalConversations] getByRoom error", e?.message);
    return [];
  }
}

/**
 * 전체 로컬 통역 기록 목록 (모든 roomId, 날짜별)
 */
export async function getAllHospitalConversations() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        db.close();
        resolve(list);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (e) {
    console.warn("[hospitalConversations] getAll error", e?.message);
    return [];
  }
}
