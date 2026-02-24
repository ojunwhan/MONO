# MONO Cursor AI 프롬프트 — 순서대로 실행

> **사용법**: 아래 프롬프트를 순서대로 하나씩 Cursor에 붙여넣기.
> 각 프롬프트가 완료되고 테스트한 후 다음으로 넘어갈 것.
> 기획안(MONO_메신저화_종합기획안_v2.docx)은 프로젝트 docs/ 폴더에 넣어두고 참조.

---

## 🔵 STEP 0: 프로젝트 컨텍스트 세팅

```
이 프로젝트는 MONO — AI 실시간 통역 메신저 (PWA)이다.

기술 스택:
- 프론트: React + Vite + TailwindCSS (PWA)
- 백엔드: Node.js + Express + Socket.IO
- DB: SQLite (현재) → PostgreSQL (추후)
- 로컬 저장: IndexedDB (대화기록) + localStorage (설정)
- 인증: JWT + Google OAuth
- AI: Whisper STT + GPT-4o 번역 + 브라우저 내장 TTS
- 호스팅: AWS Lightsail (서울 리전)
- 아이콘: lucide-react
- 폰트: Pretendard(한) + Inter(영) + Noto Sans JP(일)

핵심 원칙:
- 통역 품질 절대 최상 (Whisper + GPT-4o 고정)
- 카카오톡 수준 메신저 UX
- 대화 내역은 서버 저장 없이 각자 단말 로컬 저장 (IndexedDB)
- PWA 유지 (앱스토어 없이 전세계 배포)
- 모바일 우선 디자인

현재 완료된 것:
- Google OAuth 로그인
- 프로필 설정 (사진, 닉네임, MONO ID, 모국어)
- 설정 탭 화면
- 홈(대화목록) 화면
- 연락처 화면
- 통역(QR 즉시접속) 화면
- 글로벌 채팅 화면
- 하단 5탭 네비게이션 (기본 구현)
- 1:1 통역 대화방 (기본)

이 컨텍스트를 기억하고 앞으로 내가 주는 작업을 순서대로 진행해.
```

---

## 🔵 PHASE 1: 기반 메신저화 마무리

### STEP 1-1: 하단 탭 + 대화목록 + Unknown 수정

```
Phase 1 작업 — 하단 탭 네비게이션 완성 + 대화목록 수정

1. 하단 탭 아이콘 변경 (lucide-react):
   - 채팅: MessageCircle (말풍선)
   - 연락처: Users (사람)
   - 통역: Languages (번역)
   - 글로벌: Globe (지구본)
   - 설정: Settings (톱니바퀴)

2. 하단 탭 표시 규칙:
   - 메인 화면들 (/home, /contacts, /interpret, /global, /settings)에서는 항상 표시
   - 대화방 내부 (/room/...)에서만 하단 탭 숨기기

3. /home = 대화 목록 (카카오톡 채팅목록과 동일):
   - 상단: MONO 로고 + 닉네임 + 검색 아이콘 + 새대화(+) 버튼
   - 대화방 카드: 프로필사진, 이름, 언어플래그, 마지막메시지(번역문), 시간, 안읽메시지 뱃지
   - (+) 새대화 → 친구목록에서 선택 → 1:1 방 생성

4. "Unknown" 이름 버그 수정:
   - 대화목록에서 상대방 닉네임이 "Unknown"으로 뜨는 문제
   - DB에서 상대방 프로필(닉네임, 프로필사진) 정확히 가져와서 표시
   - 프로필 사진 없으면 이름 첫글자로 아바타 생성
```

### STEP 1-2: 연락처 탭 (텔레그램 스타일)

