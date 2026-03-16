# MONO — Master Development Context
**Last updated: 2026-03-16**
**Branch: feature/hospital-plastic-surgery**
**This is the SINGLE SOURCE OF TRUTH for all Cursor development.**

---

## 1. What MONO Is

MONO (lingora.chat) is a real-time AI multilingual interpreter. No app install required — users scan a QR code, pick a language, and start talking. PWA install is optional but enables push notifications and app-like experience.

Two user types share the **same core messenger**:
- **Individual users**: Create rooms, share QR, chat with translation
- **Organizations (hospitals, agencies, etc.)**: Same thing, plus a dashboard for records/CRM and a kiosk for fixed QR display

There is NO separate "hospital mode." Organizations are just business accounts using the same messenger with extra admin features.

---

## 2. Architecture Overview

### Stack
- **Frontend**: React 18 + Vite, PWA (Service Worker), Dexie (IndexedDB)
- **Backend**: Express + Socket.IO, single `server.js` (~6788 lines)
- **DB**: SQLite (`state/mono_phase1.sqlite`)
- **STT**: Groq Whisper Large V3 (primary), OpenAI Whisper (fallback)
- **Translation**: GPT-4o (streaming)
- **VAD**: Silero VAD v5 (client-side WebAssembly)
- **Infra**: AWS Lightsail Seoul, PM2, Nginx, Cloudflare DNS, certbot SSL

### Servers
| Name | IP | Domain | Purpose |
|------|-----|--------|---------|
| Ubuntu-2 | 15.164.59.178 | lingora.chat | Production (main) |
| Ubuntu-staging | 43.201.103.166 | hospital.lingora.chat | Staging / hospital beta |

### Deploy Command (ALWAYS use this)
```bash
cd /home/ubuntu/mono && git pull --rebase && npm run build && pm2 reload mono
```
- **NEVER** use `pm2 restart` — always `pm2 reload` (zero-downtime)
- **NEVER** skip `npm run build` — missing build causes client-server mismatch

---

## 3. Core Messaging Flow (Same for ALL rooms)

### 3.1 Room Creation
1. Host creates room → `socket.emit('create-room', { roomId, participantId, fromLang, siteContext, ... })`
2. Server stores in `ROOMS` (in-memory Map), emits `room-created-ack`
3. Host gets QR code containing `/join/{roomId}`

### 3.2 Guest Joins
1. Guest scans QR → `/join/{roomId}` → GuestJoin page
2. Picks language → navigates to `/room/{roomId}`
3. ChatScreen mounts → `socket.emit('join', { roomId, participantId, roleHint: 'guest', ... })`
4. Server adds to room, emits `partner-joined` to both sides

### 3.3 Sending a Message
1. User types text → `socket.emit('send-message', { roomId, text, participantId, msgId })`
2. Server translates via GPT-4o (buildSystemPrompt → fastTranslate/hqTranslate)
3. Server emits `receive-message` to recipient with `{ originalText, translatedText, ... }`
4. Recipient's ChatScreen appends to messages state, saves to IndexedDB

### 3.4 STT (Voice) Flow
1. User holds mic → VAD detects speech → `stt:open` → `stt:audio` (chunks) → `stt:segment_end`
2. Server runs Groq Whisper → gets transcript → translates → emits `receive-message`

### 3.5 Message Storage
- **Client (all rooms)**: IndexedDB via Dexie (`messages` table) — primary storage for individual users
- **Server (org rooms only)**: `hospital_messages` table — for dashboard/CRM access
- IndexedDB is cache; user can clear it in Settings. When full, old messages auto-purge.

### 3.6 Offline & Reconnect
- **Offline send**: Message queued in IndexedDB `outbox` → flushed on reconnect via `useOutbox`
- **Reconnect**: `socket.on('connect')` → re-emit `join` with stored params → refetch history for PT- rooms

---

## 4. Organization (Hospital) Add-Ons

Organizations use the same messenger with these extras:

