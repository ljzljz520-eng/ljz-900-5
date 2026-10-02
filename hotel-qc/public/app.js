/* ================= 工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PROBLEM_ITEMS = ['床铺整理', '卫生间清洁', '地面卫生', '灰尘污渍', '设施损坏', '物品缺失', '异味问题', '噪音问题', '其他'];
const ROLE_NAMES = { inspector: '质检员', supervisor: '客房主管', manager: '店长' };

const state = {
  token: localStorage.getItem('qc_token') || '',
  user: JSON.parse(localStorage.getItem('qc_user') || 'null'),
  tab: '',
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers['x-auth-token'] = state.token;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(false); throw new Error(data.error || '登录已过期'); }
  if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function closeModal() { $('#modal').classList.add('hidden'); }
function showModal(html) { $('#modal-content').innerHTML = html; $('#modal').classList.remove('hidden'); }
function lightbox(src) { $('#lightbox-img').src = src; $('#lightbox').classList.remove('hidden'); }
const photoImg = (p) => `<img src="/uploads/${esc(p.filename)}" loading="lazy" onclick="lightbox('/uploads/${esc(p.filename)}')" alt="照片">`;
const fmtStatus = (s) => s === 'rectified' ? '<span class="badge badge-rectified">已整改</span>' : '<span class="badge badge-pending">待整改</span>';

/* ================= 登录 ================= */
function renderLogin() {
  $('#app').innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <h1>🏨 客房质检整改系统</h1>
    <div class="sub">质检 · 整改 · 汇总 一体化管理</div>
    <input id="login-user" placeholder="用户名" autocomplete="username">
    <input id="login-pass" type="password" placeholder="密码" autocomplete="current-password">
    <button class="btn btn-primary btn-block" id="login-btn">登 录</button>
    <div class="demo-accounts">
      演示账号（密码均为 123456）：<br>
      店长 admin ｜ 质检员 zhijian / zhijian2 ｜ 主管 zhuguan
    </div>
  </div></div>`;
  const doLogin = async () => {
    const username = $('#login-user').value.trim(), password = $('#login-pass').value;
    if (!username || !password) return toast('请输入用户名和密码');
    try {
      const { token, user } = await api('/login', { method: 'POST', body: { username, password } });
      state.token = token; state.user = user;
      localStorage.setItem('qc_token', token);
      localStorage.setItem('qc_user', JSON.stringify(user));
      renderApp();
    } catch (e) { toast(e.message); }
  };
  $('#login-btn').onclick = doLogin;
  $('#login-pass').onkeydown = (e) => e.key === 'Enter' && doLogin();
}

function logout(callApi = true) {
  if (callApi && state.token) api('/logout', { method: 'POST' }).catch(() => {});
  state.token = ''; state.user = null;
  localStorage.removeItem('qc_token'); localStorage.removeItem('qc_user');
  renderLogin();
}

/* ================= 应用框架 ================= */
const TABS_BY_ROLE = {
  inspector: [['new', '➕ 新建质检'], ['records', '📋 我的记录']],
  supervisor: [['records', '📋 待整改任务']],
  manager: [['stats', '📊 统计看板'], ['records', '🖼 图片对汇总'], ['employees', '👥 员工管理'], ['tokens', '🔑 整改令牌']],
};

function renderApp() {
  const tabs = TABS_BY_ROLE[state.user.role];
  if (!tabs.some(t => t[0] === state.tab)) state.tab = tabs[0][0];
  $('#app').innerHTML = `
    <div class="header">
      <div class="title">🏨 客房质检整改</div>
      <div class="user">
        <span>${esc(state.user.name)} · ${ROLE_NAMES[state.user.role]}</span>
        <button class="logout" id="logout-btn">退出</button>
      </div>
    </div>
    <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === state.tab ? 'active' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div class="container" id="main"></div>`;
  $('#logout-btn').onclick = () => logout();
  $$('.tab').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderApp(); });
  const main = $('#main');
  if (state.tab === 'new') renderNewInspection(main);
  else if (state.tab === 'records') renderRecords(main);
  else if (state.tab === 'stats') renderStats(main);
  else if (state.tab === 'employees') renderEmployees(main);
  else if (state.tab === 'tokens') renderTokens(main);
}

/* ================= 新建质检（批量上传） ================= */
let pendingFiles = [];
function renderNewInspection(el) {
  pendingFiles = [];
  el.innerHTML = `
  <div class="card">
    <h3>新建质检记录</h3>
    <div class="form-2col">
      <div class="form-row"><label>房号 *</label><input id="f-room" placeholder="如 301" inputmode="numeric"></div>
      <div class="form-row"><label>扣分 *</label><input id="f-deduct" type="number" min="0" step="0.5" placeholder="如 5"></div>
    </div>
    <div class="form-row"><label>问题项 *</label>
      <select id="f-item">${PROBLEM_ITEMS.map(i => `<option>${i}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>问题描述</label>
      <textarea id="f-desc" rows="2" placeholder="补充说明问题细节（选填）"></textarea>
    </div>
    <div class="form-row"><label>问题照片（可批量选择多张）</label>
      <input type="file" id="f-photos" accept="image/*" multiple capture="environment" class="hidden">
      <div class="photo-grid" id="preview-grid">
        <div class="photo-add" id="add-photo-btn"><span class="plus">＋</span><span>拍照/选择</span></div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="submit-btn">提交质检记录</button>
  </div>`;

  const fileInput = $('#f-photos');
  $('#add-photo-btn').onclick = () => fileInput.click();
  fileInput.onchange = () => { pendingFiles.push(...fileInput.files); fileInput.value = ''; renderPreview(); };

  function renderPreview() {
    const grid = $('#preview-grid');
    grid.innerHTML = '';
    pendingFiles.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'preview-item';
      d.innerHTML = `<img src="${URL.createObjectURL(f)}"><button class="del" data-i="${i}">×</button>`;
      grid.appendChild(d);
    });
    const add = document.createElement('div');
    add.className = 'photo-add'; add.innerHTML = '<span class="plus">＋</span><span>拍照/选择</span>';
    add.onclick = () => fileInput.click();
    grid.appendChild(add);
    $$('.del', grid).forEach(b => b.onclick = () => { pendingFiles.splice(+b.dataset.i, 1); renderPreview(); });
  }

  $('#submit-btn').onclick = async () => {
    const room = $('#f-room').value.trim(), ded = $('#f-deduct').value;
    if (!room) return toast('请填写房号');
    if (ded === '' || +ded < 0) return toast('请填写正确的扣分');
    const fd = new FormData();
    fd.append('room_number', room);
    fd.append('problem_item', $('#f-item').value);
    fd.append('deduction', ded);
    fd.append('description', $('#f-desc').value.trim());
    pendingFiles.forEach(f => fd.append('photos', f));
    const btn = $('#submit-btn');
    btn.disabled = true; btn.textContent = '上传中…';
    try {
      const r = await api('/inspections', { method: 'POST', body: fd });
      toast(`提交成功，已上传 ${r.photo_count} 张照片`);
      state.tab = 'records'; renderApp();
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '提交质检记录'; }
  };
}

