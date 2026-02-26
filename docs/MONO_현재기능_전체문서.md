# MONO 현재 기능 전체 문서

본 문서는 현재 `main` 기준 MONO의 기능/구조/동작을 한 번에 파악하기 위한 운영 문서다.

## 1) 서비스 개요

MONO는 **실시간 통역 메신저**다.  
핵심은 다음 3가지다.

- 대화방 기반 실시간 채팅/번역
- 음성 입력(STT) → 번역(GPT-4o) → 음성 출력(TTS)
- 로그인 사용자 + 게스트 링크 입장(/join/:roomId) 동시 지원

---

## 2) 프론트엔드 핵심 구조

- 프레임워크: React + React Router
- 빌드: Vite
- UI: Tailwind + CSS 변수 테마
- 주요 셸: `src/layouts/AppShell.jsx`

### 하단 탭(AppShell)

- 통역(`/interpret`)
- 채팅(`/home`, `/room/*`)
- 연락처(`/contacts`)
- 설정(`/settings`)

탭 색상은 MONO 로고 컬러와 동일하게 고정되어 있고, active 상태는 색상 변경이 아니라 굵기/스케일로 표현된다.

---

## 3) 라우팅

기준 파일: `src/router.jsx`

- `/`  
  - 로그인 상태: `/interpret` 리다이렉트
  - 비로그인 상태: `/login` 리다이렉트
  - `?roomId=...` 쿼리 포함 시 `/join/:roomId`로 리다이렉트
- `/login`: 로그인 페이지
- `/setup`: 초기 설정
- `/home`: 대화 목록
- `/contacts`: 연락처
- `/interpret`: 통역/QR 생성 페이지
- `/settings`: 설정 페이지
- `/join/:roomId`: 게스트 입장 페이지
- `/room/:roomId`: 채팅방(호스트/게스트 공용 `ChatScreen`)
- `/cs-chat`: 고객지원 채팅

---

## 4) 인증/세션

### OAuth

- Google / Kakao 로그인 지원
- Kakao는 `KAKAO_CLIENT_SECRET` 없이도 동작 가능하도록 서버 라우트가 보완됨

### 세션

- 서버 쿠키/JWT 기반 인증
- 클라이언트는 `/api/auth/me`로 인증 상태 확인
- 로컬 identity는 IndexedDB에 동기화

### 환경변수 보안

- `.env`, `.env.local`, `.env.production`, `.env.development`는 `.gitignore`로 무시됨

---

## 5) 게스트 플로우

### 게스트 입장

- 호스트가 만든 링크(`/join/:roomId`)로 비로그인 즉시 입장 가능
- 게스트 페이지(`GuestJoinPage`)에서 언어 선택 후 바로 방 입장
- `/join/*`에서는 온보딩 슬라이드를 표시하지 않음

### 게스트 제한/유도

- 게스트도 채팅/통역은 가능
- 나가기 시 가입 유도 BottomSheet 제공
- 방에서 OAuth로 가입 시 guest → user 전환 API 사용
  - 엔드포인트: `/api/auth/convert-guest`

### 방 만료/호스트 종료

- 룸 메타 `expiresAt` 기준 만료 처리
- 이벤트:
  - `room-expired`
  - `host-left`
  - `room-closed`

---

## 6) 채팅방(ChatScreen) 동작

기준 파일: `src/components/ChatScreen.jsx`

- 호스트/게스트 모두 동일 컴포넌트 사용
- 상단 헤더 / 메시지영역 / 하단 입력바 폭 정렬 고정(`max-w-[480px]`)
- 입력창, 답장, 타이핑 표시, 읽음/전송 상태 처리
- 음성 출력(TTS) 토글 제공

---

## 7) 번역 파이프라인

기준 파일: `server.js`

- 모델: `gpt-4o`
- 번역 단계:
  - 빠른 번역: `fastTranslate(...)`
  - 후처리/고품질: `hqTranslate(...)`
