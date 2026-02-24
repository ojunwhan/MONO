# MONO 인계 문서 (최신 덮어쓰기)

## 1. 프로젝트 현재 방향
- 제품 방향: **PWA 유지**, 현장 실사용 안정성 우선
- 원칙: UI/CSS 레이아웃 변경 최소, 동작 신뢰성/복구성/정합성 중심
- 운영 URL: `https://lingora.chat`

## 2. 최근 완료 범위 (Step 1-4 ~ Step 2-6)

### 2.1 로컬 저장소/메타데이터 강화
- `src/db/index.js`
  - Dexie v2 마이그레이션 추가
  - `messages` 스토어 신설
  - `rooms` 메타 확장(`updatedAt`, `pinned`)
  - 메시지 API 추가:
    - `saveMessage()`
    - `getMessages()`
    - `deleteMessages()`
    - `getStorageUsage()`
  - outbox에 `participantId` 저장하도록 수정 (중요 버그 수정)

### 2.2 ChatScreen 저장 전환 및 상태 동기화
- `src/components/ChatScreen.jsx`
  - 메시지 저장: localStorage 방식 제거, IndexedDB 사용으로 전환
  - 메시지 상태 이벤트 반영:
    - `message-status` 수신 시 `accepted/delivered/read` 처리
    - 상태 반영 시 `queued:false`로 정리
  - 읽음 전송 안정화:
    - 메시지 업데이트 시 읽음 전송
    - `visibilitychange -> visible`에서도 읽음 재시도
  - room 필터 강화:
    - 현재 방이 아닌 `payload.roomId` 이벤트 무시
  - timestamp 정합성:
    - `payload.timestamp || payload.at || Date.now()` 우선 사용

### 2.3 서버 API/스키마 정합성 (Step 1-5)
- `server/routes/auth_api.js`
  - 호환 엔드포인트 추가:
    - `/api/users/me` (`GET`, `PUT`)
    - `/api/friends/*` (search/list/request/accept/reject/delete)
    - `/api/rooms` (`POST`, `GET`)
    - `/api/rooms/:id/members`
    - `/api/rooms/:id/read`
  - 기존 `/api/contacts/*`는 유지 (하위 호환)

- DB 마이그레이션
  - `server/db/migrations/001_phase1_core_sqlite.sql`
  - `server/db/migrations/001_phase1_core_postgres.sql`
  - `room_members.last_read_message_id` 추가
  - `server/db/run_migration_sqlite.js`에서 기존 DB 백필 안전 처리

### 2.4 전송 신뢰성 (ACK/재시도/중복 방지)
- `server.js`
  - `send-message`에 ACK 콜백 지원
  - 실패 ACK 상세 반환:
    - `rate_limited`, `invalid_payload`, `unauthorized`, `text_too_long` 등
  - 중복 메시지 ID면 `ok:true, duplicate:true` 반환
  - 정상 수락 시 `ok:true, accepted:true` 즉시 반환

- `src/hooks/useOutbox.js`
  - ACK 기반 전송으로 변경
  - ACK 실패/타임아웃 시 queue 적재
  - flush 시 ACK 성공 메시지만 dequeue
  - 순서 보장 위해 실패 시 flush 중단

### 2.5 이벤트 스키마 일관화
- `server.js`
  - `receive-message`, `recent-messages` 스키마 통일
  - 공통 필드 보장:
    - `id`, `roomId`, `roomType`, `senderPid`
    - `originalText`, `translatedText`, `text`
    - `timestamp`
  - `participants` 이벤트에 `online` 필드 추가
  - `message-status`, `message-read` 이벤트 추가

### 2.6 Global 탭 최소 기능 (Step 3-1 / 3-2 진행)
- `server.js`
  - `join-global` 이벤트 추가
    - 글로벌 방 생성/조인/참여자 등록 원자 처리
    - `call-sign-assigned`, `room-context`, `participants` 동기화
    - ACK로 `roomId/roleHint/callSign` 반환
