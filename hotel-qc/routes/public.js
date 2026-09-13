/** 扫码整改(免登录):凭 token 查看房间问题并上传整改图 */
const express = require('express');
const db = require('../db');
const { upload, removePhotoFile, tokenStatus } = require('./helpers');

const router = express.Router();

function checkToken(req, res) {
  const t = db.get('SELECT * FROM tokens WHERE token = ?', [req.params.token]);
  if (!t) { res.status(404).json({ error: '二维码无效,请联系店长重新获取' }); return null; }
  const st = tokenStatus(t);
  if (st === 'disabled') { res.status(403).json({ error: '该二维码已被停用,请联系店长' }); return null; }
  if (st === 'expired') { res.status(403).json({ error: '该二维码已过期,请联系店长重新生成' }); return null; }
  return t;
}

// 查看房间待整改问题
router.get('/t/:token', (req, res) => {
  const t = checkToken(req, res);
  if (!t) return;
  const room = db.get('SELECT * FROM rooms WHERE id = ?', [t.room_id]);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const issues = db.all(`
    SELECT i.id, i.item, i.deduction, i.photo, i.status, i.created_at,
      (SELECT photo FROM rectifications rc WHERE rc.issue_id = i.id ORDER BY rc.id DESC LIMIT 1) AS rect_photo,
      (SELECT created_at FROM rectifications rc WHERE rc.issue_id = i.id ORDER BY rc.id DESC LIMIT 1) AS rect_at
    FROM issues i WHERE i.room_id = ? ORDER BY i.status DESC, i.id`, [room.id]);
  res.json({
    room: { id: room.id, room_number: room.room_number, floor: room.floor },
    issues,
    pending: issues.filter(i => i.status === 'pending').length,
    total: issues.length,
  });
});

// 上传整改图
router.post('/t/:token/rectify', upload.single('photo'), (req, res) => {
  const t = checkToken(req, res);
  if (!t) { if (req.file) removePhotoFile('uploads/' + req.file.filename); return; }
  const issue = db.get('SELECT * FROM issues WHERE id = ?', [req.body.issue_id]);
  if (!issue || issue.room_id !== t.room_id) {
    if (req.file) removePhotoFile('uploads/' + req.file.filename);
    return res.status(404).json({ error: '问题不存在或不属于本房间' });
  }
  if (issue.status === 'rectified') {
    if (req.file) removePhotoFile('uploads/' + req.file.filename);
    return res.status(409).json({ error: '该问题已整改,请刷新查看' });
  }
  if (!req.file) return res.status(400).json({ error: '请上传整改照片' });
  db.tx(() => {
    db.run('INSERT INTO rectifications(issue_id, photo, note, token_id) VALUES (?,?,?,?)',
      [issue.id, 'uploads/' + req.file.filename, String(req.body.note || '').trim(), t.id]);
    db.run("UPDATE issues SET status = 'rectified' WHERE id = ?", [issue.id]);
  });
  res.json({ ok: true });
});

module.exports = router;
