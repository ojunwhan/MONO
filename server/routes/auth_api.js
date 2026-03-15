const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");
const {
  findUserById,
  updateUserProfile,
  normalizeLangCode,
} = require("../db/users");
const { all, get, run } = require("../db/sqlite");
const {
  getUserBillingOverview,
  getFreeMonthlyLimit,
} = require("../billing");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function buildCsSystemPrompt(language = "ko") {
  const lang = String(language || "ko").toLowerCase();
  return `당신은 MONO 앱의 AI 고객지원 도우미 "모노봇"입니다.
사용자의 언어에 맞춰 같은 언어로 답변하세요.
친절하고 간결하게, 존댓말로 답변하세요.
모르는 내용은 추측하지 말고 "담당자에게 연결해드리겠습니다"라고 안내하세요.
[MONO 앱 정보]

MONO란?


AI 실시간 통역 메신저. 언어가 달라도 모국어로 대화 가능.
웹브라우저에서 바로 사용하는 PWA. 앱 설치 불필요.
Google 또는 카카오 계정으로 로그인하면 자동 가입.
지원 언어: 한국어, 영어, 일본어, 중국어, 베트남어 등.


QR 즉시통역


회원가입 없이 QR코드 스캔으로 바로 통역 대화 시작.
상대방 앱 설치 불필요. 브라우저에서 바로 참여.
기본 제공 횟수 내 무료.


메신저 기능


친구 추가: 연락처 탭에서 MONO ID 검색 또는 초대 링크 전송.
MONO ID: 고유 아이디. 설정에서 확인 가능.
그룹 채팅: 여러 명이 각자 모국어로 대화 가능.
음성 메시지: 마이크 버튼으로 음성 전송. 자동 텍스트 변환 + 번역.
글로벌 채팅방: 전 세계 사용자와 공개 대화.


번역/통역


GPT-4o 기반 AI 번역. 자연스러운 대화체.
번역 오류 시: 메시지 길게 누르기 → "번역 다시하기" 또는 "번역 피드백".
음성 인식 문제 시: 조용한 환경, 또렷한 발음. 설정에서 마이크 감도 조절.
TTS 끄기: 설정 > 음성 설정 > 자동재생 OFF.


요금/구독


Free 플랜: 월 1,000회 번역 무료.
Pro 플랜: 추가 번역 횟수 + 프리미엄 기능 (준비 중).
남은 횟수 확인: 설정 > 구독 관리.


계정/설정


프로필 변경: 설정 > 프로필 카드 탭.
모국어 변경: 설정 > 언어 설정.
다크모드: 설정 > 표시 설정.
로그아웃/계정삭제: 설정 하단.
데이터: 로컬(기기) 저장. 설정 > 저장 관리에서 확인/정리.


보안/개인정보


대화는 참여자만 열람 가능. 제3자 접근 불가.
AI 번역 처리 후 서버에 대화 내용 보관하지 않음.
개인정보처리방침에 따라 최소한의 정보만 수집.


PWA 사용법


홈 화면 추가: iPhone → Safari > 공유 > "홈 화면에 추가" / Android → Chrome > 메뉴 > "홈 화면에 추가"
앱스토어 출시는 준비 중.


제조업 현장


여러 직원이 각자 기기에서 동시 접속 가능.
모바일 데이터로 Wi-Fi 없이도 사용 가능.


문제 해결


연결 끊김: 인터넷 확인. Wi-Fi ↔ 모바일 데이터 전환.
메시지 전송 실패: 새로고침 또는 재로그인.
알림 안 옴: 브라우저 알림 권한 허용 확인. 설정 > 알림.

[답변 불가 상황]
다음의 경우 "이 문의는 담당자에게 전달해드리겠습니다. 이메일(support@lingora.chat)로 연락 주시면 빠르게 도움드리겠습니다."라고 안내:

결제/환불 관련 실제 처리가 필요한 경우
버그 신고 (구체적 오류 현상)
계정 복구/데이터 복원 요청
MONO와 무관한 질문

[응답 언어]
- 반드시 language="${lang}"에 맞는 언어로 답변하세요.`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const trimmed = history.slice(-10);
  const out = [];
  for (const item of trimmed) {
    if (typeof item === "string") {
      const content = item.trim();
      if (content) out.push({ role: "user", content });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const roleRaw = String(item.role || "").toLowerCase();
    const role =
      roleRaw === "assistant" || roleRaw === "system"
        ? roleRaw
        : "user";
    const content = String(
      item.content || item.message || item.text || item.reply || ""
    ).trim();
    if (content) out.push({ role, content });
  }
  return out.slice(-10);
}

function readToken(req) {
  const cookieToken = req.cookies?.token;
  if (cookieToken) return cookieToken;
  const auth = req.headers?.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function verifyToken(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: "server_misconfig_jwt_secret" });
  }
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

