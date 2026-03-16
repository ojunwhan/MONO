# MONO Full Codebase Audit Report

**Generated:** 2026-03-16  
**Branch:** feature/hospital-plastic-surgery  
**Purpose:** READ-ONLY investigation for architectural planning (merging hospital mode into core messenger).

---

## 1. File Structure Overview

### 1.1 `src/` — Frontend (React + Vite)

| File | Lines | Description |
|------|-------|-------------|
| `App.jsx` | 83 | Root app: RouterProvider, onboarding, socket register-user, theme/fontSize from localStorage |
| `main.jsx` | 55 | React entry; mounts App with StrictMode |
| `router.jsx` | 230 | createBrowserRouter: all routes, rootRedirectLoader, hospitalDashboardLoader |
| `socket.js` | 39 | Socket.IO client; env VITE_SOCKET_URL |
| `i18n.js` | 35 | i18next config, locales (en, ko) |
| `audio/browserTts.js` | 222 | TTS playback (localStorage: mono.tts.speed, mono.tts.voice, mono.tts.autoplay) |
| `audio/notificationSound.js` | 90 | Notification sound (localStorage: notificationSound, mono.notif.sound) |
| `audio/ttsPlayer.js` | 113 | TTS player wrapper |
| `audio/vad-processor.js` | 61 | VAD helper |
| `auth/kakaoLogin.js` | 48 | Kakao JS SDK key (VITE_KAKAO_JAVASCRIPT_KEY) |
| `auth/session.js` | 32 | fetchAuthMe, syncAuthUserToLocalIdentity → IndexedDB identity |
| `components/AudioWaveform.jsx` | 108 | Waveform display |
| `components/BottomSheet.jsx` | 26 | Bottom sheet UI |
| `components/ChatScreen.jsx` | **2124** | Main chat UI: messages, STT, send-message, hospital/PT- branches, partner-info, leave |
| `components/InAppBlocker.jsx` | 84 | Blocks in-app browser, suggests external browser |
| `components/InstallBanner.jsx` | 24 | PWA install prompt |
| `components/LanguageFlagPicker.jsx` | 82 | Language grid for guest/hospital |
| `components/LanguageSelector.jsx` | 155 | Language dropdown |
| `components/MessageBubble.jsx` | 174 | Single message bubble (original/translated, TTS, copy) |
| `components/MicButton.jsx` | 465 | Mic record → STT/upload or socket stt:whisper |
| `components/MonoLogo.jsx` | 13 | Logo component |
| `components/OnboardingSlides.jsx` | 41 | First-time onboarding slides |
| `components/QRCodeBox.jsx` | 330 | QR generation, create-room/join, sessionStorage mono_session |
| `components/ToastMessage.jsx` | 12 | Toast UI |
| `constants/hospitalDepartments.js` | 147 | Dept list (reception, internal, surgery, …) |
| `constants/languageProfiles.js` | 149 | Language metadata |
| `constants/languages.js` | 117 | Language list |
| `constants/medicalKnowledge.js` | 441 | Medical terms (frontend ESM) |
| `constants/pipelineBlocks.js` | 61 | Pipeline block definitions |
| `constants/siteContexts.js` | 42 | Site context labels |
| `db/index.js` | 253 | Dexie IndexedDB: identity, rooms, messages, outbox, aliases |
| `db/hospitalConversations.js` | 105 | IndexedDB store mono_hospital_conversations (PT- roomId + dateStr) |
| `hooks/useMicLevel.js` | 41 | Mic level meter |
| `hooks/useNetworkStatus.js` | 33 | Online/offline |
| `hooks/useOutbox.js` | 100 | Offline outbox flush, send-message ack |
| `hooks/usePWAInstall.js` | 25 | PWA install state |
| `hooks/useVADPipeline.js` | 195 | Silero VAD → stt:open/audio/segment_end |
| `layouts/AppShell.jsx` | 99 | Layout for /home, /interpret, /settings, /contacts |
| `locales/en.json` | 260 | EN translations |
| `locales/ko.json` | 260 | KO translations |
| `media/getMic.js` | 10 | getUserMedia wrapper |
| `pages/Admin/AdminLayout.jsx` | 100 | Admin shell, sidebar |
| `pages/Admin/AdminLogin.jsx` | 81 | Admin login (password) |
| `pages/Admin/AdminOrgAdd.jsx` | 173 | Add org form |
| `pages/Admin/AdminOrgDetail.jsx` | 856 | Org detail, depts, pipeline, staff |
| `pages/Admin/AdminOrgs.jsx` | 160 | Org list |
| `pages/Admin/PipelineBuilder.jsx` | 481 | Pipeline block editor |
| `pages/Admin/VisualPipelineBuilder.jsx` | **1280** | Visual pipeline builder (drag-drop) |
| `pages/Contacts.jsx` | 609 | Contacts / friends UI |
| `pages/CsChat.jsx` | 438 | Customer support chat (API) |
| `pages/FixedRoom.jsx` | 435 | Generic fixed-location VAD (/fixed/:location) |
| `pages/FixedRoomVAD.jsx` | **1810** | Hospital VAD flow: waiting→ready→interpreting→ended, fixed-room:start/end |
| `pages/Global.jsx` | 171 | Global room UI |
| `pages/GuestJoin.jsx` | 251 | Guest join by roomId, language picker, sessionStorage mono_guest |
| `pages/Home.jsx` | 205 | Interpret home: create room, QR, myLang, participantId |
| `pages/HospitalAesthetic.jsx` | 214 | Aesthetic/plastic surgery landing |
| `pages/HospitalApp.jsx` | 806 | Hospital main: kiosk/staff/normal/summary, StaffModePanel, department grid |
| `pages/HospitalConversations.jsx` | 82 | Hospital conversations list |
| `pages/HospitalDashboard.jsx` | 1826 | Hospital dashboard: stats, sessions, org settings |
| `pages/HospitalKiosk.jsx` | 179 | Kiosk QR page (no socket) |
| `pages/HospitalLogin.jsx` | 101 | Hospital admin login (JWT) |
| `pages/HospitalPatientJoin.jsx` | 448 | Patient QR join: language, POST /api/hospital/join, navigate fixed-room |
| `pages/HospitalRecords.jsx` | 409 | Records search (chartNumber or PT-XXXXXX) |
| `pages/HospitalRegister.jsx` | 131 | Hospital org register |
| `pages/HospitalStaffQr.jsx` | 57 | Staff QR for org |
| `pages/KioskPage.jsx` | 225 | Legacy kiosk |
| `pages/Login.jsx` | 120 | Main login (Google, Kakao, etc.) |
| `pages/Org/OrgJoin.jsx` | 321 | Org patient join (orgCode/deptCode) |
| `pages/Org/OrgKiosk.jsx` | 199 | Org kiosk QR |
| `pages/Org/OrgStaff.jsx` | 314 | Org staff panel |
| `pages/OrgSetup.jsx` | 171 | Org setup |
| `pages/Privacy.jsx` | 95 | Privacy policy |
| `pages/RoomList.jsx` | 559 | Room list (IndexedDB rooms), recent conversations |
| `pages/Settings.jsx` | 622 | Settings: theme, lang, TTS, notif, fontSize, etc. |
| `pages/Setup.jsx` | 113 | First-time name + language |
| `pages/Terms.jsx` | 80 | Terms of service |
| `push/index.js` | 166 | Push subscribe, VAPID, localStorage mono.notif.enabled |
| `styles/index.css` | 192 | Global CSS |
| `utils/AudioProcessor.js` | 111 | Audio processing (localStorage mono.mic.sensitivity) |
| `utils/ChatStorage.js` | 77 | Legacy chat history (localStorage key) |
| `utils/recents.js` | 38 | Recent items (localStorage) |