### 4.1 What's Different
| Feature | Individual | Organization |
|---------|-----------|--------------|
| QR Code | Per-room, dynamic | Fixed permanent QR per org |
| Kiosk | N/A | Dedicated QR display screen |
| Dashboard | N/A | Admin panel (stats, records, CRM copy) |
| Server DB save | No | Yes (hospital_messages for records) |
| Staff view | N/A | FixedRoomVAD (VAD auto-detection mode) |
| Patient entry | N/A | HospitalPatientJoin (flag + name input) |

### 4.2 Kiosk
- Static QR page, no socket connection
- URL: `/hospital?template=reception&kiosk=true` or `/hospital/kiosk/:department`
- QR points to `/hospital/join/:orgCode` — one QR per hospital, permanent

### 4.3 Patient Join Flow
1. Patient scans kiosk QR → `/hospital/join/:orgCode`
2. `HospitalPatientJoin`: select language flag → enter English name → tap "입장"
3. `POST /api/hospital/patient` → upsert patient by patientToken
4. `POST /api/hospital/join` → server creates `PT-XXXXXX` room, adds to HOSPITAL_WAITING
5. Patient navigates to `/room/PT-XXXXXX` (ChatScreen, PTT mode)

### 4.4 Staff Flow
1. Staff at `/hospital?template=reception` sees waiting patients (via `hospital:watch` socket)
2. Clicks "통역 시작" → navigates to `/fixed-room/PT-XXXXXX` (FixedRoomVAD, VAD mode)
3. VAD auto-detects speech, translates in real-time

### 4.5 Dashboard
- Login: `/hospital-login` → `/hospital-dashboard`
- Shows: session history, PT-grouped records, stats, org settings
- Records: original + translated text, searchable by PT number
- CRM/EMR copy button: formatted for paste into external systems

### 4.6 Room ID Format
- Individual rooms: random IDs (from create-room)
- Org (hospital) rooms: `PT-XXXXXX` (PT- + 6 alphanumeric chars)
- Server reuses existing PT- room if active session found for same patientToken

---

## 5. DB Schema

### 5.1 Core (001_phase1_core_sqlite.sql)
| Table | Purpose |
|-------|---------|
| users | Registered users (OAuth: Google, Kakao, Line, Apple) |
| friends | Friend relationships (pending/accepted/blocked) |
| rooms | Room metadata (dm/group/qr/global) |
| room_members | Room membership (admin/member) |
| translation_usage | Monthly translation count per user |

### 5.2 Hospital (002 + 003 + 005)
| Table | Purpose |
|-------|---------|
| hospital_sessions | Session per room visit (room_id, patient_token, dept, status, patient_name, patient_lang) |
| hospital_messages | All messages in org rooms (session_id, room_id, sender_role, original_text, translated_text) |
| hospital_patients | Patient registry by chart_number + room_id |
| hospital_patients_v2 | Patient by patientToken (PK) |
| hospital_sessions_v2 | Sessions by patientToken |
| hospital_messages_v2 | Messages by patientToken |

### 5.3 Organization (004_admin_console.sql)
| Table | Purpose |
|-------|---------|
| organizations | Org registry (org_code, name, plan, is_active) |
| org_departments | Departments per org |
| org_pipeline_config | Translation pipeline config per dept |
| org_staff_accounts | Staff login accounts |
| org_devices | Registered devices |
| org_session_logs | Session audit logs with costs |
| org_api_cost_logs | API cost tracking |
| admin_settings | Key-value admin config |

### 5.4 Other
| Table | Purpose |
|-------|---------|
| api_usage_daily | Daily API usage stats |

---

## 6. Client State Management

### IndexedDB (Dexie — `db/index.js`)
| Store | Key | Purpose |
|-------|-----|---------|
| identity | "me" | Current user (userId, canonicalName, lang) |
| rooms | roomId | Room list with peer info, unread count |
| messages | id | All messages (roomId, text, translations, timestamp) |
| outbox | ++id | Offline message queue |
| aliases | [userId+targetLang] | Pronunciation aliases |

### IndexedDB (`hospitalConversations.js`)
| Store | Key | Purpose |
|-------|-----|---------|
| conversations | roomId_dateStr | Hospital conversation cache by room+date |

### localStorage Keys (important ones)
| Key | Purpose |
|-----|---------|
| mono.onboardingDone | First-time setup complete |
| mono.theme | dark/light |
| mono.preferredLang | User's language |
| myLang | Current language (chat) |
| mro.pid.{roomId} | participantId per room |
| mono_hospital_patient | Patient token |
| mono_hospital_current_pt | Current PT roomId |

