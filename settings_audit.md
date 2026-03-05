# Settings.jsx UI 감사 보고서

> 분석일: 2026-03-05  
> 대상: `src/pages/Settings.jsx`

---

## 비로그인 상태 UI

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 1 | Google 로그인 버튼 | `/auth/google?next=/home`으로 이동하여 Google OAuth 진행 | ✅ 정상 | - |
| 2 | Kakao 로그인 버튼 | `startKakaoLogin("/home")` 호출하여 Kakao OAuth 진행 | ✅ 정상 | - |
| 3 | App Version 표시 | `VITE_APP_VERSION` 환경변수 또는 "1.0.0" 표시 | ✅ 정상 | - |

---

## 로그인 상태 UI

### 프로필 카드 (상단)

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 4 | 프로필 아바타 | 닉네임 첫 글자를 원형 배경에 표시 | ✅ 정상 | 실제 아바타 이미지 미지원 (텍스트만) |
| 5 | 닉네임 표시 | 서버에서 불러온 nickname 표시 | ✅ 정상 | - |
| 6 | MONO ID 표시 | `@monoId` 형태로 표시 | ✅ 정상 | - |
| 7 | Status Message 표시 | statusMessage 또는 "No status message" 표시 | ✅ 정상 | - |
| 8 | 프로필 카드 클릭 | `onClick={() => {}}` — 빈 핸들러 | ❌ 미동작 | 클릭해도 아무 동작 없음. 프로필 편집으로 스크롤하거나 모달을 열어야 하지만 미구현 |

### 언어 설정 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 9 | 모국어 선택 (Native Language) | `LanguageSelector`로 모국어 변경 → `form.nativeLanguage` 업데이트 | ⚠️ 부분동작 | UI에서 변경은 되지만 **"저장" 버튼을 눌러야** 서버에 반영됨. 즉시 반영되지 않아 혼란 가능 |
| 10 | 선호 번역 언어 (Preferred Translation Language) | `localStorage`에 `mono.preferredLang` 저장 | ⚠️ 부분동작 | `localStorage`에만 저장됨. **실제로 이 값을 읽어서 사용하는 곳이 없음** (Settings.jsx에서만 참조) |
| 11 | 앱 언어 (App Language) | 한국어/English 전환 → `i18n.changeLanguage()` 호출 | ✅ 정상 | 한국어/영어 2개만 지원 |

### 음성 설정 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 12 | TTS 음성 (여성/남성) | `localStorage`에 `mono.tts.voice` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 TTS 엔진에서 이 값을 읽어 적용하는 코드가 없음** |
| 13 | TTS 속도 (0.5x ~ 2.0x) | `localStorage`에 `mono.tts.speed` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 TTS 엔진에서 이 값을 읽어 적용하는 코드가 없음** |
| 14 | 마이크 감도 (1~100) | `localStorage`에 `mono.mic.sensitivity` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 마이크/STT에서 이 값을 읽어 적용하는 코드가 없음** |
| 15 | 자동재생 토글 (Auto Play) | `localStorage`에 `mono.tts.autoplay` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 TTS 자동재생 로직에서 이 값을 읽어 적용하는 코드가 없음** |

### 표시 설정 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 16 | 다크모드 토글 | `document.documentElement`에 `dark` 클래스 토글 + `localStorage` 저장 | ✅ 정상 | `App.jsx`에서 초기 로드 시에도 적용됨 |
| 17 | 글자 크기 (작게/보통/크게) | `localStorage`에 `mono.fontSize` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 앱 전역에서 이 값을 읽어 폰트 크기를 변경하는 코드가 없음** |

### 알림 설정 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 18 | 알림 토글 (Notifications) | `localStorage`에 `mono.notif.enabled` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 알림 표시 로직에서 이 값을 확인하지 않음** |
| 19 | 소리 토글 (Sound) | `localStorage`에 `notificationSound` 및 `mono.notif.sound` 저장 | ✅ 정상 | `notificationSound.js`에서 이 값을 읽어서 소리 재생 여부 결정 |
| 20 | 진동 토글 (Vibration) | `localStorage`에 `mono.notif.vibration` 저장 | ❌ 미동작 | `localStorage`에 저장만 되고, **실제 진동 발생 코드(`navigator.vibrate`)에서 이 값을 확인하지 않음** |
| 21 | 알림 권한 요청 버튼 | `Notification.requestPermission()` 호출 | ✅ 정상 | 결과를 `setMessage()`로만 표시하므로 화면 하단에서 눈에 잘 안 보일 수 있음 |

### 구독 (Subscription) 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 22 | 플랜 표시 | 현재 구독 플랜 (free/pro) 표시 | ✅ 정상 | - |
| 23 | 이번 달 사용량 표시 | usageCount / monthlyLimit 표시 + 프로그레스 바 | ✅ 정상 | - |
| 24 | Upgrade to Pro 버튼 | `/api/subscription/checkout` 호출 | ⚠️ 부분동작 | 서버에서 `pending` 상태의 placeholder URL 반환. 실제 결제 연동 미구현 → `/settings?checkout=pending`으로 리다이렉트됨 |

