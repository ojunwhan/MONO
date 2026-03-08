# MONO 병원 VAD 파이프라인 구현 보고서

**작성일**: 2026-03-08 (일)  
**브랜치**: `feature/hospital-plastic-surgery`  
**커밋 수**: 23건 (d602fd6 → d2b36c6)  
**배포 서버**: AWS Lightsail `15.164.59.178` / PM2 프로세스 `mono`

---

## 1. 구현 목표 및 배경

### 배경
기존 MONO 통역 시스템은 사용자가 마이크 버튼을 눌러 수동으로 녹음→STT→번역하는 방식이었다.
병원 현장에서는 의료진과 환자가 동시에 디바이스를 조작하기 어려우므로,
**VAD(Voice Activity Detection) 기반 자동 음성 감지 파이프라인**을 도입하여
말하면 자동으로 감지→STT→번역이 이루어지는 핸즈프리 통역 시스템을 구현했다.

### 목표
1. **VAD 자동감지 파이프라인** (`useVADPipeline` 훅) 구현
2. **병원 직원용 VAD 통역 페이지** (`FixedRoomVAD`) 구현
3. **직원(owner) 제어 원칙** — 직원이 통역 시작/종료를 제어, 환자는 자동 연동
4. **양방향 소켓 이벤트** (`fixed-room:start`, `fixed-room:end`) 추가
5. 기존 `ChatScreen.jsx`, `MicButton.jsx`, `server.js` 핵심 로직 수정 최소화

---

## 2. 신규 파일 목록

| 파일명 | 역할 | 라인수 |
|--------|------|--------|
| `src/hooks/useVADPipeline.js` | Silero VAD 기반 자동 음성 감지 + stt:audio/segment_end 서버 전송 훅 | 125 |
| `src/pages/FixedRoomVAD.jsx` | 병원 VAD 자동통역 화면 (3단계: waiting→ready→interpreting→ended) | 821 |
| `src/pages/FixedRoom.jsx` | 범용 고정 위치 VAD 통역 화면 (/fixed/:location) | 434 |
| `src/pages/HospitalApp.jsx` | 병원 모드 메인 (키오스크/직원/노말 모드 분기) | 1,134 |
| `src/pages/HospitalPatientJoin.jsx` | 환자 QR 스캔 → 언어 선택 → FixedRoomVAD 입장 | 318 |
| `src/pages/HospitalKiosk.jsx` | 태블릿 거치용 고정 QR 화면 (소켓 연결 없음) | 178 |
| `src/pages/HospitalAesthetic.jsx` | 성형/피부 클리닉 전용 랜딩 페이지 | 213 |
| `src/pages/HospitalDashboard.jsx` | 병원 대시보드 (통계/관리) | 1,175 |
| `src/pages/HospitalRecords.jsx` | 병원 기록 조회 | 247 |
| `src/constants/medicalKnowledge.js` | 의료 용어 사전 (프론트엔드용 ESM) | 431 |
| `server/constants/medicalKnowledge.js` | 의료 용어 사전 (서버용 CJS) — GPT-4o 프롬프트 주입 | 398 |
| `server/db/migrations/003_hospital_patient_token.sql` | 환자 토큰 기반 DB 테이블 (v2) | 44 |
| `server/cost-report.js` | 일일 비용 리포트 (텔레그램) | 100 |

---

## 3. 수정된 파일 목록

| 파일명 | 라인수 | 변경 내용 요약 |
|--------|--------|----------------|
| `server.js` | 5,392 | `fixed-room:start/end` 소켓 핸들러 추가, COOP/COEP 헤더 경로 한정, MIME 타입 설정, 의료용어 프롬프트 주입, broadcast 전환 방지, 에러 모니터링, hospital API 추가 |
| `vite.config.js` | 57 | VAD WASM/ONNX 에셋 복사 플러그인, COOP/COEP 개발서버 헤더, API 프록시 |
| `src/router.jsx` | 139 | `/hospital/*`, `/fixed/:location`, `/fixed-room/:roomId` 라우트 추가 |
| `src/App.jsx` | 80 | `isGuestJoinRoute`에 hospital/fixed 경로 추가 (온보딩 스킵) |
| `src/components/QRCodeBox.jsx` | 329 | `onGuestJoined` 콜백, `myUserId` 전달, `hospitalDept`/`saveMode` props 추가 |
| `src/components/ChatScreen.jsx` | 1,827 | 병원모드 파트너명 "병원" 고정, `partnerLang` 동기화 useEffect, peerInfo 재계산 |
| `src/pages/GuestJoin.jsx` | - | 병원모드 분기 UI, 온보딩 스킵, `getPatientLabel()` 다국어 환자명 |
| `src/pages/KioskPage.jsx` | - | `siteContext` → `hospital_kiosk` 변경 |
| `src/pages/Home.jsx` | - | 병원 모드 버튼 제거 |
| `package.json` | - | `@ricky0123/vad-react`, `@ricky0123/vad-web`, `node-cron`, `recharts` 추가 |
| `server/db/migrations/002_hospital_kiosk.sql` | - | `hospital_patients` 테이블, `api_usage_daily` 테이블 추가 |