### 1.2 `server/` — Backend

| File | Lines | Description |
|------|-------|-------------|
| `server.js` (project root, not under server/) | ~6788 | Express app, Socket.IO, STT/translate/TTS pipeline, hospital APIs, static serve |
| `server/billing.js` | 102 | Translation usage limit (FREE_TRANSLATION_MONTHLY_LIMIT) |
| `server/constants/medicalKnowledge.js` | 399 | Medical glossary (CJS, server-side GPT prompt) |
| `server/cost-report.js` | 101 | Daily cost report (Telegram), OPENAI_ADMIN_KEY |
| `server/db/migrations/001_phase1_core_sqlite.sql` | 78 | users, friends, rooms, room_members, translation_usage |
| `server/db/migrations/001_phase1_core_postgres.sql` | 85 | Postgres variant (same schema idea) |
| `server/db/migrations/002_hospital_kiosk.sql` | 70 | hospital_sessions, hospital_messages, hospital_patients, api_usage_daily |
| `server/db/migrations/003_hospital_patient_token.sql` | 45 | hospital_patients_v2, hospital_sessions_v2, hospital_messages_v2 |
| `server/db/migrations/004_admin_console.sql` | 150 | organizations, org_departments, org_pipeline_config, org_staff_accounts, org_devices, org_session_logs, org_api_cost_logs, admin_settings |
| `server/db/migrations/005_hospital_patients_room_id.sql` | 7 | ALTER hospital_patients ADD room_id |
| `server/db/README.md` | 41 | DB readme |
| `server/db/run_migration_sqlite.js` | 102 | Runs migrations in order on SQLite |
| `server/db/sqlite.js` | 103 | SQLite connection (MONO_DB_PATH) |
| `server/db/users.js` | 257 | User CRUD, OAuth upsert |
| `server/routes/admin.js` | 364 | POST/GET /api/admin/login, me, orgs, orgs/:id, departments, pipeline (verifyAdmin) |
| `server/routes/auth_api.js` | 991 | /api/auth/me, /api/users/me, contacts, friends, rooms, subscription, cs-chat, convert-guest, patient-by-room history |
| `server/routes/auth_google.js` | 128 | /auth/google, /api/auth/google/callback |
| `server/routes/auth_kakao.js` | 182 | /auth/kakao, /api/auth/kakao/callback |
| `server/routes/auth_line.js` | 122 | /auth/line, /api/auth/line/callback |
| `server/routes/auth_apple.js` | 150 | /auth/apple, /api/auth/apple/callback |
| `server/routes/org.js` | 73 | GET /api/org/:orgCode/:deptCode/config |
| `server/socket/message-handler.js` | 53 | Message handling helper (OpenAI) |
| `server/stt_google_stream.js` | 51 | Google STT stream (if STT_PROVIDER=google) |
| `server/test/pipeline.test.js` | 149 | Pipeline tests |
| `server/_server_unused.js` | 129 | Unused server stub |

---

## 2. All Pages / Routes

Defined in `src/router.jsx`. Auth: “yes” = loader or route requires authenticated user; “no” = public.

