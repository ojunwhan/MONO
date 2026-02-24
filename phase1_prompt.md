# MONO 메신저화 Phase 1 프롬프트 (강화본)

```text
MONO 프로젝트를 "AI 실시간 통역 메신저"로 확장한다.
기존 QR 즉시통역 기능은 그대로 유지하면서, 메신저 기능을 추가한다.

[작업 규칙]
- 새 브랜치 `mono-phase1`에서만 작업. main 직접 수정 금지.
- 기존 통역 품질 코드(Whisper/GPT-4o/TTS 파이프라인) 수정 금지.
- 기존 QR 즉시통역 흐름 절대 깨지면 안 됨.
- 단계별 완료 시: 변경 파일 목록, DB 마이그레이션, 실행 방법, 롤백 방법을 출력.
- 각 단계마다 회귀테스트(기존 QR 기능 4개) 통과 후 다음 단계 진행.

[현재 상태]
- PWA: React + Vite + TailwindCSS
- Backend: Node.js + Express + Socket.IO (server.js)
- Engine: Whisper(STT) + GPT-4o(번역) + 브라우저 TTS
- 운영: AWS Lightsail + lingora.chat
- 기존 QR 즉시접속 방식 유지 필수

[Phase 1]
1) DB 설계/구축
- Supabase(PostgreSQL) 또는 SQLite 중 선택
- 테이블: users, friends, rooms, room_members
- users: id, email, nickname, mono_id(unique), avatar_url, native_language, status_message, created_at
- friends: id, user_id, friend_id, status(pending/accepted/blocked), created_at
- rooms: id, type(dm/group/qr/global), name, created_by, created_at
- room_members: id, room_id, user_id, role(admin/member), joined_at

2) 인증
- Google OAuth 우선
- 이메일/비밀번호는 2순위(스캐폴드만 가능)
- 최초 로그인 프로필 설정: 닉네임, MONO ID, 모국어
- JWT 기반 인증 (기존 JWT_SECRET 활용)
- 비로그인 사용자는 기존 QR 즉시접속 모드 유지

3) 화면 구조
- 하단 탭: 홈 | 연락처 | 통역(기존QR) | 글로벌 | 설정
- Router 분리
- 비로그인 기본 탭: 통역
- 로그인 기본 탭: 홈

4) 연락처
- MONO ID 검색/추가
- QR 친구추가(내 QR/상대 QR)
- 목록: 아바타, 닉네임, 모국어, 온라인
- 삭제/차단

5) 1:1 대화방
- 친구 선택 -> DM 생성
- 기존 통역 엔진 재사용
- 메시지 UI: 원문(작게)+번역문(크게)
- 기록 IndexedDB 저장
- 홈 탭 최근대화 반영

6) 홈(대화목록)
- 최근 대화방 목록
- 항목: 상대 프로필/이름/마지막메시지/시간/안읽음뱃지
- 새 대화 시작 버튼(+)

[지시]
- DB 설계부터 시작.
- 먼저 Supabase vs SQLite 장단점 비교표를 만들고, 현재 MONO 기준 추천 1안을 제시.
- 바로 SQL 스키마/마이그레이션 파일 생성까지 진행.
```
