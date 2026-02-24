# MONO 현재 상태 인계 (Claude 전달용, 최신)

## 1) 운영 컨텍스트
- 전략: **PWA 유지**
- 운영 방식: 사용자 PC 로컬 서버 + Cloudflare Tunnel
  - 서버: `node server.js` (3174)
  - 터널: `cloudflared tunnel --config C:\Users\USER\.cloudflared\config.yml run 7590e315-f780-491a-85d2-668f9939fed5`
- 도메인: `https://lingora.chat`

## 2) 이번 라운드 핵심 수정
요청 원칙: UI/CSS/레이아웃 비변경, 동작 안정성만 수정.

### A. 연결 안정성 (Cloudflare/WebSocket)
- `src/socket.js`
  - `transports: ["websocket"]`
  - `upgrade: false`
  - `path: "/socket.io/"`
  - `timeout: 20000`
  - `pingInterval: 25000`, `pingTimeout: 10000`
  - `reconnectionAttempts: Infinity`
  - `randomizationFactor: 0.5`
  - `forceNew: false`

- `server.js` Socket.IO 옵션
  - `transports: ["websocket"]`
  - `allowUpgrades: false`
  - `path: "/socket.io/"`
  - `pingInterval: 25000`, `pingTimeout: 10000`
  - `connectTimeout: 20000`
  - `maxHttpBufferSize: 5e6`

### B. 방 복구/상태 동기화 이벤트
- `server.js` 추가
  - `rejoin-room`
  - `check-room`
  - `mono-ping` / `mono-pong`
  - `heartbeat` / `heartbeat-ack`
  - `who-is-in-room` / `room-members`

- `src/components/QRCodeBox.jsx` 반영
  - `partner-joined`, `sync-room-state`, `room-status`, `room-members` 수신
  - 백그라운드 복귀 시 `who-is-in-room` 발신
  - 연결/재연결 시 `rejoin-room` 보강
  - `mono_session` sessionStorage 저장

- `src/components/ChatScreen.jsx` 반영
  - 재연결 시 `rejoin-room` 발신
  - visibility/online/network 변경 시 `check-room`
  - latency 측정(`mono-ping/pong`) 로그
  - `room-status` 수신 처리
  - `mono_session` 저장

### C. 마이크/STT 안정화
- `src/utils/AudioProcessor.js`
  - `AudioContext` 시작 시 `resume()` 보강 (suspended 대응)

- `src/components/MicButton.jsx`
  - 마이크 권한/트랙 상태 로그 추가
  - 오디오 전송 크기 로그 추가
  - `stt:open` 타이밍 정리

- `src/audio/vad-processor.js`
  - 신뢰성 우선으로 PCM 지속 전송 보강 (조용한 음성 누락 완화)

- `server.js`
  - `stt:segment-received` ACK 이벤트 추가(진단용)

### D. 링크 복사 UX
- `src/components/QRCodeBox.jsx`
  - `navigator.clipboard.writeText()` 우선
  - 실패 시 `execCommand("copy")` fallback
  - 성공 시 `✅ 복사됨!` 2초 피드백
  - `navigator.share` 사용 코드 없음(검색 확인)

## 3) 검증 결과 (최신)
- `npm run build` 성공
- `node --check server.js` 성공
- 서버 재기동/터널 재기동 확인
- 자동 E2E 6시나리오 결과: **전부 PASS**
  1. 기본 흐름 PASS
  2. 링크 복사 공유시트 미노출 PASS
  3. 백그라운드 복귀 감지 PASS
  4. 텍스트 입력/번역 PASS
  5. 마이크 입력 파이프라인 PASS (`stt:segment-received` bytes 확인)
  6. 재연결/방 복구 PASS

## 4) 현재 변경 파일
- `server.js`
- `src/socket.js`
- `src/components/QRCodeBox.jsx`
- `src/components/ChatScreen.jsx`
- `src/components/MicButton.jsx`
- `src/utils/AudioProcessor.js`
- `src/audio/vad-processor.js`
- `src/utils/ChatStorage.js`
- `handoff_for_claude.md`
- (로컬 설정) `C:\Users\USER\.cloudflared\config.yml`

## 5) 주의 사항
- 터널 설정 파일(`C:\Users\USER\.cloudflared\config.yml`)은 레포 외부 파일이라 Git 커밋/푸시에 포함되지 않음.

## 6) GitHub에 올라간 자료 (확정)
- 리포: `https://github.com/ojunwhan/MONO`
- 브랜치: `main`
- 포함된 주요 루트 자료:
  - 앱/서버 코드: `src/`, `server/`, `public/`, `server.js`
  - 빌드/실행 설정: `package.json`, `package-lock.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.cjs`
  - 인계/문서: `handoff_for_claude.md`, `aws_lightsail_migration_guide.md`
  - 참고 자료: `mono_investor_proof.csv`, `mro_c2c_audio_snapshot.json`, `monitor_simple.ps1`, `scan_all.ps1`
- Git 미포함(로컬 전용) 대표 항목:
  - `.env`
  - `node_modules/`, `dist/`
  - `state/`, `tmp/`, `uploads/`, `monitor_logs/`
  - `server/fcm-service-key.json`
