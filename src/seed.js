// 初始化数据：默认账号
const db = require('./db');
const { hashPassword } = require('./auth');

function seed() {
  const data = db.data;
  if (data.users.length > 0) return;

  const now = new Date().toISOString();
  const defaults = [
    { name: 'manager', realName: '王店长', role: 'manager', password: 'manager123' },
    { name: 'inspector', realName: '李质检', role: 'inspector', password: 'inspector123' },
    { name: 'supervisor', realName: '张主管', role: 'supervisor', password: 'super123' }
  ];
  for (const u of defaults) {
    const { password, ...rest } = u;
    db.insertUser(
      Object.assign(
        {
          id: undefined,
          active: true,
          createdAt: now
        },
        rest,
        { id: require('crypto').randomUUID(), passwordHash: hashPassword(password) }
      )
    );
  }
  db.saveSync();
  // eslint-disable-next-line no-console
  console.log('已创建默认账号：');
  console.log('  店长     manager / manager123');
  console.log('  质检员   inspector / inspector123');
  console.log('  客房主管 supervisor / super123');
}

module.exports = seed;
