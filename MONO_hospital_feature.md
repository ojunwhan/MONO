# MONO 병원 모드 기능 문서

> 최종 업데이트: 2026-03-07

---

## 1. 전체 구조

MONO 병원 모드는 **외국인 환자와 의료진 간의 실시간 통역 서비스**를 제공합니다.

### 핵심 원칙

- **QR 스캔 = 새 세션**: 환자가 QR을 스캔할 때마다 새로운 통역 세션이 생성됩니다 (이전 세션과 연속성 없음).
- **진료과별 고정 QR**: 각 진료과 태블릿에 고정 QR 코드를 표시하여 환자가 스캔합니다.
- **환자 고유번호 시스템**: 첫 방문 시 고유번호(`PT-YYYYMMDD-XXXX`)가 자동 생성되어 재방문 시 언어 설정을 자동 적용합니다.
- **직원 PC 실시간 알림**: 환자가 QR 스캔 시 해당 진료과 직원 PC에 실시간 알림이 표시됩니다.

### 운영 흐름

```
[태블릿: 고정 QR]  →  [환자: 스마트폰 스캔]  →  [직원 PC: 통역 시작]
       ↓                      ↓                       ↓
  /hospital/kiosk/:dept   /hospital/join/:dept      /hospital
  (QR 코드 상시 표시)      (언어선택 → 채팅방)      (대기환자 확인 → 통역)
```

---

## 2. 라우트 목록

| 라우트 | 용도 | 사용 기기 |
|--------|------|-----------|
| `/hospital` | 직원 PC 전용 화면 (진료과 선택 + 대기 환자 확인 + 통역) | PC |
| `/hospital/kiosk/:department` | 태블릿 거치용 고정 QR 화면 | 태블릿 |
| `/hospital/join/:department` | 환자 QR 스캔 후 착지 페이지 | 스마트폰 |
| `/hospital/records` | 통역 기록 조회 | PC |
| `/hospital-dashboard` | 병원 관리 대시보드 (통계, 이력, 보고서) | PC |

---

## 3. 환자 고유번호 시스템

### 고유번호 형식

```
PT-YYYYMMDD-XXXX

예: PT-20260307-A3F2
    PT-20260307-K8B1
```

- `PT`: Patient 접두사
- `YYYYMMDD`: 첫 방문 날짜
- `XXXX`: 랜덤 4자리 (대문자 + 숫자)

### 첫 방문 플로우

1. 환자가 태블릿 QR 코드를 스마트폰으로 스캔
2. `/hospital/join/:department` 페이지 접속
3. **언어 선택 화면** 표시 (LanguageFlagPicker)
4. 언어 선택 후 "통역 시작" 버튼 클릭
5. 클라이언트에서 고유번호 자동 생성 (`PT-YYYYMMDD-XXXX`)
6. 서버에 환자 등록 (`POST /api/hospital/patient`)
7. localStorage에 `mono_hospital_patient` 키로 저장:
   ```json
   { "patientId": "PT-20260307-A3F2", "language": "zh", "savedAt": 1709769915000 }
   ```
8. 새 room 생성 (`POST /api/hospital/join`) → 채팅방 자동 이동

### 재방문 플로우 (두 번째 스캔 이후)

1. 환자가 태블릿 QR 코드를 스마트폰으로 스캔
2. `/hospital/join/:department` 페이지 접속
3. localStorage에서 기존 고유번호 + 언어 자동 로드
4. **언어 선택 없이** 즉시 통역 시작 (자동 연결)
5. 서버에 `last_seen` 업데이트

---

## 4. 태블릿 세팅 방법

### 설치 절차

1. 태블릿을 진료과 접수 데스크에 거치
2. 브라우저를 열고 해당 진료과 키오스크 URL 접속:

| 진료과 | URL |
|--------|-----|
| 원무과 / 접수 | `https://lingora.chat/hospital/kiosk/reception` |
| 내과 | `https://lingora.chat/hospital/kiosk/internal` |
| 외과 | `https://lingora.chat/hospital/kiosk/surgery` |
| 응급의학과 | `https://lingora.chat/hospital/kiosk/emergency` |
| 산부인과 | `https://lingora.chat/hospital/kiosk/obgyn` |
| 소아과 | `https://lingora.chat/hospital/kiosk/pediatrics` |
| 정형외과 | `https://lingora.chat/hospital/kiosk/orthopedics` |
| 신경과 | `https://lingora.chat/hospital/kiosk/neurology` |
| 피부과 | `https://lingora.chat/hospital/kiosk/dermatology` |
| 안과 | `https://lingora.chat/hospital/kiosk/ophthalmology` |
| 치과 | `https://lingora.chat/hospital/kiosk/dentistry` |

3. 전체 화면 모드 설정 (F11 또는 브라우저 설정)
4. `navigator.wakeLock`이 자동으로 화면 꺼짐 방지

