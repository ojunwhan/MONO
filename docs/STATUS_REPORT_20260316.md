# MONO Status Report — 8-Area Audit

**Date:** 2026-03-16  
**Branch:** feature/hospital-plastic-surgery  
**Scope:** Read-only audit; no code changes.

---

### AREA 1: send-message handler and hospital_messages INSERT

**Files:** server.js (3851–4062, 3503–3531, 3788–3835)

**Status:** Working

**Current behavior:**
- **send-message** (oneToOne): One `INSERT OR IGNORE` at ~4053–4056 when `(isHospitalMsg2 || roomId.startsWith('PT-')) && roomId`. Uses `draft` (fastTranslate result) for `translated_text`. Later, after `hqTranslate`, an `UPDATE` at ~4010–4013 updates `translated_text`/`translated_lang` for the same message id. So one INSERT per message, then at most one UPDATE.
- **stt:segment_end** (1:1): One `INSERT` at ~3525–3529 when `shouldSaveMessages` (hospital or PT- and not ended). Uses `finalText` and `translated` (already stripped at 3400–3401).
- **stt:whisper** (hospital 1:1): One `INSERT` at ~3832–3835 when `whisperHospitalMode && roomId` and hospital 1:1; uses stripped `translatedText`.

**Duplicate INSERT:** No. Each of the three paths is triggered by a different event (send-message vs stt:segment_end vs stt:whisper). For a single user action there is only one path; no path does two INSERTs for the same message.

**Conditions that trigger each INSERT:**
| Path            | Condition |
|-----------------|-----------|
| send-message    | `roomType === "oneToOne"` and `(isHospitalMsg2 \|\| roomId.startsWith('PT-')) && roomId` |
| stt:segment_end | 1:1 room, `shouldSaveMessages === true` (hospital/PT- and not hospitalEndedSession) |
| stt:whisper     | `whisperHospitalMode && roomId` and `meta.roomType === "oneToOne"` and hospital context and `!meta.hospitalEndedSession` |

**Code excerpt:**
```js
// send-message oneToOne hospital save (4053-4056)
await dbRun(
  `INSERT OR IGNORE INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, activeSession2?.id || null, roomId, senderRole, fromLang, trimmedText, draft || '', toLang, pToken2]
);
```

---

### AREA 2: [Korean] tag in translations

**Files:** server.js (1695–1765 buildSystemPrompt, 1893–1945 fastTranslate, 1948–1972 hqTranslate, 3400–3401, 3827–3829)

**Status:** Partial

**Current behavior:**
- **Prompt:** `buildSystemPrompt` (hospital and general) ends with: “Output ONLY translated text. No explanation, no notes, no quotation marks, no brackets.” So the model is told not to emit language tags.
- **Post-processing:**  
  - **stt:segment_end:** `translated` is stripped before emit/save: `translated.replace(/^(\[.*?\]\s*)+/, '').trim()` (3400–3401).  
  - **stt:whisper:** `translatedText = stripBracketTag(translatedText)` with same regex (3827–3829).  
  - **send-message:** There is no strip of `draft` or `hq` before emit, DB INSERT, or UPDATE. So if GPT returns a leading “[Korean]” or “[English]” in send-message path, it is stored and sent as-is.

**Root cause (partial):** [Korean]-style tags are stripped only on STT paths (segment_end, whisper). Typed messages (send-message) are not stripped, so tags can appear in UI and DB for that path.

**Code excerpt:**
```js
// buildSystemPrompt (1740)
`Output ONLY translated text. No explanation, no notes, no quotation marks, no brackets.`

// stt:segment_end strip (3400-3401)
if (typeof translated === 'string') translated = translated.replace(/^(\[.*?\]\s*)+/, '').trim();

