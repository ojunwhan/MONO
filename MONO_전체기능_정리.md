# MONO — AI 실시간 통역 메신저 전체 기능 정리

> **최종 업데이트:** 2026-03-04  
> **도메인:** https://lingora.chat  
> **인프라:** AWS Lightsail (Ubuntu) + Nginx + PM2  
> **스택:** React 18 + Vite 5 / Node.js + Express + Socket.IO / SQLite / IndexedDB (Dexie)

---

## 1. 프로젝트 개요

MONO는 **언어가 달라도 모국어로 실시간 대화**할 수 있는 AI 통역 메신저입니다.  
QR코드를 찍으면 상대방은 앱 설치 없이 브라우저에서 바로 통역 대화에 참여할 수 있습니다.

### 핵심 가치
- **QR 즉시 통역** — 회원가입 없이 QR 스캔만으로 실시간 통역 대화 시작
- **99개 언어 지원** — 한국어, 영어, 일본어, 중국어, 베트남어 등 99개 언어
- **PWA** — 웹브라우저에서 네이티브 앱처럼 동작 (설치 가능)

---

## 2. 기술 스택

| 영역 | 기술 |
|------|------|
| **프론트엔드** | React 18, Vite 5, Tailwind CSS 3, React Router 6, i18next |
| **백엔드** | Node.js, Express 4, Socket.IO 4 |
| **AI/ML** | OpenAI Whisper (STT), GPT-4o (번역), gpt-4o-mini-tts (TTS) |
| **데이터베이스** | SQLite 3 (서버, WAL 모드), IndexedDB/Dexie (클라이언트) |
| **인증** | JWT (httpOnly cookie), Google OAuth 2.0, Kakao OAuth |
| **푸시 알림** | Web Push (VAPID), Service Worker |
| **모니터링** | Telegram Bot API, cron + shell script, /api/stats |
| **배포** | AWS Lightsail, Nginx (reverse proxy + SSL), PM2, Git |

---

## 3. 프론트엔드 구조

### 3.1 라우팅 (`src/router.jsx`)

| 경로 | 컴포넌트 | 설명 |
|------|----------|------|
| `/` | rootRedirectLoader | 인증 상태에 따라 `/interpret` 또는 `/login`으로 리다이렉트 |
| `/login` | `Login.jsx` | 로그인 페이지 (Google, Kakao) |
| `/setup` | `Setup.jsx` | 첫 가입 시 이름 + 언어 설정 |
| `/interpret` | `Home.jsx` | **메인 통역 탭** — 언어 선택 + QR 생성 |
| `/home` | `RoomList.jsx` | 대화방 목록 (메신저 탭) |
| `/contacts` | `Contacts.jsx` | 연락처 / MONO ID 검색 |
| `/settings` | `Settings.jsx` | 설정 (프로필, 언어, 구독, 고객지원 등) |
| `/join/:roomId` | `GuestJoin.jsx` | 게스트 입장 페이지 (QR 스캔 후) |
| `/room/:roomId` | `ChatScreen.jsx` | 실시간 채팅/통역 화면 |
| `/cs-chat` | `CsChat.jsx` | AI 고객지원 챗봇 |

### 3.2 주요 컴포넌트