```
Phase 1 작업 — 연락처 탭 텔레그램 스타일로 재설계

상단: "MONO 친구" 섹션
- 검색바: MONO ID로 친구 검색
- QR 코드로 친구 추가 버튼
- 초대 링크 공유 버튼
- 친구 목록 표시:
  - 프로필사진 (원형), 닉네임, MONO ID, 모국어 플래그
  - 온라인/오프라인 상태 표시 (초록/회색 점)
  - 탭하면 친구 프로필 시트 열림
  - 프로필 시트에서 "대화 시작" 버튼 → 1:1 대화방으로 이동
- 친구 삭제 (스와이프 or 길게누르기)

하단: "연락처에서 초대" 섹션
- Contact Picker API 지원 브라우저 (Android Chrome 등):
  "연락처에서 친구 찾기" 버튼 → 폰 연락처 접근 → MONO 가입자 매칭
- 미지원 브라우저 (iOS Safari 등):
  수동 전화번호 입력 → 검색
- 미가입자: "초대 링크 보내기" 옵션

친구 추가 요청 흐름:
- A가 B의 MONO ID 검색 → "친구 추가" 요청
- B에게 알림 → 수락/거절
- 수락 시 양쪽 친구목록에 추가
```

### STEP 1-3: 1:1 대화방 메시지 버블 UI 완성

```
Phase 1 작업 — 1:1 대화방 메시지 버블 UI 완성

메시지 버블 구조:
- 내 메시지: 오른쪽 정렬 (카톡과 동일)
- 상대 메시지: 왼쪽 정렬 + 프로필사진 + 이름 + 언어플래그
- 버블 내용: 번역문(크게, 메인) + 원문(작게, 서브)
- 탭하면 토글: 번역문만 / 원문만 / 둘다
- 메시지 하단: 시간 표시

메시지 상태 표시:
- 전송중: 시계 아이콘
- 전송완료: 체크 1개
- 번역중: 번역 아이콘 + 로딩 애니메이션
- 읽음: 체크 2개 (or 카톡식 숫자 "1" 사라짐)

입력 영역:
- 텍스트 입력창 (placeholder: "메시지 입력...")
- 오른쪽: 전송 버튼 (텍스트 있을 때만 활성화)
- 왼쪽: 마이크 버튼 (기존 통역 기능 연결)
- 텍스트 입력 시 상대방에게 타이핑 인디케이터 "..." 표시

방 상단 헤더:
- 뒤로가기 화살표 (← 대화목록으로)
- 상대방 이름 + 언어플래그 + 온라인상태
- 우측: 메뉴(⋮) 버튼 → 방 설정 시트
```

### STEP 1-4: 로컬 대화기록 (IndexedDB)

```
Phase 1 작업 — IndexedDB로 대화기록 로컬 저장

IndexedDB 스키마 설계:
- DB명: mono_messages
- Store: messages
  - key: messageId (UUID)
  - roomId: string (방 ID)
  - senderId: string
  - originalText: string (원문)
  - translatedText: string (번역문)
  - originalLang: string
  - targetLang: string
  - type: "text" | "voice" | "image" | "system"
  - status: "sending" | "sent" | "translated" | "read"
  - timestamp: number
  - replyTo: string | null (답장 대상 messageId)
- Store: rooms
  - key: roomId
  - participants: string[]
  - lastMessage: object
  - unreadCount: number
  - updatedAt: number
  - pinned: boolean

동작:
- 메시지 송수신 시 IndexedDB에 자동 저장
- 대화방 열 때 IndexedDB에서 로드 (최근 50건, 스크롤 시 추가 로드)
- 대화 목록은 rooms store에서 updatedAt 기준 정렬
- 서버에는 대화 내용 저장하지 않음 (무기록 원칙)
- 서버 역할: 실시간 메시지 릴레이 + 번역만 수행

주의: 기존 Socket.IO 통역 로직은 건드리지 말고, 메시지 저장 레이어만 추가할 것.
```

### STEP 1-5: DB 설계 + 친구/방 서버 API