### sessionStorage Keys
| Key | Purpose |
|-----|---------|
| mono_guest | Guest join payload |
| mono_session | Chat session payload |

---

## 7. Key Files (by importance)

### Must-Understand Files
| File | Lines | What It Does |
|------|-------|-------------|
| server.js | 6788 | EVERYTHING server-side: Express, Socket.IO, STT, translation, hospital APIs |
| ChatScreen.jsx | 2124 | Main chat UI — shared by ALL rooms (individual + org) |
| FixedRoomVAD.jsx | 1810 | Staff-side VAD chat (org rooms only) |
| HospitalDashboard.jsx | 1826 | Org admin dashboard |
| HospitalApp.jsx | 806 | Org main page (kiosk/staff/normal mode selector) |
| HospitalPatientJoin.jsx | 448 | Patient QR entry flow |
| QRCodeBox.jsx | 330 | QR generation + room creation |
| RoomList.jsx | 559 | User's conversation list |
| db/index.js | 253 | IndexedDB schema + CRUD |
| router.jsx | 230 | All routes |

### Supporting Files
| File | Lines | What It Does |
|------|-------|-------------|
| MicButton.jsx | 465 | Mic recording → STT |
| useVADPipeline.js | 195 | Silero VAD → socket STT |
| useOutbox.js | 100 | Offline message queue flush |
| MessageBubble.jsx | 174 | Single message render |
| GuestJoin.jsx | 251 | Guest entry by roomId |
| Contacts.jsx | 609 | Friends/contacts |
| Settings.jsx | 622 | App settings |
| Home.jsx | 205 | Create room / interpret entry |

---

## 8. URL Structure

### Individual User
| URL | Component | Purpose |
|-----|-----------|---------|
| /login | Login | OAuth login |
| /interpret | Home | Create room, QR |
| /home | RoomList | Conversation list |
| /contacts | Contacts | Friends |
| /settings | Settings | Preferences |
| /join/:roomId | GuestJoin | Join by QR scan |
| /room/:roomId | ChatScreen | Chat (ALL rooms) |

### Organization
| URL | Component | Purpose |
|-----|-----------|---------|
| /hospital?template=reception | HospitalApp | Staff PC, reception |
| /hospital?template=reception&kiosk=true | HospitalApp | Kiosk QR display |
| /hospital?template=consultation | HospitalApp | Staff PC, consultation |
| /hospital/join/:orgCode | HospitalPatientJoin | Patient QR entry |
| /fixed-room/:roomId | FixedRoomVAD | Staff VAD chat |
| /hospital-login | HospitalLogin | Admin login |
| /hospital-dashboard | HospitalDashboard | Admin panel |
| /hospital/records | HospitalRecords | Record viewer |

### Admin
| URL | Component | Purpose |
|-----|-----------|---------|
| /admin | AdminLogin | Super admin login |
| /admin/orgs | AdminOrgs | Org management |
| /admin/orgs/:orgId | AdminOrgDetail | Org detail |

---

## 9. Socket Events Reference

### Client → Server
| Event | Purpose |
|-------|---------|
| register-user | Register userId + lang |
| create-room | Create new room |
| create-1to1 | Create 1:1 with peer |
| join | Join room (main event) |
| rejoin-room | Rejoin after disconnect |
| send-message | Send text message |
| stt:open / stt:audio / stt:segment_end / stt:close | Voice STT pipeline |
| stt:whisper | Upload-based STT |
| fixed-room:start / fixed-room:end | VAD control |
| hospital:watch | Subscribe to waiting list |
| leave-room / manual-leave | Leave room |
| delete-room | Delete room |
| heartbeat / mono-ping | Keep-alive |

### Server → Client
| Event | Purpose |
|-------|---------|
| receive-message | Incoming translated message |
| receive-message-stream / stream-end | Streaming translation |
| partner-joined / partner-info | Peer connection |
| room-context / room-status | Room metadata |
| hospital:patient-waiting | New patient in queue |
| hospital:patient-picked | Patient assigned |
| fixed-room:start / fixed-room:end | VAD control broadcast |
| tts_audio | TTS playback |