| Path | Component | What it does | Auth | Status |
|------|-----------|--------------|------|--------|
| `/` | (redirect) | rootRedirectLoader: if authenticated → /interpret, else → /login; roomId query → /join/:roomId | - | Working |
| `/login` | LoginPage | Login with Google/Kakao/Line/Apple | No | Working |
| `/hospital/join/:orgCode` | HospitalPatientJoin | Patient join by org code; language picker; POST /api/hospital/join; navigate to /fixed-room/:roomId | No | Working |
| `/org-setup` | OrgSetup | Org setup flow | No | Working |
| `/setup` | Setup | First-time name + language | No | Working |
| `/rooms` | (redirect) | Redirect to /home | - | Working |
| `/home` | RoomList | Recent rooms from IndexedDB, create room, contacts | Yes (AppShell) | Working |
| `/contacts` | Contacts | Contacts/friends | Yes | Working |
| `/interpret` | Home | Create 1:1 room, QR, language; entry for logged-in user | Yes | Working |
| `/settings` | SettingsPage | Theme, language, TTS, notifications, fontSize, etc. | Yes | Working |
| `/join/:roomId` | GuestJoinPage | Guest join by roomId; language; sessionStorage mono_guest; navigate to /room/:roomId | No | Working |
| `/room/:roomId` | ChatScreen | Main chat: messages, STT, send-message, hospital/PT- logic | No | Working |
| `/cs-chat` | CsChatPage | Customer support chat (API) | Yes | Working |
| `/hospital` | HospitalApp | Hospital main: mode=kiosk|staff|normal, department, StaffModePanel | No | Working |
| `/hospital/records` | HospitalRecords | Search records by chartNumber or PT-XXXXXX | No | Working |
| `/hospital/conversations` | HospitalConversations | Hospital conversations list | No | Working |
| `/hospital/aesthetic` | HospitalAesthetic | Aesthetic/plastic landing | No | Working |
| `/hospital/kiosk/:department` | HospitalKiosk | Kiosk QR for department (no socket) | No | Working |
| `/hospital/staff-qr/:orgCode` | HospitalStaffQr | Staff QR for org | No | Working |
| `/hospital-login` | HospitalLogin | Hospital admin login (JWT) | No | Working |
| `/hospital-register` | HospitalRegister | Hospital org registration | No | Working |
| `/hospital-dashboard` | HospitalDashboard | Dashboard; loader redirects to /hospital-login if not auth | Yes (loader) | Working |
| `/fixed/:location` | FixedRoom | Generic fixed VAD room | No | Working |
| `/fixed-room/:roomId` | FixedRoomVAD | Hospital VAD: waiting→ready→interpreting→ended | No | Working |
| `/admin` | (index) AdminLogin | Admin login | No | Working |
| `/admin/orgs` | AdminOrgs | List orgs | Admin | Working |
| `/admin/orgs/:orgId` | AdminOrgDetail | Org detail, depts, pipeline | Admin | Working |
| `/admin/orgs/:orgId/dept/:deptId/pipeline` | VisualPipelineBuilder | Pipeline editor | Admin | Working |
| `/admin/pipeline` | VisualPipelineBuilder | Pipeline editor | Admin | Working |
| `/org/:orgCode/:deptCode/kiosk` | OrgKiosk | Org kiosk QR | No | Working |
| `/org/:orgCode/:deptCode/staff` | OrgStaff | Org staff panel | No | Working |
| `/org/:orgCode/:deptCode/join` | OrgJoin | Org patient join | No | Working |
| `/kiosk` | KioskPage | Legacy kiosk | No | Working |
| `/terms` | TermsPage | Terms | No | Working |
| `/privacy` | PrivacyPage | Privacy | No | Working |

---

## 3. All API Endpoints

### 3.1 server.js (Express)

