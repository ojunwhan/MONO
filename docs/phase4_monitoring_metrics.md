# MONO Phase 4-3 운영 모니터링 지표 (초안)

## 0) 목적
- 장애를 사후 발견이 아닌 사전 감지로 전환한다.
- 메시지 전달 품질과 소켓 안정성을 정량적으로 관리한다.

## 1) 핵심 지표 (필수)

### 1.1 소켓 연결 지표
- `socket_connect_success_rate` = 성공 연결 / 연결 시도
- `socket_reconnect_rate` = 재연결 횟수 / 활성 세션
- `socket_connect_error_rate` = connect_error / 연결 시도
- `socket_session_uptime_60m` = 60분 세션 유지율

권장 임계치:
- connect_success_rate >= 98%
- reconnect_rate <= 0.3 / session / hour
- connect_error_rate < 2%
- session_uptime_60m >= 95%

### 1.2 메시지 전달 지표
- `message_ack_accept_rate` = accepted ACK / send-message 시도
- `message_delivery_rate` = delivered / accepted
- `message_read_rate` = read / delivered
- `duplicate_drop_rate` = duplicate 응답 / 전체 전송
- `outbox_flush_success_rate` = flush 성공 / flush 시도

권장 임계치:
- ack_accept_rate >= 99%
- delivery_rate >= 98%
- duplicate_drop_rate <= 1%
- outbox_flush_success_rate >= 99%

### 1.3 지연/성능 지표
- `message_delivery_p50_ms`, `p95_ms`
- `join_room_latency_p50_ms`, `p95_ms`
- `healthz_latency_ms`

권장 임계치:
- message_delivery_p95 <= 1500ms
- join_room_latency_p95 <= 2000ms

## 2) 품질 보조 지표 (권장)
- API 오류율 (STT/번역/TTS): `4xx`, `5xx`, `429` 분리 추적
- 푸시 전송 성공률/클릭률
- 방 참여자 동기화 실패율 (`room-members` mismatch)
- 브라우저별 실패율 (iOS Safari / Android Chrome / Desktop)

## 3) 로그 기반 산출 포인트
- 서버 소켓 이벤트:
  - `connection`, `disconnect`, `connect_error`
  - `send-message` ACK 결과(`accepted`, `duplicate`, `unauthorized`, `rate_limited`)
  - `message-status`, `message-read`
- 클라이언트 이벤트:
  - `reconnect_attempt`, `reconnect`, `offline/online`
  - outbox enqueue/dequeue/failure

## 4) 알림 정책 (초안)
- 즉시(P1):
  - `healthz` 실패 2회 연속
  - `socket_connect_success_rate < 95%` (5분 윈도우)
  - `message_delivery_rate < 95%` (5분 윈도우)
- 경고(P2):
  - `reconnect_rate` 급증 (기준치의 2배 이상)
  - 외부 API `429` 급증
- 추세(P3):
  - 24시간 기준 read_rate 하락 추세

## 5) 운영 대시보드 최소 구성
- 카드 1: `healthz` / PM2 상태
- 카드 2: 소켓 연결 성공률/재접속률
- 카드 3: ACK 수락률/전달률/중복률
- 카드 4: 지연 p50/p95
- 카드 5: 외부 API 오류율(429/5xx)

## 6) 일일 점검 루틴
- 오전:
  - 전일 delivery/read/reconnect 주요 수치 확인
  - 임계치 초과 항목 RCA 티켓화
- 오후:
  - 5분 스모크(1:1 생성/송수신/읽음/재접속)
  - 알람 소음(false positive) 정리

## 7) 주간 리포트 항목
- 전달률/가용성(주 평균, 최저 구간)
- 장애 건수(SEV별) 및 MTTR
- 외부 API 오류 점유율
- 다음 주 개선 액션 3개