| 컴포넌트 | 파일 | 설명 |
|----------|------|------|
| `ChatScreen` | `src/components/ChatScreen.jsx` | 실시간 채팅 UI. STT → 번역 → TTS 파이프라인 통합. 메시지 버블, 마이크 버튼, 음성 파형 표시 |
| `QRCodeBox` | `src/components/QRCodeBox.jsx` | QR 코드 생성 + 초대 링크 관리. 게스트 입장 감지 시 자동 채팅 화면 이동 |
| `LanguageFlagPicker` | `src/components/LanguageFlagPicker.jsx` | 국기 이미지 기반 언어 선택 그리드 (99개 언어, Twemoji 폴백) |
| `LanguageSelector` | `src/components/LanguageSelector.jsx` | 드롭다운 방식 언어 선택 (레거시) |
| `MessageBubble` | `src/components/MessageBubble.jsx` | 채팅 메시지 말풍선 (원문 + 번역문 표시) |
| `MicButton` | `src/components/MicButton.jsx` | 마이크 녹음 버튼 (VAD 연동) |
| `AudioWaveform` | `src/components/AudioWaveform.jsx` | 실시간 음성 파형 시각화 |
| `BottomSheet` | `src/components/BottomSheet.jsx` | 모바일 하단 시트 UI |
| `MonoLogo` | `src/components/MonoLogo.jsx` | 앱 로고 컴포넌트 |
| `InstallBanner` | `src/components/InstallBanner.jsx` | PWA 설치 유도 배너 |
| `InAppBlocker` | `src/components/InAppBlocker.jsx` | 인앱 브라우저 감지 → 외부 브라우저 유도 |
| `OnboardingSlides` | `src/components/OnboardingSlides.jsx` | 첫 방문 온보딩 슬라이드 |
| `ToastMessage` | `src/components/ToastMessage.jsx` | 토스트 알림 |
| `AppShell` | `src/layouts/AppShell.jsx` | 하단 탭 네비게이션 레이아웃 |

### 3.3 로컬 데이터 (IndexedDB via Dexie)

| 테이블 | 용도 |
|--------|------|
| `identity` | 사용자 로컬 신원 (이름, 언어, userId) |
| `rooms` | 대화방 메타데이터 (roomId, roomType, lastActiveAt, pinned) |
| `messages` | 메시지 저장 (id, roomId, timestamp, senderId, status, type) |
| `outbox` | 오프라인 메시지 큐 (전송 실패 시 재시도) |
| `aliases` | 발음 별칭 캐시 (userId + targetLang → alias) |

### 3.4 Socket.IO 클라이언트 (`src/socket.js`)

- WebSocket 우선, polling 폴백
- 자동 재연결 (무한 시도, 1~5초 간격, 랜덤 지터)
- 타임아웃 20초, ping 25초 간격

---

## 4. 백엔드 구조

### 4.1 서버 진입점 (`server.js`)

단일 Express + Socket.IO 서버. 포트 기본값 `3174`.

### 4.2 인증 시스템

| 제공자 | 파일 | 콜백 URL |
|--------|------|----------|
| Google OAuth 2.0 | `server/routes/auth_google.js` | `/api/auth/google/callback` |
| Kakao OAuth | `server/routes/auth_kakao.js` | `/api/auth/kakao/callback` |
| Line (스캐폴딩) | `server/routes/auth_line.js` | — |
| Apple (스캐폴딩) | `server/routes/auth_apple.js` | — |

- JWT 토큰을 `httpOnly` 쿠키로 발급
- 게스트 → 회원 전환 API (`/api/auth/convert-guest`)
- Kakao: `throughTalk` 옵션으로 카카오톡 앱 로그인 지원
- Kakao: `code` 파라미터 사전 검증으로 `KOE320` 에러 방지

### 4.3 사용자 관리 (`server/db/users.js`)

- MONO ID 시스템: 고유 식별자 (영소문자 + 숫자 + `.` + `-` + `_`, 최대 30자)
- 자동 MONO ID 생성 (닉네임 기반 + 중복 방지 번호)
- 프로필: 닉네임, 언어, 전화번호, 아바타, 상태 메시지
- 연락처 검색: MONO ID / 전화번호 기반

### 4.4 방(Room) 관리

#### 방 타입
| 타입 | 설명 |
|------|------|
| `oneToOne` | 1:1 즉시 통역 (기본) |
| `broadcast` | 다대다 현장 통역 (콜사인 할당) |
| `global` | 글로벌 공개 채팅방 |

