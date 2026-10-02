/* 登录 Token（会话）管理：查看 / 停用 */
App.pages.sessions = (function () {
  let sessions = [];

  function shortDevice(ua) {
    if (!ua) return '未知设备';
    let os = '';
    if (/Windows NT 10/.test(ua)) os = 'Windows';
    else if (/Windows/.test(ua)) os = 'Windows(旧版)';
    else if (/Android ([\d.]+)/.test(ua)) os = 'Android ' + (ua.match(/Android ([\d.]+)/) || [])[1];
    else if (/iPhone|iPad/.test(ua)) {
      os = /iPad/.test(ua) ? 'iPadOS' : 'iOS ' + ((ua.match(/OS ([\d_]+)/) || [])[1] || '').replace(/_/g, '.');
    } else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    let browser = '浏览器';
    if (/MicroMessenger/.test(ua)) browser = '微信';
    else if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    return (os ? os + ' · ' : '') + browser;
  }

  async function load(app) {
    sessions = await api.get('/api/sessions' + (app.user.role === 'manager' ? '' : ''));
  }

  async function render(view, app) {
    const isManager = app.user.role === 'manager';
    view.innerHTML = `
      <h2 class="page-title">🔑 登录 Token 管理</h2>
      <p class="page-desc">
        每个登录设备对应一个有效 Token。停用后该设备立即被强制下线。
        ${isManager ? '店长可停用任意员工的 Token；员工仅能管理自己的登录设备。' : '你可以停用自己其他设备上的登录。'}
      </p>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">活跃 / 历史 Token（共 <span id="sCount"></span> 条）</h3>
          <div style="display:flex;gap:8px">
            <button class="btn" id="logoutOthers">停用我在其他设备的 Token</button>
            <button class="btn" id="sRefresh">刷新</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="tbl">
            <thead>
              <tr>
                ${isManager ? '<th>员工</th><th>角色</th>' : ''}
                <th>设备 / 浏览器</th><th>IP</th><th>登录时间</th><th>到期时间</th><th>状态</th><th style="text-align:right">操作</th>
              </tr>
            </thead>
            <tbody id="sBody"></tbody>
          </table>
        </div>
      </div>`;

    const reload = async () => {
      await load(app);
      document.getElementById('sCount').textContent = sessions.length;
      const body = document.getElementById('sBody');
      if (!sessions.length) {
        body.innerHTML = `<tr><td colspan="${isManager ? 7 : 5}" class="empty-tip">暂无登录记录</td></tr>`;
        return;
      }
      const now = Date.now();
      body.innerHTML = sessions.map((s) => {
        const expired = new Date(s.expiresAt).getTime() < now;
        const st = s.revoked
          ? '<span class="badge badge-open">已停用</span>'
          : expired
            ? '<span class="badge badge-muted">已过期</span>'
            : '<span class="badge badge-done">有效</span>';
        return `<tr data-jti="${s.jti}" ${s.revoked || expired ? 'style="opacity:.65"' : ''}>
          ${isManager ? `<td>${h(s.realName || s.userName)} <span class="muted">(${h(s.userName)})</span></td>
          <td><span class="badge badge-role">${ROLE_NAMES[s.role] || s.role || '-'}</span></td>` : ''}
          <td>${h(shortDevice(s.device))}</td>
          <td class="muted">${h(s.ip || '-')}</td>
          <td class="muted">${fmtTimeFull(s.createdAt)}</td>
          <td class="muted">${fmtTimeFull(s.expiresAt)}</td>
          <td>${st}</td>
          <td style="text-align:right">
            ${s.revoked || expired ? '<span class="muted" style="font-size:12px">—</span>'
              : '<button class="btn btn-sm btn-danger" data-act="revoke">停用</button>'}
          </td>
        </tr>`;
      }).join('');
      body.querySelectorAll('[data-act="revoke"]').forEach((b) => {
        b.onclick = async () => {
          const tr = b.closest('tr');
          const s = sessions.find((x) => x.jti === tr.dataset.jti);
          const who = isManager ? `「${s.realName || s.userName}」的该 Token` : '该设备的 Token';
          const ok = await confirmBox(`确定停用${who}吗？停用后对应设备需重新登录。`, '停用 Token');
          if (!ok) return;
          try {
            await api.del('/api/sessions/' + s.jti);
            toast('Token 已停用', 'ok');
            reload();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
    };

    document.getElementById('sRefresh').onclick = reload;
    document.getElementById('logoutOthers').onclick = async () => {
      const ok = await confirmBox('将停用你在其他所有设备上的登录 Token，当前设备不受影响。', '停用其他设备');
      if (!ok) return;
      await api.post('/api/auth/logout-others');
      toast('其他设备的 Token 已全部停用', 'ok');
      reload();
    };
    reload();
  }

  return { render };
})();
