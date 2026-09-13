/**
 * 数据库层:sql.js (WASM SQLite) + 文件持久化
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'data.sqlite');
let db = null;
let saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('inspector','supervisor','manager','admin')),
  phone TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_number TEXT UNIQUE NOT NULL,
  floor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  inspector_id INTEGER REFERENCES employees(id),
  item TEXT NOT NULL,
  deduction REAL NOT NULL DEFAULT 0,
  photo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rectified')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_issues_room ON issues(room_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE TABLE IF NOT EXISTS rectifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  photo TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  token_id INTEGER REFERENCES tokens(id),
  operator_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_rect_issue ON rectifications(issue_id);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  disabled INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_room ON tokens(room_id);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

async function init() {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f),
  });
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  SCHEMA.split(';').filter(s => s.trim()).forEach(s => db.run(s));
  persist();
  return module.exports;
}

/** 延迟落盘(防抖) */
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); } catch (e) { console.error('DB保存失败', e); }
  }, 150);
}
function flushSync() {
  clearTimeout(saveTimer);
  if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

function run(sql, params = []) {
  db.run(sql, params);
  persist();
  const r = db.exec('SELECT last_insert_rowid() AS id');
  return r[0].values[0][0];
}
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function tx(fn) {
  db.run('BEGIN');
  try {
    const r = fn();
    db.run('COMMIT');
    persist();
    return r;
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}

module.exports = { init, run, get, all, tx, flushSync, get raw() { return db; } };
