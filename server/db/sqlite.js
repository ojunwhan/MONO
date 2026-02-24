const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_FILE_PATH =
  process.env.MONO_DB_PATH ||
  path.join(__dirname, "..", "..", "state", "mono_phase1.sqlite");

let dbInstance = null;

function ensureDbDir() {
  const dir = path.dirname(DB_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function connectSqlite() {
  if (dbInstance) return dbInstance;
  ensureDbDir();
  dbInstance = new sqlite3.Database(DB_FILE_PATH);
  dbInstance.serialize(() => {
    dbInstance.run("PRAGMA foreign_keys = ON;");
    dbInstance.run("PRAGMA journal_mode = WAL;");
  });
  return dbInstance;
}

function run(sql, params = []) {
  const db = connectSqlite();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  const db = connectSqlite();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  const db = connectSqlite();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function exec(sql) {
  const db = connectSqlite();
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function withTransaction(task) {
  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    const result = await task();
    await run("COMMIT");
    return result;
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

function closeSqlite() {
  if (!dbInstance) return Promise.resolve();
  return new Promise((resolve, reject) => {
    dbInstance.close((err) => {
      if (err) return reject(err);
      dbInstance = null;
      resolve();
    });
  });
}

module.exports = {
  DB_FILE_PATH,
  connectSqlite,
  run,
  get,
  all,
  exec,
  withTransaction,
  closeSqlite,
};