```
Phase 1 작업 — 서버 DB 설계 및 API 구현

SQLite 테이블 설계:

1. users 테이블:
   - id (PK), google_id, email, nickname, mono_id (unique), 
     profile_image, native_language, status_message,
     is_online, last_seen, created_at

2. friendships 테이블:
   - id (PK), requester_id (FK→users), receiver_id (FK→users),
     status ("pending" | "accepted" | "blocked"),
     created_at

3. rooms 테이블:
   - id (PK), type ("dm" | "group" | "qr" | "global"),
     name, image, creator_id, created_at

4. room_members 테이블:
   - id (PK), room_id (FK→rooms), user_id (FK→users),
     role ("owner" | "admin" | "member"),
     last_read_message_id, joined_at

5. message_metadata 테이블 (메시지 내용은 저장 안 함, 읽음상태만):
   - id (PK), room_id, message_id (클라이언트 생성 UUID),
     sender_id, created_at

REST API 엔드포인트:
- POST /api/friends/request — 친구 요청
- POST /api/friends/accept — 수락
- POST /api/friends/reject — 거절
- DELETE /api/friends/:id — 삭제
- GET /api/friends — 내 친구목록
- GET /api/friends/search?mono_id= — MONO ID 검색
- POST /api/rooms — 방 생성
- GET /api/rooms — 내 방 목록
- GET /api/rooms/:id/members — 방 멤버
- PUT /api/rooms/:id/read — 읽음 상태 업데이트
- GET /api/users/me — 내 프로필
- PUT /api/users/me — 프로필 수정

모든 API는 JWT 인증 미들웨어 적용.
```

---

## 🟡 PHASE 2: 메신저 완성

### STEP 2-1: 그룹 대화방 + 방 관리

```
Phase 2 작업 — 그룹 대화방 구현

그룹 대화방 생성:
- 채팅 탭 (+) → "그룹 대화" 선택 → 친구목록에서 복수 선택 → 방 이름 입력 → 생성
- 최소 3명 이상 (나 포함)
- 방 이름, 프로필사진 설정 가능

Fan-out 번역 로직:
- 발화자가 메시지 전송 → 서버에서 참여자별 언어 확인
- 같은 언어 사용자에게는 원문 그대로 전달 (번역 생략)
- 다른 언어 사용자에게는 GPT-4o로 각각 번역 후 전달
- 번역은 병렬 처리 (Promise.all)
- 각 수신자는 자기 언어로 번역된 메시지 + 원문 수신

방 관리 기능 (방 헤더 메뉴 ⋮):
- 참여자 목록 보기 (이름, 언어, 온라인상태)
- 친구 초대하기 (추가 멤버)
- 방 나가기
- 방장 기능: 방 이름/사진 변경, 멤버 퇴장, 방장 권한 위임
- 공지사항 핀: 메시지 길게누르기 → "공지로 설정" → 방 상단 고정
  - 공지는 각 참여자 언어로 자동 번역 표시

그룹 버블 UI:
- 왼쪽: 발신자 프로필사진 + 이름 + 언어플래그
- 자기 메시지: 오른쪽 정렬
- 안읽은 수: 카톡처럼 숫자 표시 (그룹=읽지않은 인원 수)
```

### STEP 2-2: 메시지 상태 + 읽음표시

```
Phase 2 작업 — 메시지 상태 시스템 구현

메시지 상태 흐름:
sending → sent → translated → read

Socket.IO 이벤트:
- "message:send" → 클라이언트→서버 (메시지 전송)
- "message:sent" → 서버→발신자 (서버 수신 확인)
- "message:translated" → 서버→수신자 (번역 완료, 메시지 전달)
- "message:read" → 수신자→서버→발신자 (읽음 확인)

읽음 표시 (카카오톡 스타일):
- 1:1 대화: 메시지 옆에 "1" 표시 → 상대가 읽으면 "1" 사라짐
- 그룹 대화: 안읽은 인원 수 표시 → 전원 읽으면 숫자 사라짐
- 대화방 진입 시 자동으로 읽음 처리 (서버에 last_read_message_id 업데이트)

서버 처리:
- room_members.last_read_message_id 업데이트
- 읽음 변경 시 해당 방 모든 멤버에게 Socket.IO로 브로드캐스트
- 안읽은 수 = 전체 메시지 수 - 읽은 메시지 수 (클라이언트에서 계산)

대화 목록 뱃지:
- 각 방의 안읽은 메시지 수를 빨간 뱃지로 표시
- 하단 탭 "채팅" 아이콘에도 전체 안읽은 수 뱃지 표시
```

