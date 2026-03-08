# MONO 병원 모드 전체 기능 보고서

**작성일시**: 2026-03-07 (토) 22:00 KST  
**작성 기준**: `feature/hospital-plastic-surgery` 브랜치 최신 커밋  
**서버**: lingora.chat (15.164.59.178)

---

## 1. 병원 모드 진입 URL 및 파라미터

### 라우터 정의 (`src/router.jsx` L92~L114)

| URL | 컴포넌트 | 설명 |
|-----|---------|------|
| `/hospital` | `HospitalApp` | 메인 진입 (mode/dept 파라미터로 분기) |
| `/hospital?mode=kiosk&dept={id}` | `HospitalApp` → kiosk 분기 | 태블릿 QR 전용 |
| `/hospital?mode=staff&dept={id}` | `HospitalApp` → StaffModePanel | 직원 PC 대기 화면 |
| `/hospital?mode=normal&dept={id}` | `HospitalApp` → normal 분기 | 1:1 통역 (호스트 QR) |
| `/hospital/kiosk/{department}` | `HospitalKiosk` | 독립 키오스크 페이지 |
| `/hospital/join/{department}` | `HospitalPatientJoin` | 환자 QR 스캔 → 언어 선택 → 입장 |
| `/hospital/aesthetic` | `HospitalAesthetic` | 성형/피부 클리닉 랜딩 |
| `/hospital/records` | `HospitalRecords` | 통역 기록 조회 |
| `/hospital-dashboard` | `HospitalDashboard` | 관리 대시보드 |
| `/room/{roomId}` | `ChatScreen` | 채팅방 (병원/일반 공용) |

### URL 파라미터

| 파라미터 | 값 | 용도 |
|---------|-----|------|
| `mode` | `kiosk` / `staff` / `normal` / (빈값) | 동작 모드 결정 |
| `dept` | `reception` / `internal` / `surgery` / `emergency` / `obstetrics` / `pediatrics` / `orthopedics` / `neurology` / `dermatology` / `ophthalmology` / `dentistry` / `plastic_surgery` | 진료과 |

---

## 2. HospitalApp.jsx 전체 분기 로직 요약

> 파일: `src/pages/HospitalApp.jsx` (991줄)

### 분기 구조 (순서대로 평가)

```
mode === "kiosk" && selectedDept  →  [L176~L221] 키오스크 QR 전용 화면
mode === "staff" && selectedDept  →  [L226~L241] StaffModePanel 렌더링
mode === "normal" && selectedDept →  [L248~L349] 1:1 통역 모드 (QRCodeBox 사용)
step === "summary"                →  [L431~L491] 세션 종료 후 대화 요약
step === "department" (PC)        →  [L629~L648] 좌우 분할 레이아웃
step === "department" (Mobile)    →  [L630~L636] 단일 컬럼 레이아웃
step === "session" (Mobile)       →  [L657~L738] QR 코드 + 설정 화면
```

### 키오스크 모드 (`mode=kiosk`, L176~L221)
- **소켓 연결 없음** — `react-qr-code` 라이브러리로 정적 QR만 렌더링
- QR URL: `/hospital/join/{dept}` (방 번호 없음, 진료과 정보만)
- KioskGuideText 컴포넌트로 다국어 안내 문구 3초 간격 순환
- 화면 하단에 Staff PC 모드 URL 안내 표시

### 직원 모드 (`mode=staff`, L226~L241 → StaffModePanel L742~L990)
- `hospital:watch` 소켓 이벤트로 진료과별 대기 환자 구독 (L757~L780)
- `hospital:patient-waiting` 이벤트 수신 → 대기 환자 목록 실시간 추가 (L783~L823)
- `hospital:patient-picked` 이벤트 수신 → 대기 목록에서 제거
- "통역 시작" 클릭 (L826~L851):
  - `DELETE /api/hospital/waiting/{roomId}` 호출
  - `navigate('/room/{roomId}')` — `isCreator: true`, `roleHint: "owner"`, `siteContext: "hospital_{dept}"`

### 일반 모드 (`mode=normal`, L248~L349)
- 기존 MONO 1:1 통역 흐름 그대로 사용
- `QRCodeBox` 컴포넌트로 호스트 QR 생성
- `siteContext: "hospital_{dept}"` 자동 적용
- 환자가 QR 스캔 → `GuestJoin.jsx`로 입장 → `ChatScreen` 진입