/** 로그인 시에만 검사하고, organization이면 req.hospitalOrgId 설정. 비로그인/개인은 req.hospitalOrgId = null */
async function optionalHospitalOrg(req, res, next) {
  req.hospitalOrgId = null;
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await findUserById(payload.sub);
    if (user && String(user.account_type || "personal") === "organization") {
      req.hospitalOrgId = payload.sub;
    }
  } catch (_) {}
  next();
}

async function requireHospitalOrg(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: "server_misconfig_jwt_secret" });
  }
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    const user = await findUserById(payload.sub);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    if (String(user.account_type || "personal") !== "organization") {
      return res.status(403).json({ error: "organization_account_required" });
    }
    req.hospitalOrgId = payload.sub;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

/** 대시보드 전용: 로그인 + ADMIN_EMAILS에 포함된 이메일만 허용. 허용 시 req.hospitalOrgId, req.hospitalOrgCode, req.hospitalDashboardIsAdmin 설정 */
async function requireHospitalDashboardAdmin(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: "server_misconfig_jwt_secret" });
  }
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    const user = await findUserById(payload.sub);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const email = (user.email || "").trim().toLowerCase();
    if (!adminEmails.length || !email || !adminEmails.includes(email)) {
      return res.status(403).json({ error: "access_denied", message: "접근 권한이 없습니다." });
    }
    req.hospitalOrgId = payload.sub;
    req.hospitalOrgCode = (user.org_code || "").trim() || null;
    req.hospitalDashboardIsAdmin = adminEmails.includes(email);
    return next();
  } catch (e) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

async function checkUsageLimitMiddleware(req, res, next) {
  try {
    const overview = await getUserBillingOverview(req.auth?.sub);
    if (overview?.overLimit) {
      return res.status(402).json({
        error: "translation_limit_exceeded",
        message: "번역 한도 초과",
        subscription: {
          plan: overview.plan,
          usageCount: overview.used,
          monthlyLimit: overview.limit,
          month: overview.month,
        },
      });
    }
    req.usageOverview = overview;
    return next();
  } catch {
    return res.status(500).json({ error: "usage_limit_check_failed" });
  }
}

function mapUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || "",
    nickname: user.nickname || "",
    monoId: user.mono_id || "",
    avatarUrl: user.avatar_url || "",
    nativeLanguage: normalizeLangCode(user.native_language || "en"),
    phoneNumber: user.phone_number || "",
    statusMessage: user.status_message || "",
    createdAt: user.created_at || null,
    accountType: user.account_type === "organization" ? "organization" : "personal",
    orgName: user.org_name || "",
    businessNumber: user.business_number || "",
    contactName: user.contact_name || "",
    orgCode: user.org_code || "",
  };
}

function mapRelation(outStatus, inStatus) {
  if (outStatus === "accepted" || inStatus === "accepted") return "accepted";
  if (outStatus === "blocked" || inStatus === "blocked") return "blocked";
  if (outStatus === "pending") return "pending_sent";
  if (inStatus === "pending") return "pending_received";
  return "none";
}