### 저장 관리 (Storage) 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 25 | 로컬 저장소 용량 표시 | IndexedDB 사용량/할당량 표시 + 프로그레스 바 | ✅ 정상 | - |
| 26 | Clear Local Data 버튼 | localStorage + sessionStorage + IndexedDB 전체 삭제 → 토스트 → 새로고침 | ✅ 정상 | 확인 다이얼로그 포함, 토스트 피드백, 1.5초 후 자동 새로고침 |

### 프로필 편집 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 27 | Nickname 입력 | 닉네임 편집 (최대 40자) | ✅ 정상 | - |
| 28 | MONO ID 입력 | MONO ID 편집 (소문자 강제, 최대 30자) | ✅ 정상 | 중복/유효성 검증은 서버에서 처리 |
| 29 | Status Message 입력 | 상태 메시지 편집 (최대 160자) | ✅ 정상 | 서버 `updateUserProfile`에서 `status_message` 컬럼으로 저장 |
| 30 | Phone Number 입력 | 전화번호 편집 (최대 24자) | ✅ 정상 | - |
| 31 | 저장 버튼 | `PATCH /api/auth/profile` 호출 → 프로필 업데이트 | ✅ 정상 | 토스트로 성공/실패 피드백 |

### 계정 관리 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 32 | 로그아웃 버튼 | `POST /api/auth/logout` → 인증 상태 해제 | ✅ 정상 | 토스트로 완료 피드백 |
| 33 | Delete Account 버튼 | 계정 삭제 | ❌ 미동작 | `setMessage("Coming soon.")` — 미구현 placeholder |
| 34 | Blocked Users 버튼 | 차단 사용자 관리 | ❌ 미동작 | `setMessage("Coming soon.")` — 미구현 placeholder |

### 지원 (Support) 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 35 | MONO Helper 버튼 | `/cs-chat` 페이지로 이동 (CS 챗봇) | ✅ 정상 | OpenAI 기반 CS 챗봇 동작 |
| 36 | Email Support 링크 | `mailto:support@lingora.chat` | ✅ 정상 | 메일 클라이언트 열림 |

### 앱 정보 (App) 섹션

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 37 | 이용약관 링크 | `/terms` 페이지로 이동 | ❌ 미동작 | **라우트 미등록 + 페이지 파일 미존재**. 클릭하면 빈 페이지 또는 404 |
| 38 | 개인정보처리방침 링크 | `/privacy` 페이지로 이동 | ❌ 미동작 | **라우트 미등록 + 페이지 파일 미존재**. 클릭하면 빈 페이지 또는 404 |
| 39 | Version 표시 | `VITE_APP_VERSION` 또는 "1.0.0" 표시 | ✅ 정상 | - |

### 공통 UI

| # | 항목 | 기능 설명 | 동작 여부 | 문제점 |
|---|------|----------|----------|--------|
| 40 | 에러 메시지 표시 | 페이지 하단 빨간 텍스트 | ⚠️ 부분동작 | 페이지 맨 하단에 위치하여 스크롤 없이는 안 보일 수 있음 |
| 41 | 성공 메시지 표시 | 페이지 하단 primary 색 텍스트 | ⚠️ 부분동작 | 일부 핸들러에서 아직 `setMessage()` 사용 중 (토스트가 아닌). 페이지 하단이라 안 보일 수 있음 |
| 42 | 토스트 메시지 | 화면 중앙 하단 검정 반투명 배경 텍스트 | ✅ 정상 | 2.5초 후 자동 사라짐 |

---

## 미사용 코드 (Dead Code)

| # | 항목 | 설명 |
|---|------|------|
| D1 | `selectedLang` (line 240) | `getLanguageProfileByCode`로 계산하지만 **렌더링에서 사용되지 않음** |
| D2 | `message` state (line 28) | 일부 핸들러(`requestNotificationPermission`, Upgrade to Pro)에서 아직 사용되나, 대부분 `showToast`로 전환됨. 혼재 상태 |
| D3 | `error` state (line 29) | `requestNotificationPermission`에서만 사용. 대부분 `showToast`로 전환됨. 혼재 상태 |

---

## 요약

| 분류 | 개수 |
|------|------|
| ✅ 정상 동작 | 22개 |
| ⚠️ 부분 동작 | 5개 |
| ❌ 미동작 | 10개 |
| 미사용 코드 | 3개 |

### 핵심 문제 우선순위

1. **🔴 설정값 미연동 (12, 13, 14, 15, 17, 18, 20)**: TTS 음성/속도/자동재생, 마이크 감도, 글자 크기, 알림 토글, 진동 토글이 `localStorage`에 저장만 되고 **실제 기능에서 읽어서 적용하지 않음**. 사용자가 설정을 변경해도 아무 효과가 없는 상태.
2. **🔴 미구현 기능 (33, 34)**: 계정 삭제, 차단 사용자 관리가 "Coming soon." placeholder 상태.
3. **🔴 페이지 미존재 (37, 38)**: 이용약관, 개인정보처리방침 페이지가 없어서 클릭 시 404.
4. **🟡 프로필 카드 빈 핸들러 (8)**: 프로필 카드 클릭 시 아무 반응 없음.
5. **🟡 Preferred Translation Language 미사용 (10)**: 설정만 되고 실제 번역 시 활용되지 않음.
6. **🟡 결제 미연동 (24)**: Upgrade to Pro 버튼이 placeholder URL만 반환.
