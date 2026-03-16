# PT- 방 게스트(환자) 메시지 경로 추적 보고서

**작성**: 읽기 전용 (코드 수정 없음)  
**대상**: `server.js` — GUEST 메시지가 (A) send-message, (B) stt:segment_end, (C) stt:whisper 로 들어올 때의 전체 경로 및 `hospital_messages` INSERT 위치.

---

## 1. 경로 A: send-message (텍스트 입력)

### 1.1 진입점
- **핸들러**: `socket.on('send-message', async (data, ack) => { ... })`
- **위치**: server.js **L3851** 근처

### 1.2 oneToOne 분기 및 INSERT
- **분기**: `if (roomType === "oneToOne")` — **L3921**
- **receive-message 전송**: 상대에게만 전송
  - `io.to(targetSocketId).emit('receive-message', { ... })` — **L3952–3960**
  - 또는 `socket.to(roomId).emit('receive-message', ...)` (상대 소켓 없을 때) — **L3976–3985**
- **발신자(sender)에게 receive-message를 보내는 코드 없음** → 게스트가 텍스트 보낼 때 게스트 클라이언트는 receive-message 수신 안 함.

### 1.3 hospital_messages INSERT (정확한 위치)
- **위치**: **L4037–4061**
- **조건**:
  - `(isHospitalMsg2 || (roomId && roomId.startsWith('PT-'))) && roomId`
  - `isHospitalMsg2 = String(meta.siteContext || "").startsWith("hospital_")` (L3929)