### 키오스크 화면 구성

- 상단: MONO 로고
- 중앙: QR 코드 (280px, 파란색 테마)
- QR 아래: 진료과 아이콘 + 이름
- 하단: 다국어 안내 문구 3초마다 순환
  - 한국어 / English / 中文 / Tiếng Việt / 日本語 / नेपाली / Русский / العربية / Español / Français

---

## 5. 직원 PC 사용 방법

### 접속

1. PC 브라우저에서 `https://lingora.chat/hospital` 접속
2. 병원 관리자 계정으로 로그인

### PC 화면 구성 (1024px 이상)

**좌측 패널 (40%)**:
- MONO 로고 + "병원 관리"
- 언어 선택 (직원 본인 언어)
- 진료과 그리드 (11개 진료과)
- 하단 버튼: "통역 기록 조회", "관리 대시보드"

**우측 패널 (60%)**:
- 진료과 미선택: "진료과를 선택하세요" 안내
- 진료과 선택 시:
  - 선택한 진료과 아이콘 + 이름
  - **"태블릿 QR 설정"** 버튼 → 새 탭에서 키오스크 열기
  - **"대기 중인 환자"** 섹션 (실시간 Socket 알림)
    - 환자 있음: 입장 시간 + "통역 시작" 버튼
    - 환자 없음: "현재 대기 중인 환자가 없습니다"

### 모바일 화면 (1024px 미만)

- 기존 step 기반 플로우 유지 (진료과 선택 → QR 생성 → 대기)

---

## 6. 백엔드 API 목록

### 환자 관리

| Method | Endpoint | 설명 | Body / Params | 응답 |
|--------|----------|------|---------------|------|
| `POST` | `/api/hospital/patient` | 환자 등록/업데이트 | `{ patientId, language }` | `{ success, patient, isNew }` |
| `GET` | `/api/hospital/patient/:patientId` | 환자 조회 | - | `{ success, found, patient, sessions[] }` |

### 세션 / 대기

| Method | Endpoint | 설명 | Body / Params | 응답 |
|--------|----------|------|---------------|------|
| `POST` | `/api/hospital/join` | QR 스캔 → 새 room 생성 | `{ department, patientId?, language? }` | `{ success, roomId, department }` |
| `GET` | `/api/hospital/waiting` | 대기 환자 목록 | `?department=` | `{ success, waiting[] }` |
| `DELETE` | `/api/hospital/waiting/:roomId` | 대기 목록에서 제거 | - | `{ success }` |

### 세션 관리

| Method | Endpoint | 설명 | Body | 응답 |
|--------|----------|------|------|------|
| `POST` | `/api/hospital/session` | 병원 세션 생성 | `{ chartNumber, department, hostLang, roomId?, patientId? }` | `{ success, sessionId, roomId }` |
| `POST` | `/api/hospital/session/:id/end` | 세션 종료 | - | `{ success }` |
| `POST` | `/api/hospital/session/:id/guest-lang` | 환자 언어 업데이트 | `{ guestLang }` | `{ success }` |

### 메시지 / 기록

| Method | Endpoint | 설명 | Body | 응답 |
|--------|----------|------|------|------|
| `POST` | `/api/hospital/message` | 대화 메시지 저장 | `{ sessionId, roomId, senderRole, originalText, ... }` | `{ success, id }` |
| `GET` | `/api/hospital/sessions/:id/messages` | 세션별 대화 내역 | - | `{ success, session, messages[] }` |
| `GET` | `/api/hospital/records/:chartNumber` | 환자 전체 기록 | - | `{ success, patient, sessions[] }` |

### 대시보드 / 통계

| Method | Endpoint | 설명 | Params | 응답 |
|--------|----------|------|--------|------|
| `GET` | `/api/hospital/dashboard/stats` | 대시보드 통계 | `?startDate=&endDate=` | `{ todayCount, monthCount, languageCount, ... }` |
| `GET` | `/api/hospital/sessions` | 세션 목록 (필터) | `?startDate=&endDate=&department=&language=&search=&page=&limit=` | `{ sessions[], total, page }` |

---

## 7. 소켓 이벤트 목록

### 클라이언트 → 서버

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `hospital:watch` | `{ department }` | 직원이 특정 진료과 대기 알림 구독 |
| `hospital:unwatch` | `{ department }` | 직원이 진료과 알림 구독 해제 |

### 서버 → 클라이언트

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `hospital:patient-waiting` | `{ roomId, department, createdAt, patientId?, language? }` | 새 환자 대기 알림 |
| `hospital:patient-picked` | `{ roomId, department }` | 환자가 대기 목록에서 제거됨 |

---

## 8. DB 테이블 구조