/* ================= 质检记录 / 图片对 ================= */
async function renderRecords(el) {
  const isMgr = state.user.role === 'manager';
  const isSup = state.user.role === 'supervisor';
  el.innerHTML = `
    <div class="filter-bar">
      <input id="flt-room" placeholder="🔍 房号筛选">
      <select id="flt-status">
        <option value="">全部状态</option>
        <option value="pending">待整改</option>
        <option value="rectified">已整改</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="flt-btn">查询</button>
    </div>
    ${isSup ? '<div class="card" style="font-size:13px;color:var(--muted)">💡 请扫描质检员/店长提供的<b>整改二维码</b>上传整改照片；以下为当前待整改任务。</div>' : ''}
    <div id="records-list"><div class="empty-state">加载中…</div></div>`;

  const load = async () => {
    const q = new URLSearchParams();
    if ($('#flt-room').value.trim()) q.set('room', $('#flt-room').value.trim());
    if ($('#flt-status').value) q.set('status', $('#flt-status').value);
    if (isSup && !$('#flt-status').value) q.set('status', 'pending');
    try {
      const { inspections } = await api('/inspections?' + q);
      renderList(inspections);
    } catch (e) { $('#records-list').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
  };

  function renderList(list) {
    const box = $('#records-list');
    if (!list.length) { box.innerHTML = '<div class="empty-state">暂无记录</div>'; return; }
    box.innerHTML = list.map(i => `
      <div class="card">
        <div class="insp-head">
          <span class="room-badge">${esc(i.room_number)}</span>
          <span class="badge badge-item">${esc(i.problem_item)}</span>
          <span class="badge badge-deduct">扣 ${i.deduction} 分</span>
          ${fmtStatus(i.status)}
        </div>
        ${i.description ? `<div class="insp-desc">${esc(i.description)}</div>` : ''}
        <div class="insp-meta">质检员：${esc(i.inspector_name)} ｜ ${esc(i.created_at)}${i.rectified_at ? ` ｜ 整改完成：${esc(i.rectified_at)}` : ''}</div>
        <div class="pair-row">
          <div class="pair-col problem">
            <h4>问题照片（${i.problem_photos.length}）</h4>
            ${i.problem_photos.length ? `<div class="photo-grid">${i.problem_photos.map(photoImg).join('')}</div>` : '<div class="empty-hint">无照片</div>'}
          </div>
          <div class="pair-col fixed">
            <h4>整改照片（${i.rectification_photos.length}）</h4>
            ${i.rectification_photos.length ? `<div class="photo-grid">${i.rectification_photos.map(photoImg).join('')}</div>` : '<div class="empty-hint">待主管扫码上传</div>'}
          </div>
        </div>
        <div class="insp-actions">
          ${!isSup ? `<button class="btn btn-primary btn-sm" data-qr="${i.id}">📱 整改二维码</button>` : ''}
          ${!isSup ? `<button class="btn btn-ghost btn-sm" data-addphoto="${i.id}">📷 补充问题照片</button>` : ''}
        </div>
      </div>`).join('');

    $$('[data-qr]', box).forEach(b => b.onclick = () => showQr(+b.dataset.qr));
    $$('[data-addphoto]', box).forEach(b => b.onclick = () => addPhotos(+b.dataset.addphoto));
  }

  $('#flt-btn').onclick = load;
  $('#flt-room').onkeydown = (e) => e.key === 'Enter' && load();
  await load();
}

// 批量补充问题照片
function addPhotos(inspId) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    [...input.files].forEach(f => fd.append('photos', f));
    try {
      const r = await api(`/inspections/${inspId}/photos`, { method: 'POST', body: fd });
      toast(`已补充 ${r.added} 张照片`);
      renderApp();
    } catch (e) { toast(e.message); }
  };
  input.click();
}