async function upsertFriendRow(userId, friendId, status) {
  const row = await get(
    "SELECT id FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
    [userId, friendId]
  );
  if (row?.id) {
    await run("UPDATE friends SET status = ? WHERE id = ?", [status, row.id]);
    return row.id;
  }
  const id = uuidv4();
  await run(
    "INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)",
    [id, userId, friendId, status]
  );
  return id;
}

module.exports = function attachAuthApi(app) {
  // ── Compatibility aliases: /api/users/me (spec) ──
  app.get("/api/users/me", verifyToken, async (req, res) => {
    try {
      const user = await findUserById(req.auth?.sub);
      if (!user) return res.status(404).json({ error: "user_not_found" });
      return res.json({ user: mapUser(user) });
    } catch {
      return res.status(500).json({ error: "users_me_failed" });
    }
  });

  app.put("/api/users/me", verifyToken, async (req, res) => {
    try {
      const patch = req.body || {};
      const updated = await updateUserProfile(req.auth?.sub, patch);
      return res.json({ success: true, user: mapUser(updated) });
    } catch (e) {
      if (e.message === "user_not_found") return res.status(404).json({ error: "user_not_found" });
      if (e.message === "mono_id_taken") return res.status(409).json({ error: "mono_id_taken" });
      if (e.message === "invalid_mono_id") return res.status(400).json({ error: "invalid_mono_id" });
      return res.status(500).json({ error: "users_me_update_failed" });
    }
  });

  app.get("/api/auth/me", verifyToken, async (req, res) => {
    try {
      const user = await findUserById(req.auth?.sub);
      if (!user) return res.status(404).json({ error: "user_not_found" });
      return res.json({ authenticated: true, user: mapUser(user) });
    } catch (e) {
      return res.status(500).json({ error: "me_failed" });
    }
  });

  app.patch("/api/auth/profile", verifyToken, async (req, res) => {
    try {
      const patch = req.body || {};
      const updated = await updateUserProfile(req.auth?.sub, patch);
      return res.json({ success: true, user: mapUser(updated) });
    } catch (e) {
      if (e.message === "user_not_found") {
        return res.status(404).json({ error: "user_not_found" });
      }
      if (e.message === "mono_id_taken") {
        return res.status(409).json({ error: "mono_id_taken" });
      }
      if (e.message === "invalid_mono_id") {
        return res.status(400).json({ error: "invalid_mono_id" });
      }
      return res.status(500).json({ error: "profile_update_failed" });
    }
  });

  app.post("/api/contacts/lookup-phone", verifyToken, async (req, res) => {
    try {
      const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
      if (!phones.length) return res.status(400).json({ error: "phones_required" });

      const norm = (v) => String(v || "").replace(/[^\d+]/g, "").trim();
      const normalized = Array.from(
        new Set(phones.map(norm).filter((p) => p.length >= 8).slice(0, 50))
      );
      if (!normalized.length) return res.json({ members: [], nonMembers: [] });

      const placeholders = normalized.map(() => "?").join(",");
      const rows = await all(
        `
        SELECT id, nickname, mono_id, avatar_url, native_language, status_message, phone_number
        FROM users
        WHERE phone_number IN (${placeholders}) AND id <> ?
        `,
        [...normalized, req.auth.sub]
      );
      const memberPhones = new Set(rows.map((r) => String(r.phone_number || "")));
      const members = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
        phoneNumber: u.phone_number || "",
      }));
      const nonMembers = normalized.filter((p) => !memberPhones.has(p));
      return res.json({ members, nonMembers });
    } catch {
      return res.status(500).json({ error: "lookup_phone_failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    return res.json({ success: true });
  });

  app.get("/api/contacts/search", verifyToken, async (req, res) => {
    try {
      const q = String(req.query?.q || "")
        .trim()
        .toLowerCase();
      if (!q || q.length < 2) return res.json({ users: [] });

      const rows = await all(
        `
        SELECT
          u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message,
          (SELECT f1.status FROM friends f1 WHERE f1.user_id = ? AND f1.friend_id = u.id LIMIT 1) AS out_status,
          (SELECT f2.status FROM friends f2 WHERE f2.user_id = u.id AND f2.friend_id = ? LIMIT 1) AS in_status
        FROM users u
        WHERE u.id <> ?
          AND u.mono_id LIKE ?
        ORDER BY u.created_at DESC
        LIMIT 20
        `,
        [req.auth.sub, req.auth.sub, req.auth.sub, `%${q}%`]
      );

      const users = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
        relation: mapRelation(u.out_status, u.in_status),
      }));
      return res.json({ users });
    } catch {
      return res.status(500).json({ error: "contacts_search_failed" });
    }
  });

  app.get("/api/contacts/friends", verifyToken, async (req, res) => {
    try {
      const rows = await all(
        `
        SELECT u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message, MAX(f.created_at) AS linked_at
        FROM (
          SELECT friend_id AS peer_id, created_at FROM friends WHERE user_id = ? AND status = 'accepted'
          UNION
          SELECT user_id AS peer_id, created_at FROM friends WHERE friend_id = ? AND status = 'accepted'
        ) f
        JOIN users u ON u.id = f.peer_id
        GROUP BY u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message
        ORDER BY linked_at DESC
        `,
        [req.auth.sub, req.auth.sub]
      );
      const friends = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
        relation: "accepted",
      }));
      return res.json({ friends });
    } catch {
      return res.status(500).json({ error: "friends_list_failed" });
    }
  });

  app.get("/api/contacts/requests", verifyToken, async (req, res) => {
    try {
      const rows = await all(
        `
        SELECT u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message, f.created_at
        FROM friends f
        JOIN users u ON u.id = f.user_id
        WHERE f.friend_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC
        `,
        [req.auth.sub]
      );
      const requests = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
      }));
      return res.json({ requests });
    } catch {
      return res.status(500).json({ error: "incoming_requests_failed" });
    }
  });

  app.post("/api/contacts/request", verifyToken, async (req, res) => {
    try {
      const targetMonoId = String(req.body?.targetMonoId || "")
        .trim()
        .toLowerCase();
      if (!targetMonoId) return res.status(400).json({ error: "target_mono_id_required" });

      const target = await get(
        "SELECT id, mono_id FROM users WHERE mono_id = ? LIMIT 1",
        [targetMonoId]
      );
      if (!target?.id) return res.status(404).json({ error: "target_user_not_found" });
      if (target.id === req.auth.sub) {
        return res.status(400).json({ error: "cannot_add_self" });
      }

      const out = await get(
        "SELECT status FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
        [req.auth.sub, target.id]
      );
      const incoming = await get(
        "SELECT status FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
        [target.id, req.auth.sub]
      );

      if (out?.status === "accepted" || incoming?.status === "accepted") {
        return res.json({ success: true, relation: "accepted" });
      }
      if (out?.status === "blocked" || incoming?.status === "blocked") {
        return res.status(403).json({ error: "blocked_relation" });
      }
      if (incoming?.status === "pending") {
        await upsertFriendRow(target.id, req.auth.sub, "accepted");
        await upsertFriendRow(req.auth.sub, target.id, "accepted");
        return res.json({ success: true, relation: "accepted" });
      }
      await upsertFriendRow(req.auth.sub, target.id, "pending");
      return res.json({ success: true, relation: "pending_sent" });
    } catch {
      return res.status(500).json({ error: "friend_request_failed" });
    }
  });

  app.post("/api/contacts/respond", verifyToken, async (req, res) => {
    try {
      const requesterUserId = String(req.body?.requesterUserId || "").trim();
      const action = String(req.body?.action || "").trim();
      if (!requesterUserId) return res.status(400).json({ error: "requester_user_id_required" });
      if (!["accept", "reject", "block"].includes(action)) {
        return res.status(400).json({ error: "invalid_action" });
      }

      const incoming = await get(
        "SELECT id, status FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
        [requesterUserId, req.auth.sub]
      );
      if (!incoming?.id) return res.status(404).json({ error: "request_not_found" });

      if (action === "reject") {
        await run("DELETE FROM friends WHERE id = ?", [incoming.id]);
        return res.json({ success: true, relation: "none" });
      }
      if (action === "block") {
        await run("UPDATE friends SET status = 'blocked' WHERE id = ?", [incoming.id]);
        await upsertFriendRow(req.auth.sub, requesterUserId, "blocked");
        return res.json({ success: true, relation: "blocked" });
      }

      await run("UPDATE friends SET status = 'accepted' WHERE id = ?", [incoming.id]);
      await upsertFriendRow(req.auth.sub, requesterUserId, "accepted");
      return res.json({ success: true, relation: "accepted" });
    } catch {
      return res.status(500).json({ error: "request_response_failed" });
    }
  });

  app.post("/api/contacts/remove", verifyToken, async (req, res) => {
    try {
      const peerUserId = String(req.body?.peerUserId || "").trim();
      if (!peerUserId) return res.status(400).json({ error: "peer_user_id_required" });

      await run(
        "DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
        [req.auth.sub, peerUserId, peerUserId, req.auth.sub]
      );
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: "remove_friend_failed" });
    }
  });

  // ── Compatibility aliases: /api/friends/* (spec) ──
  app.get("/api/friends", verifyToken, async (req, res) => {
    try {
      const rows = await all(
        `
        SELECT u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message, MAX(f.created_at) AS linked_at
        FROM (
          SELECT friend_id AS peer_id, created_at FROM friends WHERE user_id = ? AND status = 'accepted'
          UNION
          SELECT user_id AS peer_id, created_at FROM friends WHERE friend_id = ? AND status = 'accepted'
        ) f
        JOIN users u ON u.id = f.peer_id
        GROUP BY u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message
        ORDER BY linked_at DESC
        `,
        [req.auth.sub, req.auth.sub]
      );
      const friends = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
        relation: "accepted",
      }));
      return res.json({ friends });
    } catch {
      return res.status(500).json({ error: "friends_list_failed" });
    }
  });

  app.get("/api/friends/requests", verifyToken, async (req, res) => {
    try {
      const rows = await all(
        `
        SELECT u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message, f.created_at
        FROM friends f
        JOIN users u ON u.id = f.user_id
        WHERE f.friend_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC
        `,
        [req.auth.sub]
      );
      const requests = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
      }));
      return res.json({ requests });
    } catch {
      return res.status(500).json({ error: "incoming_requests_failed" });
    }
  });

  app.get("/api/friends/search", verifyToken, async (req, res) => {
    try {
      const q = String(req.query?.mono_id || req.query?.q || "").trim().toLowerCase();
      if (!q || q.length < 2) return res.json({ users: [] });
      const rows = await all(
        `
        SELECT
          u.id, u.nickname, u.mono_id, u.avatar_url, u.native_language, u.status_message,
          (SELECT f1.status FROM friends f1 WHERE f1.user_id = ? AND f1.friend_id = u.id LIMIT 1) AS out_status,
          (SELECT f2.status FROM friends f2 WHERE f2.user_id = u.id AND f2.friend_id = ? LIMIT 1) AS in_status
        FROM users u
        WHERE u.id <> ?
          AND u.mono_id LIKE ?
        ORDER BY u.created_at DESC
        LIMIT 20
        `,
        [req.auth.sub, req.auth.sub, req.auth.sub, `%${q}%`]
      );
      const users = rows.map((u) => ({
        id: u.id,
        nickname: u.nickname || "",
        monoId: u.mono_id || "",
        avatarUrl: u.avatar_url || "",
        nativeLanguage: normalizeLangCode(u.native_language || "en"),
        statusMessage: u.status_message || "",
        relation: mapRelation(u.out_status, u.in_status),
      }));
      return res.json({ users });
    } catch {
      return res.status(500).json({ error: "friends_search_failed" });
    }
  });

  app.post("/api/friends/request", verifyToken, async (req, res) => {
    try {
      const targetMonoId = String(req.body?.targetMonoId || req.body?.mono_id || "")
        .trim()
        .toLowerCase();
      if (!targetMonoId) return res.status(400).json({ error: "target_mono_id_required" });
      const target = await get("SELECT id FROM users WHERE mono_id = ? LIMIT 1", [targetMonoId]);
      if (!target?.id) return res.status(404).json({ error: "target_user_not_found" });
      if (target.id === req.auth.sub) return res.status(400).json({ error: "cannot_add_self" });

      const out = await get(
        "SELECT status FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
        [req.auth.sub, target.id]
      );
      const incoming = await get(
        "SELECT status FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
        [target.id, req.auth.sub]
      );
      if (out?.status === "accepted" || incoming?.status === "accepted") {
        return res.json({ success: true, relation: "accepted" });
      }
      if (out?.status === "blocked" || incoming?.status === "blocked") {
        return res.status(403).json({ error: "blocked_relation" });
      }
      if (incoming?.status === "pending") {
        await upsertFriendRow(target.id, req.auth.sub, "accepted");
        await upsertFriendRow(req.auth.sub, target.id, "accepted");
        return res.json({ success: true, relation: "accepted" });
      }
      await upsertFriendRow(req.auth.sub, target.id, "pending");
      return res.json({ success: true, relation: "pending_sent" });
    } catch {
      return res.status(500).json({ error: "friend_request_failed" });
    }
  });

  app.post("/api/friends/accept", verifyToken, async (req, res) => {
    try {
      const requesterUserId = String(req.body?.requesterUserId || req.body?.user_id || "").trim();
      if (!requesterUserId) return res.status(400).json({ error: "requester_user_id_required" });
      const incoming = await get(
        "SELECT id FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending' LIMIT 1",
        [requesterUserId, req.auth.sub]
      );
      if (!incoming?.id) return res.status(404).json({ error: "request_not_found" });
      await run("UPDATE friends SET status = 'accepted' WHERE id = ?", [incoming.id]);
      await upsertFriendRow(req.auth.sub, requesterUserId, "accepted");
      return res.json({ success: true, relation: "accepted" });
    } catch {
      return res.status(500).json({ error: "friends_accept_failed" });
    }
  });

  app.post("/api/friends/reject", verifyToken, async (req, res) => {
    try {
      const requesterUserId = String(req.body?.requesterUserId || req.body?.user_id || "").trim();
      if (!requesterUserId) return res.status(400).json({ error: "requester_user_id_required" });
      await run(
        "DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
        [requesterUserId, req.auth.sub]
      );
      return res.json({ success: true, relation: "none" });
    } catch {
      return res.status(500).json({ error: "friends_reject_failed" });
    }
  });

  app.delete("/api/friends/:id", verifyToken, async (req, res) => {
    try {
      const peerUserId = String(req.params?.id || "").trim();
      if (!peerUserId) return res.status(400).json({ error: "peer_user_id_required" });
      await run(
        "DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
        [req.auth.sub, peerUserId, peerUserId, req.auth.sub]
      );
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: "friends_delete_failed" });
    }
  });

  // ── Rooms metadata API (server-side metadata only; no message contents) ──
  app.post("/api/rooms", verifyToken, async (req, res) => {
    try {
      const type = String(req.body?.type || "dm").trim();
      const roomType = ["dm", "group", "qr", "global"].includes(type) ? type : "dm";
      const name = String(req.body?.name || "").trim().slice(0, 80);
      const roomId = uuidv4();
      await run(
        "INSERT INTO rooms (id, type, name, created_by) VALUES (?, ?, ?, ?)",
        [roomId, roomType, name || null, req.auth.sub]
      );
      await run(
        "INSERT INTO room_members (id, room_id, user_id, role) VALUES (?, ?, ?, ?)",
        [uuidv4(), roomId, req.auth.sub, "admin"]
      );
      return res.json({ success: true, room: { id: roomId, type: roomType, name } });
    } catch {
      return res.status(500).json({ error: "rooms_create_failed" });
    }
  });

  app.get("/api/rooms", verifyToken, async (req, res) => {
    try {
      const rows = await all(
        `
        SELECT r.id, r.type, r.name, r.created_by, r.created_at
        FROM room_members rm
        JOIN rooms r ON r.id = rm.room_id
        WHERE rm.user_id = ?
        ORDER BY r.created_at DESC
        `,
        [req.auth.sub]
      );
      return res.json({ rooms: rows });
    } catch {
      return res.status(500).json({ error: "rooms_list_failed" });
    }
  });

  app.get("/api/rooms/:id/members", verifyToken, async (req, res) => {
    try {
      const roomId = String(req.params?.id || "").trim();
      if (!roomId) return res.status(400).json({ error: "room_id_required" });
      const rows = await all(
        `
        SELECT rm.user_id, rm.role, rm.joined_at, rm.last_read_message_id,
               u.nickname, u.mono_id, u.native_language, u.avatar_url
        FROM room_members rm
        JOIN users u ON u.id = rm.user_id
        WHERE rm.room_id = ?
        ORDER BY rm.joined_at ASC
        `,
        [roomId]
      );
      return res.json({ members: rows });
    } catch {
      return res.status(500).json({ error: "room_members_failed" });
    }
  });

  app.put("/api/rooms/:id/read", verifyToken, async (req, res) => {
    try {
      const roomId = String(req.params?.id || "").trim();
      const lastReadMessageId = String(req.body?.lastReadMessageId || "").trim();
      if (!roomId || !lastReadMessageId) {
        return res.status(400).json({ error: "room_id_and_last_read_message_id_required" });
      }
      await run(
        "UPDATE room_members SET last_read_message_id = ? WHERE room_id = ? AND user_id = ?",
        [lastReadMessageId, roomId, req.auth.sub]
      );
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: "room_read_update_failed" });
    }
  });

  // ── Subscription / Billing (Phase 4-1 scaffolding) ──
  app.get("/api/subscription/me", verifyToken, async (req, res) => {
    try {
      const overview = await getUserBillingOverview(req.auth?.sub);
      return res.json({
        success: true,
        subscription: {
          plan: overview.plan,
          planExpiresAt: overview.planExpiresAt,
          month: overview.month,
          usageCount: overview.used,
          monthlyLimit: overview.limit,
          remaining: overview.remaining,
          overLimit: overview.overLimit,
          freeLimitDefault: getFreeMonthlyLimit(),
        },
      });
    } catch {
      return res.status(500).json({ error: "subscription_overview_failed" });
    }
  });

  app.get("/api/subscription/check-limit", verifyToken, checkUsageLimitMiddleware, async (req, res) => {
    return res.json({
      success: true,
      allowed: true,
      subscription: req.usageOverview || null,
    });
  });

  // Payment integration placeholder (redirect target can be wired later)
  app.post("/api/subscription/checkout", verifyToken, async (req, res) => {
    try {
      const requestedPlan = String(req.body?.plan || "pro").trim().toLowerCase();
      const plan = ["pro", "business"].includes(requestedPlan) ? requestedPlan : "pro";
      const next = String(req.body?.next || "/settings").trim() || "/settings";
      return res.json({
        success: true,
        provider: "pending",
        plan,
        checkoutUrl: `/settings?checkout=pending&plan=${encodeURIComponent(plan)}&next=${encodeURIComponent(next)}`,
      });
    } catch {
      return res.status(500).json({ error: "subscription_checkout_failed" });
    }
  });

  // Webhook placeholder (signature verification to be added with real PSP)
  app.post("/api/subscription/webhook", async (req, res) => {
    return res.status(202).json({ success: true, status: "pending_integration" });
  });

  // ── CS Chatbot (Settings > Customer Support) ──
  app.post("/api/cs-chat", verifyToken, async (req, res) => {
    try {
      if (!openai) {
        return res.status(503).json({ error: "openai_api_key_missing" });
      }
      const message = String(req.body?.message || "").trim();
      const language = normalizeLangCode(
        String(req.body?.language || "ko").trim() || "ko"
      );
      const history = normalizeHistory(req.body?.history);

      if (!message) {
        return res.status(400).json({ error: "message_required" });
      }
      if (message.length > 4000) {
        return res.status(400).json({ error: "message_too_long" });
      }

      const completion = await openai.chat.completions.create({
        model: process.env.CS_CHAT_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: "system", content: buildCsSystemPrompt(language) },
          ...history,
          { role: "user", content: message },
        ],
      });

      const reply = String(
        completion?.choices?.[0]?.message?.content || ""
      ).trim();
      if (!reply) {
        return res.status(502).json({ error: "empty_cs_reply" });
      }
      return res.json({ reply });
    } catch (e) {
      return res.status(500).json({
        error: "cs_chat_failed",
        detail: e?.message || "unknown_error",
      });
    }
  });

  // GET /api/hospital/patient-by-room/:roomId/history — room_id로 환자 찾아 해당 환자 세션들의 메시지 최근 30건
  app.get("/api/hospital/patient-by-room/:roomId/history", async (req, res) => {
    try {
      const roomId = String(req.params.roomId || "").trim();
      if (!roomId) return res.json({ success: true, messages: [] });
      const patient = await get(
        "SELECT patient_token FROM hospital_patients WHERE room_id = ? ORDER BY created_at DESC LIMIT 1",
        [roomId]
      );
      if (!patient?.patient_token) return res.json({ success: true, messages: [] });
      const rows = await all(
        "SELECT id, session_id, room_id, sender_role, sender_lang, original_text, translated_text, translated_lang, created_at FROM hospital_messages WHERE session_id IN (SELECT id FROM hospital_sessions WHERE patient_token = ?) ORDER BY created_at ASC LIMIT 30",
        [patient.patient_token]
      );
      return res.json({ success: true, messages: rows || [] });
    } catch (e) {
      console.error("[hospital:patient-by-room:history]", e?.message);
      return res.status(500).json({ error: "history_lookup_failed" });
    }
  });

  // ── Account deletion ──
  app.delete("/api/auth/account", verifyToken, async (req, res) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) return res.status(401).json({ error: "unauthorized" });

      // Delete user's friends
      await run("DELETE FROM friends WHERE user_id = ? OR friend_id = ?", [userId, userId]);
      // Delete user's push subscriptions
      await run("DELETE FROM push_subscriptions WHERE user_id = ?", [userId]);
      // Delete hospital sessions (if any)
      try {
        await run("DELETE FROM hospital_messages WHERE hospital_session_id IN (SELECT id FROM hospital_sessions WHERE room_id IN (SELECT room_id FROM hospital_sessions WHERE id IN (SELECT id FROM hospital_sessions)))", []);
      } catch {}
      // Delete user record
      await run("DELETE FROM users WHERE id = ?", [userId]);

      // Clear auth cookie
      res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });

      return res.json({ success: true });
    } catch (e) {
      console.error("[AUTH] delete account error:", e?.message);
      return res.status(500).json({ error: "account_delete_failed" });
    }
  });
};

module.exports.verifyToken = verifyToken;
module.exports.requireHospitalOrg = requireHospitalOrg;
module.exports.requireHospitalDashboardAdmin = requireHospitalDashboardAdmin;
module.exports.optionalHospitalOrg = optionalHospitalOrg;
