// 酒店客房质检整改系统 - 后端服务
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');

const db = require('./src/db');
const {
  hashPassword,
  verifyPassword,
  issueSession,
  authenticate,
  TOKEN_TTL
} = require('./src/auth');
const seed = require('./src/seed');

seed();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '1mb' }));

// ---------- 文件上传 ----------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  }
});

// ---------- 工具 ----------
function baseUrl(req) {
  return process.env.PUBLIC_URL || req.protocol + '://' + req.get('host');
}
function fileMeta(f) {
  return { file: f.filename, name: f.originalname, size: f.size };
}
function safeUser(u) {
  return { id: u.id, name: u.name, realName: u.realName, role: u.role, active: u.active, createdAt: u.createdAt };
}
function rectUrl(req, token) {
  return baseUrl(req) + '/rect.html?t=' + token;
}
function issueView(i, req, includeToken) {
  return {
    id: i.id,
    seq: i.seq,
    room: i.room,
    floor: i.floor || '',
    items: i.items,
    totalDeduction: i.items.reduce((s, x) => s + (Number(x.deduction) || 0), 0),
    photos: i.photos,
    inspectorId: i.inspectorId,
    inspectorName: i.inspectorName,
    createdAt: i.createdAt,
    status: i.status,
    rectPhotos: i.rectPhotos || [],
    rectAt: i.rectAt || null,
    supervisorName: i.supervisorName || null,
    reopenedCount: i.reopenedCount || 0,
    rectUrl: includeToken ? rectUrl(req, i.rectToken) : null
  };
}

// 鉴权中间件
function auth(roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const r = authenticate(token);
    if (!r.ok) {
      const msg =
        r.reason === 'revoked' ? '登录凭证已被停用，请重新登录'
        : r.reason === 'disabled' ? '账号已停用'
        : '未登录或登录已过期';
      return res.status(401).json({ error: msg, code: r.reason });
    }
    if (roles && !roles.includes(r.user.role)) {
      return res.status(403).json({ error: '没有操作权限' });
    }
    req.user = r.user;
    req.jti = r.jti;
    next();
  };
}

// ================= 认证 =================
app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: '请输入账号和密码' });
  const user = db.findUserByName(String(name).trim());
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  if (!user.active) return res.status(403).json({ error: '账号已停用，请联系店长' });
  const ua = req.headers['user-agent'] || '';
  const token = issueSession(user, { ip: req.ip, device: ua });
  res.json({ token, user: safeUser(user), expiresIn: TOKEN_TTL });
});

app.get('/api/auth/me', auth(), (req, res) => {
  res.json({ user: safeUser(req.user) });
});

app.post('/api/auth/logout', auth(), (req, res) => {
  db.revokeSession(req.jti);
  res.json({ ok: true });
});

app.post('/api/auth/logout-others', auth(), (req, res) => {
  db.revokeUserSessions(req.user.id, req.jti);
  res.json({ ok: true });
});

// ================= 员工管理（店长） =================
app.get('/api/users', auth(), (req, res) => {
  // 主管/质检员可查看员工名单（用于选择、展示），但仅店长可写
  res.json(db.users().map(safeUser));
});

app.post('/api/users', auth(['manager']), (req, res) => {
  const { name, realName, role, password } = req.body || {};
  if (!name || !/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
    return res.status(400).json({ error: '登录账号需为 3-20 位字母/数字/下划线' });
  }
  if (!['manager', 'inspector', 'supervisor'].includes(role)) {
    return res.status(400).json({ error: '角色无效' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  if (db.findUserByName(name)) return res.status(409).json({ error: '账号已存在' });
  const user = {
    id: crypto.randomUUID(),
    name,
    realName: realName ? String(realName).slice(0, 30) : name,
    role,
    passwordHash: hashPassword(String(password)),
    active: true,
    createdAt: new Date().toISOString()
  };
  db.insertUser(user);
  res.json(safeUser(user));
});

app.patch('/api/users/:id', auth(['manager']), (req, res) => {
  const user = db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '员工不存在' });
  const patch = {};
  const { realName, role, active, password } = req.body || {};
  if (realName !== undefined) patch.realName = String(realName).slice(0, 30);
  if (role !== undefined) {
    if (!['manager', 'inspector', 'supervisor'].includes(role)) {
      return res.status(400).json({ error: '角色无效' });
    }
    patch.role = role;
  }
  if (active !== undefined) patch.active = !!active;
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    patch.passwordHash = hashPassword(String(password));
  }
  db.updateUser(user.id, patch);
  // 停用员工时，同时停用其全部登录 token
  if (patch.active === false) db.revokeUserSessions(user.id);
  res.json(safeUser(db.findUserById(user.id)));
});

