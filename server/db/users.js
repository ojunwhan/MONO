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

const OAUTH_ID_COLUMNS = {
  google: "google_id",
  kakao: "kakao_id",
  line: "line_id",
  apple: "apple_id",
};

async function findUserByEmail(email = "") {
  const v = String(email || "").trim().toLowerCase();
  if (!v) return null;
  return get("SELECT * FROM users WHERE email = ? LIMIT 1", [v]);
}

async function findUserByProviderId(provider, providerUserId) {
  const col = OAUTH_ID_COLUMNS[provider];
  if (!col) return null;
  const v = String(providerUserId || "").trim();
  if (!v) return null;
  return get(`SELECT * FROM users WHERE ${col} = ? LIMIT 1`, [v]);
}

async function upsertUserFromOAuth({
  provider = "google",
  providerUserId = "",
  email = "",
  nickname = "",
  avatarUrl = "",
  nativeLanguage = "en",
}) {
  const p = String(provider || "").trim().toLowerCase();
  const providerCol = OAUTH_ID_COLUMNS[p];
  if (!providerCol) throw new Error("unsupported_provider");
  const pid = String(providerUserId || "").trim();
  if (!pid) throw new Error("provider_user_id_required");

  const userId = `${p}:${pid}`;
  const resolvedNickname = normalizeNickname(nickname, "MONO User");
  const resolvedLang = normalizeLangCode(nativeLanguage);
  const resolvedEmail = String(email || "").trim().toLowerCase() || null;
  const resolvedAvatar = String(avatarUrl || "").trim() || null;
  const byProvider = await findUserByProviderId(p, pid);
  const byEmail = resolvedEmail ? await findUserByEmail(resolvedEmail) : null;
  const existing = byProvider || byEmail || (await findUserById(userId));

  if (existing) {
    const mergeFields = {
      google_id: existing.google_id || null,
      kakao_id: existing.kakao_id || null,
      line_id: existing.line_id || null,
      apple_id: existing.apple_id || null,
    };
    mergeFields[providerCol] = pid;
    await run(
      `
      UPDATE users
      SET email = COALESCE(?, email),
          nickname = ?,
          avatar_url = ?,
          native_language = COALESCE(native_language, ?),
          google_id = COALESCE(?, google_id),
          kakao_id = COALESCE(?, kakao_id),
          line_id = COALESCE(?, line_id),
          apple_id = COALESCE(?, apple_id)
      WHERE id = ?
      `,
      [
        resolvedEmail,
        resolvedNickname,
        resolvedAvatar,
        resolvedLang,
        mergeFields.google_id,
        mergeFields.kakao_id,
        mergeFields.line_id,
        mergeFields.apple_id,
        existing.id,
      ]
    );
    return findUserById(existing.id);
  }

  const monoSeed = normalizeMonoId(resolvedNickname.replace(/\s+/g, "_")) || "mono";
  const monoId = await ensureUniqueMonoId(monoSeed);
  const providerValues = {
    google_id: null,
    kakao_id: null,
    line_id: null,
    apple_id: null,
  };
  providerValues[providerCol] = pid;

  await run(
    `
    INSERT INTO users (
      id, email, nickname, mono_id, avatar_url, native_language, status_message,
      google_id, kakao_id, line_id, apple_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      resolvedEmail,
      resolvedNickname,
      monoId,
      resolvedAvatar,
      resolvedLang,
      "",
      providerValues.google_id,
      providerValues.kakao_id,
      providerValues.line_id,
      providerValues.apple_id,
    ]
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

  const nextAccountType =
    patch.accountType == null
      ? (current.account_type || "personal")
      : String(patch.accountType).trim().toLowerCase() === "organization"
        ? "organization"
        : "personal";
  const nextOrgName =
    patch.orgName == null
      ? (current.org_name || null)
      : String(patch.orgName || "").trim().slice(0, 120) || null;
  const nextBusinessNumber =
    patch.businessNumber == null
      ? (current.business_number || null)
      : String(patch.businessNumber || "").trim().replace(/\s/g, "").slice(0, 20) || null;
  const nextContactName =
    patch.contactName == null
      ? (current.contact_name || null)
      : String(patch.contactName || "").trim().slice(0, 60) || null;

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
        status_message = ?,
        account_type = ?,
        org_name = ?,
        business_number = ?,
        contact_name = ?
    WHERE id = ?
    `,
    [nextNickname, nextMonoId, nextAvatar, nextLang, nextPhone || null, nextStatus, nextAccountType, nextOrgName, nextBusinessNumber, nextContactName, targetId]
  );

  return findUserById(targetId);
}

module.exports = {
  findUserById,
  findUserByEmail,
  upsertUserFromOAuth,
  updateUserProfile,
  normalizeLangCode,
};

