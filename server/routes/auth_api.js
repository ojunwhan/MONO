const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {
  findUserById,
  updateUserProfile,
  normalizeLangCode,
} = require("../db/users");
const { all, get, run } = require("../db/sqlite");

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
};