#### 방 생명주기
1. **생성**: 호스트가 QR 생성 시 → `create-room` 이벤트 → 서버에 ROOMS Map 등록
2. **입장**: 게스트 QR 스캔 → `join-1to1` 이벤트 → 참여자 등록 + 호스트에게 알림
3. **전환**: 1:1 방에 3번째 참여자 → 자동으로 `broadcast` 모드 전환
4. **퇴장**: `leave-room` 이벤트 → 참여자 제거 + 소켓 룸 해제
5. **삭제**: `delete-room` 이벤트 → 1:1은 양쪽 삭제, 그룹은 본인만 퇴장
6. **만료**: 24시간 후 자동 정리 (grace period 후 제거)

#### leaveBeforeJoin 로직
- 새 방 입장 시 이전 방 자동 퇴장 → 한 소켓이 동시에 여러 방에 있는 상황 방지

### 4.5 AI 통역 파이프라인

```
[사용자 음성] → STT (Whisper) → [원문 텍스트] → 번역 (GPT-4o) → [번역문] → TTS (gpt-4o-mini-tts) → [음성 재생]
```

#### STT (Speech-to-Text)
- **모델**: OpenAI Whisper (`whisper-1`)
- **입력**: PCM16 오디오 또는 WebM/WAV 파일
- **전처리**: VAD (Voice Activity Detection), RMS 볼륨 검사, 최소 길이 검증
- **후처리**: 반복 텍스트 정규화, 환각(hallucination) 필터링, 가비지 텍스트 제거
- **엔드포인트**: Socket 이벤트 (`stt:segment_end`) + REST API (`/api/stt`)

#### 번역 (Translation)
- **모델**: GPT-4o (`temperature: 0.3`)
- **컨텍스트 인식**: 최근 대화 히스토리 + 사이트 컨텍스트(제조업 현장 등) 반영
- **시스템 프롬프트**: 발화자 언어 → 수신자 언어 맞춤 번역 지시
- **Fan-out**: 그룹 채팅에서 각 참여자의 언어별로 개별 번역 수행

#### TTS (Text-to-Speech)
- **모델**: `gpt-4o-mini-tts` (주), `tts-1` (폴백)
- **음성**: `echo` (중립적, 차분한 톤)
- **지시**: "Speak clearly and calmly, like a human supervisor"
- **출력**: MP3 → Base64로 클라이언트에 전송

#### 이름 적응 (Name Adaptation)
- GPT로 상대방 이름을 각 언어에 맞게 음역 (예: 김길수 → 金吉秀)
- 1:1 대화 시 자동 생성

### 4.6 과금/구독 시스템 (`server/billing.js`)

| 플랜 | 월간 번역 한도 |
|------|---------------|
| Free | 1,000회 |
| Pro | 무제한 (준비 중) |
| Business | 무제한 (준비 중) |

- `translation_usage` 테이블에서 월별 사용량 추적
- 한도 초과 시 402 응답 + 클라이언트 알림

### 4.7 Web Push 알림

- **VAPID** 키 기반 Web Push 표준
- 다중 디바이스 구독 지원 (사용자별 여러 endpoint)
- 유효하지 않은 구독 자동 정리 (404/410)
- `push_subscriptions.json`에 영구 저장
- **포그라운드 억제**: Service Worker에서 앱이 보이는 상태면 알림 생략
- **오프라인 큐**: Outbox 패턴으로 오프라인 메시지 저장 후 재전송

---

## 5. 모니터링 & 알림 시스템

### 5.1 사용량 통계 (`usageStats`)

서버 메모리에 실시간 집계 (자정 자동 리셋):

