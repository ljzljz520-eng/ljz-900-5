/** 质检问题:批量上传 / 查询 / 删除 / 整改(登录态) */
const express = require('express');
const db = require('../db');
const { requireAuth, upload, removePhotoFile } = require('./helpers');

const router = express.Router();

const ISSUE_SQL = `
  SELECT i.*, r.room_number, r.floor, e.name AS inspector_name,
    (SELECT photo FROM rectifications rc WHERE rc.issue_id = i.id ORDER BY rc.id DESC LIMIT 1) AS rect_photo,
    (SELECT note  FROM rectifications rc WHERE rc.issue_id = i.id ORDER BY rc.id DESC LIMIT 1) AS rect_note,
    (SELECT created_at FROM rectifications rc WHERE rc.issue_id = i.id ORDER BY rc.id DESC LIMIT 1) AS rect_at
  FROM issues i
  JOIN rooms r ON r.id = i.room_id
  LEFT JOIN employees e ON e.id = i.inspector_id`;

// 批量上传:一个房间 + 多条问题(每条含照片/问题项/扣分)
router.post('/issues/batch', requireAuth('inspector', 'admin', 'manager'), upload.array('photos', 30), (req, res) => {
  try {
    const roomId = parseInt(req.body.room_id, 10);
    const room = db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(400).json({ error: '房间不存在' });
    let items;
    try { items = JSON.parse(req.body.items || '[]'); } catch { return res.status(400).json({ error: '问题数据格式错误' }); }
    const files = req.files || [];
    if (!items.length) return res.status(400).json({ error: '请至少添加一条问题' });
    if (items.length !== files.length) {
      files.forEach(f => removePhotoFile('uploads/' + f.filename));
      return res.status(400).json({ error: `问题条数(${items.length})与照片数量(${files.length})不一致` });
    }
    for (const it of items) {
      if (!it.item || !String(it.item).trim()) {
        files.forEach(f => removePhotoFile('uploads/' + f.filename));
        return res.status(400).json({ error: '每条问题都必须填写问题项' });
      }
    }
    const ids = db.tx(() => items.map((it, idx) =>
      db.run('INSERT INTO issues(room_id, inspector_id, item, deduction, photo) VALUES (?,?,?,?,?)',
        [room.id, req.employee.id, String(it.item).trim(), Math.max(0, Number(it.deduction) || 0), 'uploads/' + files[idx].filename])
    ));
    res.json({ ok: true, count: ids.length, ids, room: room.room_number });
  } catch (e) {
    (req.files || []).forEach(f => removePhotoFile('uploads/' + f.filename));
    throw e;
  }
});

// 问题列表(可按房间/状态/楼层/只看我的 过滤)
router.get('/issues', requireAuth(), (req, res) => {
  const conds = [], params = [];
  if (req.query.room_id) { conds.push('i.room_id = ?'); params.push(req.query.room_id); }
  if (req.query.status) { conds.push('i.status = ?'); params.push(req.query.status); }
  if (req.query.floor) { conds.push('r.floor = ?'); params.push(req.query.floor); }
  if (req.query.mine === '1') { conds.push('i.inspector_id = ?'); params.push(req.employee.id); }
  const sql = ISSUE_SQL + (conds.length ? ' WHERE ' + conds.join(' AND ') : '') + ' ORDER BY i.id DESC LIMIT 500';
  res.json({ issues: db.all(sql, params) });
});

// 删除问题(管理员/店长,或质检员本人未整改的)
router.delete('/issues/:id', requireAuth('inspector', 'manager', 'admin'), (req, res) => {
  const issue = db.get('SELECT * FROM issues WHERE id = ?', [req.params.id]);
  if (!issue) return res.status(404).json({ error: '问题不存在' });
  const isOwner = issue.inspector_id === req.employee.id && issue.status === 'pending';
  if (!['manager', 'admin'].includes(req.employee.role) && !isOwner) {
    return res.status(403).json({ error: '只能删除本人上报且未整改的问题' });
  }
  const rects = db.all('SELECT photo FROM rectifications WHERE issue_id = ?', [issue.id]);
  db.tx(() => {
    db.run('DELETE FROM rectifications WHERE issue_id = ?', [issue.id]);
    db.run('DELETE FROM issues WHERE id = ?', [issue.id]);
  });
  removePhotoFile(issue.photo);
  rects.forEach(r => removePhotoFile(r.photo));
  res.json({ ok: true });
});

// 登录态整改上传(客房主管/店长/管理员)
router.post('/issues/:id/rectify', requireAuth('supervisor', 'manager', 'admin'), upload.single('photo'), (req, res) => {
  const issue = db.get('SELECT * FROM issues WHERE id = ?', [req.params.id]);
  if (!issue) { if (req.file) removePhotoFile('uploads/' + req.file.filename); return res.status(404).json({ error: '问题不存在' }); }
  if (issue.status === 'rectified') { if (req.file) removePhotoFile('uploads/' + req.file.filename); return res.status(409).json({ error: '该问题已整改' }); }
  if (!req.file) return res.status(400).json({ error: '请上传整改照片' });
  db.tx(() => {
    db.run('INSERT INTO rectifications(issue_id, photo, note, operator_id) VALUES (?,?,?,?)',
      [issue.id, 'uploads/' + req.file.filename, String(req.body.note || '').trim(), req.employee.id]);
    db.run("UPDATE issues SET status = 'rectified' WHERE id = ?", [issue.id]);
  });
  res.json({ ok: true });
});

module.exports = router;
