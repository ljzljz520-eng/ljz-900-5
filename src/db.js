// 简单的 JSON 文件持久化存储（无外部数据库依赖）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function defaultData() {
  return {
    counters: { issueSeq: 0 },
    users: [],
    issues: [],
    sessions: []
  };
}

let cache = null;
let writeQueued = false;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    cache = Object.assign(defaultData(), JSON.parse(raw));
  } catch (e) {
    cache = defaultData();
    persist(true);
  }
  return cache;
}

function persist(sync = false) {
  const doWrite = () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, DB_FILE);
    writeQueued = false;
  };
  if (sync) {
    doWrite();
  } else if (!writeQueued) {
    writeQueued = true;
    setImmediate(doWrite);
  }
}

const db = {
  get data() {
    return load();
  },
  save() {
    persist(false);
  },
  saveSync() {
    persist(true);
  },

  // ---------- users ----------
  users: () => load().users,
  findUserById: (id) => load().users.find((u) => u.id === id),
  findUserByName: (name) => load().users.find((u) => u.name === name),
  insertUser(u) {
    load().users.push(u);
    persist(false);
  },
  updateUser(id, patch) {
    const u = load().users.find((x) => x.id === id);
    if (u) Object.assign(u, patch);
    persist(false);
  },
  deleteUser(id) {
    const d = load();
    d.users = d.users.filter((u) => u.id !== id);
    persist(false);
  },

  // ---------- issues ----------
  issues: () => load().issues,
  findIssue: (id) => load().issues.find((i) => i.id === id),
  insertIssue(issue) {
    const d = load();
    d.counters.issueSeq += 1;
    issue.seq = d.counters.issueSeq;
    d.issues.push(issue);
    persist(false);
    return issue;
  },
  updateIssue(id, patch) {
    const i = load().issues.find((x) => x.id === id);
    if (i) Object.assign(i, patch);
    persist(false);
  },

  // ---------- sessions ----------
  sessions: () => load().sessions,
  findSession: (jti) => load().sessions.find((s) => s.jti === jti),
  insertSession(s) {
    load().sessions.push(s);
    persist(false);
  },
  revokeSession(jti) {
    const s = load().sessions.find((x) => x.jti === jti);
    if (s) s.revoked = true;
    persist(false);
  },
  revokeUserSessions(userId, exceptJti = null) {
    for (const s of load().sessions) {
      if (s.userId === userId && !s.revoked && s.jti !== exceptJti) {
        s.revoked = true;
      }
    }
    persist(false);
  }
};

module.exports = db;
