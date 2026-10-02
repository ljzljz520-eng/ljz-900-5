/* 质检上报页：房间号 + 多个问题项(扣分) + 批量照片上传 */
App.pages.report = (function () {
  let photos = []; // {file, url}

  function itemRow(desc = '', deduction = '') {
    return `<div class="item-row">
      <input type="text" class="it-desc" placeholder="问题项，如：卫生间毛发、床面褶皱" value="${h(desc)}">
      <div class="ded-wrap">
        <input type="number" class="it-ded" min="0" step="0.5" placeholder="扣分" value="${h(deduction)}">
        <span class="unit">分</span>
      </div>
      <button type="button" class="del" title="删除此项">✕</button>
    </div>`;
  }

  function updateTotal(root) {
    let total = 0;
    root.querySelectorAll('.it-ded').forEach((i) => { total += Number(i.value) || 0; });
    root.querySelector('#dedTotal').textContent = total;
  }

  function photoThumbs(root) {
    const box = root.querySelector('#pickPreview');
    if (!photos.length) {
      box.innerHTML = '<div class="photo-empty">尚未选择照片，可一次多选（最多 12 张）</div>';
      return;
    }
    box.innerHTML = `<div class="photo-grid">${photos
      .map((p, i) => `<div class="photo-thumb" data-i="${i}">
        <img src="${p.url}" alt="">
        <div class="tag">${h(p.file.name.length > 12 ? p.file.name.slice(0, 11) + '…' : p.file.name)}</div>
        <button type="button" class="remove-photo" data-i="${i}">✕</button>
      </div>`)
      .join('')}</div>`;
    box.querySelectorAll('.remove-photo').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const idx = Number(b.dataset.i);
        URL.revokeObjectURL(photos[idx].url);
        photos.splice(idx, 1);
        photoThumbs(root);
      };
    });
  }

  async function render(view, app) {
    photos = [];
    view.innerHTML = `
      <h2 class="page-title">📝 质检上报</h2>
      <p class="page-desc">录入客房问题项及扣分，批量上传问题照片。提交后生成整改二维码，客房主管扫码即可上传整改照片。</p>

      <div class="grid-2" style="grid-template-columns: 320px 1fr; align-items:start">
        <div class="card">
          <h3>房间信息</h3>
          <label class="fld">
            <span class="lab">楼层 / 区域</span>
            <input type="text" id="floor" placeholder="如：6 层 / A 栋（选填）">
          </label>
          <label class="fld">
            <span class="lab">房间号 <span class="req">*</span></span>
            <input type="text" id="room" placeholder="如：8602" required>
          </label>
        </div>

        <div class="card">
          <h3>问题项与扣分 <span class="sub">（至少 1 项）</span></h3>
          <div id="itemList">
            ${itemRow('', '')}
          </div>
          <button type="button" class="btn" id="addItem">＋ 添加问题项</button>
          <div class="deduction-total">本房间合计扣分：<b id="dedTotal">0</b> 分</div>
        </div>
      </div>

      <div class="card">
        <h3>问题照片 <span class="sub">（批量上传，至少 1 张，单张 ≤ 10MB，最多 12 张）</span></h3>
        <input type="file" id="photoInput" accept="image/*" multiple hidden>
        <label class="pick-label" for="photoInput">📷 选择照片（可多选）</label>
        <span class="hint" id="pickCount"></span>
        <div style="margin-top:12px" id="pickPreview"></div>
      </div>

      <div style="text-align:center">
        <button class="btn btn-primary" id="submitBtn" style="padding:11px 34px; font-size:15px">
          提交质检记录
        </button>
      </div>`;

    const root = view;
    photoThumbs(root);

    document.getElementById('addItem').onclick = () => {
      const list = document.getElementById('itemList');
      list.insertAdjacentHTML('beforeend', itemRow());
      list.lastElementChild.querySelector('.it-desc').focus();
    };
    root.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) {
        const rows = root.querySelectorAll('.item-row');
        if (rows.length > 1) e.target.closest('.item-row').remove();
        else toast('至少保留一个问题项', 'err');
        updateTotal(root);
      }
    });
    root.addEventListener('input', (e) => {
      if (e.target.classList.contains('it-ded')) updateTotal(root);
    });

    document.getElementById('photoInput').addEventListener('change', (e) => {
      const files = [...e.target.files];
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        if (f.size > 10 * 1024 * 1024) { toast(`「${f.file && f.file.name || f.name}」超过 10MB，已跳过`, 'err'); continue; }
        if (photos.length >= 12) { toast('最多 12 张照片', 'err'); break; }
        photos.push({ file: f, url: URL.createObjectURL(f) });
      }
      e.target.value = '';
      photoThumbs(root);
      document.getElementById('pickCount').textContent = photos.length ? `已选 ${photos.length} 张` : '';
    });

    document.getElementById('submitBtn').onclick = async () => {
      const room = document.getElementById('room').value.trim();
      const floor = document.getElementById('floor').value.trim();
      if (!room) return toast('请填写房间号', 'err');
      const items = [...root.querySelectorAll('.item-row')]
        .map((row) => ({
          desc: row.querySelector('.it-desc').value.trim(),
          deduction: Number(row.querySelector('.it-ded').value)
        }))
        .filter((x) => x.desc && !Number.isNaN(x.deduction) && x.deduction >= 0);
      if (!items.length) return toast('请至少填写一个有效问题项及扣分', 'err');
      if (!photos.length) return toast('请至少上传一张问题照片', 'err');

      const fd = new FormData();
      fd.append('room', room);
      fd.append('floor', floor);
      fd.append('items', JSON.stringify(items));
      photos.forEach((p) => fd.append('photos', p.file));

      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      try {
        const r = await api.upload('/api/issues', fd, (pct) => {
          btn.textContent = `上传中 ${pct}%…`;
        });
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        photos = [];
        successModal(r, app);
        view.querySelector('#floor').value = '';
        view.querySelector('#room').value = '';
        view.querySelector('#itemList').innerHTML = itemRow();
        updateTotal(view);
        photoThumbs(view);
        document.getElementById('pickCount').textContent = '';
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = '提交质检记录';
      }
    };
  }

  function successModal(issue, app) {
    const total = issue.totalDeduction;
    App.openModal({
      title: '✅ 提交成功',
      wide: true,
      bodyHtml: `
        <div class="qr-box">
          <p>房间 <b style="font-size:18px;color:var(--primary-dark)">${h(issue.room)}</b>
             的质检记录已创建（共 ${issue.items.length} 项，扣分 ${total} 分，照片 ${issue.photos.length} 张）</p>
          <p class="muted">将下方整改二维码发送/展示给客房主管，扫码即可上传整改照片：</p>
          <img alt="整改二维码" id="qrImg" style="background:#f8fafc">
          <div class="qr-link" id="qrLink">${h(issue.rectUrl)}</div>
        </div>`,
      footerHtml: `
        <button class="btn" id="copyLink">复制整改链接</button>
        <button class="btn" id="dlQr">下载二维码</button>
        <button class="btn btn-primary" id="goList">前往问题汇总</button>
        <button class="btn" id="continue">继续上报</button>`,
      onOpen(body, foot, close) {
        let qrBlobUrl = null;
        // 二维码接口需要登录头，用 fetch 转 blob 显示
        fetch('/api/issues/' + issue.id + '/qr.png', {
          headers: { Authorization: 'Bearer ' + api.token }
        }).then((r) => {
          if (!r.ok) throw new Error();
          return r.blob();
        }).then((b) => {
          qrBlobUrl = URL.createObjectURL(b);
          body.querySelector('#qrImg').src = qrBlobUrl;
        }).catch(() => { body.querySelector('#qrImg').replaceWith(Object.assign(document.createElement('div'), { className: 'err-banner', textContent: '二维码加载失败' })); });

        foot.querySelector('#copyLink').onclick = async () => {
          try {
            await navigator.clipboard.writeText(issue.rectUrl);
            toast('整改链接已复制', 'ok');
          } catch (e) {
            toast('复制失败，请手动选择链接复制', 'err');
          }
        };
        foot.querySelector('#dlQr').onclick = () => {
          if (!qrBlobUrl) return toast('二维码尚未加载完成', 'err');
          const a = document.createElement('a');
          a.href = qrBlobUrl;
          a.download = `房间${issue.room}-整改二维码.png`;
          a.click();
        };
        foot.querySelector('#goList').onclick = () => { close(); location.hash = '#/issues'; };
        foot.querySelector('#continue').onclick = close;
      }
    });
  }

  return { render };
})();
