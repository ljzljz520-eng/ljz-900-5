# 酒店客房质检整改系统

质检员上传客房问题照片/问题项/扣分 → 客房主管扫码上传整改图 → 店长汇总查看每间房的"问题图 vs 整改图"图片对，并统计整改完成率。

## 快速开始

```bash
npm install
npm start          # 或 node server.js
# 打开 http://localhost:3000
```

演示账号（密码均为 `123456`）：

| 账号 | 角色 | 权限 |
|---|---|---|
| `admin` | 店长 | 统计看板、图片对汇总、员工管理、整改令牌停用 |
| `zhijian` / `zhijian2` | 质检员 | 新建质检（批量上传问题照片）、生成整改二维码 |
| `zhuguan` / `zhuguan2` | 客房主管 | 查看待整改任务（实际整改通过扫码页面完成，免登录） |

首次启动自动生成演示数据（含 SVG 占位照片）。删除 `data.sqlite` 与 `public/uploads/*` 可重置。

## 业务流程

1. **质检员**：新建质检记录（房号 + 问题项 + 扣分 + 描述），支持一次**批量上传**多张问题照片；在记录上点击「整改二维码」生成二维码。
2. **客房主管**：用手机扫码（或打开链接 `rectify.html?t=令牌`）进入免登录整改页，查看问题详情与照片，**批量上传**整改照片后记录自动标记为「已整改」。
3. **店长**：
   - 「图片对汇总」按房间筛选，左右对照查看问题图与整改图；
   - 「统计看板」查看整体/分房间/分质检员/分问题项的**整改完成率**与扣分；
   - 「员工管理」新增员工、**停用/启用账号**、重置密码；
   - 「整改令牌」**停用/启用**二维码令牌——停用后扫码链接立即失效（HTTP 410）。

## 技术栈

- 后端：Node.js + Express + sql.js（WASM SQLite，数据持久化到 `data.sqlite`）+ multer（批量上传）+ qrcode（二维码生成）
- 前端：原生 HTML/CSS/JS 单页应用，移动端优先（拍照上传 `capture="environment"`）
- 照片存储：`public/uploads/`

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | 登录（停用账号拒绝登录） |
| GET/POST | `/api/users` · PUT `/api/users/:id` | 员工列表 / 新增 / 停用·改密（店长） |
| GET/POST | `/api/inspections` · GET `/api/inspections/:id` | 质检记录（质检员仅见自己的） |
| POST | `/api/inspections/:id/photos` | 批量补充问题照片 |
| POST | `/api/inspections/:id/token` | 生成整改令牌 + 二维码 |
| GET | `/api/tokens` · PUT `/api/tokens/:id/toggle` | 令牌列表 / 停用启用（店长） |
| GET/POST | `/api/rectify/:token` | 免登录整改页数据 / 批量上传整改图 |
| GET | `/api/stats` | 完成率统计（整体/房间/质检员/问题项） |

## 环境变量

- `PORT`：服务端口（默认 3000）
- `BASE_URL`：二维码链接前缀（外网/反向代理部署时设置，如 `https://qc.example.com`）