### 기본 모드 (mode 없음)
- 진료과 선택 → QR 표시 (L496~L738)
- PC: 좌우 분할 (40% 진료과 목록 / 60% QR 코드)
- Mobile: 단계별 진행 (department → session)
- 세션 종료 시 대화 요약 표시 (L431~L491)

---

## 3. ChatScreen.jsx 에서 hospital 관련 조건문 목록

> 파일: `src/components/ChatScreen.jsx` (1831줄)

| 라인 | 코드 | 동작 |
|------|------|------|
| L139 | `isHospitalMode = String(effectiveSiteContext).startsWith("hospital_")` | 병원 모드 판별 플래그 |
| L140 | `hospitalDept = location.state?.hospitalDept \|\| null` | 진료과 정보 수신 |
| L143 | `HOSPITAL_DISPLAY_NAME = hospitalDept?.labelKo \|\| "병원"` | 상대방 표시 이름 (설정 가능) |
| L146-148 | `hospitalInitialPartnerName = isHospitalMode ? (isGuestMode ? HOSPITAL_DISPLAY_NAME : "환자") : ""` | 초기 상대방 이름 설정 |
| L318-321 | `if (isHospitalMode) { historyLoadedRef.current = true; return; }` | 병원 모드에서 이전 대화 히스토리 로드 스킵 |
| L743 | `resolvedName = (isHospitalMode && roleHint === "guest") ? HOSPITAL_DISPLAY_NAME : ...` | partner-info 이벤트에서 상대방 이름 오버라이드 |
| L1133-1134 | `if (isHospitalMode) { navigate("/hospital", { state: { returnFromSession: true, messages, hospitalDept } }); }` | 나가기 시 /hospital로 복귀 + 세션 데이터 전달 |
| L1310 | `isBroadcastListener = !isHospitalMode && roomType === "broadcast" && roleHint !== "owner"` | **병원 모드는 수신전용 강제 적용 안 함** |

### 역할 결정 로직 (L135)
```javascript
roleHint = isGuestMode ? "guest" : (location.state?.isCreator || queryIsCreator ? "owner" : "guest")
```
- 환자(게스트): `isGuest: true` → `roleHint = "guest"`
- 직원(호스트): `isCreator: true` → `roleHint = "owner"`

### participantId 동기화 (L115~L128)
- `location.state?.myUserId`가 있으면 그 값 사용 (QRCodeBox → ChatScreen 전달)
- 없으면 `localStorage mro.pid.{roomId}` 조회 또는 신규 생성

### partner 언어 동기화 (L289~L300)
```javascript
useEffect(() => {
  if (!partnerLang) return;
  setPeerInfo(prev => ({
    ...prev, peerLang: partnerLang,
    peerFlagUrl: ..., peerLabel: ...
  }));
}, [partnerLang]);
```

---

## 4. server.js 에서 hospital 관련 처리 목록

> 파일: `server.js` (약 5111줄)

### 4-1. 상수 / 설정

| 라인 | 항목 | 내용 |
|------|------|------|
| L511~L522 | `SITE_CONTEXT_PROMPTS` | 12개 진료과별 GPT 시스템 프롬프트 |
| L534~L545 | `SITE_ROLES` | 12개 진료과별 역할 목록 |
| L1004 | `require("./server/constants/medicalKnowledge.js")` | 의료 용어집 임포트 |
| L1621~L1623 | `isHospitalContext(siteContext)` | `hospital_` 접두사 판별 함수 |
| L4217 | `HOSPITAL_WAITING = new Map()` | 대기 환자 메모리 저장소 |

### 4-2. buildSystemPrompt 분기 (L1625~L1660)

```
isHospital = true 일 때:
  1. SITE_CONTEXT_PROMPTS[siteContext] (진료과 프롬프트)
  2. getMedicalTermContext(dept, targetLang) (의료 용어집 주입)
  3. 전문 의료 번역 지시문
  
isHospital = false 일 때:
  1. 일반 MONO 슬랭/캐주얼 번역 프롬프트
```