// send-message: no strip before INSERT (4055 uses draft as-is)
```

---

### AREA 3: Socket reconnect + room rejoin

**Files:** ChatScreen.jsx (1118–1225), FixedRoomVAD.jsx (730–774)

**Status:** Working (ChatScreen); Partial (FixedRoomVAD)

**Current behavior:**
- **ChatScreen:** On `socket.on('connect')`, if not initial load, it calls `rejoin("reconnect")`, which emits `rejoin-room` (roomId, userId, language, isHost) then `join` (roomId, fromLang, participantId, role, localName, roleHint, saveMessages, summaryOnly, contextInject). Refs (roomIdRef, participantIdRef, fromLangRef, etc.) keep values across reconnect. For PT- rooms it also calls `fetchPtHistoryRef.current(rid)` to refetch history.
- **server.js join:** Join handler restores or creates room meta; for PT- it can restore from DB if `!ROOMS.has(roomId) && roomId.startsWith('PT-')`. It sets `meta.participants[participantId] = { nativeName, lang, socketId: socket.id, ... }` and updates ROOMS. So the reconnecting participant is re-added to ROOMS.
- **FixedRoomVAD:** No disconnect/reconnect handler. It has a single `useEffect` that runs `doJoin()` when `socket.connected` is true, or subscribes `socket.once('connect', doJoin)`. So on reconnect, if the effect re-runs (e.g. deps change), it would call `doJoin()` again when socket connects; but there is no explicit `socket.on('connect', rejoin)` that always re-emits join after reconnect. So rejoin on reconnect depends on effect and dependency array; if the component does not unmount and deps don’t change, it might not re-join until next mount or dependency change.

**Root cause (FixedRoomVAD partial):** Reconnect is not explicitly handled; join only runs when effect runs (e.g. on mount or when deps like roomId/participantId change). So after a brief disconnect/reconnect with same deps, join might not be re-sent unless the user triggers a re-render or navigation.

**Code excerpt:**
```js
// ChatScreen (1172-1182)
const onConnect = () => {
  reconnectAttemptsRef.current = 0;
  clearRetryTimer();
  setReconnectState("connected");
  if (initialConnectRef.current) { initialConnectRef.current = false; return; }
  rejoin("reconnect");
  const rid = roomIdRef.current;
  if (rid && rid.startsWith("PT-") && typeof fetchPtHistoryRef.current === "function") {
    fetchPtHistoryRef.current(rid);
  }
};

// FixedRoomVAD (751-765)
if (socket.connected) {
  doJoin();
} else {
  const onConnect = () => doJoin();
  socket.once("connect", onConnect);
  ...
}
```

---

### AREA 4: Partner language tracking

**Files:** server.js (2835–2839, 2849–2901, 2936–2940), FixedRoomVAD.jsx (578, 795–804, 1248–1265)

**Status:** Working (when both joined); Partial (staff alone)

**Current behavior:**
- **ROOMS:** When a user joins, `join` sets `meta.ownerLang` or `meta.guestLang` from `fromLang` (2836–2838) and sets `meta.participants[participantId].lang = pLang` (2898). So guest language is stored in both `meta.guestLang` and `meta.participants[participantId].lang`.
- **FixedRoomVAD when patient is offline:** `partnerInfo` is set only from `partner-joined` (onPartnerJoined), which is emitted when the other participant joins (server sends `peerLang` from `meta.participants[otherPid].lang`). If the patient has never joined, staff never receives `partner-joined` → `partnerInfo` stays null. Fallback: `partnerLangDisplay` and `partnerFlagUrl` use `patientData?.language` from GET `/api/hospital/patient/:patientToken` when `partnerInfo` is missing. So if staff has `patientToken` in state and it’s loaded, patient language can show from API; otherwise partner side shows empty.
- **“KO → KO” when patient offline:** If both `partnerInfo` and `patientData` are null/empty, `partnerLangDisplay` is `""`. The header shows something like `fromLang → partnerLangDisplay`; if partner is empty it would be “KO → ” (or similar), not “KO → KO”, unless another fallback forces staff’s language. So typical case is “KO → ” when patient is offline and patientData not loaded.

**Root cause (partial):** When staff opens the room before the patient joins, partner language is unknown until either the patient joins (partner-joined) or patientData is loaded (only when patientToken is available and API returns language). No fallback to hospital_sessions.guest_lang or hospital_messages for language.

**Code excerpt:**
```js
// server join (2835-2839)
const langCode = fromLang ? mapLang(fromLang) : null;
if (langCode) {
  if (serverRole === "owner") meta.ownerLang = langCode;
  else meta.guestLang = langCode;
}
meta.participants[participantId] = { ..., lang: pLang, ... };

