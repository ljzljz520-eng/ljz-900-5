/** 管理接口:员工列表 / 房间 / 整改二维码 token(含停用) */
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, hashPassword, removePhotoFile, ROLE_NAMES, tokenStatus, now } = require('./helpers');

const router = express.Router();

/* ================= 员工管理 ================= */

// 员工列表(店长/管理员)
router.get('/employees', requireAuth('manager', 'admin'), (req, res) => {
  const { role } = req.query;
  let sql = `SELECT id,name,role,phone,active,created_at,
    (SELECT COUNT(*) FROM issues WHERE inspector_id = employees.id) AS issue_count
    FROM employees`;
  const params = [];
  if (role) { sql += ' WHERE role = ?'; params.push(role); }
  sql += ' ORDER BY active DESC, id';
  const rows = db.all(sql, params).map(e => ({ ...e, role_name: ROLE_NAMES[e.role] }));
  res.json({ employees: rows });
});

// 新增员工(管理员)
router.post('/employees', requireAuth('admin'), (req, res) => {
  const { name, role, phone, password } = req.body || {};
  if (!name || !role || !phone) return res.status(400).json({ error: '姓名、角色、手机号必填' });
  if (!ROLE_NAMES[role]) return res.status(400).json({ error: '角色无效' });
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (db.get('SELECT id FROM employees WHERE phone = ?', [phone])) return res.status(409).json({ error: '该手机号已存在' });
  const pwd = password || '123456';
  if (String(pwd).length < 6) return res.status(400).json({ error: '密码至少6位' });
  const id = db.run('INSERT INTO employees(name,role,phone,password) VALUES (?,?,?,?)',
    [name.trim(), role, phone, hashPassword(pwd)]);
  res.json({ id, ok: true });
});

// 编辑员工(管理员):改名/角色/手机/重置密码/停用启用
router.put('/employees/:id', requireAuth('admin'), (req, res) => {
  const emp = db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  const { name, role, phone, active, password } = req.body || {};
  if (role && !ROLE_NAMES[role]) return res.status(400).json({ error: '角色无效' });
  if (phone && phone !== emp.phone && db.get('SELECT id FROM employees WHERE phone = ?', [phone])) {
    return res.status(409).json({ error: '该手机号已被占用' });
  }
  if (emp.id === req.employee.id && active === 0) return res.status(400).json({ error: '不能停用自己的账号' });
  db.run(`UPDATE employees SET name=?, role=?, phone=?, active=?, password=? WHERE id=?`, [
    name ?? emp.name, role ?? emp.role, phone ?? emp.phone,
    active === undefined ? emp.active : (active ? 1 : 0),
    password ? hashPassword(password) : emp.password, emp.id,
  ]);
  if (active === 0) db.run('DELETE FROM sessions WHERE employee_id = ?', [emp.id]); // 停用即踢下线
  res.json({ ok: true });
});

// 删除员工(管理员)
router.delete('/employees/:id', requireAuth('admin'), (req, res) => {
  const emp = db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  if (emp.id === req.employee.id) return res.status(400).json({ error: '不能删除自己的账号' });
  db.run('DELETE FROM sessions WHERE employee_id = ?', [emp.id]);
  db.run('UPDATE issues SET inspector_id = NULL WHERE inspector_id = ?', [emp.id]);
  db.run('DELETE FROM employees WHERE id = ?', [emp.id]);
  res.json({ ok: true });
});

/* ================= 房间管理 ================= */

router.get('/rooms', requireAuth(), (req, res) => {
  const rows = db.all(`
    SELECT r.*, 
      (SELECT COUNT(*) FROM issues i WHERE i.room_id = r.id) AS issue_count,
      (SELECT COUNT(*) FROM issues i WHERE i.room_id = r.id AND i.status = 'pending') AS pending_count
    FROM rooms r ORDER BY r.floor, r.room_number`);
  res.json({ rooms: rows });
});

router.post('/rooms', requireAuth('admin'), (req, res) => {
  const { room_number, floor } = req.body || {};
  if (!room_number) return res.status(400).json({ error: '房号必填' });
  if (db.get('SELECT id FROM rooms WHERE room_number = ?', [room_number])) return res.status(409).json({ error: '房号已存在' });
  const id = db.run('INSERT INTO rooms(room_number, floor) VALUES (?,?)', [String(room_number).trim(), String(floor || '').trim()]);
  res.json({ id, ok: true });
});

