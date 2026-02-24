# Phase 1 DB 선택: Supabase vs SQLite

## 비교 요약

| 항목 | SQLite | Supabase (PostgreSQL) |
|---|---|---|
| 초기 구축 속도 | 매우 빠름 | 중간 (프로젝트/권한/키 설정 필요) |
| 운영 복잡도 | 낮음 | 중간~높음 |
| 외부 장애 영향 | 거의 없음 | 네트워크/서비스 장애 영향 있음 |
| 스케일아웃 | 제한적 | 우수 |
| 인증 연계 | 직접 구현/JWT 연계 쉬움 | Supabase Auth 쓰면 빠르지만 구조 변화 큼 |
| 백업/복구 | 수동 또는 스크립트 | 관리형 기능 활용 가능 |
| 기존 MONO 영향 | 최소 | 연동 레이어 추가 필요 |
| 비용/벤더 종속 | 낮음 | 중간 |

## MONO 기준 권장안 (Phase 1)

**권장: SQLite 시작**

- 기존 `server.js` 중심 구조를 가장 적게 건드림
- QR 즉시통역 회귀 리스크 최소
- 인증/친구/DM 흐름만 얇게 추가 가능
- 스키마는 PostgreSQL 호환 고려해 설계했으므로 이후 Supabase로 마이그레이션 쉬움

## 실행 순서

1. Phase 1: SQLite로 users/friends/rooms/room_members 구축
2. 인증/연락처/DM 기능 안정화
3. Phase 2+: 트래픽/운영 요구 증가 시 Supabase(PostgreSQL)로 이전