### STEP 2-3: 길게누르기 메뉴 + 답장/전달

```
Phase 2 작업 — 메시지 길게누르기 메뉴

메시지 길게누르기 (또는 우클릭) 시 바텀시트 메뉴:
- "복사" → 원문복사 / 번역문복사 선택
- "답장" → 메시지 인용 답장 (Reply)
  - 입력창 위에 인용 미리보기 (답장 대상 메시지 요약)
  - 전송 시 replyTo 필드에 대상 messageId 포함
  - 버블 안에 인용 블록 표시 (탭하면 해당 메시지로 스크롤)
- "전달" → 다른 대화방 선택 → 해당 방으로 포워딩
  - "전달됨" 라벨 표시
- "삭제" → 내 메시지만 삭제 가능 (로컬 IndexedDB에서만 삭제)
- "번역 다시하기" → GPT-4o로 재번역 요청
  - 재번역 결과로 기존 번역문 업데이트
- "번역 품질 피드백" → 👍/👎 버튼
  - 서버에 피드백 데이터 전송 (원문+번역문+평가 쌍)

구현 시 주의:
- 바텀시트는 모바일 친화적으로 (터치 영역 충분히)
- 애니메이션 부드럽게 (slide up)
- 메시지 유형(텍스트/음성/이미지)에 따라 메뉴 항목 다르게
```

### STEP 2-4: 음성 메시지 + 자동 번역

```
Phase 2 작업 — 음성 메시지 기능 (MONO 킬러 기능)

입력 영역 마이크 버튼:
- 길게 누르기 시작 → 녹음 시작 (파형 애니메이션 표시)
- 손 떼면 → 녹음 종료 → 자동 전송
- 위로 스와이프 → 녹음 취소

음성 메시지 처리 파이프라인:
1. 클라이언트: MediaRecorder로 음성 녹음 (webm/opus)
2. 서버 전송: Socket.IO binary로 음성 데이터 전송
3. 서버: Whisper STT로 텍스트 변환
4. 서버: GPT-4o로 번역
5. 수신자에게 전달:
   - 원본 음성 파일 (재생 가능)
   - STT 원문 텍스트
   - 번역된 텍스트

수신자 UI:
- 음성 메시지 버블: 재생 버튼 + 파형 + 시간
- 아래에 번역된 텍스트 표시
- 원문 텍스트는 토글로 볼 수 있음
- MONO 특화: 음성으로 보내면 상대방은 자동 번역된 텍스트+원문 모두 수신

이것이 MONO의 킬러 기능이다:
"음성으로 말하면 → 상대방 언어로 번역된 텍스트가 즉시 도착"
```

### STEP 2-5: 타이핑 인디케이터 + 온라인 상태

```
Phase 2 작업 — 타이핑 인디케이터 + 온라인/오프라인 상태

타이핑 인디케이터:
- 사용자가 텍스트 입력 시작 → Socket.IO "typing:start" 이벤트 발신
- 3초간 입력 없으면 → "typing:stop" 발신
- 상대방 화면에 "..." 애니메이션 표시 (메시지 영역 하단)
- 그룹방: "OOO님이 입력 중..." 형태

온라인/오프라인 상태:
- Socket.IO 연결 시 → is_online = true, DB 업데이트
- Socket.IO 연결 해제 시 → is_online = false, last_seen = now()
- 연락처/대화방에서 상태 표시:
  - 온라인: 프로필 사진 옆 초록 점
  - 오프라인: 회색, "마지막 접속: 5분 전" 형태
- Socket.IO "user:online" / "user:offline" 이벤트로 실시간 업데이트
```

### STEP 2-6: Push Notification