### 4-3. 소켓 join 핸들러 — 병원 모드 특수 처리 (L2563~L2583)

```javascript
// L2564-2583: oneToOne 방에서 broadcast 자동 전환 분기
if (isHospitalRoom) {
  // 오프라인 게스트만 정리, broadcast 전환 절대 안 함
  // → 항상 1:1 유지
} else {
  // 일반 모드: 3명 이상 시 broadcast 전환
}
```

### 4-4. REST API 엔드포인트

| 라인 | Method | Path | 설명 |
|------|--------|------|------|
| L4221 | `POST` | `/api/hospital/join` | 환자 QR 스캔 → 새 roomId 생성 + ROOMS 등록 + HOSPITAL_WAITING 추가 |
| L4300 | `POST` | `/api/hospital/patient` | 환자 등록/업데이트 (patientToken 기반) |
| L4335 | `GET` | `/api/hospital/patient/:patientToken` | 환자 정보 조회 |
| L4371 | `GET` | `/api/hospital/waiting` | 대기 환자 목록 조회 (dept 필터) |
| L4388 | `DELETE` | `/api/hospital/waiting/:roomId` | 대기 목록에서 제거 + socket 알림 |
| L4404 | `GET` | `/api/hospital/patient/:patientToken/history` | 환자 전체 이력 조회 |
| L4434 | `POST` | `/api/hospital/session` | 세션 생성 |
| L4475 | `POST` | `/api/hospital/session/:sessionId/end` | 세션 종료 |
| L4503 | `POST` | `/api/hospital/message` | 메시지 저장 |
| L4526 | `GET` | `/api/hospital/dashboard/stats` | 대시보드 통계 |
| L4602 | `GET` | `/api/hospital/dashboard/sessions` | 대시보드 세션 목록 |
| L4655 | `GET` | `/api/hospital/sessions` | 세션 목록 |
| L4673 | `GET` | `/api/hospital/sessions/:sessionId/messages` | 세션별 메시지 |
| L4689 | `GET` | `/api/hospital/kiosk/status` | 키오스크 상태 |
| L4757 | `POST` | `/api/hospital/patients` | 환자 등록 (chart_number 기반) |
| L4791 | `GET` | `/api/hospital/patients/:chartNumber` | 차트번호로 환자 조회 |
| L4809 | `PUT` | `/api/hospital/patients/:chartNumber` | 환자 정보 수정 |
| L4833 | `GET` | `/api/hospital/patients` | 전체 환자 목록 |
| L4851 | `GET` | `/api/hospital/records/:chartNumber` | 차트번호별 기록 |
| L4874 | `POST` | `/api/hospital/session/:sessionId/guest-lang` | 게스트 언어 업데이트 |

### 4-5. POST /api/hospital/join 핵심 흐름 (L4221~L4294)

```
1. 새 roomId 생성: `patient_{dept}_{timestamp}_{random4}`
2. hospital_patients upsert (patientToken 기반)
3. hospital_sessions INSERT
4. ROOMS.set() — 방 메타데이터 사전 등록
   - roomType: 'oneToOne'
   - siteContext: 'hospital_{dept}'
   - ownerPid: null (직원 join 시 설정)
   - hospitalMode: true
5. HOSPITAL_WAITING에 대기 환자 추가
6. hospital:patient-waiting 소켓 이벤트 broadcast
```

---

## 5. hospitalDepartments.js 과별 설정값

> 파일: `src/constants/hospitalDepartments.js` (147줄)

| id | labelKo | icon | server SITE_CONTEXT 키 |
|----|---------|------|----------------------|
| `reception` | 원무과 / 접수 | 🏥 | `hospital_reception` |
| `internal` | 내과 | 🫀 | `hospital_internal` |
| `surgery` | 외과 | 🔪 | `hospital_surgery` |
| `emergency` | 응급의학과 | 🚨 | `hospital_emergency` |
| `obstetrics` | 산부인과 | 🤰 | `hospital_obstetrics` |
| `pediatrics` | 소아과 | 👶 | `hospital_pediatrics` |
| `orthopedics` | 정형외과 | 🦴 | `hospital_orthopedics` |
| `neurology` | 신경과 | 🧠 | `hospital_neurology` |
| `dermatology` | 피부과 | 🧴 | `hospital_dermatology` |
| `ophthalmology` | 안과 | 👁️ | `hospital_ophthalmology` |
| `dentistry` | 치과 | 🦷 | `hospital_dentistry` |
| `plastic_surgery` | 성형외과 | 💎 | `hospital_plastic_surgery` |

