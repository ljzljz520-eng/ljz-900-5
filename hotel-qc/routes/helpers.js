/** 共享工具:认证中间件 / 密码哈希 / 上传配置 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const ROLE_NAMES = { inspector: '质检员', supervisor: '客房主管', manager: '店长', admin: '管理员' };

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

/** 登录校验:Authorization: Bearer <token>,可按角色限制 */
function requireAuth(...roles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const sess = token && db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!sess) return res.status(401).json({ error: '未登录或会话已失效' });
    const emp = db.get('SELECT id,name,role,phone,active,created_at FROM employees WHERE id = ?', [sess.employee_id]);
    if (!emp || !emp.active) return res.status(401).json({ error: '账号不存在或已停用' });
    if (roles.length && !roles.includes(emp.role)) {
      return res.status(403).json({ error: `无权限,需要${roles.map(r => ROLE_NAMES[r]).join('/')}角色` });
    }
    req.employee = emp;
    next();
  };
}

/** 可选登录(不强制) */
function optionalAuth(req, _res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    const sess = db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    if (sess) req.employee = db.get('SELECT id,name,role,phone FROM employees WHERE id = ? AND active = 1', [sess.employee_id]);
  }
  next();
}

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/svg+xml': '.svg' };
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${MIME_EXT[file.mimetype] || '.jpg'}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('仅支持图片文件(jpg/png/webp/gif)'));
  },
});

function removePhotoFile(photoPath) {
  if (!photoPath) return;
  const p = path.join(__dirname, '..', photoPath);
  fs.unlink(p, () => {});
}

function tokenStatus(t) {
  if (t.disabled) return 'disabled';
  if (t.expires_at && t.expires_at < now()) return 'expired';
  return 'active';
}
function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = { requireAuth, optionalAuth, hashPassword, upload, removePhotoFile, ROLE_NAMES, tokenStatus, now };