---

## 4. 전체 플로우

### 4.1 직원(Owner) 플로우

```
[직원 PC]
/hospital?mode=staff&dept=reception
       │
       ▼
  StaffModePanel 표시
  (환자 대기 목록 실시간 수신)
       │
       │  환자가 QR 스캔 후 입장
       ▼
  "대기 중인 환자" 카드 표시
  (patientToken, 언어, 입장 시간)
       │
       │  "통역 시작" 클릭
       ▼
  navigate('/fixed-room/${roomId}')
  state: { isCreator:true, roleHint:"owner",
           siteContext, hospitalDept, patientToken }
       │
       ▼
  FixedRoomVAD [step="waiting"]
  "환자 연결을 기다리는 중..."
       │
       │  partner-joined 수신
       ▼
  FixedRoomVAD [step="ready"]
  "환자가 연결되었습니다 ✅"
  [통역 시작] 버튼 표시
       │
       │  "통역 시작" 클릭
       │  → socket.emit("fixed-room:start")
       ▼
  FixedRoomVAD [step="interpreting"]
  VAD 자동감지 시작 → 말하면 자동 STT/번역
  메시지 말풍선 실시간 표시
       │
       │  "통역 종료" 클릭
       │  → socket.emit("fixed-room:end")
       ▼
  navigate('/hospital?mode=staff&dept=${deptId}')
  (직원 대기 화면으로 복귀)
```

### 4.2 환자(Guest) 플로우

```
[환자 스마트폰]
QR 스캔 → /hospital/join/:department
       │
       ▼
  HospitalPatientJoin
  언어 선택 화면
       │
       │  언어 선택 + "통역 시작" 클릭
       ▼
  roomId 생성: patient_${dept}_${timestamp}_${random}
  서버에 waiting 등록 (POST /api/hospital/join)
       │
       ▼
  navigate('/fixed-room/${roomId}')
  state: { isCreator:false, roleHint:"guest",
           siteContext, hospitalDept, patientToken }
       │
       ▼
  FixedRoomVAD [step="ready"]
  "의료진과 연결되었습니다 ✅"
  "통역 시작을 기다리는 중..." (버튼 없음)
       │
       │  fixed-room:start 수신 (직원이 시작)
       ▼
  FixedRoomVAD [step="interpreting"]
  VAD 자동 시작 → 말하면 자동 STT/번역
  메시지 말풍선 실시간 표시 (버튼 없음)
       │
       │  fixed-room:end 수신 (직원이 종료)
       ▼
  FixedRoomVAD [step="ended"]
  "상담이 종료되었습니다"
  (페이지 닫기 안내)
```

### 4.3 키오스크(태블릿) 플로우

```
[태블릿]
/hospital?mode=kiosk&dept=reception
  또는 /hospital/kiosk/:department
       │
       ▼
  QR 코드만 표시 (소켓 연결 없음)
  URL: /hospital/join/${dept}
  다국어 안내 메시지 순환
  Wake Lock으로 화면 꺼짐 방지
```

---

## 5. 소켓 이벤트 맵 (신규 추가)

### 5.1 클라이언트 → 서버

| 이벤트명 | 페이로드 | 발생 위치 | 설명 |
|----------|----------|-----------|------|
| `fixed-room:start` | `{ roomId }` | FixedRoomVAD (owner) | 직원이 "통역 시작" 클릭 |
| `fixed-room:end` | `{ roomId }` | FixedRoomVAD (owner) | 직원이 "통역 종료" 클릭 |

### 5.2 서버 → 클라이언트 (브로드캐스트)

| 이벤트명 | 페이로드 | 수신 대상 | 동작 |
|----------|----------|-----------|------|
| `fixed-room:start` | `{ roomId }` | 해당 roomId 전체 | 양쪽 VAD 시작 + step="interpreting" |
| `fixed-room:end` | `{ roomId }` | 해당 roomId 전체 | 양쪽 VAD 종료, owner→staff 화면, guest→ended 화면 |
| `hospital:patient-waiting` | `{ roomId, dept, patientToken, lang, ... }` | staff 소켓 | 직원 화면에 환자 대기 알림 |

### 5.3 기존 이벤트 (VAD 파이프라인에서 재사용)