- **INSERT 문**:
```javascript
// L4055-4058
await dbRun(
  `INSERT OR IGNORE INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, activeSession2?.id || null, roomId, senderRole, fromLang, trimmedText, draft || '', toLang, pToken2]
);
```
- **sender_role**: `rec.role === 'owner' ? 'host' : 'guest'` (L4054), `rec = SOCKET_ROLES.get(socket.id)` (send-message 핸들러 상단 근처).

### 1.4 같은 메시지가 두 번 INSERT될 가능성 (경로 A)
- **한 번만 INSERT**: send-message 핸들러 내에서 한 번만 실행되며, **INSERT OR IGNORE** 이므로 동일 `id`로 재호출 시 두 번째는 무시됨.
- **receive-message 핸들러에서 INSERT 여부**: server.js 에서 `receive-message` **이벤트 핸들러는 없음**. receive-message는 **서버가 클라이언트로 보내는 emit**일 뿐이므로, 이 경로에서 두 번째 INSERT는 없음.
- **결론**: 경로 A에서는 **동일 게스트 메시지에 대해 한 번만 INSERT** (OR IGNORE로 중복 방지).

---

## 2. 경로 B: stt:segment_end (음성/STT)

### 2.1 진입점
- **핸들러**: `socket.on("stt:segment_end", async ({ roomId, participantId }) => { ... })`
- **위치**: server.js **L3261**

### 2.2 플로우 요약
- STT 결과 텍스트 확정 후 `emitTranslated(finalText)` 호출 (oneToOne 분기 내).
- **oneToOne 분기**: `if (roomType === "oneToOne")` — **L3339**
- **상대에게 receive-message**: `io.to(targetSocketId).emit("receive-message", ...)` (L3409 또는 L3419) 또는 `socket.to(roomId).emit("receive-message", ...)` (L3439).
- **발신자에게 receive-message (echo)**:
```javascript
// L3464-3471
socket.emit("receive-message", {
  id: msgId, roomId, roomType,
  senderPid: participantId,
  senderCallSign: senderP?.nativeName || "",
  originalText: finalText, translatedText: finalText,
  text: finalText,
  isDraft: true, at: Date.now(), timestamp: Date.now(),
});
```
→ **서버는 stt:segment_end 경로에서 발신자(게스트)에게도 receive-message를 보냄.**

### 2.3 hospital_messages INSERT (정확한 위치)
- **위치**: **L3502–3530**
- **조건**:
  - `shouldSaveMessages = !meta.hospitalEndedSession && (meta.saveMessages === true || (meta.saveMessages !== false && isHospitalMsg) || (roomId && roomId.startsWith('PT-')))` (L3504)
  - `if (shouldSaveMessages && roomId)` (L3505)
- **INSERT 문**:
```javascript
// L3525-3529
await dbRun(
  `INSERT INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [msgId, activeSession?.id || null, roomId, senderRole, fromLang, finalText, translated || '', toLang, pToken]
);
```
- **sender_role**: `senderRole = rec.role === 'owner' ? 'host' : 'guest'` (L3523), `rec`는 `emitTranslated` 클로저에서 사용되는 역할(이 소켓이 stt:segment_end를 보낸 발신자).

### 2.4 같은 메시지가 두 번 INSERT될 가능성 (경로 B)
- **서버 내**: stt:segment_end 한 번 처리당 `emitTranslated` 한 번 호출, 그 안에서 INSERT 한 번만 수행. **서버에서는 한 메시지당 한 번만 INSERT.**
- **클라이언트가 받은 receive-message로 인한 추가 저장**: 아래 “5. FixedRoomVAD.jsx” 참조. 발신자(게스트)가 **자기 echo**를 받으면 `saveMessageToServer`가 호출될 수 있으나, **POST /api/hospital/message**는 **requireHospitalOrg**로 보호되어 있어 **PT- 일반 세션(org 없음)**에서는 세션을 찾지 못해 404가 나고 INSERT되지 않음. **org 소속 PT- 세션**이면 같은 메시지가 서버 INSERT + 클라이언트 POST로 **두 번 저장될 가능성 있음.**

---

## 3. 경로 C: stt:whisper (음성 업로드)

### 3.1 진입점
- **핸들러**: `socket.on("stt:whisper", ...)`
- **위치**: server.js **L3727** 근처

### 3.2 조건
- `whisperHospitalMode && roomId` (L3788)
- `isHospital1to1 && !meta.hospitalEndedSession` (L3792)
- `isHospital1to1 = meta.roomType === "oneToOne" && String(meta.siteContext || "").startsWith("hospital_")` (L3791)

### 3.3 hospital_messages INSERT (정확한 위치)
- **위치**: **L3829–3834**
- **INSERT 문**:
```javascript
// L3829-3833
await dbRun(
  `INSERT INTO hospital_messages (id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, patient_token)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [msgId, activeSession?.id || null, roomId, senderRole, fromLang, normalized, translatedText, toLang, pToken]
);
```
- **sender_role**: `senderRole = rec.role === "owner" ? "host" : "guest"` (L3794), `rec = SOCKET_ROLES.get(socket.id)` (L3793).

### 3.4 receive-message / 추가 INSERT
- 이 블록 안에서는 **receive-message를 emit하지 않음**.  
- `socket.emit("stt:result", { roomId, participantId, text: normalized, final: true });` (L3845) 및 `ackReply` 만 수행.
- **결론**: 경로 C에서는 **한 번만 INSERT** 되며, receive-message로 인한 서버 측 추가 INSERT나 동일 경로 내 중복 INSERT 없음.

---

## 4. 서버가 receive-message를 발신자에게도 보내는지 여부

| 경로              | 상대에게 emit                    | 발신자에게 emit (echo)     |
|-------------------|----------------------------------|----------------------------|
| **send-message**  | `io.to(targetSocketId)` / `socket.to(roomId)` | **없음** (L3952, L3976만 존재) |
| **stt:segment_end** | `io.to(targetSocketId)` / `socket.to(roomId)` | **있음** `socket.emit("receive-message", ...)` (L3465) |
| **stt:whisper**   | 없음 (receive-message 미사용)   | 없음                       |

- **send-message**: 발신자에게는 receive-message를 보내지 않음.
- **stt:segment_end**: 발신자에게 **echo**로 receive-message를 보냄.

---

## 5. 발신자 클라이언트가 자기 메시지를 받고 재전송/중복 저장할 수 있는지

- **재전송**: FixedRoomVAD에서 receive-message 수신 시 **send-message를 다시 보내는 코드는 없음**. 수신 시에는 메시지 목록에 추가·저장 API 호출만 있음.
- **중복 저장**:
  - **서버**: send-message는 `INSERT OR IGNORE` + 동일 `id` 사용으로 한 번만 저장. stt:segment_end / stt:whisper는 각각 한 경로당 한 번만 INSERT.
  - **클라이언트**: receive-message 수신 시 `saveMessageToServer` 호출 가능 (아래 6절). 이때 **POST /api/hospital/message**는 **requireHospitalOrg**이며, `hospital_sessions`에서 `org_id`로 세션을 조회. **PT- 방이 org에 묶여 있지 않으면** 세션을 찾지 못해 404 → INSERT 없음. **org에 묶인 PT- 세션이면** stt:segment_end로 저장한 뒤, 클라이언트가 echo를 받고 POST로 한 번 더 보낼 경우 **같은 내용이 다른 id로 한 번 더 INSERT될 수 있음** (POST는 매번 새 uuid 생성, L5741).

---

## 6. FixedRoomVAD.jsx — receive-message 수신 시 저장 API 호출 여부

- **있음.** receive-message(및 stream-end) 처리 시 `saveMessages && sessionIdRef.current` 이면 `saveMessageToServer` 호출.
- **관련 코드**:
  - **L182–203**: `saveMessageToServer` 정의. 내부에서 **POST `/api/hospital/message`** 호출 (L195).
  - **L1042–1054**: receive-message 처리 시 `saveMessageToServer({ sessionId: sessionIdRef.current, roomId, patientToken, senderRole, ... })` 호출 (L1043–1052). `savedMessageIdsRef.current.add(id)` 로 중복 호출 방지.
- **동작**: **같은 소켓에서 같은 메시지 id를 두 번 받으면** `savedMessageIdsRef` 때문에 두 번째는 저장 생략. 하지만 **stt:segment_end**에서는 서버가 **발신자에게도** receive-message를 보내므로, **게스트가 말한 한 번의 발화**에 대해 서버 INSERT 1회 + 게스트 클라이언트가 자기 echo를 받고 POST 1회 할 수 있음. 이 POST가 성공하려면 **requireHospitalOrg**를 만족하는 세션이어야 함 (일반 PT- 세션은 실패할 가능성이 높음).

---

## 7. hospital_messages INSERT 요약표 (게스트 메시지, PT- 방)

| 경로              | INSERT 위치 (server.js) | guard 조건 | INSERT 종류 | 같은 메시지 두 번 INSERT 가능성 (서버만) |
|-------------------|--------------------------|------------|-------------|------------------------------------------|
| **A. send-message**   | L4055–4058               | `(isHospitalMsg2 \|\| roomId.startsWith('PT-')) && roomId` | INSERT OR IGNORE | 없음 (동일 id면 1건만 유지) |
| **B. stt:segment_end**| L3525–3529               | `shouldSaveMessages && roomId`, PT- 또는 hospital 컨텍스트 | INSERT           | 없음 (한 요청당 1회) |
| **C. stt:whisper**   | L3829–3833               | `whisperHospitalMode && roomId`, `isHospital1to1 && !meta.hospitalEndedSession` | INSERT           | 없음 (한 요청당 1회) |

- **receive-message 핸들러**: server에는 **receive-message를 처리하는 핸들러가 없음**. receive-message는 서버 → 클라이언트 emit 전용이므로, 서버 측에서 receive-message로 인한 INSERT는 없음.
- **이중 저장 가능성**: 서버만 보면 **같은 게스트 메시지가 서버에서 두 번 INSERT되는 경로는 없음**. 다만 **stt:segment_end** 시 발신자에게 echo를 보내고, **FixedRoomVAD**가 그 echo로 **POST /api/hospital/message**를 호출할 수 있으며, 해당 API는 **requireHospitalOrg** + org 소속 세션일 때만 INSERT하므로, **org 소속 PT- 세션**인 경우에만 “서버 1회 + 클라이언트 요청 1회”로 **두 개의 행**이 생길 수 있음.

---

## 8. 참고: POST /api/hospital/message (L5730–5751)

- **라우트**: `app.post('/api/hospital/message', requireHospitalOrg, ...)` (L5731).
- **INSERT**: L5742–5746, **새 uuid** 생성 후 INSERT. 컬럼에 **org_id, session_type** 사용 (PT- 소켓 경로의 INSERT와 스키마가 다름).
- **역할**: **org 소속 병원 세션**용 메시지 저장. PT- 방의 실시간 소켓 경로(A/B/C)와는 별개 API이지만, 클라이언트가 receive-message 시 이 API를 호출하면 **org 세션일 때만** DB에 한 건 더 들어갈 수 있음.

---

*문서 끝. 코드 수정 없이 읽기 전용으로 작성됨.*