### 각 과별 prompt 구조
- 전문 의료 통역사 역할 지정
- 해당 과 전문 용어 나열
- 환자 안전 우선 원칙
- 응급과(`emergency`)만 특수: "Speed and accuracy are critical", "NEVER delay"

---

## 6. medicalKnowledge.js 연결 상태

### 파일 구조

| 파일 | 타입 | 용도 |
|------|------|------|
| `src/constants/medicalKnowledge.js` (441줄) | ESM (`export`) | 프론트엔드 참조용 |
| `server/constants/medicalKnowledge.js` (398줄) | CJS (`module.exports`) | **서버 실사용** |

> ⚠️ 두 파일은 동일한 데이터를 CJS/ESM 두 벌로 관리. 용어 추가 시 양쪽 동기화 필요.

### 용어집 카테고리

| 상수명 | 설명 | 수록 용어 수 |
|--------|------|-------------|
| `COMMON_HOSPITAL` | 공통 병원 행정/절차 | ~20개 |
| `PLASTIC_SURGERY` | 성형외과 전문 | ~40개 |
| `COSMETIC_DERMATOLOGY` | 미용피부과 | ~25개 |
| `INTERNAL_MEDICINE` | 내과 | ~25개 |
| `SURGERY` | 외과 | ~20개 |
| `EMERGENCY` | 응급의학과 | ~25개 |
| `OBSTETRICS` | 산부인과 | ~20개 |
| `PEDIATRICS` | 소아과 | ~20개 |
| `ORTHOPEDICS` | 정형외과 | ~20개 |
| `NEUROLOGY` | 신경과 | ~20개 |
| `OPHTHALMOLOGY` | 안과 | ~15개 |
| `DENTISTRY` | 치과 | ~15개 |
| `PROCEDURES_AND_TESTS` | 검사/처치 공통 | ~20개 |
| `MEDICATIONS` | 약물 공통 | ~15개 |

### DEPT_TERM_MAP (dept → 용어 세트 매핑)

```javascript
// server/constants/medicalKnowledge.js L349~L365
{
  plastic_surgery:  [COMMON, PLASTIC, COSMETIC_DERM, MEDICATIONS],
  dermatology:      [COMMON, COSMETIC_DERM, PLASTIC, MEDICATIONS],
  internal:         [COMMON, INTERNAL, PROCEDURES, MEDICATIONS],
  surgery:          [COMMON, SURGERY, PROCEDURES, MEDICATIONS],
  emergency:        [COMMON, EMERGENCY, PROCEDURES, MEDICATIONS],
  obstetrics:       [COMMON, OBSTETRICS, MEDICATIONS],
  pediatrics:       [COMMON, PEDIATRICS, MEDICATIONS],
  orthopedics:      [COMMON, ORTHOPEDICS, PROCEDURES, MEDICATIONS],
  neurology:        [COMMON, NEUROLOGY, PROCEDURES, MEDICATIONS],
  ophthalmology:    [COMMON, OPHTHALMOLOGY, MEDICATIONS],
  dentistry:        [COMMON, DENTISTRY, MEDICATIONS],
  reception:        [COMMON, MEDICATIONS],
}
```

### 서버 연결 (server.js)
- **L1004**: `const { getMedicalTermContext } = require("./server/constants/medicalKnowledge.js")`
- **L1631~L1633**: `buildSystemPrompt` 내부에서 `dept` 추출 후 `getMedicalTermContext(dept, targetLang)` 호출
- 결과가 GPT-4o `systemPrompt`에 용어집으로 주입됨

---

## 7. 소켓 이벤트 중 hospital 관련 흐름

### 7-1. 전체 소켓 이벤트 맵

#### Client → Server

