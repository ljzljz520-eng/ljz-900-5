/** 完成率统计:总览 / 按房间 / 按楼层 */
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./helpers');

const router = express.Router();
const ROLES = ['manager', 'admin', 'supervisor', 'inspector'];

// 总览
router.get('/overview', requireAuth(...ROLES), (_req, res) => {
  const rooms = db.get('SELECT COUNT(*) AS c FROM rooms').c;
  const iss = db.get(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='rectified'),0) AS rectified,
    COALESCE(SUM(deduction),0) AS deduction_total,
    COALESCE(SUM(CASE WHEN status='pending' THEN deduction ELSE 0 END),0) AS deduction_pending
    FROM issues`);
  const roomsWithIssues = db.get('SELECT COUNT(DISTINCT room_id) AS c FROM issues').c;
  const roomsPending = db.get("SELECT COUNT(DISTINCT room_id) AS c FROM issues WHERE status='pending'").c;
  const today = db.get("SELECT COUNT(*) AS c FROM issues WHERE date(created_at)=date('now','localtime')").c;
  res.json({
    total_rooms: rooms,
    total_issues: iss.total,
    rectified: iss.rectified,
    pending: iss.total - iss.rectified,
    completion_rate: iss.total ? Math.round(iss.rectified / iss.total * 1000) / 10 : 100,
    room_completion_rate: rooms ? Math.round((rooms - roomsPending) / rooms * 1000) / 10 : 100,
    rooms_with_issues: roomsWithIssues,
    rooms_pending: roomsPending,
    deduction_total: Math.round(iss.deduction_total * 10) / 10,
    deduction_pending: Math.round(iss.deduction_pending * 10) / 10,
    today_issues: today,
  });
});

// 按房间统计
router.get('/rooms', requireAuth(...ROLES), (_req, res) => {
  const rows = db.all(`
    SELECT r.id, r.room_number, r.floor,
      COUNT(i.id) AS total,
      COALESCE(SUM(i.status='rectified'),0) AS rectified,
      COALESCE(SUM(i.deduction),0) AS deduction_total,
      COALESCE(SUM(CASE WHEN i.status='pending' THEN i.deduction ELSE 0 END),0) AS deduction_pending,
      MAX(i.created_at) AS last_issue_at
    FROM rooms r LEFT JOIN issues i ON i.room_id = r.id
    GROUP BY r.id ORDER BY r.floor, r.room_number`);
  res.json({
    rooms: rows.map(r => ({
      ...r,
      pending: r.total - r.rectified,
      rate: r.total ? Math.round(r.rectified / r.total * 1000) / 10 : null, // null=无问题
    })),
  });
});

// 按楼层统计
router.get('/floors', requireAuth(...ROLES), (_req, res) => {
  const rows = db.all(`
    SELECT r.floor,
      COUNT(DISTINCT r.id) AS rooms,
      COUNT(i.id) AS total,
      COALESCE(SUM(i.status='rectified'),0) AS rectified,
      COALESCE(SUM(i.deduction),0) AS deduction_total
    FROM rooms r LEFT JOIN issues i ON i.room_id = r.id
    GROUP BY r.floor ORDER BY r.floor`);
  res.json({
    floors: rows.map(f => ({
      ...f,
      pending: f.total - f.rectified,
      rate: f.total ? Math.round(f.rectified / f.total * 1000) / 10 : 100,
    })),
  });
});

module.exports = router;