app.delete('/api/users/:id', auth(['manager']), (req, res) => {
  const user = db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '员工不存在' });
  if (user.id === req.user.id) return res.status(400).json({ error: '不能删除当前登录账号' });
  db.deleteUser(user.id);
  db.revokeUserSessions(user.id);
  res.json({ ok: true });
});

// ================= Token / 会话管理 =================
app.get('/api/sessions', auth(), (req, res) => {
  let list = db.sessions();
  if (req.user.role !== 'manager') list = list.filter((s) => s.userId === req.user.id);
  else if (req.query.userId) list = list.filter((s) => s.userId === req.query.userId);
  const users = Object.fromEntries(db.users().map((u) => [u.id, u]));
  const now = Date.now();
  res.json(
    list
      .map((s) => ({
        jti: s.jti,
        userId: s.userId,
        userName: users[s.userId] ? users[s.userId].name : '(已删除)',
        realName: users[s.userId] ? users[s.userId].realName : '',
        role: users[s.userId] ? users[s.userId].role : '',
        device: s.device || '',
        ip: s.ip || '',
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revoked: s.revoked || new Date(s.expiresAt).getTime() < now
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );
});

app.delete('/api/sessions/:jti', auth(), (req, res) => {
  const s = db.findSession(req.params.jti);
  if (!s) return res.status(404).json({ error: '会话不存在' });
  if (req.user.role !== 'manager' && s.userId !== req.user.id) {
    return res.status(403).json({ error: '没有操作权限' });
  }
  db.revokeSession(s.jti);
  res.json({ ok: true });
});

// 店长一键停用某员工的全部 token
app.post('/api/sessions/revoke-user/:userId', auth(['manager']), (req, res) => {
  db.revokeUserSessions(req.params.userId);
  res.json({ ok: true });
});

// ================= 质检问题 =================
function parseItems(body) {
  let items = body.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (e) {
      items = null;
    }
  }
  if (!Array.isArray(items)) return null;
  return items
    .map((it) => ({
      desc: String(it.desc || '').trim(),
      deduction: Number(it.deduction)
    }))
    .filter((it) => it.desc && !Number.isNaN(it.deduction) && it.deduction >= 0);
}

// 批量上传：一次提交房间号 + 多个问题项（各带扣分）+ 多张问题照片
app.post('/api/issues', auth(['inspector', 'manager']), upload.array('photos', 12), (req, res) => {
  const room = String((req.body && req.body.room) || '').trim();
  if (!room) return res.status(400).json({ error: '请填写房间号' });
  const items = parseItems(req.body || {});
  if (!items || items.length === 0) return res.status(400).json({ error: '请至少填写一个有效的问题项及扣分' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请至少上传一张问题照片' });

  const issue = {
    id: crypto.randomUUID(),
    seq: 0,
    room,
    floor: String((req.body && req.body.floor) || '').trim(),
    items,
    photos: req.files.map(fileMeta),
    inspectorId: req.user.id,
    inspectorName: req.user.realName || req.user.name,
    createdAt: new Date().toISOString(),
    status: 'open',
    rectToken: crypto.randomBytes(16).toString('hex'),
    rectPhotos: [],
    rectAt: null,
    supervisorName: null,
    reopenedCount: 0
  };
  db.insertIssue(issue);
  res.json(issueView(db.findIssue(issue.id), req, true));
});

app.get('/api/issues', auth(), (req, res) => {
  const { room, status, inspectorId } = req.query;
  let list = db.issues();
  if (room) list = list.filter((i) => i.room.includes(String(room)));
  if (status) list = list.filter((i) => i.status === status);
  if (inspectorId) list = list.filter((i) => i.inspectorId === inspectorId);
  const staff = req.user.role !== 'supervisor'; // 员工侧可看到整改链接
  res.json(
    list
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((i) => issueView(i, req, staff))
  );
});

app.get('/api/issues/:id', auth(), (req, res) => {
  const i = db.findIssue(req.params.id);
  if (!i) return res.status(404).json({ error: '问题不存在' });
  res.json(issueView(i, req, req.user.role !== 'supervisor'));
});

// 重新打开（整改不合格），二维码链接自动换新
app.post('/api/issues/:id/reopen', auth(['inspector', 'manager']), (req, res) => {
  const i = db.findIssue(req.params.id);
  if (!i) return res.status(404).json({ error: '问题不存在' });
  db.updateIssue(i.id, {
    status: 'open',
    rectToken: crypto.randomBytes(16).toString('hex'),
    rectPhotos: [],
    rectAt: null,
    supervisorName: null,
    reopenedCount: (i.reopenedCount || 0) + 1
  });
  res.json(issueView(db.findIssue(i.id), req, true));
});

app.delete('/api/issues/:id', auth(['manager']), (req, res) => {
  const i = db.findIssue(req.params.id);
  if (!i) return res.status(404).json({ error: '问题不存在' });
  db.data.issues = db.data.issues.filter((x) => x.id !== i.id);
  db.save();
  res.json({ ok: true });
});

// 二维码图片（登录后可访问，直接打印贴在任务单/发给主管）
app.get('/api/issues/:id/qr.png', auth(['inspector', 'manager']), (req, res) => {
  const i = db.findIssue(req.params.id);
  if (!i) return res.status(404).send('not found');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  QRCode.toFileStream(res, rectUrl(req, i.rectToken), { width: 360, margin: 1 });
});

// ================= 主管扫码整改（免登录，凭一次性链接） =================
app.get('/api/rect/:token', (req, res) => {
  const i = db.issues().find((x) => x.rectToken === req.params.token);
  if (!i) return res.status(404).json({ error: '链接无效或已失效，请联系质检员重新生成二维码' });
  res.json({
    seq: i.seq,
    room: i.room,
    floor: i.floor || '',
    items: i.items,
    photos: i.photos,
    inspectorName: i.inspectorName,
    createdAt: i.createdAt,
    status: i.status,
    rectPhotos: i.rectPhotos || [],
    rectAt: i.rectAt || null,
    supervisorName: i.supervisorName || null,
    reopenedCount: i.reopenedCount || 0
  });
});

app.post('/api/rect/:token/upload', upload.array('photos', 12), (req, res) => {
  const i = db.issues().find((x) => x.rectToken === req.params.token);
  if (!i) return res.status(404).json({ error: '链接无效或已失效，请联系质检员重新生成二维码' });
  if (i.status === 'done') return res.status(409).json({ error: '该问题已完成整改，如需重新上传请联系质检员驳回' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请至少上传一张整改照片' });

  const supervisorName = String((req.body && req.body.supervisorName) || '').trim().slice(0, 30) || '客房主管';
  db.updateIssue(i.id, {
    status: 'done',
    rectPhotos: req.files.map(fileMeta),
    rectAt: new Date().toISOString(),
    supervisorName
  });
  res.json({ ok: true });
});

// ================= 统计（完成率） =================
app.get('/api/stats/summary', auth(['manager', 'inspector', 'supervisor']), (req, res) => {
  const issues = db.issues();
  const total = issues.length;
  const done = issues.filter((i) => i.status === 'done').length;
  const open = total - done;
  const totalDeduction = issues.reduce(
    (s, i) => s + i.items.reduce((a, x) => a + (Number(x.deduction) || 0), 0),
    0
  );

  const groupMap = (keyFn) => {
    const m = new Map();
    for (const i of issues) {
      const k = keyFn(i);
      if (!m.has(k)) m.set(k, { name: k, total: 0, done: 0, deduction: 0 });
      const g = m.get(k);
      g.total += 1;
      if (i.status === 'done') g.done += 1;
      g.deduction += i.items.reduce((a, x) => a + (Number(x.deduction) || 0), 0);
    }
    return [...m.values()]
      .map((g) => ({ ...g, rate: g.total ? Math.round((g.done / g.total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.total - a.total);
  };

  res.json({
    total,
    open,
    done,
    completionRate: total ? Math.round((done / total) * 1000) / 10 : 0,
    totalDeduction,
    byRoom: groupMap((i) => i.room),
    byInspector: groupMap((i) => i.inspectorName),
    byFloor: groupMap((i) => i.floor || '未填写')
  });
});

// ---------- 静态资源 ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));

// ---------- 错误处理 ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 10MB' : err.code === 'LIMIT_FILE_COUNT' ? '最多上传 12 张图片' : '上传失败：' + err.message;
    return res.status(400).json({ error: msg });
  }
  if (err) return res.status(400).json({ error: err.message || '请求错误' });
  next();
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log('酒店客房质检整改系统已启动: http://localhost:' + PORT);
});
