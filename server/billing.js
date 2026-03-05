const { get, run } = require("./db/sqlite");
const { v4: uuidv4 } = require("uuid");

const DEFAULT_FREE_LIMIT = 1000;

function currentMonthKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getFreeMonthlyLimit() {
  const raw = Number(process.env.FREE_TRANSLATION_MONTHLY_LIMIT || DEFAULT_FREE_LIMIT);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_FREE_LIMIT;
  return Math.floor(raw);
}

function normalizePlan(plan = "") {
  const p = String(plan || "").trim().toLowerCase();
  if (p === "pro" || p === "business") return p;
  return "free";
}

async function ensureUserPlanRow(userId) {
  if (!userId) return { plan: "free", plan_expires_at: null };
  const row = await get("SELECT id, plan, plan_expires_at FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!row) return { plan: "free", plan_expires_at: null };
  if (!row.plan) {
    await run("UPDATE users SET plan = 'free' WHERE id = ?", [userId]);
    return { plan: "free", plan_expires_at: row.plan_expires_at || null };
  }
  return { plan: normalizePlan(row.plan), plan_expires_at: row.plan_expires_at || null };
}

async function getUsageRow(userId, month = currentMonthKey()) {
  if (!userId) return null;
  return get(
    "SELECT user_id, month, count, updated_at FROM translation_usage WHERE user_id = ? AND month = ? LIMIT 1",
    [userId, month]
  );
}

async function getUserBillingOverview(userId) {
  const month = currentMonthKey();
  const { plan, plan_expires_at } = await ensureUserPlanRow(userId);
  const usage = await getUsageRow(userId, month);
  const used = Number(usage?.count || 0);
  const limit = plan === "free" ? getFreeMonthlyLimit() : null;
  const remaining = limit == null ? null : Math.max(0, limit - used);
  return {
    userId,
    month,
    plan,
    planExpiresAt: plan_expires_at || null,
    used,
    limit,
    remaining,
    overLimit: limit != null && used >= limit,
  };
}

async function bumpTranslationUsage(userId, countDelta = 1) {
  if (!userId) return null;
  // Skip billing for guest/temporary IDs that are not in the users table
  const userExists = await get("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!userExists) return null;
  const month = currentMonthKey();
  const delta = Number.isFinite(Number(countDelta)) ? Math.max(0, Math.floor(Number(countDelta))) : 1;
  if (delta <= 0) return getUsageRow(userId, month);
  await run(
    `
    INSERT INTO translation_usage (id, user_id, month, count, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, month)
    DO UPDATE SET count = count + excluded.count, updated_at = datetime('now')
    `,
    [uuidv4(), userId, month, delta]
  );
  return getUsageRow(userId, month);
}

async function checkUsageLimit(userId) {
  const overview = await getUserBillingOverview(userId);
  if (overview.plan === "free" && overview.limit != null && overview.used >= overview.limit) {
    return {
      allowed: false,
      reason: "translation_limit_exceeded",
      overview,
    };
  }
  return { allowed: true, reason: "ok", overview };
}

module.exports = {
  currentMonthKey,
  getFreeMonthlyLimit,
  getUserBillingOverview,
  bumpTranslationUsage,
  checkUsageLimit,
};