| 이벤트 | 발신 컴포넌트 | payload | 서버 처리 위치 |
|--------|-------------|---------|--------------|
| `hospital:watch` | StaffModePanel (L763) | `{ department }` | server.js L4720 |
| `hospital:unwatch` | StaffModePanel (L776) | `{ department }` | server.js L4744 |
| `create-room` | QRCodeBox (L60~L88) | `{ roomId, lang, siteContext, roomType, participantId, ... }` | server.js L2341~L2460 |
| `join` | ChatScreen (L397~L418) | `{ roomId, participantId, lang, roleHint, siteContext, ... }` | server.js L2462~L2900 |

#### Server → Client

| 이벤트 | 수신 컴포넌트 | payload | 용도 |
|--------|-------------|---------|------|
| `hospital:patient-waiting` | StaffModePanel (L816) | `{ roomId, department, createdAt, patientToken, language }` | 대기 환자 알림 |
| `hospital:patient-picked` | StaffModePanel (L817) | `{ roomId, department }` | 대기 목록에서 제거 |
| `partner-joined` | ChatScreen (L795) | `{ roomId, peerLang, peerFlagUrl, peerLabel }` | 상대방 언어 정보 |
| `partner-info` | ChatScreen (L794) | `{ partnerName, peerLocalizedName, peerLang }` | 상대방 이름+언어 |
| `participants` | ChatScreen (L784) | `[{ pid, lang, online, ... }]` | 참가자 목록 |

### 7-2. 키오스크 → 환자 → 직원 전체 흐름

```
[1] 태블릿 (Kiosk)
    /hospital?mode=kiosk&dept=reception
    또는 /hospital/kiosk/reception
    → 정적 QR 표시 (소켓 연결 없음)
    → QR URL: /hospital/join/reception

[2] 환자 (Phone)
    QR 스캔 → /hospital/join/reception
    → HospitalPatientJoin 마운트
    → 언어 선택
    → handleJoin() 실행:
       POST /api/hospital/patient  ← patientToken 등록
       POST /api/hospital/join     ← roomId 생성 + HOSPITAL_WAITING 추가
                                   ← 서버가 hospital:patient-waiting emit
       navigate('/room/{roomId}')  ← isGuest:true, isCreator:false,
                                      roleHint:"guest", siteContext:"hospital_reception"

[3] 직원 PC (Staff)
    /hospital?mode=staff&dept=reception
    → StaffModePanel 마운트
    → socket.emit("hospital:watch", { department: "reception" })
    → socket.on("hospital:patient-waiting") ← 환자 대기 카드 표시
    → "통역 시작" 클릭:
       DELETE /api/hospital/waiting/{roomId}  ← 대기 목록 제거
                                             ← 서버가 hospital:patient-picked emit
       navigate('/room/{roomId}')            ← isCreator:true,
                                                roleHint:"owner", siteContext:"hospital_reception"

[4] ChatScreen 동작 (양쪽)
    마운트 → socket.emit("join", { roomId, participantId, roleHint, siteContext, ... })
    서버:
      - 병원 모드 방 → broadcast 전환 방지
      - partner-info / partner-joined 이벤트 양방향 전송
    결과:
      - 직원: roleHint="owner" → 마이크+입력창 활성
      - 환자: roleHint="guest" → 마이크+입력창 활성 (isBroadcastListener 비활성)
```

### 7-3. 상담실 모드 (HospitalAesthetic) 흐름

```
[1] 호스트 (PC/Tablet)
    /hospital/aesthetic → "상담실 모드" 클릭
    → QRCodeBox 마운트 (roomId 즉시 생성)
    → create-room emit → join emit
    → QR 표시 (일반 MONO join URL)

[2] 환자 (Phone)
    QR 스캔 → /join/{roomId} → GuestJoin
    → 언어 선택 → join → ChatScreen

[3] QRCodeBox가 guest:joined/partner-joined 수신
    → navigate('/room/{roomId}', { myUserId: pidRef.current, isCreator: true, siteContext: "hospital_plastic_surgery" })
    → ChatScreen 마운트 (같은 participantId로 재join)
```

---

## 8. 현재 알려진 미완성 항목 / TODO

### 🔴 확인된 이슈