| 항목 | 설명 |
|------|------|
| `totalVisits` | 페이지 방문 수 (HTTP 요청) |
| `uniqueIPs` | 고유 접속 IP 수 |
| `currentConnections` | 현재 동시 소켓 접속 수 |
| `peakConnections` | 오늘 최대 동시 접속 |
| `roomsCreated` | 실제 호스트+게스트 연결 완료된 방 수 |
| `roomsActive` | 현재 활성 방 수 |
| `activeSession` | 호스트+게스트 둘 다 접속한 통역 세션 수 |
| `googleLogins` | Google 로그인 수 |
| `kakaoLogins` | Kakao 로그인 수 |
| `guestJoins` | 게스트 입장 수 |
| `sttRequests` | STT 요청 수 |
| `translationRequests` | 번역 요청 수 |
| `ttsRequests` | TTS 요청 수 |
| `errorCount` | 에러 발생 수 |
| `regions` | 국가별 접속 이벤트 집계 |

### 5.2 텔레그램 실시간 알림

| 이벤트 | 알림 내용 |
|--------|----------|
| **로그인** | `🟢 14:30 | Google 로그인 | 홍길동 | 📍 South Korea, Seoul` |
| **게스트 입장** | `👤 14:31 | 게스트 입장 | 방: 0ed91d41... | 📍 Vietnam, Ho Chi Minh City` |
| **방 생성** | `🏠 14:32 | 방 생성 | 현재 활성 3개` |
| **번역 마일스톤** | `🔄 14:35 | 번역 100건 달성` (10건 단위) |
| **에러 발생** | `🚨 에러(runtime) | Error message...` (3분 중복 방지) |

### 5.3 매시간 리포트 (텔레그램)

새벽 1~7시 제외, 매시간 자동 발송:

```
📊 MONO 시간별 리포트
⏰ 2026. 3. 4. 오후 2:00:00

👥 현재 접속: 3명
📈 오늘 최대 동시접속: 7명
🌐 오늘 방문: 631회 (105명)

🔑 로그인: Google 0 / 카카오 5
👤 게스트 입장: 5회
🏠 방 생성: 3개 (활성: 1)
🎯 실제 통역 세션: 3건
🌍 접속 지역: South Korea 5 / Vietnam 2

🎤 STT: 20회
🔄 번역: 34회
🔊 TTS: 17회

❌ 에러: 0건
```

### 5.4 IP 기반 지역 정보 (`ip-api.com`)

- 로그인/게스트 입장 시 IP → 국가/도시 자동 조회
- 10분 캐시 (`LOCATION_CACHE`)
- 로컬/프라이빗 IP 자동 감지
- `x-forwarded-for` 헤더에서 클라이언트 원본 IP 추출

### 5.5 즉시 에러 알림 (중복 방지)

- `uncaughtException` / `unhandledRejection` 캐치
- 3분 쿨다운 (`ERROR_ALERT_STATE`) → 동일 에러 반복 알림 방지
- 텔레그램 전송 실패 시 재귀 루프 방지

### 5.6 인프라 모니터링 (`monitor.sh` — cron 10분 간격)

| 체크 항목 | 자동 조치 |
|-----------|----------|
| PM2 프로세스 상태 | 죽어있으면 `pm2 restart mono` |
| 메모리 80% 초과 | 텔레그램 알림 |
| 디스크 90% 초과 | 텔레그램 알림 |
| PM2 에러 로그 (Error/FATAL/crash) | 텔레그램 알림 |
| `https://lingora.chat` 헬스체크 | 실패 시 `pm2 restart mono` |
| 로그 파일 100MB 초과 | `pm2 flush` |
| OpenAI API 키 유효성 | 만료/Rate limit 시 텔레그램 알림 |

### 5.7 `/api/stats` 엔드포인트

- `STATS_API_KEY` 인증 (`?key=...`)
- 현재 모든 `usageStats` 데이터를 JSON으로 반환

---

## 6. 언어 선택 UX

### 6.1 자동 감지

1. `localStorage`에 저장된 언어 우선 로드
2. 없으면 `navigator.language`에서 브라우저 언어 감지
3. 감지된 언어로 자동 선택

