# MONO Phase 1 DB Baseline

이 디렉터리는 MONO 메신저화 Phase 1의 최소 스키마를 담습니다.

## 추천안

현재 MONO 운영 구조(단일 Node 서버 + 기존 JWT 기반)에서는 **SQLite로 빠르게 시작**하고,
Phase 2~3에서 Supabase(PostgreSQL)로 올리는 방식이 가장 안전합니다.

- 이유:
  - 기존 QR/통역 런타임과 충돌 없이 로컬 파일 DB로 즉시 적용 가능
  - 운영 리스크(네트워크, 권한, 외부 장애) 최소화
  - 이후 SQL 구조를 그대로 PostgreSQL로 이식 가능하도록 설계됨

## 파일

- `migrations/001_phase1_core_sqlite.sql`
- `migrations/001_phase1_core_postgres.sql`

## 테이블

- `users`
- `friends`
- `rooms`
- `room_members`

## 상태값(Enum 정책)

- `friends.status`: `pending | accepted | blocked`
- `rooms.type`: `dm | group | qr | global`
- `room_members.role`: `admin | member`

## 인덱스/제약 핵심

- `users.email` unique (nullable 허용)
- `users.mono_id` unique (필수)
- `friends`는 `(user_id, friend_id)` 중복 방지 + 자기 자신 친구 추가 방지
- `room_members`는 `(room_id, user_id)` 중복 방지
- `friends`는 방향성 관계(요청자->대상)를 유지