```
stt:open       → STT 세션 등록
stt:audio      → PCM16 오디오 청크 전송 (24000샘플 단위)
stt:segment_end → 전송 완료 → 서버 풀파이프라인 시작
                  (transcribePcm16 → fastTranslate → hqTranslate → receive-message)
```

---

## 6. URL 구조 (신규 추가)

| URL | 페이지 | 설명 |
|-----|--------|------|
| `/fixed-room/:roomId` | FixedRoomVAD | VAD 자동통역 화면 (직원/환자 공용) |
| `/fixed/:location` | FixedRoom | 범용 고정 위치 VAD 통역 |
| `/hospital` | HospitalApp | 병원 모드 메인 (?mode=kiosk/staff/normal) |
| `/hospital/aesthetic` | HospitalAesthetic | 성형/피부 클리닉 랜딩 |
| `/hospital/kiosk/:department` | HospitalKiosk | 태블릿 QR 전용 |
| `/hospital/join/:department` | HospitalPatientJoin | 환자 QR 스캔 입장 |
| `/hospital/records` | HospitalRecords | 병원 기록 조회 |
| `/hospital-dashboard` | HospitalDashboard | 병원 대시보드 |

---

## 7. VAD 파라미터 설정값 및 이유

`src/hooks/useVADPipeline.js`에서 Silero VAD v5 모델 사용:

| 파라미터 | 값 | 이유 |
|----------|-----|------|
| `positiveSpeechThreshold` | 0.5 | 말소리 판정 임계값 (기본값). 병원 상담실 환경에 적합 |
| `negativeSpeechThreshold` | 0.35 | 묵음 판정 임계값. 낮출수록 예민하게 묵음 감지 |
| `redemptionMs` | 600 | 침묵 판정 대기 시간 (~0.6초). 자연스러운 말 끊김 감지 |
| `minSpeechMs` | 250 | 최소 발화 길이. 기침/노이즈 필터링 |
| `preSpeechPadMs` | 300 | 발화 시작 전 여유 버퍼. 첫 음절 누락 방지 |
| `submitUserSpeechOnPause` | true | VAD pause 시 진행 중인 발화 자동 전송 |

### 추가 필터 (onSpeechEnd 콜백 내)

| 필터 | 조건 | 이유 |
|------|------|------|
| RMS 저음량 필터 | `rms < 0.01` | Whisper 환각(hallucination) 방지 |
| 최소 길이 필터 | `samples < 8000 (0.5초)` | 너무 짧은 노이즈 폐기 |

### 오디오 전송 스펙

| 항목 | 값 |
|------|-----|
| 샘플레이트 | 16,000 Hz |
| 포맷 | Int16 PCM |
| 청크 크기 | 24,000 샘플 (1.5초) |
| 인코딩 | Base64 |
| 전송 경로 | `stt:open` → `stt:audio` × N → `stt:segment_end` |

---

## 8. 알려진 이슈 / 향후 개선사항

### 알려진 이슈

| # | 이슈 | 심각도 | 상태 |
|---|------|--------|------|
| 1 | VAD WASM 파일이 COOP/COEP 헤더 필요 → `/fixed-room`, `/fixed` 경로에만 적용 중. 다른 페이지에서 VAD 사용 시 별도 설정 필요 | 중 | 해결됨 (경로 한정) |
| 2 | 빌드 결과물 1.5MB 초과 (chunk size warning) → code splitting 미적용 | 하 | 미해결 |
| 3 | 환자가 브라우저를 닫고 재접속 시 `participantId` 변경 가능 → localStorage 기반으로 방지 중이나 시크릿 모드에서는 불가 | 하 | 부분 해결 |
| 4 | VAD가 지원되지 않는 브라우저(Safari iOS 일부) 에서 `SharedArrayBuffer` 미지원 가능 | 중 | COOP/COEP 헤더로 대응 중 |

### 향후 개선사항

| # | 개선사항 | 우선순위 |
|---|---------|----------|
| 1 | VAD 파라미터 실시간 조정 UI (관리자 대시보드) | 중 |
| 2 | 환자별 대화 이력 조회 (`GET /api/hospital/patient/:token/history`) 연동 | 상 |
| 3 | 세션 종료 시 자동 요약 (GPT-4o 요약) 생성 | 중 |
| 4 | 다중 진료과 동시 운영 시 직원 화면 진료과 필터링 | 중 |
| 5 | 환자 재방문 시 이전 대화 요약 자동 표시 | 하 |
| 6 | TTS(음성 합성) 자동 재생 옵션 추가 | 하 |
| 7 | Code splitting으로 번들 크기 최적화 | 하 |
| 8 | Safari/iOS 호환성 테스트 및 fallback 구현 | 상 |