- `temperature`: `0.3`
- 최근 대화 맥락(룸 컨텍스트)을 프롬프트에 포함해 문맥/톤/슬랭 반영

---

## 8) STT/TTS 현재 동작

### STT 우선순위

기준 파일: `src/components/MicButton.jsx`

1. **Web Speech API 우선**
   - `SpeechRecognition` / `webkitSpeechRecognition` 사용
   - `continuous = true`
   - `interimResults = true`
   - 마이크 ON 동안 인식 누적
   - 마이크 OFF 시 `recognition.stop()` 후 누적 텍스트를 1회 전송

2. **Fallback: Whisper 경로 유지**
   - 브라우저 미지원 시 기존 소켓 기반 PCM 업로드 사용
   - 단, 동작 정책은 동일:
     - 마이크 ON 동안 버퍼링만
     - 마이크 OFF 시점에만 전송 + `stt:segment_end`

### Whisper 환각 방지

기준 파일: `server.js`

- 최소 녹음 시간 필터(0.5초 미만 폐기)
- RMS 저음량 필터(음성 없음 토스트 이벤트)
- 환각 패턴 필터
  - 예: “시청해주셔서 감사합니다”, “구독과 좋아요”, “Thanks for watching”, 방송사 약어 등

### TTS

- 서버 TTS 모델: `gpt-4o-mini-tts`(fallback `tts-1`)
- 클라이언트 브라우저 TTS도 병행 사용

---

## 9) 언어/국기 시스템

- 언어 데이터: `src/constants/languages.js`
- 언어 선택기: `src/components/LanguageSelector.jsx`
- 국기 렌더는 이모지 호환성 문제를 피하기 위해 이미지 렌더 방식 적용

---

## 10) PWA/배포

- `manifest.json` 및 아이콘 세팅 완료
- `vite.config.js`의 `base`는 루트 경로(`/`) 기반
  - `/join/:roomId` 같은 딥링크에서 MIME 에러 방지
- 서버(`server.js`)는 `dist` 정적 서빙 + SPA fallback(`app.get("*")`)

---

## 11) 데이터 저장소

- IndexedDB:
  - 내 identity
  - 룸 목록/최근 메시지
  - 읽지 않음 카운트 등
- sessionStorage:
  - 게스트 세션(`mono_guest`)
- localStorage:
  - UI/언어/테마/음성 설정

---

## 12) 운영 시 확인 포인트 (체크리스트)

- 서버 실행: `node server.js` (기본 3174)
- 빌드 반영: `npm run build`
- 로그인/OAuth 정상 여부
- `/join/:roomId`에서 온보딩 없이 즉시 입장 여부
- STT:
  - Web Speech 지원 브라우저에서 버튼 ON/OFF 1회 전송 동작
  - 미지원 브라우저에서 Whisper fallback 동작
- 번역:
  - 문맥 반영/슬랭/톤 유지
- 게스트:
  - 방 만료/호스트 종료 이벤트 반응
  - 나가기 가입 유도 흐름

---

## 13) 현재 알려진 특이사항

- Vite 빌드 시 chunk size 경고가 있으나 빌드는 성공함
- `socket.js`는 일부 경로에서 dynamic + static import가 혼재되어 경고가 발생할 수 있음
- 브라우저 캐시/서비스워커 영향으로 UI 반영이 늦어 보일 수 있어 강력 새로고침이 필요할 수 있음

---

## 14) 핵심 파일 맵

- 라우터: `src/router.jsx`
- 앱 셸/하단탭: `src/layouts/AppShell.jsx`
- 채팅 화면: `src/components/ChatScreen.jsx`
- 마이크/STT 입력: `src/components/MicButton.jsx`
- 게스트 입장: `src/pages/GuestJoin.jsx`
- 통역 홈: `src/pages/Home.jsx`
- 설정: `src/pages/Settings.jsx`
- 로그인: `src/pages/Login.jsx`
- 서버 통합 로직: `server.js`
- 인증 API 라우트: `server/routes/*`