// FixedRoomVAD fallback (1249-1255)
const partnerLangDisplay = useMemo(() => {
  if (partnerInfo?.langLabel) return partnerInfo.langLabel;
  if (patientData?.language) { ... }
  return "";
}, [partnerInfo, patientData]);
```

---

### AREA 5: ChatScreen PT- history restoration

**Files:** ChatScreen.jsx (383–438), server.js (5564–5582)

**Status:** Working

**Current behavior:**
- On mount for a PT- room, a useEffect (431–436) runs after 400 ms and calls `fetchPtRoomHistory(roomId)` unless `ptHistoryLoadedRef.current` is true.
- API: `GET /api/hospital/patient-by-room/:roomId/history` (server.js 5564–5582). Query: `SELECT id, room_id, sender_role, original_text, translated_text, sender_lang, translated_lang, created_at FROM hospital_messages WHERE room_id = ? ORDER BY id ASC LIMIT 100`.
- Response includes both `original_text` and `translated_text`; both host and guest messages are returned (single table, filtered by room_id).
- ChatScreen maps rows to messages: `mine = (sender_role === "guest")`, `orig = m.original_text`, `trans = m.translated_text ?? orig`, and builds `originalText`, `translatedText`, `text` (display). So both sides are shown with original and translated where available.

**Code excerpt:**
```js
// ChatScreen (388)
const res = await fetch(`/api/hospital/patient-by-room/${encodeURIComponent(rid)}/history`);
const rows = Array.isArray(data?.messages) ? data.messages : [];
const mapped = rows.map((m) => {
  const mine = m.sender_role === "guest";
  const orig = (m.original_text != null && m.original_text !== "") ? m.original_text : "";
  const trans = (m.translated_text != null && m.translated_text !== "") ? m.translated_text : orig;
  return { ..., originalText: orig, translatedText: trans || orig, ... };
});
```

---

### AREA 6: FixedRoomVAD history restoration

**Files:** FixedRoomVAD.jsx (messages state, receive-message handler, no history API)

**Status:** Partial

**Current behavior:**
- FixedRoomVAD does not call any history API on mount. Messages are only what arrive via socket `receive-message` (and revise-message) in the current session. So previous-session or pre-mount messages are not loaded.
- Because there is no history load, “translatedText display” for old messages is N/A for FixedRoomVAD—those messages are never shown. For live messages, `receive-message` and `revise-message` provide `translatedText`, which is displayed; no undefined/null issue for in-session messages.

**Root cause:** Design choice: FixedRoomVAD is a live-only view (no history fetch). So “history restoration” is not implemented; users do not see prior messages when opening the page.

**Code excerpt:**
```js
// FixedRoomVAD: no fetch to /api/hospital/patient-by-room/... or similar.
// Messages come only from socket (receive-message, revise-message) in useEffect handlers.
```

---

### AREA 7: Returning patient detection (HospitalPatientJoin.jsx)

**Files:** HospitalPatientJoin.jsx (76–159, 219–239)

**Status:** Partial

**Current behavior:**
- **Returning patient:** `getOrCreatePatientToken()` (31–36) reads `localStorage.getItem(PATIENT_TOKEN_KEY)`; if present, that token is reused. So returning patients reuse the same patientToken. No separate “returning patient” flag that skips UI.
- **Name input:** After language selection, `showLangGrid` becomes false and the user sees the name input (“Please enter your name (as shown on passport)”) and “통역 시작” (disabled until `patientName.trim()`). So returning patients do not skip the name screen; they must enter a name every time.
- **Session separator:** No session separator or divider is rendered in ChatScreen or HospitalPatientJoin for “new visit” vs “same visit”. ChatScreen PT- history merges all messages from the room; there is no UI divider between sessions.

**Root cause (partial):** Returning patient is detected only in the sense that the same patientToken is reused; there is no “skip name input” or “session divider” feature.

**Code excerpt:**
```js
// handleJoin (84-85)
const patientToken = urlToken ? String(urlToken).trim() : getOrCreatePatientToken();
// ...
setIsExistingSession(data.isExistingSession === true);  // from API, not used to skip name

// Name required (253)
disabled={!patientName.trim()}
```

---

### AREA 8: Department name display (HospitalPatientJoin + server)

**Files:** HospitalPatientJoin.jsx (40, 46–53, 181–191), server.js (GET /api/hospital/join not returning dept display name), src/constants/hospitalDepartments.js

**Status:** Partial

**Current behavior:**
- Route is `/hospital/join/:orgCode`. `orgCode` is the URL param (e.g. `reception`, `CHEONGDAM`).
- **Department name:** `dept` is computed as `HOSPITAL_DEPARTMENTS.find((d) => d.id === orgCode)` (47–48). If not found, then if `orgCode === "consultation"` it uses a hardcoded object; otherwise it uses `{ id: orgCode || "general", labelKo: "병원 통역", label: "Hospital", icon: "🏥" }`. So the label is from the frontend constant list keyed by `id` (reception, internal, surgery, …), not from server or org_departments.
- **Org like CHEONGDAM:** `HOSPITAL_DEPARTMENTS` has ids such as reception, internal, plastic_surgery, etc. There is no `id: "CHEONGDAM"`. So for `/hospital/join/CHEONGDAM`, `found` is undefined and the fallback applies: patient sees `labelKo: "병원 통역"`, `label: "Hospital"`, `icon: "🏥"`. The server is not queried for org name or org_departments; the client never fetches org display name by org_code.

**Root cause:** Department/org display is driven only by `orgCode` and the static `HOSPITAL_DEPARTMENTS` list. Org-specific names (e.g. “청담성형”) are not loaded from `organizations` or `org_departments`; for unknown orgCode the user sees the generic “병원 통역” / “Hospital”.

**Code excerpt:**
```js
// HospitalPatientJoin (47-52)
const dept = useMemo(() => {
  const found = HOSPITAL_DEPARTMENTS.find((d) => d.id === orgCode);
  if (found) return found;
  if (orgCode === "consultation") return { id: "consultation", labelKo: "진료실", ... };
  return { id: orgCode || "general", labelKo: "병원 통역", label: "Hospital", icon: "🏥" };
}, [orgCode]);
// Rendered: dept.labelKo, dept.label (181-190)
```

---

*End of status report. No code was modified.*