| Method | Path | Description | DB / Notes | ~Line |
|--------|------|-------------|------------|-------|
| GET | /api/push/vapid-key | Return VAPID public key | - | 1357 |
| POST | /api/push/subscribe | Subscribe push (userId, subscription) | - | 1365 |
| POST | /api/push/unsubscribe | Unsubscribe by endpoint | - | 1375 |
| POST | /api/push/send | Send push payload | - | 1385 |
| POST | /stt, /api/stt | Upload audio → STT (multer) | - | 4415–4416 |
| POST | /api/auth/convert-guest | Convert guest to registered user (JWT) | users | 4426 |
| POST | /api/hospital/auth/login | Hospital admin login (email/password → JWT) | org_staff_accounts etc. | 4968 |
| POST | /api/hospital/register | Hospital org register | organizations, org_departments | 5017 |
| GET | /api/hospital/auth/me | Current hospital admin (requireHospitalAdminJwt) | - | 5068 |
| GET | /api/hospital/org-settings | Org settings by org_code | organizations, org_departments | 5078 |
| POST | /api/hospital/auth/logout | Clear hospital JWT cookie | - | 5101 |
| POST | /api/hospital/join | Patient join: create roomId (PT-…), ROOMS, HOSPITAL_WAITING | hospital_sessions (v2), memory | 5111 |
| POST | /api/hospital/patient | Create/update patient (patientToken) | hospital_patients_v2 | 5323 |
| GET | /api/hospital/patient/:patientToken | Get patient by token | hospital_patients_v2 | 5359 |
| GET | /api/hospital/waiting | Waiting list by dept | HOSPITAL_WAITING (memory) | 5396 |
| DELETE | /api/hospital/waiting/:roomId | Remove from waiting, emit hospital:patient-picked | - | 5434 |
| POST | /api/hospital/assign-room | Assign room to patient | hospital_patients (room_id) | 5454 |
| GET | /api/hospital/session-log/:roomId | Session log for room | - | 5503 |
| GET | /api/hospital/patient/:patientToken/history | Patient history | hospital_sessions_v2, hospital_messages_v2 | 5519 |
| GET | /api/hospital/patient-by-room/:roomId/history | History by roomId | hospital_sessions, hospital_messages | 5564 |
| POST | /api/hospital/patient/:patientToken/message | Send message to patient (pending) | - | 5586 |
| GET | /api/hospital/patient/:patientToken/pending-messages | Pending messages | - | 5613 |
| POST | /api/hospital/session | Create session | hospital_sessions | 5632 |
| POST | /api/hospital/session/:sessionId/end | End session | hospital_sessions | 5674 |
| POST | /api/hospital/message | Save message (requireHospitalOrg) | hospital_messages | 5712 |
| GET | /api/hospital/dashboard/stats | Dashboard stats (requireHospitalAdminJwt) | hospital_* | 5738 |
| GET | /api/hospital/dashboard/sessions | Dashboard sessions | hospital_sessions | 5826 |
| GET | /api/hospital/sessions | Sessions list (requireHospitalAdminJwt) | hospital_sessions | 5892 |
| GET | /api/hospital/sessions/:sessionId/messages | Session messages | hospital_messages | 5925 |
| DELETE | /api/hospital/sessions/:sessionId | Delete session | - | 5945 |
| GET | /api/hospital/rooms | List rooms (requireHospitalAdminJwt) | - | 5979 |
| POST | /api/hospital/rooms | Create room (requireHospitalAdminJwt) | - | 5993 |
| DELETE | /api/hospital/rooms/:id | Delete room | - | 6014 |
| GET | /api/hospital/kiosk/status | Kiosk status | - | 6030 |
| POST | /api/hospital/patients | Register patient (chart_number) | hospital_patients | 6120 |
| GET | /api/hospital/patients/:chartNumber | Get patient by chart | hospital_patients | 6155 |
| PUT | /api/hospital/patients/:chartNumber | Update patient | hospital_patients | 6173 |
| GET | /api/hospital/patients | List patients | hospital_patients | 6197 |
| GET | /api/hospital/records/:identifier | Records by chart or PT- | hospital_sessions, hospital_messages | 6215 |
| POST | /api/hospital/session/:sessionId/guest-lang | Update guest_lang | hospital_sessions | 6251 |
| GET | /api/stats | Usage stats (STATS_API_KEY) | - | 6279 |
| GET | /admin/errors | Error list (in-memory) | - | 6316 |
| GET | /api/errors | Errors API | - | 6513 |
| GET | /api/cost-report | Cost report (TELEGRAM) | - | 6542 |
| GET | /api/guess-lang | Guess language | - | 6569 |
| POST | /api/translate-word | Translate single word | - | 6575 |
| GET | /healthz | Health check | - | 6597 |
| GET | /, * | SPA serve (sendWithOg) | - | 6695, 6698 |

### 3.2 server/routes/auth_api.js

Mounted by `attachAuthApi(app)`. All under same app.

| Method | Path | Description | DB |
|--------|------|-------------|-----|
| GET | /api/users/me | Current user (verifyToken) | users |
| PUT | /api/users/me | Update user | users |
| GET | /api/auth/me | Auth me (verifyToken) | users |
| POST | /api/contacts/lookup-phone | Phone lookup | - |
| POST | /api/auth/logout | Logout | - |
| GET | /api/contacts/search | Search contacts | - |
| GET | /api/contacts/friends | Friends | friends |
| GET | /api/contacts/requests | Contact requests | - |
| POST | /api/contacts/request | Send request | - |
| POST | /api/contacts/respond | Respond to request | - |
| POST | /api/contacts/remove | Remove contact | - |
| GET | /api/friends | Friends list | friends |
| GET | /api/friends/requests | Friend requests | friends |
| GET | /api/friends/search | Search friends | - |
| POST | /api/friends/request | Send friend request | friends |
| POST | /api/friends/accept | Accept friend | friends |
| POST | /api/friends/reject | Reject friend | friends |
| DELETE | /api/friends/:id | Delete friend | friends |
| POST | /api/rooms | Create room | rooms, room_members |
| GET | /api/rooms | List rooms | rooms |
| GET | /api/rooms/:id/members | Room members | room_members |
| PUT | /api/rooms/:id/read | Mark read | room_members |
| GET | /api/subscription/me | Subscription info | - |
| GET | /api/subscription/check-limit | Check usage limit | translation_usage |
| POST | /api/subscription/checkout | Checkout | - |
| POST | /api/subscription/webhook | Webhook | - |
| POST | /api/cs-chat | CS chat (OpenAI) | - |
| GET | /api/hospital/patient-by-room/:roomId/history | History by roomId (duplicate of server.js) | hospital_sessions, hospital_messages |
| DELETE | /api/auth/account | Delete account | users |

### 3.3 server/routes/auth_google.js, auth_kakao.js, auth_line.js, auth_apple.js

OAuth: GET /auth/:provider, GET /api/auth/:provider, GET /api/auth/:provider/callback (and non-/api variants). Callbacks issue JWT, set cookie, redirect. DB: users (upsert by provider id).

### 3.4 server/routes/admin.js — prefix /api/admin

| Method | Path | Description | DB |
|--------|------|-------------|-----|
| POST | /api/admin/login | Admin login (password) | admin_settings |
| GET | /api/admin/me | Me (verifyAdmin) | - |
| POST | /api/admin/logout | Logout | - |
| GET | /api/admin/orgs | List orgs | organizations |
| POST | /api/admin/orgs | Create org | organizations |
| GET | /api/admin/orgs/:orgId | Org detail | organizations, org_departments, etc. |
| GET | /api/admin/orgs/:orgId/departments | Departments | org_departments |
| POST | /api/admin/orgs/:orgId/departments | Create dept | org_departments |
| DELETE | /api/admin/orgs/:orgId/departments/:deptId | Delete dept | org_departments |
| GET | /api/admin/orgs/:orgId/departments/:deptId/pipeline | Pipeline config | org_pipeline_config |

