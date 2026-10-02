/* 扫码整改页（免登录，凭链接 token）*/
(function () {
  const token = new URLSearchParams(location.search).get('t') || '';
  const content = document.getElementById('content');
  let picked = []; // {file, url}
  let issue = null;

  async function loadIssue() {
    if (!token) {
      content.innerHTML = '<div class="err-banner">链接缺少凭证参数，请确认二维码完整。</div>';
      return;
    }
    const resp = await fetch('/api/rect/' + encodeURIComponent(token));
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      content.innerHTML = `<div class="err-banner">${h(d.error || '链接无效')}</div>`;
      return;
    }
    issue = await resp.json();
    document.getElementById('roomBig').textContent = issue.room;
    document.getElementById('floorInfo').textContent = issue.floor ? issue.floor + ' · ' : '';
    renderForm();
  }

  function renderForm() {
    if (issue.status === 'done') {
      content.innerHTML = `
        <div class="done-banner">✅ 该问题已完成整改，无需重复上传</div>
        <div class="card">
          <h3>整改结果</h3>
          <p class="muted" style="margin-top:0">
            整改人：<b>${h(issue.supervisorName)}</b> ｜ 提交时间：${fmtTimeFull(issue.rectAt)}
          </p>
          <div class="col-title"><span class="dot dot-rect"></span>已上传的整改照片（${(issue.rectPhotos || []).length} 张）</div>
          <div id="doneGrid" style="margin-top:8px">${photoGrid(issue.rectPhotos, '整改')}</div>
        </div>
        <div class="card">
          <h3>问题项回顾</h3>
          <ul class="ded-list">${issue.items.map((it) => `<li><span>${h(it.desc)}</span><span class="d">-${it.deduction} 分</span></li>`).join('')}</ul>
          <div class="col-title" style="margin-top:10px"><span class="dot dot-problem"></span>问题照片（${issue.photos.length} 张）</div>
          <div id="probGrid" style="margin-top:8px">${photoGrid(issue.photos, '问题')}</div>
        </div>`;
      bindGridLightbox(content);
      return;
    }

    content.innerHTML = `
      <div class="card">
        <h3>待整改问题项</h3>
        <ul class="ded-list">
          ${issue.items.map((it) => `<li><span>${h(it.desc)}</span><span class="d">扣 ${it.deduction} 分</span></li>`).join('')}
        </ul>
        <p class="hint" style="margin-bottom:10px">质检员：${h(issue.inspectorName)} ｜ 上报时间：${fmtTimeFull(issue.createdAt)}
          ${issue.reopenedCount ? ` ｜ <span style="color:var(--danger)">已被驳回重改 ${issue.reopenedCount} 次</span>` : ''}
        </p>
        <div class="col-title"><span class="dot dot-problem"></span>问题照片（${issue.photos.length} 张，点击可放大）</div>
        <div id="probGrid" style="margin-top:8px">${photoGrid(issue.photos, '问题')}</div>
      </div>

      <div class="card">
        <h3>上传整改照片</h3>
        <label class="fld">
          <span class="lab">整改人姓名（选填）</span>
          <input type="text" id="supName" placeholder="如：张主管" maxlength="30">
        </label>
        <input type="file" id="rectInput" accept="image/*" multiple hidden>
        <label class="pick-label" for="rectInput">📷 拍照 / 选择整改照片（可多选）</label>
        <span class="hint" id="rectCount"></span>
        <div style="margin-top:12px" id="rectPreview"></div>
      </div>

      <div style="text-align:center; padding-bottom:10px">
        <button class="btn btn-primary" id="rectSubmit" style="padding:12px 40px;font-size:16px;width:100%">
          提交整改照片
        </button>
        <p class="hint">提交后质检员/店长即可看到整改前后的图片对；如需重改请联系质检员驳回。</p>
      </div>`;

    bindGridLightbox(content);
    renderPicked();

    document.getElementById('rectInput').addEventListener('change', (e) => {
      for (const f of [...e.target.files]) {
        if (!f.type.startsWith('image/')) continue;
        if (f.size > 10 * 1024 * 1024) { toast('「' + f.name + '」超过 10MB，已跳过', 'err'); continue; }
        if (picked.length >= 12) { toast('最多 12 张', 'err'); break; }
        picked.push({ file: f, url: URL.createObjectURL(f) });
      }
      e.target.value = '';
      renderPicked();
    });

    document.getElementById('rectSubmit').onclick = async () => {
      if (!picked.length) return toast('请至少拍一张整改照片', 'err');
      const fd = new FormData();
      fd.append('supervisorName', document.getElementById('supName').value.trim());
      picked.forEach((p) => fd.append('photos', p.file));
      const btn = document.getElementById('rectSubmit');
      btn.disabled = true;
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/rect/' + encodeURIComponent(token) + '/upload');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) btn.textContent = '上传中 ' + Math.round((e.loaded / e.total) * 100) + '%…';
          };
          xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error((JSON.parse(xhr.responseText || '{}').error) || '上传失败')));
          xhr.onerror = () => reject(new Error('网络错误'));
          xhr.send(fd);
        });
        picked.forEach((p) => URL.revokeObjectURL(p.url));
        picked = [];
        toast('整改照片提交成功！', 'ok');
        await loadIssue();
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false;
        btn.textContent = '提交整改照片';
      }
    };
  }

  function renderPicked() {
    const box = document.getElementById('rectPreview');
    if (!box) return;
    document.getElementById('rectCount').textContent = picked.length ? `已选 ${picked.length} 张` : '';
    if (!picked.length) {
      box.innerHTML = '<div class="photo-empty">尚未选择整改照片</div>';
      return;
    }
    box.innerHTML = `<div class="photo-grid">${picked.map((p, i) => `
      <div class="photo-thumb">
        <img src="${p.url}" alt="">
        <button type="button" class="remove-photo" data-i="${i}">✕</button>
      </div>`).join('')}</div>`;
    box.querySelectorAll('.remove-photo').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.i);
        URL.revokeObjectURL(picked[i].url);
        picked.splice(i, 1);
        renderPicked();
      };
    });
  }

  loadIssue();
})();
