# 🏨 酒店客房质检整改系统

质检员上传客房问题照片、问题项与扣分 → 系统生成整改二维码 → 客房主管扫码免登录上传整改照片 → 店长按房间查看「问题图 ↔ 整改图」图片对并统计完成率。

## 功能特性

| 角色 | 能力 |
|---|---|
| **质检员** inspector | 批量上传问题照片、录入多个问题项及扣分、获取整改二维码、驳回不合格整改、查看汇总 |
| **客房主管** supervisor | 查看问题汇总；扫码后**免登录**上传整改照片（手机端页面） |
| **店长** manager | 全部权限、按房间/楼层/质检员查看图片对、**完成率统计**、员工管理、**Token 停用** |

- 📷 **批量上传**：一次提交房间号 + 多个问题项（各带扣分，自动合计）+ 多张照片（最多 12 张，单张 ≤10MB，带上传进度）
- 🔳 **整改二维码**：每条问题生成随机凭证链接（`/rect.html?t=...`），主管扫码即可上传，无需账号；**驳回重改后旧二维码立即失效换新**，整改完成后链接自动锁定
- 🔑 **Token 停用**：JWT + 服务端会话双校验；支持停用单个 Token、一键停用某员工全部 Token（停用员工自动连带）、员工管理自己的其他设备
- 👥 **员工列表**：新增/编辑/启用停用/删除员工，三种角色，密码 scrypt 加盐哈希
- 📊 **完成率统计**：总体完成率、累计扣分，按房间 / 质检员 / 楼层维度分组（进度条 + 明细表）
- 🛡️ 纯 Node.js 实现 JWT（HS256）与密码哈希，无数据库依赖（JSON 文件持久化），零外部 CDN

## 快速开始

```bash
npm install
npm start
# 打开 http://localhost:3000
```

首次启动自动创建演示账号（可在 `src/seed.js` 中修改）：

| 角色 | 账号 | 密码 |
|---|---|---|
| 店长 | `manager` | `manager123` |
| 质检员 | `inspector` | `inspector123` |
| 客房主管 | `supervisor` | `super123` |

环境变量：`PORT`（默认 3000）、`PUBLIC_URL`（二维码链接的对外地址，如 `https://hotel.example.com`，默认按请求自动推导）。

## 使用流程

1. 质检员登录 → **质检上报**：填房间号/楼层，添加问题项与扣分，多选问题照片 → 提交
2. 在弹出的二维码窗口中**下载/发送整改二维码**给客房主管（也可在「问题汇总」里随时查看）
3. 主管手机微信/浏览器扫码 → 查看问题项与问题照片 → 拍照多选上传整改照片
4. 店长在 **问题汇总** 按房间核对整改前后图片对（点击图片可放大、左右切换）
5. 整改不合格 → 质检员点「驳回重改」，清空整改图并生成新二维码
6. **完成率统计**页查看全店及各房间/楼层/质检员的完成率与扣分

## 技术栈

- 后端：Node.js + Express，multer（图片上传），qrcode（二维码），内置 crypto（scrypt 密码哈希、HS256 JWT）
- 存储：`data/db.json`（数据）、`data/secret.key`（JWT 密钥，自动生成）、`uploads/`（图片，随机不可猜文件名）
- 前端：原生 HTML/CSS/JS（无构建、无 CDN），localStorage 存 token，Bearer 头鉴权

## 目录结构

```
server.js              入口与全部 API
src/db.js              JSON 持久化 + 数据访问
src/auth.js            密码哈希 / JWT 签发校验 / 会话
src/seed.js            默认账号初始化
public/
  login.html           登录
  app.html + js/       内部工作台（统计/上报/汇总/员工/Token）
  rect.html + js/      扫码整改页（公开）
uploads/               上传图片
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录获取 token |
| GET/POST/PATCH/DELETE | `/api/users` | 员工管理（店长） |
| GET/DELETE | `/api/sessions[/:jti]` | 会话/Token 列表与停用 |
| POST | `/api/issues` | 批量上传问题（multipart：room/items/photos） |
| GET | `/api/issues` | 问题列表（room/status/inspectorId 筛选） |
| POST | `/api/issues/:id/reopen` | 驳回重改（二维码换新） |
| GET | `/api/issues/:id/qr.png` | 整改二维码图片 |
| GET | `/api/rect/:token` | 扫码查看问题（公开） |
| POST | `/api/rect/:token/upload` | 上传整改照片（公开） |
| GET | `/api/stats/summary` | 完成率统计 |
