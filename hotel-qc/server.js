/**
 * 酒店客房质检整改系统 - 后端服务
 * 角色: inspector 质检员 / supervisor 客房主管 / manager 店长
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || ''; // 外网部署时可指定二维码链接前缀
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- 会话 ---------------- */
const sessions = new Map(); // token -> user

function auth(req, res, next) {
  const t = req.headers['x-auth-token'];
  const s = t && sessions.get(t);
  if (!s) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = s;
  next();
}
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: '没有权限执行此操作' });
  next();
};

/* ---------------- 文件上传 ---------------- */
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext || '.jpg'}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('只允许上传图片文件'));
  }
});
// 包装 multer，统一 JSON 错误
const uploadPhotos = (req, res, next) =>
  upload.array('photos', 30)(req, res, (err) =>
    err ? res.status(400).json({ error: '上传失败：' + err.message }) : next());

function removeFile(filename) {
  const p = path.join(UPLOAD_DIR, path.basename(filename));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/* ---------------- 认证 ---------------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.get('SELECT * FROM users WHERE username = ?', [String(username || '').trim()]);
  if (!u || u.password !== db.hash(String(password || '')))
    return res.status(401).json({ error: '用户名或密码错误' });
  if (!u.active) return res.status(403).json({ error: '该账号已被停用，请联系店长' });
  const token = crypto.randomBytes(24).toString('hex');
  const user = { id: u.id, username: u.username, name: u.name, role: u.role };
  sessions.set(token, user);
  res.json({ token, user });
});

app.post('/api/logout', auth, (req, res) => {
  sessions.delete(req.headers['x-auth-token']);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

/* ---------------- 员工管理（店长） ---------------- */
app.get('/api/users', auth, requireRole('manager'), (req, res) => {
  const users = db.all(`
    SELECT u.id, u.username, u.name, u.role, u.active, u.created_at,
      (SELECT COUNT(*) FROM inspections i WHERE i.inspector_id = u.id) AS inspection_count
    FROM users u ORDER BY u.id`);
  res.json({ users });
});

app.post('/api/users', auth, requireRole('manager'), (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !['inspector', 'supervisor', 'manager'].includes(role))
    return res.status(400).json({ error: '请完整填写用户名、密码、姓名和角色' });
  if (db.get('SELECT id FROM users WHERE username = ?', [username.trim()]))
    return res.status(409).json({ error: '用户名已存在' });
  const r = db.run('INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)',
    [username.trim(), db.hash(password), name.trim(), role]);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/users/:id', auth, requireRole('manager'), (req, res) => {
  const u = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: '员工不存在' });
  const { name, role, active, password } = req.body || {};
  if (u.id === req.user.id && active === 0) return res.status(400).json({ error: '不能停用自己的账号' });
  if (name !== undefined) db.run('UPDATE users SET name = ? WHERE id = ?', [String(name).trim(), u.id]);
  if (role && ['inspector', 'supervisor', 'manager'].includes(role))
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, u.id]);
  if (active !== undefined) db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, u.id]);
  if (password) db.run('UPDATE users SET password = ? WHERE id = ?', [db.hash(password), u.id]);
  res.json({ ok: true });
});

/* ---------------- 质检记录 ---------------- */
function attachPhotos(rows) {
  for (const r of rows) {
    const photos = db.all('SELECT id, type, filename, created_at FROM photos WHERE inspection_id = ? ORDER BY id', [r.id]);
    r.problem_photos = photos.filter(p => p.type === 'problem');
    r.rectification_photos = photos.filter(p => p.type === 'rectification');
  }
  return rows;
}