```
Phase 2 작업 — 웹 푸시 알림 구현

Web Push API + VAPID:
- Service Worker에 push 이벤트 핸들러 추가
- 사용자가 알림 권한 허용 시 subscription 정보 서버에 저장

알림 트리거:
- 새 메시지 수신 (앱이 백그라운드이거나 닫혀있을 때)
  - 알림 내용: 발신자 이름 + 번역된 메시지 미리보기
- 친구 추가 요청 수신
- 그룹방 초대
- 알림 클릭 시 해당 대화방으로 이동

설정 연동:
- 방별 알림 ON/OFF (room_members 테이블에 muted 필드)
- 전체 알림 ON/OFF (설정 페이지)
- 소리/진동 설정

iOS PWA 제약 대응:
- iOS는 PWA에서 Web Push 지원이 제한적
- "홈 화면에 추가(A2HS)" 유도 배너 표시
- A2HS 후에만 알림 가능함을 안내
```

### STEP 2-7: 이미지 첨부 + 카메라 + 링크 미리보기

```
Phase 2 작업 — 이미지/카메라/링크 기능

이미지 첨부:
- 입력창 옆 (+) 또는 이미지 아이콘
- 갤러리에서 이미지 선택 → 미리보기 → 전송
- 이미지는 서버에 임시 업로드 (S3 or Lightsail 로컬) → URL 전달
- 이미지 버블: 썸네일 표시, 탭하면 전체화면 보기

카메라 촬영:
- 카메라 아이콘 → 브라우저 카메라 API (navigator.mediaDevices)
- 촬영 → 미리보기 → 전송 또는 OCR 번역 (Phase 3에서 추가)

링크 미리보기 (Open Graph):
- 메시지에 URL 포함 시 자동 감지
- 서버에서 해당 URL의 OG 메타데이터 fetch
  - og:title, og:description, og:image
- 메시지 버블 아래에 링크 프리뷰 카드 표시
  - 썸네일 + 제목 + 설명 + 도메인명
- 탭하면 외부 브라우저로 열기
```

### STEP 2-8: 메시지 검색 + 자주쓰는 문장

```
Phase 2 작업 — 메시지 검색 + 즐겨찾기 문장

메시지 검색 (대화 내):
- 대화방 헤더 메뉴 → "검색" 또는 상단 검색 아이콘
- 키워드 입력 → IndexedDB에서 해당 방의 메시지 검색
- 검색 결과 리스트 → 탭하면 해당 메시지로 스크롤 + 하이라이트
- 원문/번역문 모두 검색 대상

자주 쓰는 문장 즐겨찾기:
- 메시지 길게누르기 메뉴에 "즐겨찾기 추가" 옵션
- 입력창 옆 별(⭐) 아이콘 → 즐겨찾기 목록 표시
- 탭하면 해당 문장 바로 전송
- 즐겨찾기 관리: 설정 > 즐겨찾기 문장 (수정/삭제)
- IndexedDB에 별도 store로 저장

번역 언어 임시 변경:
- 대화방 헤더 메뉴 → "번역 언어 변경"
- 이번 대화에서만 타겟 언어를 임시로 변경
- 방을 나갔다 들어오면 기본 언어로 복귀
```

### STEP 2-9: 설정 페이지 전체 완성

```
Phase 2 작업 — 설정 페이지 전체 구현

설정 페이지 섹션별 구현:

1. 프로필 설정 (이미 있으면 보완):
   - 프로필 사진 (원형 크롭, 탭하면 변경)
   - 닉네임 편집
   - MONO ID 표시 (수정 불가)
   - 상태메시지 편집
   - 내 QR 코드 보기/공유 버튼

2. 언어 설정:
   - 모국어 (STT/TTS 기준) — 드롭다운
   - 선호 번역 언어 — 드롭다운
   - 앱 UI 언어 (i18n 적용 후) — 드롭다운 [추후]

3. 음성 설정:
   - TTS 음성 선택 (남성/여성)
   - TTS 속도 조절 (슬라이더)
   - 자동재생 ON/OFF (토글)
   - 마이크 감도 조절 (슬라이더)

4. 표시 설정:
   - 다크모드 ON/OFF (토글) — TailwindCSS dark: 클래스 활용
   - 글자 크기 조절 (작게/보통/크게) — CSS variable로 적용

5. 알림 설정:
   - 전체 알림 ON/OFF
   - 소리 ON/OFF
   - 진동 ON/OFF

6. 저장 관리:
   - 로컬 대화기록 저장량 표시 (IndexedDB 용량, MB 단위)
   - "전체 대화 삭제" 버튼 (확인 다이얼로그)
   - 방별 선택 삭제

7. 계정 관리:
   - 로그아웃 버튼
   - 계정 삭제 버튼 (법적 필수, 확인 절차 2번)
   - 차단 목록 관리

8. 구독 관리 (자리만 확보):
   - "현재 플랜: Free" 표시
   - "Pro 업그레이드" 버튼 (탭하면 "준비 중" 안내)
   - 사용량 표시: 이번 달 번역 횟수 카운터

9. 앱 정보:
   - 앱 버전
   - 이용약관 (링크)
   - 개인정보처리방침 (링크)

10. 오프라인 큐:
   - 인터넷 끊겼을 때 메시지 입력 → IndexedDB에 큐 저장
   - 네트워크 복구 시 자동 재전송
   - navigator.onLine + online/offline 이벤트 활용
```

