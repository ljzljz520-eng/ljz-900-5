/** 酒店客房质检整改系统 - 服务入口 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/issues'));
app.use('/api/public', require('./routes/public'));
app.use('/api/stats', require('./routes/stats'));

app.get('/', (_req, res) => res.redirect('/login.html'));

// 统一错误处理(multer 错误等)
app.use((err, _req, res, _next) => {
  console.error(err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '图片超过15MB限制' });
  res.status(err.status || 500).json({ error: err.message || '服务器错误' });
});

const PORT = process.env.PORT || 3000;
db.init().then(() => {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
  app.listen(PORT, () => {
    console.log(`✅ 酒店客房质检整改系统已启动: http://localhost:${PORT}`);
    console.log(`   默认账号见 README(如 13800000001 / 123456)`);
  });
});
