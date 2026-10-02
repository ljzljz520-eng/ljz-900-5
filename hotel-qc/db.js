/**
 * 数据库层：sql.js (WASM SQLite) + 文件持久化
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data.sqlite');
let db = null;

const hash = (pw) => crypto.createHash('sha256').update(String(pw)).digest('hex');

function persist() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

async function init() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('inspector','supervisor','manager')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number TEXT NOT NULL,
      inspector_id INTEGER NOT NULL REFERENCES users(id),
      problem_item TEXT NOT NULL,
      deduction REAL NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rectified')),
      rectified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id),
      type TEXT NOT NULL CHECK(type IN ('problem','rectification')),
      filename TEXT NOT NULL,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id),
      room_number TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_photos_insp ON photos(inspection_id);
    CREATE INDEX IF NOT EXISTS idx_insp_room ON inspections(room_number);
    CREATE INDEX IF NOT EXISTS idx_tokens_insp ON tokens(inspection_id);
  `);

  // 初始员工
  if (get('SELECT COUNT(*) c FROM users').c === 0) {
    const seed = [
      ['admin',     '123456', '张店长',  'manager'],
      ['zhijian',   '123456', '王质检',  'inspector'],
      ['zhijian2',  '123456', '赵质检',  'inspector'],
      ['zhuguan',   '123456', '李主管',  'supervisor'],
      ['zhuguan2',  '123456', '陈主管',  'supervisor'],
    ];
    for (const [u, p, n, r] of seed) {
      db.run('INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)', [u, hash(p), n, r]);
    }
  }
  persist();
}

function run(sql, params = []) {
  db.run(sql, params);
  const r = db.exec('SELECT last_insert_rowid() AS id, changes() AS ch');
  const out = r[0] ? { lastInsertRowid: r[0].values[0][0], changes: r[0].values[0][1] } : { lastInsertRowid: 0, changes: 0 };
  persist();
  return out;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
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

module.exports = { init, run, get, all, hash };