// 整改二维码弹窗
async function showQr(inspId) {
  try {
    const { url, qr } = await api(`/inspections/${inspId}/token`, { method: 'POST' });
    showModal(`
      <h3 style="text-align:center;font-size:16px">客房主管扫码上传整改图</h3>
      <img class="qr-img" src="${qr}" alt="整改二维码">
      <div style="text-align:center;font-size:13px;color:var(--muted)">微信/相机扫码即可打开整改页</div>
      <div class="qr-url">${esc(url)}</div>
      <button class="btn btn-ghost btn-block" style="margin-top:12px" onclick="navigator.clipboard&&navigator.clipboard.writeText('${url}');toast('链接已复制')">复制链接</button>`);
  } catch (e) { toast(e.message); }
}

/* ================= 统计看板 ================= */
async function renderStats(el) {
  el.innerHTML = '<div class="empty-state">加载中…</div>';
  try {
    const { overall, byRoom, byInspector, byItem } = await api('/stats');
    el.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card c-blue"><div class="num">${overall.total}</div><div class="lbl">问题总数</div></div>
        <div class="stat-card c-green"><div class="num">${overall.rectified}</div><div class="lbl">已整改</div></div>
        <div class="stat-card c-orange"><div class="num">${overall.pending}</div><div class="lbl">待整改</div></div>
        <div class="stat-card c-blue"><div class="num">${overall.rate}%</div><div class="lbl">整改完成率</div></div>
        <div class="stat-card c-red"><div class="num">${overall.deductions}</div><div class="lbl">累计扣分</div></div>
      </div>

      <div class="card"><h3>🚪 各房间完成率</h3>
        ${byRoom.length ? `<table class="data"><thead><tr><th>房号</th><th>问题数</th><th>已整改</th><th>完成率</th><th>扣分</th></tr></thead>
        <tbody>${byRoom.map(r => `<tr>
          <td><b>${esc(r.room_number)}</b></td><td>${r.total}</td><td>${r.rectified}</td>
          <td><div class="rate-cell"><div class="progress"><div style="width:${r.rate}%"></div></div><b>${r.rate}%</b></div></td>
          <td>${r.deductions}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-hint">暂无数据</div>'}
      </div>

      <div class="card"><h3>👷 质检员工作量</h3>
        ${byInspector.length ? `<table class="data"><thead><tr><th>质检员</th><th>检查问题数</th><th>已整改</th><th>累计扣分</th></tr></thead>
        <tbody>${byInspector.map(r => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${r.rectified}</td><td>${r.deductions}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-hint">暂无数据</div>'}
      </div>

      <div class="card"><h3>🏷 问题项分布</h3>
        ${byItem.length ? `<table class="data"><thead><tr><th>问题项</th><th>次数</th><th>已整改</th><th>扣分</th></tr></thead>
        <tbody>${byItem.map(r => `<tr><td>${esc(r.problem_item)}</td><td>${r.count}</td><td>${r.rectified}</td><td>${r.deductions}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-hint">暂无数据</div>'}
      </div>`;
  } catch (e) { el.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

/* ================= 员工管理 ================= */
async function renderEmployees(el) {
  el.innerHTML = '<div class="empty-state">加载中…</div>';
  try {
    const { users } = await api('/users');
    el.innerHTML = `
      <div class="card"><h3>➕ 新增员工</h3>
        <div class="form-2col">
          <div class="form-row"><label>用户名</label><input id="e-user" placeholder="登录账号"></div>
          <div class="form-row"><label>姓名</label><input id="e-name" placeholder="真实姓名"></div>
        </div>
        <div class="form-2col">
          <div class="form-row"><label>初始密码</label><input id="e-pass" placeholder="登录密码"></div>
          <div class="form-row"><label>角色</label>
            <select id="e-role"><option value="inspector">质检员</option><option value="supervisor">客房主管</option><option value="manager">店长</option></select>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="e-add">添加员工</button>
      </div>
      <div class="card"><h3>👥 员工列表（${users.length}）</h3>
        <table class="data"><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>质检数</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${users.map(u => `<tr>
          <td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td>
          <td>${ROLE_NAMES[u.role]}</td><td>${u.inspection_count}</td>
          <td>${u.active ? '<span class="tag-active">在职</span>' : '<span class="tag-inactive">已停用</span>'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm ${u.active ? 'btn-danger' : 'btn-success'}" data-toggle="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>${u.active ? '停用' : '启用'}</button>
            <button class="btn btn-ghost btn-sm" data-reset="${u.id}">重置密码</button>
          </td></tr>`).join('')}</tbody></table>
      </div>`;

    $('#e-add').onclick = async () => {
      const body = { username: $('#e-user').value.trim(), name: $('#e-name').value.trim(), password: $('#e-pass').value, role: $('#e-role').value };
      if (!body.username || !body.name || !body.password) return toast('请完整填写');
      try { await api('/users', { method: 'POST', body }); toast('员工已添加'); renderEmployees(el); }
      catch (e) { toast(e.message); }
    };
    $$('[data-toggle]', el).forEach(b => b.onclick = async () => {
      const u = users.find(x => x.id === +b.dataset.toggle);
      if (!confirm(`确定${u.active ? '停用' : '启用'}「${u.name}」的账号吗？`)) return;
      try { await api(`/users/${u.id}`, { method: 'PUT', body: { active: u.active ? 0 : 1 } }); toast('操作成功'); renderEmployees(el); }
      catch (e) { toast(e.message); }
    });
    $$('[data-reset]', el).forEach(b => b.onclick = async () => {
      const u = users.find(x => x.id === +b.dataset.reset);
      const pw = prompt(`为「${u.name}」设置新密码：`);
      if (!pw) return;
      try { await api(`/users/${u.id}`, { method: 'PUT', body: { password: pw } }); toast('密码已重置'); }
      catch (e) { toast(e.message); }
    });
  } catch (e) { el.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

/* ================= 整改令牌管理 ================= */
async function renderTokens(el) {
  el.innerHTML = '<div class="empty-state">加载中…</div>';
  try {
    const { tokens } = await api('/tokens');
    if (!tokens.length) { el.innerHTML = '<div class="empty-state">暂无令牌。在「图片对汇总」中为质检记录生成整改二维码。</div>'; return; }
    el.innerHTML = `
      <div class="card"><h3>🔑 整改令牌（停用后扫码链接立即失效）</h3>
      <table class="data"><thead><tr><th>房号</th><th>问题项</th><th>令牌</th><th>状态</th><th>创建</th><th>操作</th></tr></thead>
      <tbody>${tokens.map(t => `<tr>
        <td><b>${esc(t.room_number)}</b></td>
        <td>${esc(t.problem_item)}<br><span style="font-size:11px;color:var(--muted)">${t.inspection_status === 'rectified' ? '✅ 已整改' : '⏳ 待整改'}</span></td>
        <td class="mono">${esc(t.token.slice(0, 8))}…</td>
        <td>${t.active ? '<span class="tag-active">有效</span>' : '<span class="tag-inactive">已停用</span>'}</td>
        <td style="font-size:12px">${esc(t.created_at)}<br><span style="color:var(--muted)">${esc(t.creator_name || '-')}</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm ${t.active ? 'btn-danger' : 'btn-success'}" data-tt="${t.id}">${t.active ? '停用' : '启用'}</button>
          <button class="btn btn-ghost btn-sm" data-tqr="${t.inspection_id}">二维码</button>
        </td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-tt]', el).forEach(b => b.onclick = async () => {
      try { const r = await api(`/tokens/${b.dataset.tt}/toggle`, { method: 'PUT' }); toast(r.active ? '令牌已启用' : '令牌已停用'); renderTokens(el); }
      catch (e) { toast(e.message); }
    });
    $$('[data-tqr]', el).forEach(b => b.onclick = () => showQr(+b.dataset.tqr));
  } catch (e) { el.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

/* ================= 启动 ================= */
(async () => {
  if (state.token && state.user) {
    try { await api('/me'); renderApp(); return; } catch (e) { /* 会话失效 */ }
  }
  renderLogin();
})();
