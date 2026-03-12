# Investigation: Why hospital_messages Always Saves sender_role as 'guest'

## 1. Where SOCKET_ROLES is set (when a user joins a room)

| Location | When | Value set |
|----------|------|-----------|
| **~2160** | Create-room flow (owner creates room) | `SOCKET_ROLES.set(socket.id, { role: "owner" })` |
| **~2256** | Host joins with call sign | `SOCKET_ROLES.set(socket.id, { role: "owner" })` |
| **~2341** | Global `join` (roomId, participantId, roleHint, fromLang) | `SOCKET_ROLES.set(socket.id, { role })` where `role` = "owner" if `isOwner` else "guest", and `isOwner = !meta.ownerPid \|\| meta.ownerPid === participantId` |
| **~2774** | Same `join` handler, after `roleHint` override | If `roleHint === "owner"` → `serverRole = "owner"` and `meta.ownerPid = participantId`; then `SOCKET_ROLES.set(socket.id, { role: serverRole })` |
| **~3079** | `register` event | `SOCKET_ROLES.set(socket.id, { role: role === 'owner' ? 'owner' : 'guest' })` |
| **~3095** | `set-lang` (reuses existing rec) | `SOCKET_ROLES.set(socket.id, rec)` (no role change) |
| **~3147** | `stt:open` (if no role yet) | `role = meta.ownerPid && meta.ownerPid === participantId ? "owner" : "guest"`; `SOCKET_ROLES.set(socket.id, { role })` |

For hospital PT- rooms, the important path is the **`join`** handler (~2591): staff sends `roleHint: "owner"`, so `serverRole = "owner"` and `meta.ownerPid = participantId`, and `SOCKET_ROLES` is set. So SOCKET_ROLES is set correctly when staff joins with roleHint "owner".

---

## 2. Where meta.ownerPid is set for hospital rooms

| Location | When |
|----------|------|
| **~2293** | Global `join`: `if (isOwner) meta.ownerPid = participantId` where `isOwner = !meta.ownerPid \|\| meta.ownerPid === participantId` |
| **~2331** | Same: `if (isOwner) meta.ownerPid = participantId` |
| **~2417** | `rejoin-room`: `if (isHost) meta.ownerPid = userId` |
| **~2770** | **`join` with roleHint "owner"**: `meta.ownerPid = participantId` (staff path) |
| **~1980** | On disconnect: if leaving pid was owner, `meta.ownerPid = nextOwner` |
| **~4331** | Swap owner logic |

For hospital PT- rooms created by **POST /api/hospital/join**, the room is created with **`ownerPid: null`** and **`participants: {}`** (~5121–5136). So `meta.ownerPid` is set **only when someone joins via socket**. It is set when the **staff** joins with **roleHint "owner"** (~2770). So ownerPid is set **after** the staff joins via socket, not when the room is created.

---

## 3. Where meta.participants[ownerPid].socketId is set

| Location | When |
|----------|------|
| **~2345–2353** | Global `join`: `meta.participants[participantId] = { ..., socketId: socket.id }` (full object with callSign, lang, etc.) |
| **~2396** | `rejoin-room`: `existing.socketId = socket.id` if participant already in meta |
| **~2633** | `join` re-use path (same room, same pid): `meta.participants[participantId].socketId = socket.id` |
| **~2838–2844** | **`join` for oneToOne (including hospital)**: `meta.participants[participantId] = { nativeName, lang, socketId: socket.id, ... }` — this is where staff’s socketId is stored when they join with roleHint "owner" |
| **~2990–2994** | `join` for non–oneToOne: same idea with callSign |
| **~3133** | **`stt:open`** when restoring PT- room: `meta.participants[participantId] = { socketId: socket.id }` (minimal object) — only for the **current** socket’s participantId, not for owner |

So for hospital 1:1 rooms, **`meta.participants[ownerPid].socketId`** is set in the **`join`** handler when the staff joins (~2838), at the same time as `meta.ownerPid = participantId` (~2770). It is **not** set by `/api/hospital/join` (that only creates the room with `participants: {}`).

---

## 4. Debug log added in emitTranslated

In the emitTranslated closure, the following log was added **before** the hospital_messages INSERT:

```js
console.log('[DEBUG sender_role_investigate]', {
  socketId: socket?.id,
  metaOwnerPid: meta?.ownerPid,
  metaParticipants: meta?.participants,
  ownerSocketId
});
```

This prints the exact values used for `senderRole = (socket.id === ownerSocketId) ? 'host' : 'guest'`. When you run the app and have staff speak (STT), check server logs for this line to see whether `meta.ownerPid` and `meta.participants[meta.ownerPid].socketId` are set and whether they match `socket.id`.

---

## 5. Is meta.participants populated for hospital (PT-XXXXXX) rooms?

- **Room creation (POST /api/hospital/join)**  
  Room is created with **`participants: {}`** (~5121–5136). So at creation time, **no** participants.

- **After patient joins via socket (`join`)**  
  Patient sends `join` with roomId, participantId (patient id), roleHint usually **"guest"**. Then `meta.participants[patientId] = { ..., socketId }` (~2838). So **only the patient** is in `meta.participants`. **meta.ownerPid** stays **null** (patient did not send roleHint "owner").