// 批量生成房间:某楼层 + 起止号,如 3楼 01~08 → 301..308
router.post('/rooms/batch', requireAuth('admin'), (req, res) => {
  const { floor, from, to } = req.body || {};
  const f = parseInt(floor, 10), a = parseInt(from, 10), b = parseInt(to, 10);
  if (!f || isNaN(a) || isNaN(b) || a > b || b - a > 100) return res.status(400).json({ error: '参数不正确(楼层/起止号)' });
  const created = [], skipped = [];
  db.tx(() => {
    for (let i = a; i <= b; i++) {
      const num = `${f}${String(i).padStart(2, '0')}`;
      if (db.get('SELECT id FROM rooms WHERE room_number = ?', [num])) { skipped.push(num); continue; }
      db.run('INSERT INTO rooms(room_number, floor) VALUES (?,?)', [num, `${f}F`]);
      created.push(num);
    }
  });
  res.json({ created, skipped });
});

router.delete('/rooms/:id', requireAuth('admin'), (req, res) => {
  const room = db.get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const photos = db.all(`SELECT photo FROM issues WHERE room_id = ? UNION ALL
    SELECT r.photo FROM rectifications r JOIN issues i ON r.issue_id = i.id WHERE i.room_id = ?`, [room.id, room.id]);
  db.tx(() => {
    db.run('DELETE FROM rectifications WHERE issue_id IN (SELECT id FROM issues WHERE room_id = ?)', [room.id]);
    db.run('DELETE FROM issues WHERE room_id = ?', [room.id]);
    db.run('DELETE FROM tokens WHERE room_id = ?', [room.id]);
    db.run('DELETE FROM rooms WHERE id = ?', [room.id]);
  });
  photos.forEach(p => removePhotoFile(p.photo));
  res.json({ ok: true });
});

/* ================= 整改二维码 Token ================= */

function tokenUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/rectify.html?token=${token}`;
}

router.get('/tokens', requireAuth('manager', 'admin'), (req, res) => {
  const rows = db.all(`
    SELECT t.*, r.room_number, r.floor,
      (SELECT COUNT(*) FROM issues i WHERE i.room_id = t.room_id AND i.status='pending') AS pending_count
    FROM tokens t JOIN rooms r ON r.id = t.room_id ORDER BY t.id DESC`);
  res.json({
    tokens: rows.map(t => ({
      ...t, status: tokenStatus(t), url: tokenUrl(req, t.token),
      created_by_name: (db.get('SELECT name FROM employees WHERE id = ?', [t.created_by]) || {}).name || '-',
    })),
  });
});

async function createToken(req, roomId, expiresHours) {
  const token = crypto.randomBytes(16).toString('hex');
  let expiresAt = null;
  if (expiresHours && Number(expiresHours) > 0) {
    expiresAt = new Date(Date.now() + Number(expiresHours) * 3600 * 1000)
      .toLocaleString('sv-SE').replace('T', ' ');
  }
  const id = db.run('INSERT INTO tokens(token, room_id, expires_at, created_by) VALUES (?,?,?,?)',
    [token, roomId, expiresAt, req.employee.id]);
  const url = tokenUrl(req, token);
  const qr = await QRCode.toDataURL(url, { width: 320, margin: 1 });
  return { id, token, url, qr, expires_at: expiresAt };
}

router.post('/tokens', requireAuth('manager', 'admin'), async (req, res) => {
  const { room_id, expires_hours } = req.body || {};
  const room = db.get('SELECT * FROM rooms WHERE id = ?', [room_id]);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const t = await createToken(req, room.id, expires_hours);
  res.json({ ...t, room_number: room.room_number });
});

// 批量生成(每房一个码)
router.post('/tokens/batch', requireAuth('manager', 'admin'), async (req, res) => {
  const { room_ids, expires_hours } = req.body || {};
  if (!Array.isArray(room_ids) || !room_ids.length) return res.status(400).json({ error: '请选择房间' });
  const out = [];
  for (const rid of room_ids) {
    const room = db.get('SELECT * FROM rooms WHERE id = ?', [rid]);
    if (!room) continue;
    out.push({ room_number: room.room_number, ...(await createToken(req, room.id, expires_hours)) });
  }
  res.json({ tokens: out });
});

// 停用 / 启用 token
router.post('/tokens/:id/disable', requireAuth('manager', 'admin'), (req, res) => {
  const t = db.get('SELECT * FROM tokens WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: '二维码不存在' });
  db.run('UPDATE tokens SET disabled = 1 WHERE id = ?', [t.id]);
  res.json({ ok: true, status: 'disabled' });
});
router.post('/tokens/:id/enable', requireAuth('manager', 'admin'), (req, res) => {
  const t = db.get('SELECT * FROM tokens WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: '二维码不存在' });
  db.run('UPDATE tokens SET disabled = 0 WHERE id = ?', [t.id]);
  res.json({ ok: true, status: tokenStatus({ ...t, disabled: 0 }) });
});
router.delete('/tokens/:id', requireAuth('manager', 'admin'), (req, res) => {
  db.run('DELETE FROM tokens WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
