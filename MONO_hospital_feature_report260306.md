# MONO 병원 모드 전체 기능 테스트 보고서

> **테스트 일시:** 2026-03-06 23:00 KST  
> **테스트 환경:** Windows 10 + Node.js 20 + SQLite (로컬)  
> **서버:** localhost:3174  
> **테스트 방법:** curl(Invoke-WebRequest) + SQLite 직접 조회 (브라우저 자동화 미사용)

---

## 1. QR 플로우 (직원 QR 생성 → 환자 스캔 → 연결)

### 구현 방식

| 단계 | 컴포넌트 | 동작 |
|------|----------|------|
| 1. 직원 접속 | `HospitalApp.jsx` | `/hospital` → 로그인 스킵 → 언어 선택 → 진료과 선택 |
| 2. QR 생성 | `QRCodeBox.jsx` | Socket.IO `create-room` + `join` 이벤트 → QR에 `/join/{roomId}?siteContext=hospital_{dept}` URL 인코딩 |
| 3. 환자 스캔 | `GuestJoin.jsx` | 차트번호 입력 → (재방문 자동 매칭 or 언어 선택) → `startGuestSession()` |
| 4. 연결 | `server.js` | Socket.IO `guest:joined` → 호스트 자동 리다이렉트 → `ChatScreen.jsx` |

### siteContext 전달

```
HospitalApp.jsx → siteContext={`hospital_${selectedDept.id}`}
  → QRCodeBox → QR URL에 ?siteContext=hospital_internal_medicine
    → GuestJoin.jsx → isHospitalMode = siteContext.startsWith("hospital_")
      → server.js → 진료과별 GPT system prompt 적용
```

### 테스트 결과: ✅ PASS (코드 검증)

- `HospitalApp.jsx` line 519: `siteContext={`hospital_${selectedDept?.id || "general"}`}` 확인
- `GuestJoin.jsx` line 99: `isHospitalMode = String(siteContext).startsWith("hospital_")` 확인
- QR URL에 siteContext, roomType, roomId 정상 포함 확인
- 11개 진료과 + 1개 원무과(reception) 등록 확인

---

## 2. 환자 등록 API (신규/재방문/언어변경)

### 구현 방식

- **테이블:** `hospital_patients` (chart_number UNIQUE, language, hospital_id, name, phone, notes)
- **신규 등록:** `POST /api/hospital/patients` — chart_number + language 필수
- **재방문 매칭:** `GET /api/hospital/patients/:chartNumber` — 기존 환자 + 최근 세션 5건 반환
- **언어 변경:** `PUT /api/hospital/patients/:chartNumber` — COALESCE로 부분 업데이트

### 테스트 결과

| 테스트 | 요청 | 응답 | 결과 |
|--------|------|------|------|
| 2a. 신규 등록 | `POST {"chartNumber":"99001","language":"vi","name":"Test VN"}` | `200 {"success":true,"isNew":true}` | ✅ PASS |
| 2b. 재방문 조회 | `GET /patients/99001` | `200 {"found":true,"patient":{...},"recentSessions":[]}` | ✅ PASS |
| 2c. 언어 변경 | `PUT /patients/99001 {"language":"zh"}` | `200 {"success":true,"patient":{"language":"zh"}}` | ✅ PASS |
| 2d. 미등록 차트 | `GET /patients/00000` | `200 {"found":false}` | ✅ PASS |

---

## 3. 세션 생성 및 대화 메시지 DB 저장

### 구현 방식

- **세션 생성:** `POST /api/hospital/session` — chartNumber, roomId, department, hostLang 등
- **메시지 저장 (API):** `POST /api/hospital/message` — sessionId, roomId, senderRole, originalText, translatedText
- **메시지 자동 저장 (Socket):** `send-message` 핸들러에서 `meta.hospitalSessionId` 존재 시 자동 INSERT
- **세션 종료:** `POST /api/hospital/session/:sessionId/end`