| # | 항목 | 상태 | 설명 |
|---|------|------|------|
| 1 | **호스트 헤더 KOR ↔ KOR 표시** | ✅ 수정 완료 (배포됨) | QRCodeBox → ChatScreen 전환 시 `participantId` 미전달로 새 pid 생성 → 서버에서 잘못된 peer 매칭 → 수정: `myUserId: pidRef.current` 전달 |
| 2 | **medicalKnowledge.js 이중 관리** | ⚠️ 구조적 부채 | ESM/CJS 두 벌 관리 필요. 용어 추가 시 양쪽 동기화 안 하면 불일치 발생 |
| 3 | **v1/v2 DB 테이블 공존** | ⚠️ 구조적 부채 | `hospital_patients` (chart_number 기반) + `hospital_patients_v2` (patient_token 기반) 혼재. 서버는 v1 테이블에 patient_token 컬럼 추가하여 사용 중 |

### 🟡 미구현 / 부분 구현

| # | 항목 | 상태 | 설명 |
|---|------|------|------|
| 4 | **send-message에서 hospital_messages 자동 저장** | ⚠️ 부분 구현 | server.js `send-message` 핸들러에서 `patient_token`이 있을 때 `hospital_messages`에 저장하는 로직 존재하나, 환자 측에서 `patientToken`이 소켓 join 데이터에 전달되지 않을 수 있음 |
| 5 | **직원 화면에서 환자 이전 방문 기록 표시** | ⚠️ API만 존재 | `GET /api/hospital/patient/:patientToken/history` API 구현됨. 프론트엔드 UI 미구현 |
| 6 | **세션 종료 시 hospital_sessions.ended_at 업데이트** | ⚠️ 수동 호출 필요 | `POST /api/hospital/session/:sessionId/end` API 존재. 자동 호출 로직 미구현 |
| 7 | **HOSPITAL_WAITING 메모리 만료 처리** | ❌ 미구현 | 서버 재시작 시 대기 목록 초기화됨. 장기 미접수 환자 자동 만료 없음 |
| 8 | **복수 직원 동시 접속 시 환자 배정 충돌** | ⚠️ 기본 방지만 | `DELETE /api/hospital/waiting/:roomId`로 제거하지만, 동시 클릭 시 race condition 가능 |

### 🟢 향후 개선 가능 사항

| # | 항목 | 설명 |
|---|------|------|
| 9 | 병원명 CLINIC_NAME 통합 상수화 | HospitalAesthetic: `"성형/피부 클리닉"`, ChatScreen: `hospitalDept?.labelKo \|\| "병원"` — 통합 관리 필요 |
| 10 | EMR 연동 | hospital_patients 테이블에 `hospital_id` 필드 존재하나 미사용 |
| 11 | 키오스크 원격 관리 | `/api/hospital/kiosk/status` API 존재하나 관리 UI 미구현 |
| 12 | 진료과별 커스텀 긴급 문구 | 현재 emergency만 EMERGENCY_PHRASES 있음. 다른 과 확장 가능 |

---

## 부록: 파일별 라인 수 요약

| 파일 | 라인 수 | 역할 |
|------|--------|------|
| `server.js` | ~5111 | 서버 전체 (socket + REST + DB) |
| `src/components/ChatScreen.jsx` | ~1831 | 채팅방 UI + 소켓 핸들링 |
| `src/components/QRCodeBox.jsx` | ~330 | 호스트 QR 생성 + 방 관리 |
| `src/pages/HospitalApp.jsx` | ~991 | 병원 메인 (kiosk/staff/normal 분기) |
| `src/pages/HospitalPatientJoin.jsx` | ~317 | 환자 QR 스캔 → 입장 |
| `src/pages/HospitalKiosk.jsx` | ~179 | 독립 키오스크 QR 화면 |
| `src/pages/HospitalAesthetic.jsx` | ~214 | 성형/피부 클리닉 랜딩 |
| `src/constants/hospitalDepartments.js` | ~147 | 12개 진료과 정의 |
| `src/constants/medicalKnowledge.js` | ~441 | 의료 용어집 (ESM) |
| `server/constants/medicalKnowledge.js` | ~398 | 의료 용어집 (CJS) |
| `server/db/migrations/002_hospital_kiosk.sql` | ~70 | DB 스키마 v1 |
| `server/db/migrations/003_hospital_patient_token.sql` | ~45 | DB 스키마 v2 |
