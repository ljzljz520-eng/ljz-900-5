/** 认证:登录 / 当前用户 / 退出 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { hashPassword, requireAuth, ROLE_NAMES } = require('./helpers');

const router = express.Router();

router.post('/login', (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: '请输入手机号和密码' });
  const emp = db.get('SELECT * FROM employees WHERE phone = ?', [String(phone).trim()]);
  if (!emp || emp.password !== hashPassword(password)) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }
  if (!emp.active) return res.status(403).json({ error: '账号已停用,请联系管理员' });
  const token = crypto.randomUUID();
  db.run('INSERT INTO sessions(token, employee_id) VALUES (?,?)', [token, emp.id]);
  res.json({ token, employee: { id: emp.id, name: emp.name, role: emp.role, role_name: ROLE_NAMES[emp.role], phone: emp.phone } });
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({ employee: { ...req.employee, role_name: ROLE_NAMES[req.employee.role] } });
});

router.post('/logout', requireAuth(), (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  db.run('DELETE FROM sessions WHERE token = ?', [token]);
  res.json({ ok: true });
});

module.exports = router;