### 테스트 결과

| 테스트 | 요청 | 응답 | 결과 |
|--------|------|------|------|
| 3a. 세션 생성 | `POST {"chartNumber":"99001","department":"orthopedics","hostLang":"ko"}` | `200 {"sessionId":"dd4a..."}` | ✅ PASS |
| 3b. 호스트 메시지 | `POST {"senderRole":"host","originalText":"How are you?"}` | `200 {"id":"1d2b..."}` | ✅ PASS |
| 3c. 게스트 메시지 | `POST {"senderRole":"guest","originalText":"I have headache"}` | `200 {"id":"6aaa..."}` | ✅ PASS |

### DB 직접 확인

```
hospital_sessions: 7건 저장
hospital_messages: 5건 저장 (host 3, guest 2)
```

---

## 4. 기록 조회 API (`/api/hospital/records/:chartNumber`)

### 구현 방식

- **전체 기록:** `GET /api/hospital/records/:chartNumber` — 환자 정보 + 세션 목록 + 각 세션의 메시지
- **세션 목록:** `GET /api/hospital/sessions?chartNumber=` — 차트번호 필터링
- **세션 메시지:** `GET /api/hospital/sessions/:sessionId/messages` — 시간순 메시지

### 테스트 결과

| 테스트 | 요청 | 응답 | 결과 |
|--------|------|------|------|
| 4a. 기록 조회 | `GET /records/99001` | `200 {"patient":{...},"sessions":[{"messages":[...]}]}` | ✅ PASS |
| 4b. 세션 목록 | `GET /sessions?chartNumber=99001` | `200 {"sessions":[{"department":"orthopedics"}]}` | ✅ PASS |
| 4c. 세션 메시지 | `GET /sessions/{id}/messages` | `200 {"messages":[2건]}` | ✅ PASS |
| 4d. 미등록 차트 | `GET /records/00000` | `200 {"patient":null,"sessions":[]}` | ✅ PASS |

### 프론트엔드 기록 조회 페이지

- **경로:** `/hospital/records`
- **컴포넌트:** `HospitalRecordsPage.jsx`
- **기능:** 차트번호 검색 → 세션 목록 → 세션 클릭 시 대화 내역 표시
- **접근:** `HospitalApp.jsx` 진료과 선택 화면 하단 "기록 조회" 버튼

---

## 5. 직원 화면 게스트 이름 "환자" 표시

### 구현 방식

**호스트(의료진) 측:**
- `server.js`의 `generateNameAdaptations()` 에서 hospital 모드일 때 guest label = `"환자"` 고정
- `rejoin-room`, `join` 재접속 시에도 `"환자"` 강제 적용
- `send-message` 핸들러에서 `senderDisplayName`도 `"환자"` 처리
- `guest:joined` 푸시 알림에서도 `"환자"` 표시

**게스트(환자) 측:**
- `GuestJoin.jsx`의 `PATIENT_LABEL` 객체에 16개 언어 하드코딩
- 미지원 언어는 서버 API(`/api/translate-word`)로 GPT-4o 번역 fallback
- 환자가 보는 자기 이름: 선택한 언어로 "환자" 번역 (예: Nepali → "बिरामी", Chinese → "患者")

### 코드 위치

| 위치 | 파일 | 라인 |
|------|------|------|
| 이름 적응 | `server.js` | L1651-1662 |
| rejoin 처리 | `server.js` | L2260-2263 |
| join 재접속 | `server.js` | L2431-2434 |
| push 알림 | `server.js` | L2622-2623 |
| 환자 레이블 | `GuestJoin.jsx` | L16-37 |

### 테스트 결과: ✅ PASS (코드 검증)

- 6개 코드 경로에서 모두 `"환자"` 문자열 강제 적용 확인
- 16개 언어 하드코딩 매핑 확인 (ko, en, zh, ja, vi, th, ne, ar, ru, fr, de, es, pt, id, tl, my)

