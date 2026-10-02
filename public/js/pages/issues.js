/* 问题汇总页：按房间分组展示问题图 / 整改图图片对 */
App.pages.issues = (function () {
  let state = { room: '', status: '', inspectorId: '', list: [], users: [] };

  async function load() {
    const q = new URLSearchParams();
    if (state.room) q.set('room', state.room);
    if (state.status) q.set('status', state.status);
    if (state.inspectorId) q.set('inspectorId', state.inspectorId);
    const [list, users] = await Promise.all([
      api.get('/api/issues?' + q.toString()),
      api.get('/api/users')
    ]);
    state.list = list;
    state.users = users;
  }

  function issueCard(i, role) {
    const canManage = role === 'manager' || role === 'inspector';
    const canDelete = role === 'manager';
    const total = i.totalDeduction;
    const badge = i.status === 'done'
      ? '<span class="badge badge-done">✓ 已整改</span>'
      : '<span class="badge badge-open">待整改</span>';

    const rectCol = i.rectPhotos && i.rectPhotos.length
      ? photoGrid(i.rectPhotos, '整改')
      : `<div class="photo-empty">${i.status === 'done' ? '' : '主管尚未上传整改照片'}</div>`;

    return `<div class="issue-inner" data-id="${i.id}">
      <div class="issue-head">
        <span class="seq">#${String(i.seq).padStart(4, '0')}</span>
        ${badge}
        <span class="meta">质检员：${h(i.inspectorName)} · ${fmtTimeFull(i.createdAt)}</span>
        ${i.rectAt ? `<span class="meta">整改：${h(i.supervisorName)} · ${fmtTimeFull(i.rectAt)}</span>` : ''}
        ${i.reopenedCount ? `<span class="badge badge-muted">已驳回 ${i.reopenedCount} 次</span>` : ''}
        <span class="spacer"></span>
        <span class="badge badge-role">扣 ${total} 分</span>
        ${canManage ? `<button class="btn btn-sm" data-act="qr">整改二维码</button>` : ''}
        ${canManage && i.status === 'done' ? `<button class="btn btn-sm btn-danger" data-act="reopen">驳回重改</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger" data-act="del">删除</button>` : ''}
      </div>
      <ul class="ded-list">
        ${i.items.map((it) => `<li><span>${h(it.desc)}</span><span class="d">-${it.deduction} 分</span></li>`).join('')}
      </ul>
      <div class="photo-pair">
        <div>
          <div class="col-title"><span class="dot dot-problem"></span>问题照片（${i.photos.length} 张）</div>
          ${photoGrid(i.photos, '问题')}
        </div>
        <div>
          <div class="col-title"><span class="dot dot-rect"></span>整改照片（${(i.rectPhotos || []).length} 张）</div>
          ${rectCol}
        </div>
      </div>
    </div>`;
  }

  function groupByRoom(list, role) {
    const rooms = new Map();
    for (const i of list) {
      if (!rooms.has(i.room)) rooms.set(i.room, { room: i.room, floor: i.floor, items: [] });
      rooms.get(i.room).items.push(i);
    }
    const arr = [...rooms.values()];
    arr.forEach((r) => {
      r.items.sort((a, b) => b.seq - a.seq);
      r.done = r.items.filter((i) => i.status === 'done').length;
    });
    if (!arr.length) return '<div class="empty-tip">没有符合条件的质检记录</div>';
    return arr.map((r) => `
      <div class="card room-card">
        <div class="room-head">
          <span class="room-no">🛏️ ${h(r.room)}</span>
          ${r.floor ? `<span class="floor">${h(r.floor)}</span>` : ''}
          <span class="badge ${r.done === r.items.length ? 'badge-done' : 'badge-open'}">
            ${r.done === r.items.length ? '全部完成' : '整改中'}
          </span>
          <span class="rate-mini">${r.items.length} 项问题 · 已整改 ${r.done} 项 ·
            完成率 ${r.items.length ? Math.round((r.done / r.items.length) * 100) : 0}%</span>
        </div>
        ${r.items.map((i) => issueCard(i, role)).join('')}
      </div>`).join('');
  }

  async function render(view, app) {
    const role = app.user.role;
    await load();

    const inspectorOpts = state.users
      .filter((u) => u.role === 'inspector')
      .map((u) => `<option value="${u.id}" ${state.inspectorId === u.id ? 'selected' : ''}>${h(u.realName || u.name)}</option>`)
      .join('');

    view.innerHTML = `
      <h2 class="page-title">🛏️ 问题汇总</h2>
      <p class="page-desc">按房间查看每条问题的「问题照片 → 整改照片」图片对，核查整改效果。</p>

      <div class="card">
        <div class="filter-bar">
          <div class="f">
            <label>房间号</label>
            <input type="text" id="fRoom" placeholder="输入房间号搜索" value="${h(state.room)}">
          </div>
          <div class="f" style="max-width:150px">
            <label>状态</label>
            <select id="fStatus">
              <option value="">全部</option>
              <option value="open" ${state.status === 'open' ? 'selected' : ''}>待整改</option>
              <option value="done" ${state.status === 'done' ? 'selected' : ''}>已整改</option>
            </select>
          </div>
          ${role === 'manager' ? `<div class="f" style="max-width:180px">
            <label>质检员</label>
            <select id="fInspector">
              <option value="">全部</option>
              ${inspectorOpts}
            </select>
          </div>` : ''}
          <button class="btn btn-primary" id="fSearch">筛选</button>
          <button class="btn" id="fReset">重置</button>
        </div>
      </div>

      <div id="roomList"></div>`;

    const listBox = document.getElementById('roomList');
    listBox.innerHTML = groupByRoom(state.list, role);
    bindGridLightbox(listBox);

    document.getElementById('fSearch').onclick = async () => {
      state.room = document.getElementById('fRoom').value.trim();
      state.status = document.getElementById('fStatus').value;
      const fi = document.getElementById('fInspector');
      state.inspectorId = fi ? fi.value : '';
      listBox.innerHTML = '<div class="empty-tip">加载中…</div>';
      await load();
      listBox.innerHTML = groupByRoom(state.list, role);
      bindGridLightbox(listBox);
      bindActions(app, listBox);
    };
    document.getElementById('fReset').onclick = () => {
      state.room = ''; state.status = ''; state.inspectorId = '';
      App.switchTab('issues');
    };
    document.getElementById('fRoom').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('fSearch').click();
    });

    bindActions(app, listBox);
  }

  function bindActions(app, root) {
    root.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest('.issue-inner');
        const id = card.dataset.id;
        const issue = state.list.find((i) => i.id === id);
        const act = btn.dataset.act;
        if (act === 'qr') showQr(issue);
        if (act === 'reopen') {
          const ok = await confirmBox(`驳回 #${String(issue.seq).padStart(4, '0')}（房间 ${issue.room}）后，原整改照片将清空，需生成新二维码由主管重新上传。`);
          if (!ok) return;
          try {
            const fresh = await api.post(`/api/issues/${id}/reopen`);
            Object.assign(issue, fresh);
            toast('已驳回，新二维码已生成', 'ok');
            showQr(issue);
            App.switchTab('issues');
          } catch (e) { toast(e.message, 'err'); }
        }
        if (act === 'del') {
          const ok = await confirmBox(`确定删除房间 ${issue.room} 的 #${String(issue.seq).padStart(4, '0')} 记录吗？此操作不可恢复。`, '删除确认');
          if (!ok) return;
          try {
            await api.del(`/api/issues/${id}`);
            toast('已删除', 'ok');
            App.switchTab('issues');
          } catch (e) { toast(e.message, 'err'); }
        }
      };
    });
  }

  function showQr(issue) {
    App.openModal({
      title: `整改二维码 · 房间 ${issue.room} · #${String(issue.seq).padStart(4, '0')}`,
      wide: true,
      bodyHtml: `
        <div class="qr-box">
          <p class="muted">客房主管使用手机扫码，即可免登录上传该问题的整改照片：</p>
          <img alt="二维码" id="qrImg2" style="background:#f8fafc">
          <div class="qr-link">${h(issue.rectUrl || '链接加载中…')}</div>
          <p class="hint" style="margin-top:8px">状态：${
            issue.status === 'done'
              ? '<span class="badge badge-done">已整改</span>'
              : '<span class="badge badge-open">待整改</span>'
          } ｜ 驳回重改后二维码会自动失效换新</p>
        </div>`,
      footerHtml: `
        <button class="btn" id="cp2">复制链接</button>
        <button class="btn btn-primary" id="close2">关闭</button>`,
      onOpen(body, foot, close) {
        let blobUrl = null;
        fetch('/api/issues/' + issue.id + '/qr.png', { headers: { Authorization: 'Bearer ' + api.token } })
          .then((r) => r.blob())
          .then((b) => { blobUrl = URL.createObjectURL(b); body.querySelector('#qrImg2').src = blobUrl; });
        foot.querySelector('#cp2').onclick = async () => {
          try { await navigator.clipboard.writeText(issue.rectUrl); toast('链接已复制', 'ok'); }
          catch (e) { toast('复制失败', 'err'); }
        };
        foot.querySelector('#close2').onclick = close;
      }
    });
  }

  return { render };
})();
