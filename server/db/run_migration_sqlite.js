const fs = require("fs");
const path = require("path");
const { all, exec, closeSqlite, DB_FILE_PATH } = require("./sqlite");

async function main() {
  const migrationPath = path.join(
    __dirname,
    "migrations",
    "001_phase1_core_sqlite.sql"
  );

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
  }

  // Backfill before running migration SQL:
  // existing DB may have users table without phone_number.
  const userTable = await all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  );
  if (userTable.length > 0) {
    const columns = await all("PRAGMA table_info(users)");
    const hasPhone = columns.some((c) => c?.name === "phone_number");
    const hasPlan = columns.some((c) => c?.name === "plan");
    const hasPlanExpiresAt = columns.some((c) => c?.name === "plan_expires_at");
    const hasGoogleId = columns.some((c) => c?.name === "google_id");
    const hasKakaoId = columns.some((c) => c?.name === "kakao_id");
    const hasLineId = columns.some((c) => c?.name === "line_id");
    const hasAppleId = columns.some((c) => c?.name === "apple_id");
    if (!hasPhone) {
      await exec("ALTER TABLE users ADD COLUMN phone_number TEXT;");
    }
    if (!hasPlan) {
      await exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';");
    }
    if (!hasPlanExpiresAt) {
      await exec("ALTER TABLE users ADD COLUMN plan_expires_at TEXT;");
    }
    if (!hasGoogleId) {
      await exec("ALTER TABLE users ADD COLUMN google_id TEXT;");
    }
    if (!hasKakaoId) {
      await exec("ALTER TABLE users ADD COLUMN kakao_id TEXT;");
    }
    if (!hasLineId) {
      await exec("ALTER TABLE users ADD COLUMN line_id TEXT;");
    }
    if (!hasAppleId) {
      await exec("ALTER TABLE users ADD COLUMN apple_id TEXT;");
    }
  }
  const roomMembersTable = await all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='room_members'"
  );
  if (roomMembersTable.length > 0) {
    const columns = await all("PRAGMA table_info(room_members)");
    const hasLastRead = columns.some((c) => c?.name === "last_read_message_id");
    if (!hasLastRead) {
      await exec("ALTER TABLE room_members ADD COLUMN last_read_message_id TEXT;");
    }
  }

  const sql = fs.readFileSync(migrationPath, "utf8");
  await exec(sql);
  await exec("CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);");
  await exec("CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);");
  await exec("CREATE INDEX IF NOT EXISTS idx_users_kakao_id ON users(kakao_id);");
  await exec("CREATE INDEX IF NOT EXISTS idx_users_line_id ON users(line_id);");
  await exec("CREATE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id);");
  await exec("CREATE INDEX IF NOT EXISTS idx_translation_usage_user_month ON translation_usage(user_id, month);");
  console.log(`[db] SQLite migration applied: ${migrationPath}`);
  console.log(`[db] SQLite file: ${DB_FILE_PATH}`);
}

main()
  .then(async () => {
    await closeSqlite();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[db] SQLite migration failed:", error.message);
    await closeSqlite();
    process.exit(1);
  });

