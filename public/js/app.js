/* 主应用：鉴权、导航、路由、通用弹层 */
const TABS = [
  { key: 'dashboard', name: '完成率统计', roles: ['manager'], icon: '📊' },
  { key: 'report', name: '质检上报', roles: ['inspector'], icon: '📝' },
  { key: 'issues', name: '问题汇总', roles: ['manager', 'inspector', 'supervisor'], icon: '🛏️' },
  { key: 'staff', name: '员工列表', roles: ['manager'], icon: '👥' },
  { key: 'sessions', name: '登录 Token', roles: ['manager', 'inspector', 'supervisor'], icon: '🔑' }
];

const App = {
  user: null,
  pages: {},
  current: null,

  async init() {
    if (!api.token) return this.gotoLogin();
    try {
      const r = await api.get('/api/auth/me');
      this.user = r.user;
      api.setUser(r.user);
    } catch (e) {
      return this.gotoLogin();
    }
    document.getElementById('uname').textContent = this.user.realName || this.user.name;
    document.getElementById('urole').textContent = ROLE_NAMES[this.user.role] || this.user.role;
    document.getElementById('logoutBtn').onclick = async () => {
      try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
      api.clear();
      this.gotoLogin();
    };
    this.buildNav();
    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  gotoLogin() {
    api.clear();
    location.href = '/login.html';
  },

  availableTabs() {
    return TABS.filter((t) => t.roles.includes(this.user.role));
  },

  buildNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = this.availableTabs()
      .map((t) => `<button data-tab="${t.key}">${t.icon} ${t.name}</button>`)
      .join('');
    nav.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { location.hash = '#/' + b.dataset.tab; });
    });
  },

  route() {
    const key = (location.hash || '').replace(/^#\/?/, '') || this.availableTabs()[0].key;
    const allowed = this.availableTabs().some((t) => t.key === key);
    const tab = allowed ? key : this.availableTabs()[0].key;
    if (!allowed) location.hash = '#/' + tab;
    this.switchTab(tab);
  },

  async switchTab(key) {
    this.current = key;
    document.querySelectorAll('#nav button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === key);
    });
    const view = document.getElementById('view');
    view.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      await this.pages[key].render(view, this);
    } catch (e) {
      if (e.status === 401) return this.gotoLogin();
      view.innerHTML = `<div class="err-banner">${h(e.message)}</div>`;
    }
  },

  /* ---------- 通用弹层 ---------- */
  openModal({ title = '', bodyHtml = '', footerHtml = '', wide = false, onOpen } = {}) {
    const mask = document.getElementById('modalMask');
    const box = document.getElementById('modalBox');
    box.classList.toggle('wide', wide);
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFoot').innerHTML = footerHtml;
    mask.classList.add('show');
    const close = () => mask.classList.remove('show');
    document.getElementById('modalClose').onclick = close;
    mask.onclick = (e) => { if (e.target === mask) close(); };
    if (onOpen) onOpen(document.getElementById('modalBody'), document.getElementById('modalFoot'), close);
    return { body: document.getElementById('modalBody'), foot: document.getElementById('modalFoot'), close };
  }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