### 6.2 국기 피커 (`LanguageFlagPicker`)

- "Select Your Language" (영어 고정) 텍스트 표시
- 자동 감지된 국기에 파란 테두리 하이라이트
- 국기 48×48 이미지 + 3글자 약어 (KOR, VNM, CHN 등)
- 국기 탭 → 즉시 변경 + `localStorage` 저장
- Twemoji 폴백으로 모든 언어 국기 이미지 보장

### 6.3 흐름

- **첫 방문**: 자동 감지 + 국기 그리드 표시 → 국기 탭 → 확정 → QR/대화방
- **재방문**: `localStorage`에서 로드 → 국기 선택 스킵 → 바로 QR/대화방
- **변경**: 언어 표시 영역 탭 → 국기 그리드 재오픈

### 6.4 지원 언어 (99개)

**Tier 1 (주요 21개):** 한국어, 영어, 중국어, 일본어, 베트남어, 태국어, 인도네시아어, 말레이어, 필리핀어, 미얀마어, 크메르어, 네팔어, 몽골어, 우즈베크어, 러시아어, 스페인어, 포르투갈어, 프랑스어, 독일어, 아랍어, 힌디어

**Tier 2 (78개):** 아프리칸스, 알바니아어, 암하라어, 아르메니아어, 아제르바이잔어 외 73개 언어

---

## 7. 대화방 관리

### 7.1 대화방 목록 (`RoomList.jsx`)

- 최근 대화방 시간순 정렬
- 마지막 메시지 미리보기
- 읽지 않은 메시지 카운트

### 7.2 컨텍스트 메뉴 (길게 누르기 / 우클릭)

| 메뉴 | 동작 |
|------|------|
| 초대 링크 복사 | 클립보드에 초대 URL 복사 |
| 대화방 삭제 (빨간색) | 확인 후 → 1:1은 양쪽 삭제, 그룹은 본인만 퇴장 |

### 7.3 연락처 (`Contacts.jsx`)

- MONO ID 검색 (300ms 디바운스)
- 전화번호 기반 연락처 동기화
- 친구 요청 / 수락 / 차단
- 1:1 대화 시작

---

## 8. 채팅 화면 (`ChatScreen.jsx`)

### 8.1 실시간 통역 대화

- 원문 + 번역문 동시 표시 (메시지 버블)
- STT 실시간 음성 인식 → 자동 전송
- TTS 번역문 자동 음성 재생
- 음성 파형 시각화 (`AudioWaveform`)
- 마이크 감도 조절

### 8.2 방 전환 안전장치

- 새 방 입장 시 이전 방 자동 퇴장 (`leaveBeforeJoin`)
- `useEffect` cleanup에서 `leave-room` 이벤트 발송
- 서버에서 한 소켓의 다중 방 동시 참여 방지

### 8.3 메시지 저장

- IndexedDB `messages` 테이블에 로컬 저장
- 오프라인 전송 실패 → `outbox` 큐에 저장 → 재연결 시 자동 재전송
- 메시지 복원: 방 재입장 시 서버에서 최근 메시지 복원

---

## 9. 인증 & 보안

### 9.1 인증 흐름

```
[사용자] → Google/Kakao 로그인 → [OAuth 콜백] → 서버에서 사용자 조회/생성
→ JWT 토큰 발급 (httpOnly 쿠키) → 클라이언트 리다이렉트
```

### 9.2 게스트 → 회원 전환

- 게스트로 대화 참여 → 로그인하면 기존 게스트 세션을 회원 계정에 연결
- `/api/auth/convert-guest` API

### 9.3 보안 정책

- JWT 토큰은 `httpOnly`, `secure`, `sameSite: lax` 쿠키로만 전달
- CORS: `https://lingora.chat` 허용
- Rate limiting: 소켓 이벤트별 초당/30초당 요청 제한
- 참여자 인증: 소켓 이벤트 처리 시 `isAuthorizedParticipant` 검증
- OpenAI 쿼터 초과 감지 + 자동 차단/복구

