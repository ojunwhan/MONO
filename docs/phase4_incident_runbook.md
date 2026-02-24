# MONO Phase 4-2 장애 대응 런북 (초안)

## 0) 목적
- 운영 중 장애 발생 시 1차 대응 시간을 줄이고 서비스 복구를 표준화한다.
- 범위: `lingora.chat` (Node + PM2 + Nginx + SSL)

## 1) 장애 등급
- `SEV-1`: 전체 접속 불가, 메시지 송수신 전면 장애, TLS/도메인 장애
- `SEV-2`: 일부 기능 장애(예: STT 불가, 푸시 실패), 대체 경로 존재
- `SEV-3`: 성능 저하, 간헐적 오류, 운영 영향 경미

## 2) 공통 초기 대응 (5분 이내)
1. 영향 범위 확인 (전체/일부, 웹/모바일, 특정 방/전체)
2. `healthz` 확인
3. PM2 상태 확인
4. Nginx 상태 확인
5. 최근 배포/설정 변경 여부 확인

### 기본 점검 명령
```bash
curl -sS https://lingora.chat/healthz
pm2 status
pm2 logs mono --lines 200
sudo systemctl status nginx
```

## 3) 시나리오별 대응

### A. 사이트 접속 불가 / 5xx 급증 (SEV-1)
1. `pm2 status`에서 `mono` 상태 확인
2. `pm2 restart mono`
3. `nginx -t` 후 `systemctl reload nginx`
4. 재확인: `healthz`, 메인 페이지, 소켓 접속
5. 미복구 시 이전 정상 릴리스로 롤백

### B. 소켓 연결 실패/재접속 폭증 (SEV-1~2)
1. `/socket.io/` 프록시 설정 확인 (Nginx)
2. 서버 포트 점유/충돌 확인
3. 소켓 관련 에러 로그 수집
4. PM2 재시작 후 5분 모니터링

### C. STT/번역/TTS API 오류율 급증 (SEV-2)
1. 외부 API 에러 코드(429/5xx) 확인
2. 사용자 경고 이벤트 노출 정상 여부 확인
3. 서비스 핵심 경로(텍스트 채팅) 유지 확인
4. 공급자 상태 회복 전까지 장애 공지 템플릿 발송

### D. 배포 직후 정적 리소스 누락 (SEV-2)
1. `dist/index.html` 존재 확인
2. 정적 파일 해시 불일치 확인
3. 최신 빌드 재업로드 + PM2 재시작

## 4) 롤백 절차 (표준)
1. 직전 정상 배포본 아카이브 확인
2. `dist/`, 서버 런타임 파일을 직전 버전으로 복원
3. `pm2 restart mono`
4. `healthz` + 스모크 테스트 3개 항목 확인
5. 장애 티켓에 롤백 시각/사유 기록

## 5) 로그 채취 절차
- PM2:
```bash
pm2 logs mono --lines 500
pm2 describe mono
```
- Nginx:
```bash
sudo tail -n 300 /var/log/nginx/error.log
sudo tail -n 300 /var/log/nginx/access.log
```
- 시스템:
```bash
df -h
free -m
top -b -n 1 | head -n 40
```

## 6) 복구 확인 체크리스트
- [ ] `healthz` 정상
- [ ] 1:1 방 생성/조인 정상
- [ ] 텍스트 송수신 정상
- [ ] 소켓 재연결 루프 없음
- [ ] 오류 로그 급증 멈춤

## 7) 사후 조치 (Postmortem)
- [ ] 장애 타임라인 작성 (발생/인지/완화/복구)
- [ ] 근본 원인(RCA) 기록
- [ ] 재발 방지 액션 아이템 생성
- [ ] 문서/알람 임계치 업데이트

