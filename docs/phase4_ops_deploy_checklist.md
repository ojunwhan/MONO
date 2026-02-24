# MONO Phase 4-1 운영 배포 체크리스트 (AWS/PM2/Nginx/SSL)

## 0) 범위
- 대상: `lingora.chat` 운영 배포/점검
- 기준: PWA + Node.js(`server.js`) + PM2 + Nginx + Let's Encrypt
- 원칙: 서버는 무상태 유지, 메시지 본문 서버 저장 금지

## 1) 사전 점검 (로컬)
- [ ] `npm run build` 성공
- [ ] `npm run qa:smoke` PASS
- [ ] `curl http://127.0.0.1:3174/healthz` 정상 응답
- [ ] 민감정보(`.env`, 키 파일) 커밋/배포 아카이브 제외 확인

## 2) 서버 배포 파일 점검
- [ ] `dist/` 최신 빌드 업로드 확인
- [ ] `server.js`, `server/` 하위 최신 동기화 확인
- [ ] `state/` 디렉토리 권한 확인 (읽기/쓰기)
- [ ] 업로드 후 파일 누락 체크 (`dist/index.html` 존재 필수)

## 3) PM2 운영 점검
- [ ] `pm2 status` 에서 `mono` 프로세스 `online`
- [ ] 재시작 후 즉시 정상 복구 (`pm2 restart mono`)
- [ ] 부팅 후 자동 실행 설정 (`pm2 save`, `pm2 startup`) 확인
- [ ] 로그 회전 정책 확인 (`pm2-logrotate` 또는 동등 설정)

### PM2 기본 명령
```bash
pm2 status
pm2 logs mono --lines 200
pm2 restart mono
pm2 save
```

## 4) Nginx 리버스 프록시 점검
- [ ] `server_name`이 `lingora.chat`, `www.lingora.chat` 포함
- [ ] `/socket.io/` WebSocket 프록시 헤더 설정 확인
- [ ] `client_max_body_size` 및 타임아웃 설정 운영값 확인
- [ ] `nginx -t` 구문 검사 통과
- [ ] 설정 반영 후 `systemctl reload nginx` 성공

### Nginx 점검 명령
```bash
sudo nginx -t
sudo systemctl status nginx
sudo systemctl reload nginx
```

## 5) SSL/인증서 점검 (Let's Encrypt)
- [ ] 인증서 발급 성공 이력 확인
- [ ] `https://lingora.chat` 접속 시 인증서 체인 정상
- [ ] 자동 갱신 드라이런 성공 (`certbot renew --dry-run`)
- [ ] 갱신 후 Nginx reload 훅 정상 동작 확인

### Certbot 점검 명령
```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

## 6) 운영 스모크 테스트 (배포 직후)
- [ ] 호스트: 방 생성 및 QR 표시 정상
- [ ] 게스트: 조인 후 호스트 헤더 peer 정보 즉시 반영
- [ ] 1:1 텍스트 송수신, 번역, 읽음 상태 정상
- [ ] 오프라인 -> 온라인 복구 후 outbox flush 순서 정상
- [ ] 백그라운드 복귀 시 room-members 재동기화 정상
- [ ] 푸시 알림(가능 환경) 수신 및 클릭 라우팅 정상

## 7) 장애 대응 1차 체크
- [ ] `healthz` 실패 시 PM2 재시작 후 회복 여부 확인
- [ ] 포트 충돌 점검 (`3174` 점유 프로세스 확인)
- [ ] 소켓 연결 급감 시 Nginx/PM2 로그 동시 확인
- [ ] OpenAI/외부 API 오류율 급증 시 사용자 경고 이벤트 확인

## 8) 배포 승인 기준 (Go/No-Go)
- Go:
  - [ ] `healthz` 정상
  - [ ] PM2 `online` + 재시작 복구 확인
  - [ ] Nginx/SSL 점검 통과
  - [ ] 운영 스모크 6항목 통과
- No-Go:
  - [ ] `dist/index.html` 누락 또는 정적 파일 불일치
  - [ ] 소켓 조인/재조인 실패 재현
  - [ ] HTTPS/인증서 오류

## 9) 배포 후 30분 모니터링
- [ ] 5분 간격 `healthz` 확인
- [ ] 에러 로그 급증 여부 확인
- [ ] 소켓 재접속 폭증 여부 확인
- [ ] 메시지 전달률 이상 징후 여부 확인