---

## 10. PWA (Progressive Web App)

### 10.1 설정 (`manifest.json`)

- 앱 이름: "MONO - 실시간 통역 메신저"
- 시작 URL: `/interpret`
- 표시 모드: `standalone`
- 아이콘: 192×192, 512×512

### 10.2 Service Worker (`sw.js`)

- **Push 알림 처리**: 앱이 백그라운드일 때만 알림 표시
- **알림 클릭**: 앱 포커스 또는 해당 대화방으로 이동
- **로컬 알림**: 클라이언트에서 `SHOW_NOTIFICATION` 메시지로 직접 알림 트리거

---

## 11. 국제화 (i18n)

- `i18next` + `react-i18next`
- 브라우저 언어 자동 감지 (`i18next-browser-languagedetector`)
- 번역 파일: `src/locales/ko.json`, `src/locales/en.json`
- 주요 키:
  - `interpret.selectLanguage` → "내 언어 선택" / "Select My Language"
  - `chat.copyInviteLink` → "초대 링크 복사"
  - `chat.deleteRoom` → "대화방 삭제"
  - `guestJoin.subtitle` → 게스트 입장 안내문

---

## 12. 데이터베이스 (SQLite)

### 12.1 주요 테이블

| 테이블 | 설명 |
|--------|------|
| `users` | 사용자 정보 (id, nickname, mono_id, avatar_url, native_language, phone_number, plan, status_message) |
| `friends` | 친구 관계 (user_id, friend_id, status) |
| `translation_usage` | 월별 번역 사용량 (user_id, month, count) |

### 12.2 경로

- 서버: `state/mono_phase1.sqlite` (WAL 모드, FK 활성화)
- 마이그레이션: `server/db/migrations/001_phase1_core_sqlite.sql`

---

## 13. API 엔드포인트

### 13.1 인증

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/auth/me` | 현재 로그인 사용자 정보 |
| GET | `/api/auth/google` | Google OAuth 시작 |
| GET | `/api/auth/google/callback` | Google OAuth 콜백 |
| GET | `/api/auth/kakao` | Kakao OAuth 시작 |
| GET | `/api/auth/kakao/callback` | Kakao OAuth 콜백 |
| POST | `/api/auth/logout` | 로그아웃 |
| POST | `/api/auth/convert-guest` | 게스트 → 회원 전환 |
| PATCH | `/api/auth/profile` | 프로필 수정 |

### 13.2 사용자

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/users/me` | 사용자 정보 조회 |
| PUT | `/api/users/me` | 사용자 정보 수정 |
| GET | `/api/contacts/search` | MONO ID 검색 |
| POST | `/api/contacts/phone-lookup` | 전화번호 연락처 매칭 |

### 13.3 구독/과금

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/subscription/me` | 구독 상태 조회 |
| GET | `/api/subscription/check-limit` | 한도 확인 |
| POST | `/api/subscription/checkout` | 결제 시작 (스캐폴딩) |
| POST | `/api/subscription/webhook` | PSP 웹훅 (스캐폴딩) |

### 13.4 푸시

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/push/vapid-key` | VAPID 공개키 반환 |
| POST | `/api/push/subscribe` | 푸시 구독 등록 |

