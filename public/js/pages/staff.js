/* 员工列表管理（店长）*/
App.pages.staff = (function () {
  let users = [];

  async function load() { users = await api.get('/api/users'); }

  async function render(view, app) {
    view.innerHTML = `
      <h2 class="page-title">👥 员工列表</h2>
      <p class="page-desc">管理员工账号与角色，停用员工会同时使其全部登录 Token 立即失效。</p>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">员工账号（共 <span id="uCount"></span> 人）</h3>
          <button class="btn btn-primary" id="addUser">＋ 新增员工</button>
        </div>
        <div class="table-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>登录账号</th><th>姓名</th><th>角色</th><th>状态</th><th>创建时间</th><th style="text-align:right">操作</th>
              </tr>
            </thead>
            <tbody id="uBody"></tbody>
          </table>
        </div>
      </div>`;
    await reload(app);
    document.getElementById('addUser').onclick = () => editModal(null, app);
  }

  async function reload(app) {
    await load();
    document.getElementById('uCount').textContent = users.length;
    const body = document.getElementById('uBody');
    body.innerHTML = users.map((u) => {
      const isSelf = u.id === app.user.id;
      return `<tr data-id="${u.id}">
        <td><b>${h(u.name)}</b>${isSelf ? ' <span class="badge badge-muted">当前账号</span>' : ''}</td>
        <td>${h(u.realName || '-')}</td>
        <td><span class="badge badge-role">${ROLE_NAMES[u.role] || u.role}</span></td>
        <td>${u.active ? '<span class="badge badge-done">在职</span>' : '<span class="badge badge-open">已停用</span>'}</td>
        <td class="muted">${fmtTime(u.createdAt)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" data-act="edit">编辑</button>
          <button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-act="toggle">
            ${u.active ? '停用' : '启用'}
          </button>
          ${isSelf ? '' : '<button class="btn btn-sm btn-danger" data-act="del">删除</button>'}
        </td>
      </tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach((tr) => {
      const u = users.find((x) => x.id === tr.dataset.id);
      tr.querySelectorAll('[data-act]').forEach((b) => {
        b.onclick = async () => {
          const act = b.dataset.act;
          if (act === 'edit') editModal(u, app);
          if (act === 'toggle') {
            if (u.active) {
              const ok = await confirmBox(`确定停用「${u.realName || u.name}」吗？其所有已登录设备的 Token 将立即失效。`, '停用员工');
              if (!ok) return;
              await api.patch('/api/users/' + u.id, { active: false });
              toast('已停用，其全部 Token 已失效', 'ok');
            } else {
              await api.patch('/api/users/' + u.id, { active: true });
              toast('已启用', 'ok');
            }
            reload(app);
          }
          if (act === 'del') {
            const ok = await confirmBox(`确定删除员工「${u.realName || u.name}」吗？其登录记录将一并清除。`, '删除员工');
            if (!ok) return;
            await api.del('/api/users/' + u.id);
            toast('已删除', 'ok');
            reload(app);
          }
        };
      });
    });
  }

  function editModal(u, app) {
    const isEdit = !!u;
    App.openModal({
      title: isEdit ? `编辑员工：${u.name}` : '新增员工',
      bodyHtml: `
        <label class="fld">
          <span class="lab">登录账号 ${isEdit ? '' : '<span class="req">*</span>'}</span>
          <input type="text" id="mName" value="${isEdit ? h(u.name) : ''}" placeholder="3-20 位字母/数字/下划线" ${isEdit ? 'disabled' : ''}>
        </label>
        <label class="fld">
          <span class="lab">姓名</span>
          <input type="text" id="mReal" value="${isEdit ? h(u.realName || '') : ''}" placeholder="如：李质检">
        </label>
        <label class="fld">
          <span class="lab">角色</span>
          <select id="mRole">
            <option value="manager">店长</option>
            <option value="inspector">质检员</option>
            <option value="supervisor">客房主管</option>
          </select>
        </label>
        <label class="fld">
          <span class="lab">${isEdit ? '重置密码（留空则不修改）' : '初始密码 <span class="req">*</span>'}</span>
          <input type="text" id="mPwd" placeholder="${isEdit ? '不修改请留空（至少 6 位）' : '至少 6 位'}">
        </label>
        ${isEdit ? `<label class="fld" style="display:flex;align-items:center;gap:8px;margin:0">
          <input type="checkbox" id="mActive" ${u.active ? 'checked' : ''} style="width:auto">
          <span>账号启用（停用后该员工无法登录，已签发 Token 全部失效）</span>
        </label>` : ''}`,
      footerHtml: `<button class="btn" id="mCancel">取消</button>
                   <button class="btn btn-primary" id="mSave">保存</button>`,
      onOpen(body, foot, close) {
        if (isEdit) body.querySelector('#mRole').value = u.role;
        foot.querySelector('#mCancel').onclick = close;
        foot.querySelector('#mSave').onclick = async () => {
          try {
            const payload = {
              realName: body.querySelector('#mReal').value.trim(),
              role: body.querySelector('#mRole').value
            };
            const pwd = body.querySelector('#mPwd').value;
            if (pwd) payload.password = pwd;
            if (isEdit) payload.active = body.querySelector('#mActive').checked;
            if (!isEdit) {
              payload.name = body.querySelector('#mName').value.trim();
              if (!payload.name) return toast('请填写登录账号', 'err');
              if (!pwd) return toast('请设置初始密码', 'err');
              await api.post('/api/users', Object.assign(payload, { password: pwd }));
            } else {
              await api.patch('/api/users/' + u.id, payload);
            }
            toast('保存成功', 'ok');
            close();
            reload(app);
          } catch (e) { toast(e.message, 'err'); }
        };
      }
    });
  }

  return { render };
})();