---

## 10. Authentication

- **OAuth**: Google, Kakao, Line, Apple → JWT in HTTP-only cookie
- **Hospital admin**: Email/password → separate JWT (requireHospitalAdminJwt)
- **Super admin**: Password → admin JWT (verifyAdmin)
- **Guest**: No login required — participantId generated client-side, stored in localStorage

---

## 11. Environment Variables

### Server (.env)
```
PORT=3174
NODE_ENV=production
JWT_SECRET=...
OPENAI_API_KEY=...
GROQ_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
VAPID_SUBJECT=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
MONO_DB_PATH=state/mono_phase1.sqlite
```

### Client (Vite)
```
VITE_SOCKET_URL=...
VITE_KAKAO_JAVASCRIPT_KEY=...
```

---

## 12. Current DB Records

### Organizations
| id | org_code | name | plan |
|----|----------|------|------|
| 1 | ORG-0001 | 서울 성형외과 | trial |
| 2 | CHEONGDAM | 청담우리들병원 | trial |

### Hospital Login
| Hospital | Email | Password |
|----------|-------|----------|
| 서울 성형외과 | seoul@lingora.chat | Seoul2026! |
| 청담우리들병원 | cheongdam@lingora.chat | Cheongdam2026! |

---

## 13. Known Issues & Technical Debt

### Active Bugs
1. **[Korean] tag in translations**: Translation output sometimes includes literal "[Korean]" prefix — needs stripping
2. **FixedRoomVAD partner language**: When patient is offline, staff screen shows "KO → KO" instead of actual patient language — should infer from history
3. **Dept shows org_code**: Patient join shows "CHEONGDAM" instead of actual department name

### Structural Debt
1. **server.js is 6788 lines** — needs modular split (socket handlers, hospital APIs, auth, translation pipeline)
2. **hospital_messages v1/v2 coexist** — should consolidate to one table
3. **medicalKnowledge.js dual copies** — ESM (frontend) + CJS (server), must sync manually
4. **ChatScreen.jsx has PT- branches** — ideally should work identically for all rooms
5. **deploy.sh uses `pm2 restart`** — should be `pm2 reload`
6. **Duplicate API route**: `/api/hospital/patient-by-room/:roomId/history` exists in both server.js and auth_api.js

### Files Needing Split (>1000 lines)
| File | Lines | Split Plan |
|------|-------|-----------|
| server.js | 6788 | → socket/, routes/, translation/, hospital/ modules |
| ChatScreen.jsx | 2124 | → hooks, sub-components |
| FixedRoomVAD.jsx | 1810 | → hooks, sub-components |
| HospitalDashboard.jsx | 1826 | → tab components |
| VisualPipelineBuilder.jsx | 1280 | → block components |

---

## 14. Absolute Rules for Development

1. **DO NOT touch working core logic** unless explicitly instructed — ChatScreen socket handlers, GuestJoin, Login, Home, RoomList, Contacts, Settings, auth routes
2. **DO NOT refactor or "improve" files outside the current task scope** — Cursor has destroyed flows by doing unauthorized refactors before
3. **NEVER skip `npm run build`** — missing build broke send-message previously
4. **Deploy**: `cd /home/ubuntu/mono && git pull --rebase && npm run build && pm2 reload mono`
5. **NEVER use `pm2 restart`** — always `pm2 reload` (zero-downtime)
6. **Session log logic (commit bcb5df7) is OFF LIMITS** — never touch
7. **Each task = separate git commit** — do not bundle unrelated changes
8. **.env must be in .gitignore** — verify after any config change
9. **If unsure about scope, ASK** — do not guess and change
10. **Prompts to Cursor: always in English** — add scope restriction at the end

---

## 15. Stable Recovery Points

| Commit | Description | Rollback Command |
|--------|-------------|-----------------|
| a1430c4 | Hospital mode baseline (all core features working) | `git reset --hard a1430c4 && npm run build && pm2 reload mono` |
| bcb5df7 | Session log complete (bidirectional, original+translated) | — |

---

*This document replaces all previous cursor context files, feature reports, and logic summaries.*
*Any new development work should reference ONLY this document.*
