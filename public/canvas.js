// 自由画布（独立页版）：素材拼贴，平移/缩放/图片与便签节点/拖拽/自动保存（按项目隔离）
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 项目 id 解析：URL ?pid= 优先，其次 localStorage 激活项目，兜底默认 ----------
  function resolvePid() {
    const q = new URLSearchParams(location.search).get('pid');
    if (q) return q;
    try { return localStorage.getItem('aap_activeProject') || 'p_default'; } catch (e) { return 'p_default'; }
  }
  const PID = resolvePid();
  const key = () => 'aap_canvas_' + PID;

  const st = { nodes: JSON.parse(localStorage.getItem(key()) || '[]'), scale: 1, tx: 0, ty: 0, selected: null, pid: PID };

  function save() { localStorage.setItem(key(), JSON.stringify(st.nodes)); }

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
    el.dataset.id = n.id;
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
    const width = w || 220;
    const p = centerPos(width);
    st.nodes.push({ id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), type: 'image', src, cap: cap || '', x: p.x, y: p.y, w: width });
    save(); render();
  }
  function addNote() {
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
  function goBack() { location.href = '/'; }

  // ---------- 绑定 ----------
  $('#cvBack').onclick = goBack;
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { goBack(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.selected && document.activeElement.tagName !== 'TEXTAREA') {
      st.nodes = st.nodes.filter((x) => x.id !== st.selected);
      st.selected = null;
      save(); render();
    }
  });

  // ---------- 初始化：显示项目名 + 渲染 + 有内容则自适应视图 ----------
  (function init() {
    let pname = '';
    try {
      const projs = JSON.parse(localStorage.getItem('aap_projects') || '[]');
      const p = projs.find((x) => x.id === PID);
      if (p) pname = p.name;
    } catch (e) {}
    $('#canvasProjName').textContent = pname || PID;
    render();
    if (st.nodes.length) setTimeout(fitView, 60);
  })();
})();