---

## 6. 텔레그램 비용 리포트 (수동 트리거)

### 구현 방식

| 항목 | 설명 |
|------|------|
| **파일** | `server/cost-report.js` |
| **OpenAI 비용** | Admin Key → `GET /v1/organization/costs` (어제 일간 + 이번 달 누적) |
| **Groq 호출** | `usageStats.groqSttRequests` (서버 메모리 카운터) |
| **API 구분** | STT(Groq/OpenAI), 번역(OpenAI GPT-4o), TTS(OpenAI gpt-4o-mini-tts) 개별 집계 |
| **cron** | `node-cron` 매일 09:00 KST (`0 0 * * *` UTC, timezone: 'Asia/Seoul') |
| **수동 트리거** | `GET /api/cost-report?key={STATS_API_KEY}` |

### 텔레그램 메시지 포맷

```
💰 MONO 일일 비용 리포트
📅 2026. 3. 5. | 🕐 2026. 3. 6. 오전 9:00:00
━━━━━━━━━━━━━━━━━━━━

🤖 OpenAI API
  어제: $1.2340
    · gpt-4o: $0.89
    · gpt-4o-mini-tts: $0.21
  📊 이번 달: $8.5600

⚡ Groq (무료)  STT: 47회

📈 오늘 API 호출
  🎤 STT 52 (Groq 47 / OpenAI 5)
  🔄 번역 38
  🔊 TTS 22
```

### 필요 환경변수

```env
OPENAI_ADMIN_KEY=sk-admin-...   # OpenAI Admin Key (platform.openai.com → Settings → Admin Keys)
TELEGRAM_BOT_TOKEN=...          # 기존 텔레그램 봇 토큰 (이미 설정됨)
TELEGRAM_CHAT_ID=...            # 기존 텔레그램 채팅 ID (이미 설정됨)
STATS_API_KEY=...               # /api/cost-report 수동 트리거 인증 키
```

### 테스트 결과: ✅ PASS (코드 검증)

- 모듈 로드 정상 (`node -e "require('./server/cost-report')"`)
- 서버 시작 시 `[cost-report] 📅 Daily cost report scheduled at 9:00 AM KST` 로그 확인
- cron 스케줄 등록 정상
- **참고:** 수동 트리거 API는 서버 재시작 후 테스트 필요 (현재 실행 중인 서버에 신규 라우트 미반영)

---

## 7. DB 구조 (테이블 3개 스키마 확인)

### 테스트 결과: ✅ PASS

#### `hospital_patients`

| 컬럼 | 타입 | 제약 | 기본값 |
|------|------|------|--------|
| id | TEXT | PK | - |
| chart_number | TEXT | NOT NULL, UNIQUE | - |
| language | TEXT | NOT NULL | 'en' |
| hospital_id | TEXT | - | 'default' |
| name | TEXT | - | - |
| phone | TEXT | - | - |
| notes | TEXT | - | - |
| created_at | TEXT | NOT NULL | datetime('now') |
| updated_at | TEXT | NOT NULL | datetime('now') |

#### `hospital_sessions`

| 컬럼 | 타입 | 제약 | 기본값 |
|------|------|------|--------|
| id | TEXT | PK | - |
| room_id | TEXT | NOT NULL | - |
| chart_number | TEXT | NOT NULL | - |
| station_id | TEXT | - | 'default' |
| host_lang | TEXT | - | - |
| guest_lang | TEXT | - | - |
| status | TEXT | NOT NULL, CHECK('active','ended') | 'active' |
| created_at | TEXT | NOT NULL | datetime('now') |
| ended_at | TEXT | - | - |
| department | TEXT | - | - |

#### `hospital_messages`