### 3.5 server/routes/org.js — prefix /api/org

| Method | Path | Description | DB |
|--------|------|-------------|-----|
| GET | /api/org/:orgCode/:deptCode/config | Org dept config | organizations, org_departments, org_pipeline_config |

---

## 4. All Socket Events

### 4.1 Client → Server (`socket.on` in server.js)

| Event | ~Line | Description |
|-------|-------|-------------|
| admin:subscribe-errors | 2008 | Admin subscribes to error stream (key check) |
| register-user | 2074 | Register userId, canonicalName, lang; emit user-registered |
| push-subscribe | 2093 | Store push subscription for userId |
| push-unsubscribe | 2098 | Remove subscription by endpoint |
| presence:update | 2103 | Update participantId, activeRoomId, visibilityState |
| leave-room | 2113 | Leave room (roomId, participantId, reason) |
| manual-leave | 2117 | Manual leave |
| fixed-room:start | 2122 | Start VAD for roomId; io.to(roomId).emit("fixed-room:start") |
| fixed-room:end | 2128 | End VAD for roomId; io.to(roomId).emit("fixed-room:end") |
| vad:gain | 2137 | Update VAD gain/threshold; emit vad:gain:update |
| delete-room | 2145 | Delete room; emit room-deleted |
| create-1to1 | 2170 | Create 1:1 room with peerUserId; emit room-created |
| get-users | 2260 | List connected users; emit user-list |
| create-room | 2269 | Create room (roomId, participantId, siteContext, …); ROOMS, emit room-created-ack |
| ensure-global-room | 2328 | Ensure global room exists; ack |
| join-global | 2364 | Join global room; emit global-room-ready |
| joinRoom | 2429 | Legacy join by roomId |
| rejoin-room | 2437 | Rejoin with userId, language, isHost; emit room-status rejoined/gone |
| check-room | 2531 | Check room exists; emit room-status ok/gone |
| who-is-in-room | 2556 | Members in room; emit room-members |
| monitor-room | 2573 | Monitor room; emit room-monitor-status |
| mono-ping | 2592 | Ping; emit mono-pong |
| typing-start | 2596 | Broadcast typing-start to room |
| typing-stop | 2605 | Broadcast typing-stop |
| message-status | 2614 | Message status update; emit to sender |
| message-read | 2633 | Mark read; emit to sender |
| join | 2652 | Main join: roomId, participantId, roleHint, fromLang, …; PT- restore from DB; partner-joined, room-context, etc. |
| heartbeat | 3127 | Heartbeat; emit heartbeat-ack |
| register | 3135 | Register role, lang in room (legacy) |
| set-lang | 3150 | Set lang for socket in room |
| stt:open | 3165 | Open STT session; PT- restore; emit stt:segment-received |
| stt:audio | 3233 | Receive PCM audio chunk |
| stt:segment_end | 3261 | End segment; run STT → translate → receive-message / receive-message-stream; hospital_messages save |
| stt:close | 3716 | Close STT session |
| stt:whisper | 3727 | Whisper upload; transcribe; receive-message; hospital save |
| send-message | 3852 | Text message; translate; emit receive-message; hospital_messages save |
| disconnect | 4212 | Cleanup ROOMS, HOSPITAL_WAITING, emit room:ended for hospital |
| reconnect | 4315 | Reconnect handler |
| hospital:watch | 4322 | Subscribe to department waiting list; emit hospital:patient-waiting |

### 4.2 Server → Client (emit)

| Event | Direction | Description |
|-------|-----------|-------------|
| admin:subscribed | Server→Client | Admin subscribed ack |
| admin:error | Server→Client | Error entry to admin |
| user-registered | Server→Client | After register-user |
| room-created | Server→Client | After create-1to1 / create-room |
| room-created-ack | Server→Client | After create-room |
| room-status | Server→Client | ok | room-gone | rejoined | room-expired |
| room-context | Server→Client | siteContext, locked, roomType |
| room-members | Server→Client | Members in room |
| room-monitor-status | Server→Client | Monitor data |
| room-deleted | Server→Client | Room deleted |
| room:ended | Server→Client | Hospital room ended (e.g. patient left) |
| partner-joined | Server→Client | Partner joined room |
| partner-info | Server→Client | Partner name, lang, etc. |
| participants | Server→Client | Full participant list |
| call-sign-assigned | Server→Client | Call sign for user |
| global-room-ready | Server→Client | Global room ready |
| fixed-room:start | Server→Client | Start VAD (broadcast to room) |
| fixed-room:end | Server→Client | End VAD (broadcast to room) |
| vad:gain:update | Server→Client | VAD params update |
| typing-start / typing-stop | Server→Client | Typing indicators |
| message-status | Server→Client | Message status (e.g. delivered) |
| receive-message | Server→Client | Incoming message (original + translated) |
| receive-message-stream | Server→Client | Stream chunk |
| receive-message-stream-end | Server→Client | Stream end |
| revise-message | Server→Client | HQ revision |
| tts_audio | Server→Client | TTS base64 |
| stt:segment-received | Server→Client | Segment ack |
| stt:no-voice | Server→Client | No voice detected |
| heartbeat-ack | Server→Client | Heartbeat response |
| mono-pong | Server→Client | Ping response |
| server-warning | Server→Client | Warning message |
| error | Server→Client | Error message |
| hospital:patient-waiting | Server→Client | New patient waiting (to staff) |
| hospital:patient-picked | Server→Client | Patient removed from waiting |