app.get('/api/inspections', auth, (req, res) => {
  const conds = [], params = [];
  if (req.user.role === 'inspector') { conds.push('i.inspector_id = ?'); params.push(req.user.id); }
  if (req.query.room) { conds.push('i.room_number LIKE ?'); params.push(`%${req.query.room}%`); }
  if (req.query.status) { conds.push('i.status = ?'); params.push(req.query.status); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.all(`
    SELECT i.*, u.name AS inspector_name,
      (SELECT t.token FROM tokens t WHERE t.inspection_id = i.id AND t.active = 1 ORDER BY t.id DESC LIMIT 1) AS active_token
    FROM inspections i JOIN users u ON u.id = i.inspector_id
    ${where} ORDER BY i.id DESC LIMIT 500`, params);
  res.json({ inspections: attachPhotos(rows) });
});

app.post('/api/inspections', auth, requireRole('inspector', 'manager'), uploadPhotos, (req, res) => {
  const { room_number, problem_item, deduction, description } = req.body || {};
  if (!room_number || !problem_item)
    return res.status(400).json({ error: '请填写房号和问题项' });
  const ded = parseFloat(deduction);
  if (isNaN(ded) || ded < 0) return res.status(400).json({ error: '扣分必须是非负数字' });
  const r = db.run(
    'INSERT INTO inspections (room_number, inspector_id, problem_item, deduction, description) VALUES (?,?,?,?,?)',
    [room_number.trim(), req.user.id, problem_item.trim(), ded, String(description || '').trim()]);
  const inspId = r.lastInsertRowid;
  for (const f of req.files || []) {
    db.run('INSERT INTO photos (inspection_id, type, filename, uploaded_by) VALUES (?,?,?,?)',
      [inspId, 'problem', f.filename, req.user.id]);
  }
  res.json({ id: inspId, photo_count: (req.files || []).length });
});

app.get('/api/inspections/:id', auth, (req, res) => {
  const row = db.get(`
    SELECT i.*, u.name AS inspector_name FROM inspections i
    JOIN users u ON u.id = i.inspector_id WHERE i.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json({ inspection: attachPhotos([row])[0] });
});

// 批量补充问题照片
app.post('/api/inspections/:id/photos', auth, requireRole('inspector', 'manager'), uploadPhotos, (req, res) => {
  const insp = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!insp) return res.status(404).json({ error: '记录不存在' });
  if (!req.files || !req.files.length) return res.status(400).json({ error: '请选择照片' });
  for (const f of req.files) {
    db.run('INSERT INTO photos (inspection_id, type, filename, uploaded_by) VALUES (?,?,?,?)',
      [insp.id, 'problem', f.filename, req.user.id]);
  }
  res.json({ ok: true, added: req.files.length });
});

app.delete('/api/photos/:id', auth, requireRole('inspector', 'manager'), (req, res) => {
  const p = db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: '照片不存在' });
  db.run('DELETE FROM photos WHERE id = ?', [p.id]);
  removeFile(p.filename);
  res.json({ ok: true });
});

/* ---------------- 整改令牌 / 二维码 ---------------- */
app.post('/api/inspections/:id/token', auth, requireRole('inspector', 'manager'), async (req, res) => {
  const insp = db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!insp) return res.status(404).json({ error: '记录不存在' });
  let t = db.get('SELECT * FROM tokens WHERE inspection_id = ? AND active = 1 ORDER BY id DESC', [insp.id]);
  if (!t) {
    const token = crypto.randomBytes(12).toString('hex');
    db.run('INSERT INTO tokens (token, inspection_id, room_number, created_by) VALUES (?,?,?,?)',
      [token, insp.id, insp.room_number, req.user.id]);
    t = db.get('SELECT * FROM tokens WHERE token = ?', [token]);
  }
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/rectify.html?t=${t.token}`;
  const qr = await QRCode.toDataURL(url, { width: 360, margin: 2 });
  res.json({ token: t.token, url, qr });
});

app.get('/api/tokens', auth, requireRole('manager'), (req, res) => {
  const rows = db.all(`
    SELECT t.*, i.problem_item, i.status AS inspection_status, u.name AS creator_name
    FROM tokens t
    JOIN inspections i ON i.id = t.inspection_id
    LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.id DESC LIMIT 300`);
  res.json({ tokens: rows });
});

// 停用 / 启用令牌
app.put('/api/tokens/:id/toggle', auth, requireRole('manager'), (req, res) => {
  const t = db.get('SELECT * FROM tokens WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: '令牌不存在' });
  db.run('UPDATE tokens SET active = ? WHERE id = ?', [t.active ? 0 : 1, t.id]);
  res.json({ ok: true, active: t.active ? 0 : 1 });
});

/* ---------------- 整改页（免登录，凭 token） ---------------- */
function validToken(tokenStr) {
  const t = db.get('SELECT * FROM tokens WHERE token = ?', [String(tokenStr || '')]);
  if (!t) return { error: '链接无效', status: 404 };
  if (!t.active) return { error: '该整改链接已被店长停用', status: 410 };
  return { token: t };
}

app.get('/api/rectify/:token', (req, res) => {
  const { token, error, status } = validToken(req.params.token);
  if (error) return res.status(status).json({ error });
  const insp = db.get(`
    SELECT i.*, u.name AS inspector_name FROM inspections i
    JOIN users u ON u.id = i.inspector_id WHERE i.id = ?`, [token.inspection_id]);
  res.json({ inspection: attachPhotos([insp])[0] });
});

// 主管批量上传整改照片
app.post('/api/rectify/:token', uploadPhotos, (req, res) => {
  const { token, error, status } = validToken(req.params.token);
  if (error) {
    for (const f of req.files || []) removeFile(f.filename);
    return res.status(status).json({ error });
  }
  if (!req.files || !req.files.length) return res.status(400).json({ error: '请至少上传一张整改照片' });
  const insp = db.get('SELECT * FROM inspections WHERE id = ?', [token.inspection_id]);
  if (!insp) return res.status(404).json({ error: '记录不存在' });
  for (const f of req.files) {
    db.run('INSERT INTO photos (inspection_id, type, filename, uploaded_by) VALUES (?,?,?,?)',
      [insp.id, 'rectification', f.filename, null]);
  }
  db.run("UPDATE inspections SET status = 'rectified', rectified_at = datetime('now','localtime') WHERE id = ?", [insp.id]);
  res.json({ ok: true, added: req.files.length });
});

/* ---------------- 完成率统计 ---------------- */
app.get('/api/stats', auth, (req, res) => {
  const overall = db.get(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status='rectified' THEN 1 ELSE 0 END),0) AS rectified,
      COALESCE(SUM(deduction),0) AS deductions
    FROM inspections`);
  overall.pending = overall.total - overall.rectified;
  overall.rate = overall.total ? +(overall.rectified * 100 / overall.total).toFixed(1) : 0;

  const byRoom = db.all(`
    SELECT room_number, COUNT(*) AS total,
      SUM(CASE WHEN status='rectified' THEN 1 ELSE 0 END) AS rectified,
      ROUND(100.0 * SUM(CASE WHEN status='rectified' THEN 1 ELSE 0 END) / COUNT(*), 1) AS rate,
      SUM(deduction) AS deductions,
      MAX(created_at) AS last_at
    FROM inspections GROUP BY room_number ORDER BY room_number`);

  const byInspector = db.all(`
    SELECT u.name, COUNT(*) AS total,
      SUM(CASE WHEN i.status='rectified' THEN 1 ELSE 0 END) AS rectified,
      SUM(i.deduction) AS deductions
    FROM inspections i JOIN users u ON u.id = i.inspector_id
    GROUP BY i.inspector_id ORDER BY total DESC`);

  const byItem = db.all(`
    SELECT problem_item, COUNT(*) AS count, SUM(deduction) AS deductions,
      SUM(CASE WHEN status='rectified' THEN 1 ELSE 0 END) AS rectified
    FROM inspections GROUP BY problem_item ORDER BY count DESC`);

  const recent7 = db.all(`
    SELECT date(created_at) AS day, COUNT(*) AS total,
      SUM(CASE WHEN status='rectified' THEN 1 ELSE 0 END) AS rectified
    FROM inspections WHERE created_at >= datetime('now','-7 day')
    GROUP BY date(created_at) ORDER BY day`);

  res.json({ overall, byRoom, byInspector, byItem, recent7 });
});

/* ---------------- 演示数据 ---------------- */
function seedDemo() {
  if (db.get('SELECT COUNT(*) c FROM inspections').c > 0) return;
  const svg = (label, bg) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
      <rect width="100%" height="100%" fill="${bg}"/>
      <rect x="20" y="20" width="760" height="560" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="4"/>
      <text x="50%" y="50%" font-size="52" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text>
    </svg>`);
  const saveSvg = (label, bg) => {
    const fn = `demo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.svg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fn), svg(label, bg));
    return fn;
  };
  const zhijian = db.get("SELECT id FROM users WHERE username='zhijian'");
  const zhijian2 = db.get("SELECT id FROM users WHERE username='zhijian2'");
  const demo = [
    ['301', zhijian.id, '卫生间清洁', 5, '马桶内侧有污渍，地面有水渍', 'pending', [['马桶污渍', '#c0392b'], ['地面积水', '#d35400']], []],
    ['302', zhijian.id, '床铺整理', 3, '床单有褶皱，枕套未更换', 'rectified', [['床单褶皱', '#8e44ad']], [['已更换床品', '#27ae60']]],
    ['305', zhijian2.id, '设施损坏', 10, '床头灯不亮，需工程部维修', 'pending', [['床头灯损坏', '#2c3e50']], []],
    ['301', zhijian2.id, '物品缺失', 2, '缺少两瓶矿泉水', 'rectified', [['迷你吧空缺', '#16a085']], [['已补齐矿泉水', '#2980b9']]],
    ['303', zhijian.id, '地面卫生', 4, '地毯有头发和碎屑', 'rectified', [['地毯碎屑', '#7f8c8d']], [['已吸尘清洁', '#27ae60']]],
  ];
  for (const [room, uid, item, ded, desc, status, probs, rects] of demo) {
    const r = db.run('INSERT INTO inspections (room_number, inspector_id, problem_item, deduction, description, status, rectified_at) VALUES (?,?,?,?,?,?,?)',
      [room, uid, item, ded, desc, status, status === 'rectified' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null]);
    for (const [label, color] of probs)
      db.run('INSERT INTO photos (inspection_id, type, filename, uploaded_by) VALUES (?,?,?,?)', [r.lastInsertRowid, 'problem', saveSvg(label, color), uid]);
    for (const [label, color] of rects)
      db.run('INSERT INTO photos (inspection_id, type, filename, uploaded_by) VALUES (?,?,?,?)', [r.lastInsertRowid, 'rectification', saveSvg(label, color), null]);
  }
  console.log('已生成演示数据');
}

/* ---------------- 启动 ---------------- */
(async () => {
  await db.init();
  seedDemo();
  app.listen(PORT, () => console.log(`酒店客房质检整改系统已启动: http://localhost:${PORT}`));
})();