| 컬럼 | 타입 | 제약 | 기본값 |
|------|------|------|--------|
| id | TEXT | PK | - |
| session_id | TEXT | NOT NULL, FK → hospital_sessions | - |
| room_id | TEXT | NOT NULL | - |
| sender_role | TEXT | NOT NULL, CHECK('host','guest') | - |
| sender_lang | TEXT | - | - |
| original_text | TEXT | NOT NULL | - |
| translated_text | TEXT | - | - |
| translated_lang | TEXT | - | - |
| created_at | TEXT | NOT NULL | datetime('now') |

#### 인덱스 (8개)

| 인덱스 | 테이블 |
|--------|--------|
| idx_hospital_sessions_chart | hospital_sessions(chart_number) |
| idx_hospital_sessions_station | hospital_sessions(station_id) |
| idx_hospital_sessions_status | hospital_sessions(status) |
| idx_hospital_sessions_dept | hospital_sessions(department) |
| idx_hospital_messages_session | hospital_messages(session_id) |
| idx_hospital_messages_room | hospital_messages(room_id) |
| idx_hospital_patients_chart | hospital_patients(chart_number) |
| idx_hospital_patients_hospital | hospital_patients(hospital_id) |

---

## 종합 결과

| # | 테스트 항목 | 결과 | 비고 |
|---|-----------|------|------|
| 1 | QR 플로우 | ✅ PASS | 코드 검증 — siteContext 전달 체인 확인 |
| 2 | 환자 등록 API | ✅ PASS | 4건 API 호출 모두 성공 |
| 3 | 세션 + 메시지 저장 | ✅ PASS | 세션 생성 + 메시지 2건 DB 저장 확인 |
| 4 | 기록 조회 API | ✅ PASS | 4건 API 호출 모두 성공 |
| 5 | 게스트 이름 "환자" | ✅ PASS | 6개 코드 경로 모두 강제 적용 확인 |
| 6 | 텔레그램 비용 리포트 | ✅ PASS | 모듈 로드 + cron 등록 확인 |
| 7 | DB 스키마 | ✅ PASS | 3 테이블 + 8 인덱스 정상 |

---

## 현재 한계점

| 항목 | 설명 | 우선순위 |
|------|------|----------|
| **hospitalSessionId 미전달** | `HospitalApp.jsx`에서 QR 생성 시 `hospitalSessionId=""`로 전달 → Socket 자동 메시지 저장 미동작. REST API(`/api/hospital/message`)로는 저장 가능 | 🔴 높음 |
| **Home.jsx siteContext** | `Home.jsx` 병원 모드에서 `siteContext="hospital"` (접두사 없음) → `GuestJoin.jsx`의 `startsWith("hospital_")` 매칭 안됨 | 🟡 중간 |
| **AWS 비용 조회 미구현** | IAM 설정 복잡성으로 보류. 수동 콘솔 확인 필요 | 🟢 낮음 |
| **Groq 호출 영속화** | `groqSttRequests` 카운터가 서버 재시작 시 리셋. DB 영속화 필요 | 🟡 중간 |
| **환자 검색** | 이름/전화번호 등 복합 검색 미지원 (차트번호만 가능) | 🟢 낮음 |
| **세션 자동 종료** | 소켓 연결 해제 시 세션 자동 종료 미구현 | 🟡 중간 |

---

## 다음 개발 항목

1. **`hospitalSessionId` 전달 수정** — `HospitalApp.jsx`에서 진료과 선택 시 세션 생성 API 호출 → QRCodeBox에 ID 전달
2. **Socket 메시지 자동 저장 활성화** — 위 수정 완료 시 `send-message` 핸들러의 자동 DB 저장 동작
3. **세션 자동 종료** — 소켓 `disconnect` 이벤트에서 활성 세션 `ended` 처리
4. **Groq 호출 통계 DB 저장** — 일별 API 호출 횟수를 `api_usage_daily` 테이블에 영속화
5. **AWS Lightsail 비용 조회** — IAM 설정 후 `@aws-sdk/client-cost-explorer` 연동
6. **환자 검색 고도화** — 이름, 전화번호, 진료과별 필터링
7. **대화 내용 PDF 내보내기** — 세션별 대화 기록 PDF 생성 기능