---

## 9. 테스트 확인 항목

### 9.1 기본 플로우 테스트

- [ ] 직원 PC: `/hospital?mode=staff&dept=reception` 접속 → 대기 화면 정상 표시
- [ ] 태블릿: `/hospital/kiosk/reception` 접속 → QR만 표시, 소켓 미연결 확인
- [ ] 환자 폰: QR 스캔 → `/hospital/join/reception` → 언어 선택 화면 표시
- [ ] 환자: 언어 선택 후 "통역 시작" → `/fixed-room/${roomId}` 진입
- [ ] 직원 화면: 환자 대기 카드 실시간 표시 확인
- [ ] 직원: "통역 시작" 클릭 → `/fixed-room/${roomId}` 진입

### 9.2 VAD 통역 테스트

- [ ] 직원 화면: step="waiting" → partner-joined → step="ready"
- [ ] 환자 화면: step="ready" → "통역 시작을 기다리는 중..." 표시 (버튼 없음)
- [ ] 직원: "통역 시작" 클릭 → 양쪽 step="interpreting" + VAD 자동 시작
- [ ] 말하면 상태바 "🎤 음성 감지 중" → "번역 중..." → "🎤 듣는 중" 순환
- [ ] 번역 결과 양쪽 메시지 말풍선에 실시간 표시
- [ ] HQ 번역 업데이트 (revise-message) 정상 반영

### 9.3 종료 테스트

- [ ] 직원: "통역 종료" 클릭 → 양쪽 VAD 정지
- [ ] 직원: `/hospital?mode=staff&dept=${dept}` 자동 이동
- [ ] 환자: step="ended" → "상담이 종료되었습니다" 화면 표시
- [ ] 환자가 먼저 나가면 직원 화면 step="waiting" 전환

### 9.4 네트워크/소켓 확인

- [ ] 브라우저 네트워크 탭: `stt:audio` + `stt:segment_end` 소켓 이벤트 확인
- [ ] `fixed-room:start` / `fixed-room:end` 양방향 전파 확인
- [ ] Keepalive (25초 간격) 정상 발송 확인

### 9.5 기존 기능 비파괴 확인

- [ ] 일반 MONO `/interpret` → QR 생성 → 게스트 스캔 → 통역 정상 동작
- [ ] `/room/:roomId` 기존 ChatScreen 정상 동작
- [ ] 병원 노말 모드 `/hospital?mode=normal&dept=plastic_surgery` 정상 동작

### 9.6 에지케이스

- [ ] 직원이 "통역 시작" 전에 뒤로가기 → VAD 미시작 확인
- [ ] 환자가 새로고침 후 재접속 → participantId 유지 확인
- [ ] VAD 로딩 실패 시 에러 메시지 표시 확인
- [ ] COOP/COEP 헤더가 `/fixed-room`, `/fixed` 경로에만 적용되는지 확인

---

## 커밋 이력 (2026-03-08)

```
d2b36c6 feat: owner controls VAD for both sides - fixed-room:start/end bilateral events
2a256e8 feat: fixed-room:end event for bilateral session termination
5c43bd5 feat: patient navigates to /fixed-room with guest roleHint
46beaa9 fix: COOP/COEP headers only for /fixed-room and /fixed paths
baab1fd feat: staff VAD pipeline - FixedRoomVAD with 3-step flow
33e7110 fix: VAD ONNX Runtime WASM serving - copy assets, COOP/COEP, MIME types
27c5726 feat: VAD fixed pipeline
6e1ea7d feat: add real-time error monitoring dashboard /admin/errors
07c4da1 fix: hospital_patients INSERT NOT NULL constraint
c4f57a6 feat: auto-save session transcript with folder picker
8509870 fix: remove hospital mode button from Home, skip guest onboarding
0bcff7d feat: add per-page OG meta tags for KakaoTalk preview
dd827ae fix: pass participantId from QRCodeBox to ChatScreen
88b4c3c fix: force sync peerInfo when partnerLang changes
fa57758 fix: host header language display - sync on participants/rejoin
aeda880 fix: hospital mode header - partner name and language display
3b4d378 feat: inject medical term glossary into GPT-4o systemPrompt
be3115d fix: prevent broadcast conversion for all hospital rooms
b6f293d feat: add /hospital/aesthetic landing page
463c027 feat: add hospital normal mode and plastic_surgery department
b9272c8 fix: hospital guest partner name display
d602fd6 feat: hospital kiosk redesign - patientToken storage, staff realtime
3683acb fix: hospital fixed room - block history load, clear participants
```

---

*Generated by MONO Development Assistant — 2026-03-08*
