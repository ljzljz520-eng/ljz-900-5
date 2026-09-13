/** 公共前端工具 */
const API = {
  get token() { return localStorage.getItem('qc_token') || ''; },
  get user() { try { return JSON.parse(localStorage.getItem('qc_user') || 'null'); } catch { return null; } },
  setSession(token, user) { localStorage.setItem('qc_token', token); localStorage.setItem('qc_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('qc_token'); localStorage.removeItem('qc_user'); },

  async req(method, url, body, isForm) {
    const headers = {};
    if (API.token) headers['Authorization'] = 'Bearer ' + API.token;
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401 && !url.includes('/public/')) { API.clear(); location.href = '/login.html'; }
      throw new Error(data.error || `请求失败(${res.status})`);
    }
    return data;
  },
  get(url) { return API.req('GET', url); },
  post(url, body) { return API.req('POST', url, body); },
  put(url, body) { return API.req('PUT', url, body); },
  del(url) { return API.req('DELETE', url); },
  upload(url, formData, method = 'POST') { return API.req(method, url, formData, true); },
};

function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 2600);
}

const ROLE_HOME = { inspector: '/inspector.html', supervisor: '/work.html', manager: '/manager.html', admin: '/admin.html' };
const ROLE_NAMES = { inspector: '质检员', supervisor: '客房主管', manager: '店长', admin: '管理员' };

/** 页面守卫:要求登录且角色匹配 */
function guard(...roles) {
  const u = API.user;
  if (!u || !API.token) { location.href = '/login.html'; return null; }
  if (roles.length && !roles.includes(u.role)) { location.href = ROLE_HOME[u.role] || '/login.html'; return null; }
  return u;
}

const NAV_ITEMS = {
  inspector: [{ href: '/inspector.html', label: '📋 质检上报' }],
  supervisor: [{ href: '/work.html', label: '🔧 整改工作台' }],
  manager: [
    { href: '/manager.html', label: '📊 质检看板' },
    { href: '/admin.html#tokens', label: '🔳 二维码管理' },
    { href: '/admin.html#employees', label: '👥 员工列表' },
  ],
  admin: [
    { href: '/manager.html', label: '📊 质检看板' },
    { href: '/admin.html#employees', label: '👥 员工管理' },
    { href: '/admin.html#rooms', label: '🚪 房间管理' },
    { href: '/admin.html#tokens', label: '🔳 二维码管理' },
  ],
};

function renderNav(activeHref) {
  const u = API.user;
  const items = NAV_ITEMS[u.role] || [];
  const nav = document.createElement('div');
  nav.className = 'navbar';
  nav.innerHTML = `<div class="navbar-inner">
    <span class="brand">🏨 客房质检</span>
    ${items.map(i => `<a class="nav-link ${i.href.split('#')[0] === activeHref ? 'active' : ''}" href="${i.href}">${i.label}</a>`).join('')}
    <span class="spacer"></span>
    <span class="user">${u.name} · ${ROLE_NAMES[u.role]}</span>
    <button class="logout" onclick="logout()">退出</button>
  </div>`;
  document.body.prepend(nav);
}

async function logout() {
  try { await API.post('/api/auth/logout'); } catch {}
  API.clear();
  location.href = '/login.html';
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(s) { return s ? String(s).slice(5, 16) : '-'; }

/** 图片灯箱 */
function initLightbox() {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = '<img>';
  lb.onclick = () => lb.classList.remove('show');
  document.body.appendChild(lb);
  document.body.addEventListener('click', e => {
    if (e.target.tagName === 'IMG' && e.target.dataset.zoom !== undefined) {
      lb.querySelector('img').src = e.target.src;
      lb.classList.add('show');
    }
  });
}

function statusBadge(status) {
  return status === 'rectified'
    ? '<span class="badge badge-rectified">✓ 已整改</span>'
    : '<span class="badge badge-pending">⏳ 待整改</span>';
}