---

## 🟠 PHASE 3: 글로벌 + MONO 특화 기능

### STEP 3-1: 글로벌 채팅방

```
Phase 3 작업 — 글로벌 채팅방 구현

글로벌 탭 화면:
- 카테고리별 공개방 목록:
  자유토론 / 언어교환 / 여행 / 비즈니스 / 문화
- 각 방 카드: 방이름, 카테고리, 참여인원수, 최근메시지
- 상단: 카테고리 필터 탭 + 검색
- "방 만들기" 버튼 → 카테고리 선택, 방이름, 최대인원 설정

글로벌방 특징:
- 누구나 입장 가능 (가입자만)
- 각자 설정한 언어로 자동 번역 표시
- 번역 최적화: 번역 요청은 수신자 측에서 발생
  - 서버측 번역 캐시: 동일 문장+타겟언어 조합은 캐시 재사용
- 대화기록: 서버에 최근 N건만 캐시 (TTL 적용)
- 신고 기능: 메시지 길게누르기 → "신고" → 사유 선택 → 서버에 저장
```

### STEP 3-2: 번역 캐시 시스템

```
Phase 3 작업 — 번역 캐시 시스템

서버측 번역 캐시:
- 캐시 키: hash(원문 + 소스언어 + 타겟언어)
- 캐시 저장소: 메모리 (Map) 또는 SQLite 테이블
- TTL: 24시간
- 동일 문장+같은 언어 조합이면 GPT 호출 생략 → 캐시에서 즉시 반환
- API 비용 절감 효과

캐시 테이블 (SQLite):
- id, source_text_hash, source_lang, target_lang,
  translated_text, created_at, hit_count

동작:
1. 번역 요청 수신
2. 캐시 조회 (hash 매칭)
3. 캐시 있으면 → 즉시 반환, hit_count++
4. 캐시 없으면 → GPT-4o 호출 → 결과 캐시 저장 → 반환
5. 24시간 지난 캐시 자동 삭제 (cron or lazy deletion)

글로벌챗에서 특히 효과적:
- 100명이 같은 메시지를 10개 언어로 받아야 할 때
- 캐시 없으면 10번 GPT 호출, 캐시 있으면 1번만 호출
```

### STEP 3-3: OCR 이미지 번역 + AI 대화 요약

```
Phase 3 작업 — MONO 특화 기능 구현

1. 이미지 내 텍스트 번역 (OCR):
   - 이미지 전송 시 "텍스트 번역" 옵션 표시
   - GPT-4o Vision API로 이미지 내 텍스트 추출
   - 추출된 텍스트를 상대방 언어로 번역
   - 결과 표시: 원본 이미지 + 추출 텍스트 + 번역 텍스트
   - 활용: 간판, 메뉴판, 문서 사진, 안내문

2. AI 대화 요약:
   - 대화방 메뉴 → "대화 요약" 버튼
   - IndexedDB에서 최근 N건 메시지 로드
   - GPT-4o에 요약 요청 (사용자 언어로)
   - 요약 결과를 시스템 메시지로 표시
   - "요약해줘" 텍스트 입력 시에도 트리거

3. 대화 내보내기:
   - 대화방 메뉴 → "대화 내보내기"
   - IndexedDB에서 전체 메시지 로드
   - .txt 파일로 변환 (시간, 발신자, 원문, 번역문)
   - 다운로드 트리거
```

