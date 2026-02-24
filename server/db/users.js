const { get, run } = require("./sqlite");

function normalizeLangCode(lang = "") {
  const raw = String(lang || "").trim().toLowerCase();
  if (!raw) return "en";
  return raw.split("-")[0] || "en";
}

function normalizeMonoId(value = "") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return cleaned.slice(0, 30);
}

function normalizeNickname(value = "", fallback = "MONO User") {
  const out = String(value || "").trim();
  return out.slice(0, 40) || fallback;
}

function normalizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").trim().slice(0, 24);
}

async function monoIdExists(monoId, exceptUserId = null) {
  if (!monoId) return false;
  if (exceptUserId) {
    const row = await get(
      "SELECT id FROM users WHERE mono_id = ? AND id <> ? LIMIT 1",
      [monoId, exceptUserId]
    );
    return !!row;
  }
  const row = await get("SELECT id FROM users WHERE mono_id = ? LIMIT 1", [monoId]);
  return !!row;
}

async function ensureUniqueMonoId(seed, exceptUserId = null) {
  const base = normalizeMonoId(seed) || "mono";
  for (let i = 0; i < 20; i += 1) {
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const candidate = normalizeMonoId(`${base}_${suffix}`);
    // eslint-disable-next-line no-await-in-loop
    const exists = await monoIdExists(candidate, exceptUserId);
    if (!exists) return candidate;
  }
  return normalizeMonoId(`mono_${Date.now().toString(36)}`);
}

async function findUserById(id) {
  if (!id) return null;
  return get("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
}

async function upsertUserFromOAuth({
  id,
  email = "",
  nickname = "",
  avatarUrl = "",
  nativeLanguage = "en",
}) {
  const userId = String(id || "").trim();
  if (!userId) throw new Error("user_id_required");

  const existing = await findUserById(userId);
  const resolvedNickname = normalizeNickname(nickname, "MONO User");
  const resolvedLang = normalizeLangCode(nativeLanguage);
  const resolvedEmail = String(email || "").trim().toLowerCase() || null;
  const resolvedAvatar = String(avatarUrl || "").trim() || null;

  if (existing) {
    await run(
      `
      UPDATE users
      SET email = COALESCE(?, email),
          nickname = ?,
          avatar_url = ?,
          native_language = COALESCE(native_language, ?)
      WHERE id = ?
      `,
      [resolvedEmail, resolvedNickname, resolvedAvatar, resolvedLang, userId]
    );
    return findUserById(userId);
  }

  const monoSeed = normalizeMonoId(resolvedNickname.replace(/\s+/g, "_")) || "mono";
  const monoId = await ensureUniqueMonoId(monoSeed);

  await run(
    `
    INSERT INTO users (id, email, nickname, mono_id, avatar_url, native_language, status_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [userId, resolvedEmail, resolvedNickname, monoId, resolvedAvatar, resolvedLang, ""]
  );
  return findUserById(userId);
}

async function updateUserProfile(userId, patch) {
  const targetId = String(userId || "").trim();
  if (!targetId) throw new Error("user_id_required");

  const current = await findUserById(targetId);
  if (!current) throw new Error("user_not_found");

  const nextNickname =
    patch.nickname == null
      ? current.nickname
      : normalizeNickname(patch.nickname, current.nickname || "MONO User");
  const nextLang =
    patch.nativeLanguage == null
      ? current.native_language
      : normalizeLangCode(patch.nativeLanguage);
  const nextStatus =
    patch.statusMessage == null
      ? current.status_message || ""
      : String(patch.statusMessage).trim().slice(0, 160);
  const nextAvatar =
    patch.avatarUrl == null
      ? current.avatar_url
      : String(patch.avatarUrl || "").trim() || null;
  const nextPhone =
    patch.phoneNumber == null
      ? current.phone_number || ""
      : normalizePhoneNumber(patch.phoneNumber);

  let nextMonoId = current.mono_id;
  if (patch.monoId != null) {
    const requested = normalizeMonoId(patch.monoId);
    if (!requested || requested.length < 3) {
      throw new Error("invalid_mono_id");
    }
    const exists = await monoIdExists(requested, targetId);
    if (exists) throw new Error("mono_id_taken");
    nextMonoId = requested;
  }

  await run(
    `
    UPDATE users
    SET nickname = ?,
        mono_id = ?,
        avatar_url = ?,
        native_language = ?,
        phone_number = ?,
        status_message = ?
    WHERE id = ?
    `,
    [nextNickname, nextMonoId, nextAvatar, nextLang, nextPhone || null, nextStatus, targetId]
  );

  return findUserById(targetId);
}

module.exports = {
  findUserById,
  upsertUserFromOAuth,
  updateUserProfile,
  normalizeLangCode,
};