### 13.5 기타

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/stt` | 음성 파일 STT 변환 |
| GET | `/api/stats` | 사용량 통계 (인증 필요) |

---

## 14. Socket.IO 이벤트

### 14.1 클라이언트 → 서버

| 이벤트 | 설명 |
|--------|------|
| `register-user` | 사용자 등록 (userId, canonicalName, lang) |
| `create-room` | 방 생성 (roomId, fromLang, participantId, siteContext, role, roomType) |
| `join-1to1` | 1:1 방 입장 |
| `create-1to1` | 1:1 방 생성 + 입장 |
| `ensure-global-room` | 글로벌 방 확보 |
| `leave-room` | 방 퇴장 |
| `delete-room` | 방 삭제 |
| `send-message` | 메시지 전송 (자동 번역 포함) |
| `stt:start` | STT 세션 시작 |
| `stt:audio` | STT 오디오 청크 전송 |
| `stt:segment_end` | STT 세그먼트 종료 (전사 요청) |
| `push-subscribe` | 푸시 구독 등록 |
| `push-unsubscribe` | 푸시 구독 해제 |
| `presence:update` | 사용자 상태 업데이트 |

### 14.2 서버 → 클라이언트

| 이벤트 | 설명 |
|--------|------|
| `user-registered` | 사용자 등록 확인 |
| `room-created-ack` | 방 생성 확인 |
| `guest:joined` / `user-joined` | 게스트/사용자 입장 알림 |
| `partner-joined` | 1:1 파트너 입장 |
| `partner-info` | 파트너 이름 적응 정보 |
| `participants` | 현재 참여자 목록 |
| `call-sign-assigned` | 콜사인 할당 (broadcast 모드) |
| `room-context` | 방 컨텍스트 변경 알림 |
| `stt:segment-received` | STT 세그먼트 수신 확인 |
| `stt:no-voice` | 음성 미감지 알림 |
| `tts_audio` | TTS 음성 데이터 (Base64 MP3) |
| `sync-room-state` | 방 상태 동기화 |

---

## 15. 배포 프로세스

```bash
# 로컬에서
git add -A && git commit -m "커밋 메시지" && git push origin main

# AWS 서버에서
ssh -i LightsailDefaultKey-ap-northeast-2.pem ubuntu@15.164.59.178
cd ~/mono && git pull origin main && npm run build && pm2 restart mono && pm2 status
```

### 15.1 서버 환경변수 (`.env`)

| 변수 | 용도 |
|------|------|
| `PORT` | 서버 포트 (기본 3174) |
| `JWT_SECRET` | JWT 서명 키 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET` | Kakao OAuth |
| `VITE_KAKAO_JAVASCRIPT_KEY` | Kakao JS SDK 키 |
| `VAPID_SUBJECT` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 텔레그램 알림 |
| `STATS_API_KEY` | /api/stats 인증 키 |

### 15.2 Nginx 설정