---

## 5. All DB Tables

### 5.1 Core (001_phase1_core_sqlite.sql)

| Table | Columns | What it stores | Used by |
|-------|---------|----------------|---------|
| users | id, email, nickname, mono_id, avatar_url, native_language, google_id, kakao_id, line_id, apple_id, phone_number, status_message, plan, plan_expires_at, created_at | Registered users | Auth, contacts, friends, rooms |
| friends | id, user_id, friend_id, status (pending/accepted/blocked), created_at | Friend relationships | auth_api friends |
| rooms | id, type (dm/group/qr/global), name, created_by, created_at | Room metadata (API rooms) | auth_api rooms |
| room_members | id, room_id, user_id, role (admin/member), last_read_message_id, joined_at | Room membership | auth_api |
| translation_usage | id, user_id, month, count, updated_at | Monthly translation count | Billing, check limit |

### 5.2 Hospital (002_hospital_kiosk.sql)

| Table | Columns | What it stores | Used by |
|-------|---------|----------------|---------|
| hospital_sessions | id, room_id, chart_number, patient_id, station_id, department, host_lang, guest_lang, status (active/ended), created_at, ended_at | Hospital session per room | Hospital APIs, socket join/stt restore |
| hospital_messages | id, session_id, room_id, sender_role (host/guest), sender_lang, original_text, translated_text, translated_lang, created_at | Hospital messages (and patient_token in later code) | Hospital APIs, emitTranslated, send-message, stt:segment_end |
| hospital_patients | id, chart_number, patient_id, language, hospital_id, name, phone, notes, last_seen, created_at, updated_at; + room_id (005) | Patient registry (chart-based) | Hospital APIs, assign-room |

### 5.3 Hospital v2 (003_hospital_patient_token.sql)

| Table | Columns | What it stores | Used by |
|-------|---------|----------------|---------|
| hospital_patients_v2 | patient_token PK, dept, first_visit_at, last_visit_at | Patient by token | /api/hospital/join, patient APIs |
| hospital_sessions_v2 | id, patient_token, room_id, dept, started_at, ended_at | Sessions by token | History, session APIs |
| hospital_messages_v2 | id, patient_token, room_id, sender_role (patient/staff), original_text, translated_text, lang, created_at | Messages by token | History APIs |

### 5.4 Admin / Org (004_admin_console.sql)

| Table | Columns | What it stores | Used by |
|-------|---------|----------------|---------|
| organizations | id, org_code, name, org_type, plan, trial_ends_at, logo_url, primary_color, welcome_msg, default_lang, is_active, created_at, updated_at | Orgs | Admin, hospital dashboard |
| org_departments | id, org_id, dept_code, dept_name, dept_name_en, sort_order, is_active, created_at | Departments | Admin, org config |
| org_pipeline_config | id, dept_id, config_json, updated_at, updated_by | Pipeline config | Admin pipeline builder |
| org_staff_accounts | id, org_id, user_id, email, role, dept_ids, invite_token, is_active, last_login_at, created_at | Staff accounts | Hospital login |
| org_devices | id, org_id, dept_id, device_label, device_type, last_seen_at, last_ip, is_online, created_at | Devices | - |
| org_session_logs | id, org_id, dept_id, room_id, patient_token, started_at, ended_at, duration_sec, lang_*, stt_chars, translate_chars, *_cost_krw | Session logs | - |
| org_api_cost_logs | id, org_id, log_date, api_type, call_count, input_units, cost_usd, cost_krw | API cost | - |
| admin_settings | key, value, updated_at | KV (e.g. admin_setup_done) | Admin login |

### 5.5 Other

| Table | Source | What it stores |
|-------|--------|----------------|
| api_usage_daily | 002 | date PK, groq_stt_count, openai_stt_count, translation_count, tts_count, total_*, peak_connections, rooms_created |

---

## 6. State Management

- **Global state:** No Redux/Zustand. React Context used implicitly via router (no global auth context store; auth is checked via fetchAuthMe() in loader). Socket is a singleton (socket.js) and used across components.
- **IndexedDB (Dexie — db/index.js):**
  - **identity** (key): single row key="me" — userId, canonicalName, lang, updatedAt.
  - **rooms**: roomId, roomType, lastActiveAt, updatedAt, pinned, peerUserId, peerCanonicalName, peerAlias, peerLang, unreadCount.
  - **messages**: id, roomId, timestamp, senderId, senderName, originalText, translatedText, originalLang, translatedLang, type, status, replyTo.
  - **outbox**: ++id, roomId, msgId, text, participantId, createdAt.
  - **aliases**: [userId+targetLang], userId — pronunciation aliases.
- **IndexedDB (hospitalConversations.js):** DB name `mono_hospital_conversations`, store `conversations`; keyPath `id`; keys like `roomId_dateStr`; stores messages array per PT- room per day.
- **localStorage keys (app-wide):**
  - mono.onboardingDone
  - mono.theme (dark/light)
  - mono.fontSize (small/normal/large)
  - mono.preferredLang
  - mono.uiLang
  - mono.tts.voice, mono.tts.speed, mono.tts.autoplay
  - mono.mic.sensitivity
  - mono.notif.enabled, mono.notif.sound, mono.notif.vibration
  - mono.voice
  - mono.autoNameSeq
  - myLang (and kioskLang in KioskPage)
  - micDeviceId
  - notificationSound (legacy), mono.notif.sound
  - mro.pid.{roomId} (participantId per room)
  - mono_hospital_patient (HospitalPatientJoin — patient token)
  - mono_hospital_current_pt (current PT roomId)
  - ChatStorage: key from constant in ChatStorage.js (legacy chat history)
  - recents: key from recents.js
