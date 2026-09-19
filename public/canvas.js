// 自由画布（素材拼贴）：平移/缩放/图片与便签节点/拖拽/自动保存（按项目隔离）
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, e) => { if (window.toastMsg) window.toastMsg(m, e); };

  const st = { nodes: [], scale: 1, tx: 0, ty: 0, selected: null, pid: null, open: false };
  const key = () => 'aap_canvas_' + st.pid;

  function ensurePid() {
    const pid = window.getAppProjectId ? window.getAppProjectId() : 'p_default';
    if (pid !== st.pid) { st.pid = pid; st.nodes = JSON.parse(localStorage.getItem(key()) || '[]'); st.selected = null; }
  }
  function save() { ensurePid(); localStorage.setItem(key(), JSON.stringify(st.nodes)); }

  // ---------- 渲染 ----------
  function applyTransform() {
    $('#cvWorld').style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.scale + ')';
    $('#cvZoomLabel').textContent = Math.round(st.scale * 100) + '%';
  }
  function render() {
    const world = $('#cvWorld');
    world.innerHTML = '';
    st.nodes.forEach((n) => world.appendChild(nodeEl(n)));
    applyTransform();
  }
  function nodeEl(n) {
    const el = document.createElement('div');
    el.className = 'cv-node' + (n.type === 'note' ? ' cv-note' : '') + (st.selected === n.id ? ' sel' : '');
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.width = (n.w || 220) + 'px';
    if (n.type === 'note') {
      el.innerHTML = '<textarea placeholder="写点备注…">' + esc(n.text || '') + '</textarea>';
      const ta = el.querySelector('textarea');
      ta.addEventListener('input', () => { n.text = ta.value; save(); });
      ta.addEventListener('mousedown', (e) => e.stopPropagation());
    } else {
      el.innerHTML = '<img src="' + n.src + '" draggable="false">' + (n.cap ? '<div class="cv-cap">' + esc(n.cap) + '</div>' : '');
      el.querySelector('img').addEventListener('dblclick', () => window.open(n.src, '_blank'));
    }
    const del = document.createElement('button');
    del.className = 'cv-del';
    del.title = '删除';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      st.nodes = st.nodes.filter((x) => x.id !== n.id);
      if (st.selected === n.id) st.selected = null;
      save(); render();
    });
    el.appendChild(del);
    // 拖动节点
    el.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'TEXTAREA') return;
      e.stopPropagation();
      select(n.id);
      const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
      const move = (ev) => {
        n.x = ox + (ev.clientX - sx) / st.scale;
        n.y = oy + (ev.clientY - sy) / st.scale;
        el.style.left = n.x + 'px';
        el.style.top = n.y + 'px';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    return el;
  }
  function select(id) {
    st.selected = id;
    document.querySelectorAll('.cv-node').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  }

  // ---------- 视口：平移 + 缩放 ----------
  const vp = $('#cvViewport');
  function zoomAt(cx, cy, f) {
    const rect = vp.getBoundingClientRect();
    const mx = cx - rect.left, my = cy - rect.top;
    const ns = Math.min(4, Math.max(0.15, st.scale * f));
    const k = ns / st.scale;
    st.tx = mx - (mx - st.tx) * k;
    st.ty = my - (my - st.ty) * k;
    st.scale = ns;
    applyTransform();
  }
  vp.addEventListener('mousedown', (e) => {
    if (e.target !== vp && e.target !== $('#cvWorld')) return;
    select(null);
    const sx = e.clientX, sy = e.clientY, ox = st.tx, oy = st.ty;
    vp.classList.add('panning');
    const move = (ev) => { st.tx = ox + (ev.clientX - sx); st.ty = oy + (ev.clientY - sy); applyTransform(); };
    const up = () => { vp.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  vp.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });

  // ---------- 节点操作 ----------
  function centerPos(w) {
    const rect = vp.getBoundingClientRect();
    return {
      x: Math.round((rect.width / 2 - st.tx) / st.scale - w / 2 + (Math.random() * 60 - 30)),
      y: Math.round((rect.height / 2 - st.ty) / st.scale - 90 + (Math.random() * 60 - 30)),
    };
  }
  function addImage(src, cap, w) {
    ensurePid();
    const width = w || 220;
    const p = centerPos(width);
    st.nodes.push({ id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), type: 'image', src, cap: cap || '', x: p.x, y: p.y, w: width });
    save(); render();
  }
  function addNote() {
    ensurePid();
    const p = centerPos(200);
    st.nodes.push({ id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), type: 'note', text: '', x: p.x, y: p.y, w: 200 });
    save(); render();
    const tas = document.querySelectorAll('.cv-node.cv-note textarea');
    if (tas.length) tas[tas.length - 1].focus();
  }
  function fitView() {
    if (!st.nodes.length) { st.scale = 1; st.tx = 0; st.ty = 0; applyTransform(); return; }
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    st.nodes.forEach((n) => {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 220)); maxY = Math.max(maxY, n.y + (n.type === 'note' ? 140 : 320));
    });
    const rect = vp.getBoundingClientRect();
    const pad = 40;
    const s = Math.min(4, Math.max(0.15, Math.min((rect.width - pad * 2) / (maxX - minX), (rect.height - pad * 2) / (maxY - minY))));
    st.scale = s;
    st.tx = (rect.width - (maxX - minX) * s) / 2 - minX * s;
    st.ty = (rect.height - (maxY - minY) * s) / 2 - minY * s;
    applyTransform();
  }

  // ---------- 开关与外部接口 ----------
  function open() {
    ensurePid();
    st.open = true;
    $('#canvasMask').style.display = 'flex';
    const p = (JSON.parse(localStorage.getItem('aap_projects') || '[]')).find((x) => x.id === st.pid);
    $('#canvasProjName').textContent = p ? p.name : '';
    render();
  }
  function close() { st.open = false; $('#canvasMask').style.display = 'none'; }

  $('#canvasBtn').onclick = open;
  $('#cvClose').onclick = close;
  $('#cvAddNote').onclick = addNote;
  $('#cvUpload').onclick = () => $('#cvFile').click();
  $('#cvFile').addEventListener('change', (e) => {
    Array.prototype.forEach.call(e.target.files, (f) => {
      const r = new FileReader();
      r.onload = () => addImage(r.result, f.name);
      r.readAsDataURL(f);
    });
    e.target.value = '';
  });
  $('#cvZoomIn').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); };
  $('#cvZoomOut').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); };
  $('#cvFit').onclick = fitView;
  $('#cvClear').onclick = () => { if (!st.nodes.length) return; if (window.confirm('清空画布上所有内容？')) { st.nodes = []; st.selected = null; save(); render(); } };
  $('#canvasMask').addEventListener('click', (e) => { if (e.target === $('#canvasMask')) close(); });

  document.addEventListener('keydown', (e) => {
    if (!st.open) return;
    if (e.key === 'Escape') close();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selected && document.activeElement.tagName !== 'TEXTAREA') {
      st.nodes = st.nodes.filter((x) => x.id !== st.selected);
      st.selected = null;
      save(); render();
    }
  });

  // 供 app.js 调用
  window.CV_addFromHistory = (src, cap) => { addImage(src, cap); toast(st.open ? '已加入画布' : '已加入画布（点右上角「🗺️ 画布」查看）'); };
  window.CV_onProjectSwitch = () => { if (st.open) { ensurePid(); const p = (JSON.parse(localStorage.getItem('aap_projects') || '[]')).find((x) => x.id === st.pid); $('#canvasProjName').textContent = p ? p.name : ''; render(); } };
})();