- `src/pages/Global.jsx`
  - 스텁에서 실동작 페이지로 전환
  - 글로벌 채널 입장 버튼 -> `join-global` -> `/room/global-lobby` 이동
  - 로딩/상태 텍스트/타임아웃/오류 처리 추가

## 3. 검증 결과 (최근)
- `npm run build`: 성공
- lints: 신규 오류 없음
- 서버 health: `GET /healthz` 정상
- 자동 소켓 검증 PASS:
  1) delivered/read 상태 전파
  2) duplicate msgId 방지
  3) unauthorized 전송 거절 ACK
  4) 6개 회귀 시나리오
     - participants
     - delivered/read
     - duplicate
     - unauthorized
     - rejoin
     - room-members
  5) payload 스키마 검증
     - `receive-message`
     - `recent-messages`
  6) room filter edge-case 검증 (타 방 메시지 무시)
  7) global broadcast 스모크 테스트 PASS (`join-global` 경로)

## 4. 현재 핵심 변경 파일
- `server.js`
- `server/routes/auth_api.js`
- `server/db/migrations/001_phase1_core_sqlite.sql`
- `server/db/migrations/001_phase1_core_postgres.sql`
- `server/db/run_migration_sqlite.js`
- `src/db/index.js`
- `src/hooks/useOutbox.js`
- `src/components/ChatScreen.jsx`
- `src/pages/RoomList.jsx`

## 5. 다음 작업 포인트
- PDF 기준 재정렬:
  - `MONO_Cursor_프롬프트_전체순서.md.pdf` 확인 후 Phase 4 정의를 재적용
  - Phase 4는 운영문서화가 아니라 `4-1 과금`, `4-2 소셜로그인`, `4-3 폰트/디자인`
- Step 4-1 (과금 체계) 구현 완료
  - DB: `users.plan`, `users.plan_expires_at`, `translation_usage`
  - 서버: 번역 시 사용자 월간 사용량 카운트 + free limit 초과 경고(`server-warning`)
  - API:
    - `GET /api/subscription/me`
    - `POST /api/subscription/checkout` (결제 연동 스텁)
    - `POST /api/subscription/webhook` (웹훅 스텁)
  - 클라이언트: `Settings`의 구독관리 카드(이번 달 번역 횟수/플랜/업그레이드 버튼)
- Step 4-2 (소셜로그인 확장) 진행 중
  - OAuth 계정 매핑 컬럼 추가: `google_id`, `kakao_id`, `line_id`, `apple_id`
  - 이메일 기반 계정 병합 로직 추가 (`upsertUserFromOAuth` 개선)
  - 소셜 로그인 라우트:
    - `Google`: `/auth/google` + `/api/auth/google` alias
    - `Kakao`: `/auth/kakao` + `/api/auth/kakao` alias
    - `LINE`: `/auth/line` + `/api/auth/line` alias
    - `Apple`: `/auth/apple` + `/api/auth/apple` alias
  - 콜백 라우트도 `/api/auth/*/callback` alias 지원
  - Apple OAuth는 form_post + token exchange(id_token 확보) 경로 반영
  - 로그인 JWT `sub`는 병합된 실제 사용자 레코드 id를 우선 사용하도록 수정
- 다음 우선순위
  - Step 4-3: 폰트 스택(Pretendard/Inter/Noto Sans JP)과 디자인 토큰 정리 완료
  - `docs/MONO_Cursor_프롬프트_전체순서.md` 기준 Phase 4 체크리스트(`4-1~4-3`) 완료 표시 반영
  - 운영 반영 전: 소셜 로그인 provider별 실제 키/콘솔 설정 검증(환경변수/redirect URI)

## 6. 주의 사항
- `.env`/키/비밀값은 문서에 기록하지 않음
- 기존 서버 보안/소켓 가드/rate-limit 로직은 유지
- 1:1 인원 제한 정책 유지 (테스트 시 재입장은 동일 participantId 기준으로 검증 필요)