- **sessionStorage:**
  - mono_guest (GuestJoin: guest join payload for /room)
  - mono_session (ChatScreen, QRCodeBox: session payload for room)
  - OrgJoin / HospitalPatientJoin: store join payload before navigate.

---

## 7. Authentication Flow

- **Login:** Google, Kakao, Line, Apple OAuth. Buttons in Login.jsx; redirect to provider then to /api/auth/:provider/callback. Callback verifies, upserts user in DB (users), issues JWT (signed with JWT_SECRET), sets HTTP-only cookie (or redirect with token).
- **Stored after login:** JWT in cookie (and possibly token in URL for OAuth redirect). Identity synced to IndexedDB (identity.me) via syncAuthUserToLocalIdentity (userId, canonicalName, lang).
- **Auth check on API:** auth_api.js uses verifyToken middleware (cookie or Authorization header). /api/auth/me, /api/users/me, contacts, friends, rooms require verifyToken. Hospital dashboard uses requireHospitalAdminJwt (separate JWT from hospital login).
- **Guest → registered:** POST /api/auth/convert-guest (server.js). Converts guest identity to registered user (JWT required). No separate “convert” UI flow described in this audit.

---

## 8. Messaging Flow (Critical)

### 8.1 Creating a 1:1 room

1. **Host (Home.jsx):** User clicks create; participantId from localStorage `mro.pid.{roomId}` or generated; roomId can be generated client-side or from server.
2. **create-room (server.js ~2269):** Socket emit "create-room" with roomId, participantId, fromLang, siteContext, role, localName, roomType. Server creates ROOMS entry (meta: participants, siteContext, ownerPid, etc.), emits "room-created-ack" to sender.
3. **Alternative create-1to1 (~2170):** Emit "create-1to1" with myUserId, peerUserId, siteContext; server finds peer socket, creates room, emits "room-created" to both.
4. **QR / Guest:** Guest scans QR or opens /join/:roomId; GuestJoin stores mono_guest in sessionStorage, navigates to /room/:roomId with state. ChatScreen mounts, emits "join" with roomId, participantId (guest), roleHint "guest". Server ensures room in ROOMS (or creates for PT- from DB), adds participant, emits "partner-joined", "room-context" to both sides.

### 8.2 Sending a message

1. **User types and sends:** ChatScreen uses send-message (or outbox if offline). Text + roomId + participantId + msgId (client-generated).
2. **Socket emit:** `socket.emit('send-message', { roomId, participantId, text, msgId, ... }, ack)`.
3. **Server (server.js ~3852):** send-message handler: loads meta from ROOMS, gets target participant socketId, runs translation (buildSystemPrompt, fastTranslate/hqTranslate), then `io.to(targetSocketId).emit('receive-message', { id, senderPid, originalText, translatedText, ... })`. Optionally TTS. If hospital 1:1 and saveMessages, inserts into hospital_messages (session_id from hospital_sessions by room_id).
4. **Recipient:** ChatScreen listens "receive-message", appends to messages state, saves to IndexedDB (saveMessage), updates UI.

### 8.3 Message history load

- **Non–PT- rooms:** ChatScreen loads from IndexedDB getMessages(roomId) first (db/index.js). If historyLoadedRef false and not PT-, it also fetches or relies on socket; for non-hospital, history load is skipped once (historyLoadedRef) to avoid overwriting.
- **PT- rooms:** No IndexedDB history for PT- in main messages store. ChatScreen fetches GET /api/hospital/patient-by-room/:roomId/history and merges into state; also saveHospitalConversation (hospitalConversations.js) for local copy by roomId+date.

### 8.4 Where messages are stored

- **General:** Not stored on server (memory-only for real-time). Client: IndexedDB `messages` table (Dexie).
- **Hospital:** Server: hospital_messages (and hospital_messages_v2 for token-based). Client: IndexedDB mono_hospital_conversations (by roomId+dateStr).

### 8.5 Offline and reconnect

- **Offline send:** Message goes to IndexedDB outbox (enqueueMessage). useOutbox flushes on reconnect: for each queued item, emit send-message with ack; on success dequeueMessage.
- **Reconnect:** Socket "connect" fires; register-user re-sent; ChatScreen can re-join room (join) or refetch PT- history (fetchPtHistoryRef) so messages received while offline appear.

---

## 9. Hospital Mode (Critical)

### 9.1 Differences from general messenger

- **Room ID:** PT-XXXXXX (from POST /api/hospital/join). Room can be restored from hospital_sessions when ROOMS doesn’t have it (join, stt:open).
- **Roles:** Staff = owner (roleHint "owner"), patient = guest. sender_role in hospital_messages = host | guest (derived from socket vs meta.ownerPid).
- **Persistence:** All messages saved to hospital_messages (and optionally v2). Local copy in mono_hospital_conversations (IndexedDB).
- **Flow:** Staff sees waiting list (hospital:watch, hospital:patient-waiting); "통역 시작" → navigate to /fixed-room/:roomId or /room/:roomId. Patient joins via /hospital/join/:orgCode → /fixed-room/:roomId. fixed-room:start/end control VAD for both sides.
- **Site context:** siteContext = hospital_{dept}. Used for system prompt (SITE_CONTEXT_PROMPTS), SITE_ROLES, and isHospitalContext() checks. Broadcast conversion is disabled for hospital rooms (always 1:1).