### `hospital_patients` — 환자 등록

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | UUID |
| `chart_number` | TEXT | NOT NULL, UNIQUE | 차트번호 또는 환자 고유번호 |
| `patient_id` | TEXT | - | 환자 고유번호 (`PT-YYYYMMDD-XXXX`) |
| `language` | TEXT | NOT NULL, DEFAULT 'en' | 환자 선호 언어 |
| `hospital_id` | TEXT | DEFAULT 'default' | 병원 ID (다중 병원 대비) |
| `name` | TEXT | - | 환자 이름 |
| `phone` | TEXT | - | 환자 연락처 |
| `notes` | TEXT | - | 비고 |
| `last_seen` | TEXT | - | 마지막 방문 일시 |
| `created_at` | TEXT | NOT NULL | 최초 등록 일시 |
| `updated_at` | TEXT | NOT NULL | 마지막 수정 일시 |

### `hospital_sessions` — 통역 세션

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | UUID |
| `room_id` | TEXT | NOT NULL | 채팅방 ID |
| `chart_number` | TEXT | NOT NULL | 차트번호 |
| `patient_id` | TEXT | - | 환자 고유번호 |
| `station_id` | TEXT | DEFAULT 'default' | 키오스크 스테이션 ID |
| `department` | TEXT | - | 진료과 ID |
| `host_lang` | TEXT | - | 직원 언어 |
| `guest_lang` | TEXT | - | 환자 언어 |
| `status` | TEXT | NOT NULL, CHECK ('active', 'ended') | 세션 상태 |
| `created_at` | TEXT | NOT NULL | 세션 시작 일시 |
| `ended_at` | TEXT | - | 세션 종료 일시 |

### `hospital_messages` — 대화 메시지

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | UUID |
| `session_id` | TEXT | NOT NULL, FK | 소속 세션 ID |
| `room_id` | TEXT | NOT NULL | 채팅방 ID |
| `sender_role` | TEXT | NOT NULL, CHECK ('host', 'guest') | 발화자 역할 |
| `sender_lang` | TEXT | - | 발화 언어 |
| `original_text` | TEXT | NOT NULL | 원문 |
| `translated_text` | TEXT | - | 번역문 |
| `translated_lang` | TEXT | - | 번역 대상 언어 |
| `created_at` | TEXT | NOT NULL | 메시지 시각 |

### 인덱스

| 인덱스 | 테이블(컬럼) |
|--------|-------------|
| `idx_hospital_sessions_chart` | `hospital_sessions(chart_number)` |
| `idx_hospital_sessions_station` | `hospital_sessions(station_id)` |
| `idx_hospital_sessions_status` | `hospital_sessions(status)` |
| `idx_hospital_sessions_dept` | `hospital_sessions(department)` |
| `idx_hospital_sessions_created` | `hospital_sessions(created_at DESC)` |
| `idx_hospital_sessions_pid` | `hospital_sessions(patient_id)` |
| `idx_hospital_messages_session` | `hospital_messages(session_id)` |
| `idx_hospital_messages_room` | `hospital_messages(room_id)` |
| `idx_hospital_patients_chart` | `hospital_patients(chart_number)` |
| `idx_hospital_patients_pid` | `hospital_patients(patient_id)` |
| `idx_hospital_patients_hospital` | `hospital_patients(hospital_id)` |

---

## 9. 테스트 결과 (2026-03-07)

| # | 테스트 항목 | 결과 |
|---|-----------|------|
| 1 | `/hospital/kiosk/reception` QR 코드 표시 | ✅ PASS |
| 2 | `/hospital/join/reception` 새 세션 자동 생성 | ✅ PASS |
| 3 | `POST /api/hospital/join` API roomId 반환 | ✅ PASS |
| 4 | `POST /api/hospital/patient` patientId 저장 | ✅ PASS |
| 5 | `/hospital` PC 대기 환자 알림 소켓 수신 | ✅ PASS |
| 6 | QR 스캔 후 환자 언어 선택 화면 표시 | ✅ PASS |
| 7 | 재방문 시 언어 선택 없이 자동 연결 | ✅ PASS |

---

## 10. 파일 구조

```
src/
├── pages/
│   ├── HospitalApp.jsx          # 직원 PC 메인 화면
│   ├── HospitalKiosk.jsx        # 태블릿 QR 키오스크
│   ├── HospitalPatientJoin.jsx  # 환자 QR 스캔 착지 페이지
│   ├── HospitalRecords.jsx      # 통역 기록 조회
│   └── HospitalDashboard.jsx    # 관리 대시보드
├── constants/
│   └── hospitalDepartments.js   # 진료과 목록 정의
├── components/
│   ├── MonoLogo.jsx             # MONO 로고 컴포넌트
│   ├── LanguageFlagPicker.jsx   # 언어 선택 그리드
│   └── QRCodeBox.jsx            # QR 코드 생성 컴포넌트
├── router.jsx                   # 라우트 정의
server.js                        # 백엔드 API + Socket 핸들러
server/db/migrations/
└── 002_hospital_kiosk.sql       # DB 마이그레이션
```