- HTTPS (Let's Encrypt SSL)
- WebSocket 프록시 (`/socket.io/` → localhost:3174)
- 정적 파일 서빙 (`/dist`)
- `x-forwarded-for` 헤더 전달

---

## 16. 해결된 주요 이슈

| 이슈 | 원인 | 해결 |
|------|------|------|
| KOE303 (Redirect URI 불일치) | 서버/프론트 콜백 URL 불일치 | 모든 콜백 URL `/api/auth/*/callback`으로 통일 |
| KOE320 (code=undefined) | 코드 파라미터 검증 미비 | `code` 사전 검증 강화, `undefined`/`null` 문자열 체크 |
| 소켓 연결 불안정 | websocket only 전송 | polling 폴백 + upgrade 허용 |
| 방 전환 시 중복 참여 | leave 없이 join | `leaveBeforeJoin` 로직 도입 |
| 텔레그램 메시지 깨짐 | UTF-8 인코딩 문제 | `--data-urlencode` + `LANG=C.UTF-8` |
| 국기 이미지 누락 | 국가 코드 매핑 미비 | Twemoji 폴백 메커니즘 |
| Contacts 페이지 에러 | 함수 선언 순서 | `onSearch` 선언 위치 수정 |
| billing FK 에러 | SQLite FK 제약조건 | 반복 발생 중 (경고 로그) |

---

## 17. 파일 구조 요약

```
MONO/
├── server.js                    # 메인 서버 (Express + Socket.IO)
├── index.html                   # HTML 진입점 (Kakao SDK, Naver 인증)
├── package.json                 # 의존성 관리
├── vite.config.js               # Vite 빌드 설정
├── tailwind.config.js           # Tailwind CSS 설정
│
├── src/
│   ├── main.jsx                 # React 앱 진입점
│   ├── App.jsx                  # 앱 래퍼
│   ├── router.jsx               # 라우팅 정의
│   ├── socket.js                # Socket.IO 클라이언트
│   ├── i18n.js                  # i18n 설정
│   │
│   ├── pages/
│   │   ├── Home.jsx             # 통역 탭 (QR 생성)
│   │   ├── Login.jsx            # 로그인
│   │   ├── GuestJoin.jsx        # 게스트 입장
│   │   ├── RoomList.jsx         # 대화방 목록
│   │   ├── Contacts.jsx         # 연락처
│   │   ├── Settings.jsx         # 설정
│   │   ├── Global.jsx           # 글로벌 채팅
│   │   ├── CsChat.jsx           # AI 고객지원
│   │   └── Setup.jsx            # 초기 설정
│   │
│   ├── components/
│   │   ├── ChatScreen.jsx       # 채팅 화면
│   │   ├── QRCodeBox.jsx        # QR 코드 생성
│   │   ├── LanguageFlagPicker.jsx  # 국기 언어 선택
│   │   ├── MessageBubble.jsx    # 메시지 말풍선
│   │   ├── MicButton.jsx        # 마이크 버튼
│   │   ├── AudioWaveform.jsx    # 음성 파형
│   │   └── ...
│   │
│   ├── auth/
│   │   ├── kakaoLogin.js        # Kakao SDK 초기화 + 로그인
│   │   └── session.js           # 세션/인증 관리
│   │
│   ├── constants/
│   │   ├── languages.js         # 99개 언어 데이터
│   │   ├── languageProfiles.js  # 언어 프로필 + 국기 매핑
│   │   └── siteContexts.js      # 사이트 컨텍스트 정의
│   │
│   ├── db/
│   │   └── index.js             # IndexedDB (Dexie) 어댑터
│   │
│   ├── audio/                   # 오디오 처리 유틸
│   ├── hooks/                   # 커스텀 React Hooks
│   ├── locales/                 # i18n 번역 파일
│   ├── push/                    # 푸시 알림 클라이언트
│   └── utils/                   # 유틸리티 함수
│
├── server/
│   ├── routes/
│   │   ├── auth_google.js       # Google OAuth
│   │   ├── auth_kakao.js        # Kakao OAuth
│   │   ├── auth_api.js          # 인증 API + 연락처 + 구독 + CS챗봇
│   │   ├── auth_line.js         # Line OAuth (스캐폴딩)
│   │   └── auth_apple.js        # Apple OAuth (스캐폴딩)
│   ├── db/
│   │   ├── sqlite.js            # SQLite 연결 래퍼
│   │   ├── users.js             # 사용자 CRUD
│   │   └── migrations/          # DB 마이그레이션 SQL
│   ├── billing.js               # 과금/구독 로직
│   └── socket/
│       └── message-handler.js   # 소켓 메시지 핸들러
│
├── public/
│   ├── manifest.json            # PWA 매니페스트
│   ├── sw.js                    # Service Worker
│   ├── robots.txt               # 검색엔진 크롤링 규칙
│   ├── sitemap.xml              # 사이트맵
│   └── icons/                   # 앱 아이콘
│
├── state/
│   ├── mono_phase1.sqlite       # SQLite DB 파일
│   └── push_subscriptions.json  # 푸시 구독 영구 저장
│
├── scripts/
│   ├── stress-sim.js            # 부하 테스트 시뮬레이터
│   └── qa-smoke.js              # QA 스모크 테스트
│
└── monitor.sh                   # 서버 모니터링 스크립트 (AWS cron)
```