### 9.2 Hospital-only vs shared files

- **Hospital-only (pages):** HospitalApp, HospitalDashboard, HospitalKiosk, HospitalPatientJoin, HospitalRecords, HospitalLogin, HospitalRegister, HospitalStaffQr, HospitalAesthetic, HospitalConversations, FixedRoomVAD (VAD flow), FixedRoom (generic fixed).
- **Shared with hospital branches:** ChatScreen.jsx, server.js, QRCodeBox.jsx, GuestJoin.jsx, Home.jsx, App.jsx (isGuestJoinRoute includes hospital paths). db/index.js is general; db/hospitalConversations.js is hospital-only.

### 9.3 Hospital-only DB tables

- hospital_sessions, hospital_messages, hospital_patients (002)
- hospital_patients_v2, hospital_sessions_v2, hospital_messages_v2 (003)
- org_* and admin_settings (004) used by hospital dashboard and org flow.

### 9.4 Hospital branches in shared code

**ChatScreen.jsx:**  
isHospitalMode (effectiveSiteContext.startsWith("hospital_")), hospitalDept, HOSPITAL_DISPLAY_NAME, hospitalInitialPartnerName; skip history load for hospital (historyLoadedRef); PT- room history via API and fetchPtHistoryRef; partner name override (resolvedName) for guest; leave → navigate /hospital with state; isBroadcastListener false for hospital; org copy settings (EMR/CRM) for staff; saveHospitalConversation for guest on messages change. Console.log "[Hospital History]...".

**server.js:**  
SITE_CONTEXT_PROMPTS / SITE_ROLES for hospital_*; isHospitalContext(); buildSystemPrompt hospital dept + medical terms; ROOMS meta siteContext hospital_*; create-room chartNumber/hospitalSessionId/sessionType; join: isHospitalRoom — no broadcast conversion, remove offline guest only; PT- restore from hospital_sessions; host_lang update to hospital_sessions on owner join; partner labels for hospital 1:1; stt:open PT- restore; stt:segment_end and send-message: shouldSaveMessages for hospital/PT-, INSERT hospital_messages; stt hospitalMode forces Groq; disconnect emit room:ended for hospital; hospital:watch / hospital:patient-waiting. Many console.log/console.warn for [JOIN:hospital], [stt:hospital], etc.

**Other:**  
QRCodeBox: hospitalDept, saveMode, onGuestJoined. GuestJoin: hospital mode copy/partner name. Home: no hospital button. App: isGuestJoinRoute includes /hospital, /fixed-room, /fixed.

---

## 10. Known Issues / Technical Debt

- **TODO/FIXME:** Grep found no explicit TODO/FIXME in src; a few comments reference "PT-XXXXXX" or "실패 시 1회 재시도" (retry once).
- **console.log/error:** server.js: [env] JWT_SECRET, PORT; [JOIN:hospital], [1:1:hospital], [stt:hospital], [stt:segment], [cost-report], [hospital:msg-save], [stt:open] PT- restore. ChatScreen: [Hospital History]. Multiple files in src use console.log (MicButton, FixedRoomVAD, HospitalApp, HospitalDashboard, ChatScreen, QRCodeBox, useVADPipeline, etc.).
- **Dead code / unused imports:** server/_server_unused.js present. Duplicate route GET /api/hospital/patient-by-room/:roomId/history in server.js and auth_api.js (both attach to same app).
- **Hardcoded values:** ADMIN_PASSWORD / ADMIN_JWT_SECRET default in admin.js. Default PORT 3174. VAPID/callback URLs in routes. deploy.sh branch default feature/hospital-plastic-surgery. GitHub Actions deploy.yml hardcodes IP 15.164.59.178.
- **Large files (candidates for split):** server.js (~6788), ChatScreen.jsx (2124), FixedRoomVAD.jsx (1810), HospitalDashboard.jsx (1826), VisualPipelineBuilder.jsx (1280), auth_api.js (991), HospitalApp.jsx (806).

---

## 11. Build & Deploy

- **Build:** Vite. `npm run build` → `vite build`. Config: vite.config.js — React plugin, copyVadAssets (ONNX/WASM to dist), base '/', proxy /api to 127.0.0.1:3174, COOP/COEP headers, optimizeDeps exclude @ricky0123/vad-web.
- **Env (server):** JWT_SECRET, PORT, NODE_ENV, PORT_AUTO_FALLBACK, MONO_DB_PATH, OPENAI_API_KEY, GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, STATS_API_KEY, VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, ADMIN_PASSWORD, ADMIN_JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, KAKAO_*, LINE_*, APPLE_*, STT_PROVIDER, DIAG, FREE_TRANSLATION_MONTHLY_LIMIT, OPENAI_ADMIN_KEY, CS_CHAT_MODEL, ADMIN_EMAILS. No .env file in repo (gitignored).
- **Env (client):** VITE_SOCKET_URL, VITE_KAKAO_JAVASCRIPT_KEY, VITE_APP_VERSION, import.meta.env.DEV.
- **PM2:** deploy.sh runs `pm2 restart mono`. No ecosystem.config.js in repo; process name "mono" assumed.
- **Nginx:** Not in repo; deploy docs reference AWS Lightsail; GitHub Actions deploy.yml SSHs to ubuntu@15.164.59.178, cd /home/ubuntu/mono, git reset --hard origin/feature/hospital-plastic-surgery, npm run migrate, npm run build, pm2 restart mono.

---

*End of audit. No code was modified.*
