#!/usr/bin/env node
/**
 * Self-contained test: checks that recent hospital_sessions have at least one
 * sender_role = 'host' message in hospital_messages.
 * Run: node test_hospital_messages.js
 */
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = path.join(__dirname, "state", "mono_phase1.sqlite");

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function main() {
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error("DB open error:", err.message);
      process.exit(1);
    }
  });

  try {
    const sessions = await run(
      db,
      `SELECT room_id, started_at FROM hospital_sessions ORDER BY COALESCE(started_at, created_at) DESC LIMIT 3`
    );

    if (!sessions.length) {
      console.log("No hospital_sessions found.");
      db.close();
      process.exit(0);
    }

    let anyPass = false;
    for (const s of sessions) {
      console.log(`\n--- Session room_id=${s.room_id} started_at=${s.started_at} ---`);
      const messages = await run(
        db,
        `SELECT sender_role, original_text FROM hospital_messages WHERE room_id = ? ORDER BY created_at ASC`,
        [s.room_id]
      );

      for (const m of messages) {
        console.log(`  [${m.sender_role}] ${(m.original_text || "").slice(0, 60)}`);
      }

      const hasHost = messages.some((m) => m.sender_role === "host");
      if (hasHost) {
        console.log(`  => PASS (host messages found)`);
        anyPass = true;
      } else {
        console.log(`  => FAIL (only guest messages or none)`);
      }
    }

    console.log(anyPass ? "\nPASS" : "\nFAIL");
    process.exit(anyPass ? 0 : 1);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
