// 认证工具：密码哈希（scrypt）+ JWT（HS256，内置 crypto 实现）
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const SECRET_FILE = path.join(__dirname, '..', 'data', 'secret.key');

function getSecret() {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
  } catch (e) {
    const s = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = getSecret();

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ---------- 密码 ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + dk.toString('hex');
}
function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const dk = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const a = Buffer.from(hashHex, 'hex');
    return a.length === dk.length && crypto.timingSafeEqual(a, dk);
  } catch (e) {
    return false;
  }
}

// ---------- JWT ----------
function signToken(payload, ttlSec) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const full = Object.assign(
    { iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec },
    payload
  );
  const head = b64urlJson(header);
  const body = b64urlJson(full);
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest());
  return head + '.' + body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf-8'));
  } catch (e) {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---------- 会话（可停用的 token）----------
const TOKEN_TTL = 12 * 60 * 60; // 12 小时

function issueSession(user, meta = {}) {
  const jti = crypto.randomUUID();
  const token = signToken({ sub: user.id, jti, role: user.role, name: user.name }, TOKEN_TTL);
  const now = new Date().toISOString();
  db.insertSession({
    jti,
    userId: user.id,
    createdAt: now,
    expiresAt: new Date(Date.now() + TOKEN_TTL * 1000).toISOString(),
    revoked: false,
    device: (meta.device || '').slice(0, 120),
    ip: (meta.ip || '').slice(0, 64)
  });
  return token;
}

// 解析并校验 token：签名有效 + 会话未停用 + 员工在职
function authenticate(token) {
  const payload = verifyToken(token);
  if (!payload) return { ok: false, reason: 'invalid' };
  const session = db.findSession(payload.jti);
  if (!session) return { ok: false, reason: 'invalid' };
  if (session.revoked) return { ok: false, reason: 'revoked' };
  const user = db.findUserById(payload.sub);
  if (!user || !user.active) return { ok: false, reason: 'disabled' };
  return { ok: true, user, jti: payload.jti };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  issueSession,
  authenticate,
  TOKEN_TTL
};