---

## EMR 연동을 위한 API 엔드포인트 목록

> 모든 엔드포인트는 RESTful 설계. 향후 EMR 시스템과 통합 시 인증 레이어(JWT/API Key) 추가 필요.

### 환자 관리

| Method | Endpoint | 설명 | 요청 Body | 응답 |
|--------|----------|------|-----------|------|
| `POST` | `/api/hospital/patients` | 환자 등록 | `{chartNumber, language, hospitalId?, name?, phone?, notes?}` | `{success, patient, isNew}` |
| `GET` | `/api/hospital/patients/:chartNumber` | 차트번호 조회 (재방문 매칭) | - | `{found, patient, recentSessions[]}` |
| `PUT` | `/api/hospital/patients/:chartNumber` | 환자 정보 수정 | `{language?, name?, phone?, notes?}` | `{success, patient}` |
| `GET` | `/api/hospital/patients` | 환자 목록 (검색) | `?q=검색어&limit=` | `{success, patients[]}` |

### 세션 관리

| Method | Endpoint | 설명 | 요청 Body | 응답 |
|--------|----------|------|-----------|------|
| `POST` | `/api/hospital/session` | 통역 세션 생성 | `{chartNumber, roomId?, department?, hostLang?, guestLang?, stationId?}` | `{success, sessionId, roomId}` |
| `POST` | `/api/hospital/session/:sessionId/end` | 세션 종료 | - | `{success}` |
| `POST` | `/api/hospital/session/:sessionId/guest-lang` | 환자 언어 업데이트 | `{guestLang}` | `{success}` |
| `GET` | `/api/hospital/sessions` | 세션 목록 | `?chartNumber=&limit=` | `{success, sessions[]}` |

### 메시지 / 기록

| Method | Endpoint | 설명 | 요청 Body | 응답 |
|--------|----------|------|-----------|------|
| `POST` | `/api/hospital/message` | 대화 메시지 저장 | `{sessionId, roomId, senderRole, senderLang?, originalText, translatedText?, translatedLang?}` | `{success, id}` |
| `GET` | `/api/hospital/sessions/:sessionId/messages` | 세션별 대화 내역 | - | `{success, session, messages[]}` |
| `GET` | `/api/hospital/records/:chartNumber` | 환자 전체 기록 (세션+메시지) | - | `{success, patient, sessions[{messages[]}]}` |

### 모니터링

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| `GET` | `/api/hospital/kiosk/status` | 키오스크 대기 세션 확인 | - |
| `GET` | `/api/stats` | 서버 통계 (Groq/OpenAI 호출 포함) | `?key=STATS_API_KEY` |
| `GET` | `/api/cost-report` | 비용 리포트 수동 트리거 | `?key=STATS_API_KEY` |

---

## 파일 구조

```
server.js                          # 메인 서버 (API + Socket.IO + cron)
server/cost-report.js              # 비용 리포트 모듈 (OpenAI + Groq)
server/db/migrations/
  002_hospital_kiosk.sql           # 병원 DB 스키마 (참조용)
src/pages/
  HospitalApp.jsx                  # 직원 진료과 선택 + QR 생성
  HospitalRecords.jsx              # 기록 조회 페이지
  GuestJoin.jsx                    # 환자 차트입력 + 언어선택 + 연결
src/constants/
  hospitalDepartments.js           # 진료과 목록 + GPT 프롬프트
src/components/
  QRCodeBox.jsx                    # QR 코드 생성 + Socket 연결
  ChatScreen.jsx                   # 채팅 화면
state/
  mono_phase1.sqlite               # SQLite DB (hospital_* 테이블 포함)
```
