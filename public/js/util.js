// 通用工具
function h(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtTimeFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ROLE_NAMES = { manager: '店长', inspector: '质检员', supervisor: '客房主管' };

function toast(msg, type = 'info') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2600);
}

// 简单确认框（返回 Promise<boolean>）
function confirmBox(message, title = '确认操作') {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-head">${h(title)}</div>
        <div class="modal-body">${h(message)}</div>
        <div class="modal-foot">
          <button class="btn" data-a="0">取消</button>
          <button class="btn btn-primary" data-a="1">确定</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const close = (v) => { mask.remove(); resolve(v); };
    mask.addEventListener('click', (e) => { if (e.target === mask) close(false); });
    mask.querySelectorAll('button').forEach((b) => b.onclick = () => close(b.dataset.a === '1'));
  });
}

// 灯箱看大图（支持同组切换）
function openLightbox(srcList, index = 0) {
  let cur = index;
  const lb = document.createElement('div');
  lb.className = 'lightbox show';
  lb.innerHTML = `<img alt="预览">`;
  const img = lb.querySelector('img');
  const show = () => { img.src = srcList[cur]; };
  show();
  lb.addEventListener('click', (e) => {
    if (e.target === img) { lb.remove(); return; }
    const w = window.innerWidth;
    if (e.clientX < w / 2) cur = (cur - 1 + srcList.length) % srcList.length;
    else cur = (cur + 1) % srcList.length;
    show();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', esc); }
    if (e.key === 'ArrowRight') { cur = (cur + 1) % srcList.length; show(); }
    if (e.key === 'ArrowLeft') { cur = (cur - 1 + srcList.length) % srcList.length; show(); }
  });
  document.body.appendChild(lb);
}

function thumbHtml(filePath, list, index, tag) {
  const url = '/uploads/' + encodeURIComponent(filePath);
  return `<div class="photo-thumb" data-i="${index}">
    <img src="${url}" loading="lazy" alt="">
    ${tag ? `<div class="tag">${h(tag)}</div>` : ''}
  </div>`;
}

// 图片网格 + 灯箱
function photoGrid(photos, tagPrefix) {
  if (!photos || !photos.length) return '<div class="photo-empty">暂无照片</div>';
  const list = photos.map((p) => '/uploads/' + encodeURIComponent(p.file));
  return `<div class="photo-grid">${photos
    .map((p, i) => thumbHtml(p.file, list, i, tagPrefix ? tagPrefix + (i + 1) : ''))
    .join('')}</div>`;
}

function bindGridLightbox(root) {
  root.querySelectorAll('.photo-grid').forEach((grid) => {
    const imgs = [...grid.querySelectorAll('.photo-thumb img')].map((im) => im.getAttribute('src'));
    grid.querySelectorAll('.photo-thumb').forEach((t) => {
      t.addEventListener('click', () => openLightbox(imgs, Number(t.dataset.i || 0)));
    });
  });
}

// 带进度的文件大小提示
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