### STEP 3-4: 법적 필수 + 온보딩

```
Phase 3 작업 — 법적 필수 페이지 + 온보딩

1. 이용약관 페이지:
   - /terms 라우트
   - 한국어 기본, 추후 다국어
   - 설정 > 앱정보에서 링크

2. 개인정보처리방침 페이지:
   - /privacy 라우트
   - 수집 항목: 이메일, 닉네임, 프로필사진, 언어설정
   - 대화 내용 서버 미저장 명시
   - 설정 > 앱정보에서 링크

3. 계정 삭제 기능 (법적 필수):
   - 설정 > 계정관리 > "계정 삭제"
   - 확인 다이얼로그 2단계: "정말 삭제?" → "되돌릴 수 없습니다" → 삭제
   - 서버: users 테이블에서 삭제 or soft delete
   - 관련 데이터: friendships, room_members 정리
   - 클라이언트: IndexedDB 전체 삭제, localStorage 클리어, 로그아웃

4. 온보딩 튜토리얼:
   - 첫 로그인 시 자동 표시 (localStorage에 onboarding_done 플래그)
   - 3~4장 슬라이드 (스와이프)
     1장: "MONO에 오신 걸 환영합니다" + 핵심 소개
     2장: "친구를 추가하고 대화해보세요" + 연락처 안내
     3장: "QR코드로 즉시 통역" + 통역탭 안내
     4장: "시작하기" 버튼
   - 다국어 지원 (사용자 모국어 기준)
   - "다시 보지 않기" 체크박스

5. 앱 업데이트 알림:
   - Service Worker에서 새 버전 감지 시
   - "새 버전이 있습니다. 업데이트하시겠습니까?" 배너 표시
   - 확인 시 페이지 리로드 (skipWaiting + clients.claim)
```

### STEP 3-5: i18n 다국어 UI

```
Phase 3 작업 — i18n 다국어 UI 적용

react-i18next 설정:
- npm install react-i18next i18next i18next-browser-languagedetector

지원 언어 (Phase 1):
- ko (한국어) — 기본
- en (영어)
- ja (일본어)
- zh (중국어 간체)
- vi (베트남어)

번역 파일 구조:
/src/locales/
  ko/translation.json
  en/translation.json
  ja/translation.json
  zh/translation.json
  vi/translation.json

번역 대상 (앱 전체 UI 텍스트):
- 하단 탭 라벨
- 설정 페이지 모든 텍스트
- 대화방 UI (입력 placeholder, 메뉴 항목 등)
- 온보딩 슬라이드
- 에러 메시지
- 알림 텍스트
- 이용약관/개인정보처리방침 (최소 한/영)

언어 전환:
- 설정 > 언어설정 > 앱 UI 언어 변경
- 변경 즉시 적용 (페이지 리로드 없이)
- 사용자 선택 언어는 localStorage에 저장

초기 언어 결정 순서:
1. localStorage에 저장된 사용자 선택
2. 사용자 프로필의 모국어
3. 브라우저 언어 (navigator.language)
4. 기본값: ko
```

---

## 🔴 PHASE 4: 고도화 + 수익화

### STEP 4-1: 과금 체계 자리 잡기

```
Phase 4 작업 — 과금 체계 기반 구현

사용량 추적 (이미 Phase 2에서 카운터 만들어뒀으면 보완):
- 서버: 사용자별 월간 번역 횟수 카운팅
  - translation_usage 테이블: user_id, month, count, updated_at
- 클라이언트: 설정 > 구독관리에 "이번 달 번역 OOO회" 표시

프리미엄 게이팅 구조:
- 미들웨어: checkUsageLimit(req, res, next)
- Free 티어 제한 도달 시: "번역 한도 초과" 안내 + Pro 업그레이드 유도
- 제한값은 환경변수로 관리 (추후 조정 용이하게)

결제 연동 준비:
- Stripe 또는 Paddle 결제 페이지 연동 포인트 설계
- /api/subscription/checkout — 결제 페이지 리다이렉트
- /api/subscription/webhook — 결제 상태 업데이트
- users 테이블에 plan ("free" | "pro" | "business"), plan_expires_at 필드 추가
- 아직 실제 결제 연동은 안 함. 구조만 잡아둘 것.
```