- **After staff joins via socket (`join`)**  
  Staff sends `join` with roomId, participantId (staff id), roleHint **"owner"**. Then `meta.ownerPid = participantId` (~2770) and `meta.participants[staffId] = { nativeName, lang, socketId: socket.id, ... }` (~2838). So **both** patient and staff are in `meta.participants`, and **meta.participants[meta.ownerPid].socketId** is the staff’s socket.id.

So for PT- rooms, **meta.participants is populated only when users join via the socket `join` event**. If the staff has never emitted `join` for that room (e.g. UI joins only via a different path, or STT starts before `join`), then **meta.participants[staffId]** and **meta.ownerPid** may still be empty when STT runs.

**PT- restore (e.g. after server restart):**  
When `!ROOMS.has(roomId) && roomId.startsWith('PT-')`, the room is recreated from DB with **`ownerPid: null`** and **`participants: {}`** (~2602–2617 in `join`, ~3115–3131 in `stt:open`). So after restore, **ownerPid is null** and **participants is empty** until someone sends `join` again. The **stt:open** path only does `meta.participants[participantId] = { socketId: socket.id }` for the **caller** of stt:open (often the patient). It does **not** set `meta.ownerPid`. So if the patient opens STT first after restore, we have only the patient in `participants` and **ownerPid still null**. When staff later sends `join`, both `meta.ownerPid` and `meta.participants[staffId].socketId` get set.

---

## 6. Is ownerPid set BEFORE or AFTER the staff joins via socket?

**ownerPid is set only when the staff joins via the socket `join` event** (~2770, when `roleHint === "owner"`). It is **not** set by:

- POST /api/hospital/join (room creation): `ownerPid: null`
- PT- restore from DB: `ownerPid: null`
- stt:open: no assignment to `meta.ownerPid`

So **ownerPid is set only after** the staff (or whoever joins with roleHint "owner") sends the **`join`** event. If the staff’s frontend never sends `join` for that roomId (e.g. only opens STT or only subscribes to the room in another way), then **meta.ownerPid stays null** and **meta.participants[meta.ownerPid]** is undefined, so **ownerSocketId** is undefined and **senderRole** is always `'guest'`.

---

## Summary: Why senderRole is always 'guest'

1. **Current logic**  
   `senderRole = (socket.id === ownerSocketId) ? 'host' : 'guest'` with `ownerSocketId = meta?.participants?.[meta?.ownerPid]?.socketId`. So host is only detected when the **current socket.id** equals the **owner’s socketId** stored in **meta.participants[meta.ownerPid].socketId**.

2. **When that works**  
   When the staff has previously sent a **socket `join`** for that roomId with **roleHint "owner"**, so that:
   - `meta.ownerPid` = staff’s participantId, and  
   - `meta.participants[staffId].socketId` = staff’s socket.id.  
   Then when the staff’s socket triggers STT, `socket.id === ownerSocketId` and `senderRole === 'host'`.

3. **Why it might always be 'guest'**  
   - **meta.ownerPid is null**  
     Room was created by API or restored from DB with `ownerPid: null`, and the staff **never** sent a `join` with `roleHint: "owner"` for this roomId. Then `ownerSocketId` is undefined → `senderRole` is always `'guest'`.  
   - **meta.participants[meta.ownerPid] is missing or has no socketId**  
     Staff sent `join` but with a different participantId than the one used later in STT; or only **stt:open** was used (which only sets `meta.participants[participantId]` for the opener and does not set `meta.ownerPid`). Then `meta.participants[meta.ownerPid]` can be undefined or have no `socketId` → `ownerSocketId` undefined → `senderRole` is `'guest'`.  
   - **Order of events**  
     If the **patient** opens STT first (stt:open) and the room is restored there, we only add the patient to `participants` and never set `ownerPid`. If the staff then speaks without ever sending `join` for that room (e.g. dashboard “enter room” only updates UI and doesn’t emit `join`), then when staff’s socket fires stt:segment_end, `meta.ownerPid` is still null and `senderRole` stays `'guest'`.

4. **What to verify at runtime**  
   Use the new log in emitTranslated:

   - If **meta.ownerPid** is **null/undefined** when staff speaks → staff’s client is not sending `join` with roleHint "owner" for this roomId, or join runs after STT.  
   - If **meta.participants** is **{}** or has no entry for **meta.ownerPid** → staff never completed the `join` path that sets `meta.participants[participantId].socketId`.  
   - If **ownerSocketId** is **undefined** → same as above (no owner in participants or no socketId).  
   - If **socket.id** and **ownerSocketId** are both set but **different** → the socket that is sending STT is not the same as the one that joined as owner (e.g. different tab/socket for the same staff, or participantId mismatch between join and STT).

**Root cause (most likely):** For the fixed-room / VAD flow, the **staff** may **never emit the socket `join`** for the PT- room (e.g. they only “enter” in the dashboard or only open STT). Then `meta.ownerPid` and `meta.participants[staffId].socketId` are never set, so `ownerSocketId` is always undefined and **senderRole** is always **'guest'**.