### STEP 4-2: 소셜로그인 확장

```
Phase 4 작업 — 소셜로그인 추가

추가할 로그인 (순서대로):
1. 카카오톡 로그인 (한국 사용자 핵심)
2. LINE 로그인 (일본/동남아)
3. Apple 로그인 (iOS 사용자)

각각:
- OAuth2 플로우 구현
- 서버: /api/auth/kakao, /api/auth/line, /api/auth/apple
- 기존 google_id처럼 kakao_id, line_id, apple_id 필드 추가
- 동일 이메일이면 기존 계정에 연결 (계정 통합)

로그인 화면:
- "Google로 계속하기" (기존)
- "카카오로 계속하기"
- "LINE으로 계속하기"
- "Apple로 계속하기"
- 브랜드 색상+아이콘 적용
```

### STEP 4-3: 폰트 + 디자인 정리

```
Phase 4 작업 — 디자인 시스템 정리

폰트 적용:
- Pretendard (한글): CDN or self-host
  @font-face로 등록, font-family: 'Pretendard' 
- Inter (영문): Google Fonts or CDN
- Noto Sans JP (일본어): Google Fonts

적용 순서:
font-family: 'Pretendard', 'Inter', 'Noto Sans JP', -apple-system, sans-serif;

디자인 토큰 정리:
- 색상 변수 (CSS custom properties):
  --color-primary: 메인 브랜드색
  --color-bg: 배경
  --color-text: 텍스트
  --color-bubble-mine: 내 말풍선
  --color-bubble-other: 상대 말풍선
  --color-border: 구분선
- 다크모드: .dark 클래스에 변수 오버라이드
- 간격: 4px 단위 그리드
- 라운드 코너: 일관된 border-radius (12px 대화버블, 8px 카드)
- 모바일 우선: max-width 제한, safe-area 대응
```

---

## ✅ 실행 체크리스트

| 단계 | 작업 | 상태 |
|------|------|------|
| 0 | 컨텍스트 세팅 | ⬜ |
| 1-1 | 하단탭 + 대화목록 + Unknown수정 | ⬜ |
| 1-2 | 연락처 텔레그램 스타일 | ⬜ |
| 1-3 | 메시지 버블 UI | ⬜ |
| 1-4 | IndexedDB 로컬 저장 | ⬜ |
| 1-5 | DB설계 + 서버 API | ⬜ |
| 2-1 | 그룹 대화방 + 방관리 | ⬜ |
| 2-2 | 메시지 상태 + 읽음표시 | ⬜ |
| 2-3 | 길게누르기 메뉴 | ⬜ |
| 2-4 | 음성 메시지 | ⬜ |
| 2-5 | 타이핑 인디케이터 + 온라인상태 | ⬜ |
| 2-6 | Push Notification | ⬜ |
| 2-7 | 이미지 + 카메라 + 링크 | ⬜ |
| 2-8 | 메시지 검색 + 즐겨찾기 | ⬜ |
| 2-9 | 설정 페이지 전체 | ⬜ |
| 3-1 | 글로벌 채팅방 | ⬜ |
| 3-2 | 번역 캐시 | ⬜ |
| 3-3 | OCR + AI요약 + 내보내기 | ⬜ |
| 3-4 | 법적필수 + 온보딩 | ⬜ |
| 3-5 | i18n 다국어 UI | ⬜ |
| 4-1 | 과금 기반 | ✅ |
| 4-2 | 소셜로그인 확장 | ✅ |
| 4-3 | 폰트 + 디자인 정리 | ✅ |
