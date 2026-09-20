// AI 游戏素材平台 · 自用版前端逻辑
const $ = (s) => document.querySelector(s);

// ---------- 项目管理（历史/角色卡/画布按项目隔离） ----------
const PROJECTS_KEY = 'aap_projects';
const ACTIVE_PROJ_KEY = 'aap_activeProject';
function loadProjects() {
  let list = JSON.parse(localStorage.getItem(PROJECTS_KEY) || 'null');
  if (!list || !list.length) {
    list = [{ id: 'p_default', name: '默认项目', createdAt: Date.now() }];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
  }
  let active = localStorage.getItem(ACTIVE_PROJ_KEY);
  if (!active || !list.some((p) => p.id === active)) active = list[0].id;
  // 旧版单项目数据迁移到激活项目
  if (!localStorage.getItem('aap_hist_' + active) && localStorage.getItem('aap_history')) {
    localStorage.setItem('aap_hist_' + active, localStorage.getItem('aap_history'));
    localStorage.removeItem('aap_history');
  }
  if (!localStorage.getItem('aap_roles_' + active) && localStorage.getItem('aap_roles')) {
    localStorage.setItem('aap_roles_' + active, localStorage.getItem('aap_roles'));
    localStorage.removeItem('aap_roles');
  }
  localStorage.setItem(ACTIVE_PROJ_KEY, active);
  return { list, active };
}
const proj0 = loadProjects();

const state = {
  projects: proj0.list,
  projectId: proj0.active,
  styles: [],
  assetTypes: [],
  models: [],
  style: '',
  assetType: '',
  modelId: '',
  customStyles: [],
  customStyleId: '',
  pendingCard: null,
  modelTab: 'all',
  roles: JSON.parse(localStorage.getItem('aap_roles_' + proj0.active) || '[]'),
  history: JSON.parse(localStorage.getItem('aap_hist_' + proj0.active) || '[]'),
};

function histKey() { return 'aap_hist_' + state.projectId; }
function rolesKey() { return 'aap_roles_' + state.projectId; }
window.getAppProjectId = () => state.projectId;

// ---------- BYOK：API Key 只存本机浏览器（用非 aap_ 前缀，避免被同步层上云） ----------
const DEVICE_KEYS = 'device_keys';
function getLocalKey(modelId) {
  try { return (JSON.parse(localStorage.getItem(DEVICE_KEYS) || '{}')[modelId]) || ''; } catch (e) { return ''; }
}
function setLocalKey(modelId, key) {
  try {
    const keys = JSON.parse(localStorage.getItem(DEVICE_KEYS) || '{}');
    if (key) keys[modelId] = key; else delete keys[modelId];
    localStorage.setItem(DEVICE_KEYS, JSON.stringify(keys));
  } catch (e) {}
}
function maskKey(k) { return k ? String(k).slice(0, 7) + '••••••' + String(k).slice(-4) : ''; }

function renderProjects() {
  const sel = $('#projectSel');
  sel.innerHTML = '';
  state.projects.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === state.projectId) o.selected = true;
    sel.appendChild(o);
  });
}
function switchProject(id) {
  if (id === state.projectId) return;
  state.projectId = id;
  localStorage.setItem(ACTIVE_PROJ_KEY, id);
  state.history = JSON.parse(localStorage.getItem(histKey()) || '[]');
  state.roles = JSON.parse(localStorage.getItem(rolesKey()) || '[]');
  renderGallery();
  renderRoles();
  updatePreview();
  if (window.CV_onProjectSwitch) window.CV_onProjectSwitch();
  const p = state.projects.find((x) => x.id === id);
  toast('已切换到「' + (p ? p.name : id) + '」');
}
function newProject() {
  const p = { id: 'p_' + Date.now(), name: '项目 ' + (state.projects.length + 1), createdAt: Date.now() };
  state.projects.push(p);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(state.projects));
  renderProjects();
  switchProject(p.id);
}
function renameProject() {
  const p = state.projects.find((x) => x.id === state.projectId);
  if (!p) return;
  const name = window.prompt('重命名项目：', p.name);
  if (name === null) return;
  p.name = name.trim() || p.name;
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(state.projects));
  renderProjects();
  if (window.CV_onProjectSwitch) window.CV_onProjectSwitch();
  toast('已重命名');
}
function delProject() {
  if (state.projects.length <= 1) { toast('至少保留一个项目', true); return; }
  const p = state.projects.find((x) => x.id === state.projectId);
  if (!window.confirm('删除项目「' + p.name + '」？其生成历史、角色卡、画布内容将一并删除，不可恢复。')) return;
  state.projects = state.projects.filter((x) => x.id !== p.id);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(state.projects));
  ['aap_hist_', 'aap_roles_', 'aap_canvas_'].forEach((k) => localStorage.removeItem(k + p.id));
  const next = state.projects[0];
  renderProjects();
  switchProject(next.id);
}
$('#projectSel').onchange = (e) => switchProject(e.target.value);
$('#projNew').onclick = newProject;
$('#projRename').onclick = renameProject;
$('#projDel').onclick = delProject;
renderProjects();

// ---------- 内置风格参考图 ----------
// 内置风格参考图：320px WebP 缩略图存于 /styles/{id}.webp（原图备份于项目 assets_orig/）；SVG 示意图仅作加载失败兜底
const STYLE_THUMB_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#eef1f6"/></svg>');
function styleThumb(id) {
  return '/styles/' + id + '.webp';
}
// 素材类型参考图：320px WebP 缩略图存于 /assettypes/{id}.webp
function typeThumb(id) {
  return '/assettypes/' + id + '.webp';
}

// ---------- 基础 UI ----------
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.textContent = ''; }, 3000);
}

function renderChips(el, items, active, onPick) {
  el.innerHTML = '';
  items.forEach((it) => {
    const c = document.createElement('div');
    c.className = 'chip' + (it === active ? ' on' : '');
    c.textContent = it;
    c.onclick = () => { onPick(it); renderChips(el, items, it, onPick); updatePreview(); };
    el.appendChild(c);
  });
}

// ---------- 配置加载 ----------
async function loadConfig() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    // 内置风格统一为对象 {id,name,prompt}，兼容旧版字符串数组
    state.styles = (cfg.styles || []).map((s) => (typeof s === 'string' ? { id: s, name: s, prompt: s + '风格' } : s));
    // 素材类型统一为对象 {id,name,prompt}，兼容旧版 {name:prompt} 字符串映射
    const rawTypes = cfg.assetTypes || {};
    state.assetTypes = Array.isArray(rawTypes)
      ? rawTypes.map((t) => (typeof t === 'string' ? { id: t, name: t, prompt: t } : t))
      : Object.keys(rawTypes).map((k) => ({ id: k, name: k, prompt: rawTypes[k] }));
    state.models = cfg.models || [];

    // BYOK：合并本机 localStorage 的 Key 状态（Key 不上云，每台设备各自配）
    state.models.forEach((m) => {
      const lk = getLocalKey(m.id);
      if (lk && !m.hasKey) { m.hasKey = true; m.keyMask = maskKey(lk); }
    });

    // 风格卡片（带缩略参考图）
    if (!state.style && state.styles.length) state.style = state.styles[0];
    renderStyleGrid();
    // 素材类型卡片（带缩略参考图）
    if (!state.assetType && state.assetTypes.length) state.assetType = state.assetTypes[0].id;
    renderTypeGrid();

    // 模型下拉（只列出「已测试通过」的生图模型；provider=chat 的 LLM 用于优化/分析，不出现）
    renderModelSelect();

    // 自定义风格卡（先取库再渲染，避免闪烁）
    await loadStyleLib();
    updatePreview();
  } catch (e) {
    toast('加载配置失败：' + e.message, true);
  }
}

// 内置风格：带缩略参考图的卡片网格
function renderStyleGrid() {
  const el = $('#styleChips');
  el.classList.add('style-grid');
  el.innerHTML = '';
  state.styles.forEach((s) => {
    const on = !state.customStyleId && state.style && state.style.id === s.id;
    const card = document.createElement('div');
    card.className = 'style-chip' + (on ? ' on' : '');
    card.title = s.prompt || s.name;
    card.innerHTML = `<div class="sc-thumb"><img src="${styleThumb(s.id)}" onerror="this.onerror=null;this.src='${STYLE_THUMB_FALLBACK}'" alt=""></div><div class="sc-name">${esc(s.name)}</div>`;
    card.onclick = () => {
      state.style = s;
      state.customStyleId = '';
      renderStyleGrid();
      renderCustomChips();
      updatePreview();
    };
    el.appendChild(card);
  });
}

// 素材类型：带缩略参考图的卡片网格
function renderTypeGrid() {
  const el = $('#typeChips');
  el.classList.add('style-grid');
  el.innerHTML = '';
  state.assetTypes.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'style-chip' + (state.assetType === t.id ? ' on' : '');
    card.title = t.prompt || t.name;
    card.innerHTML = `<div class="sc-thumb"><img src="${typeThumb(t.id)}" onerror="this.onerror=null;this.src='${STYLE_THUMB_FALLBACK}'" alt=""></div><div class="sc-name">${esc(t.name)}</div>`;
    card.onclick = () => {
      state.assetType = t.id;
      renderTypeGrid();
      updatePreview();
    };
    el.appendChild(card);
  });
}

// 生图模型下拉：只显示「已测试通过」的生图模型
function renderModelSelect() {
  const sel = $('#modelSel');
  sel.innerHTML = '';
  const imageModels = state.models.filter((m) => m.provider !== 'chat' && m.verified === true);
  imageModels.forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name;
    sel.appendChild(o);
  });
  // 当前选中项不在可用列表时，回退到第一个；无可用模型则清空
  if (!imageModels.some((m) => m.id === state.modelId)) state.modelId = imageModels.length ? imageModels[0].id : '';
  sel.value = state.modelId || '';
  sel.onchange = () => { state.modelId = sel.value; };
}

// ---------- 自定义风格库 ----------
async function loadStyleLib() {
  try {
    const lib = await fetch('/api/styles').then((r) => r.json());
    state.customStyles = lib.styles || [];
  } catch (e) { state.customStyles = []; }
  renderCustomChips();
}

function renderCustomChips() {
  const el = $('#customStyleChips');
  el.innerHTML = '';
  state.customStyles.forEach((c) => {
    const chip = document.createElement('div');
    chip.className = 'style-chip' + (state.customStyleId === c.id ? ' on' : '');
    const thumb = c.refImage ? `<img src="${c.refImage}" alt="">` : `<div class="sc-thumb-empty">${esc(c.name.slice(0, 1))}</div>`;
    chip.innerHTML = `<div class="sc-thumb">${thumb}</div><div class="sc-name">🎨 ${esc(c.name)}</div>`;
    chip.title = c.promptWords;
    chip.onclick = () => {
      state.customStyleId = (state.customStyleId === c.id) ? '' : c.id;
      if (state.customStyleId) { state.style = ''; renderStyleGrid(); }
      renderCustomChips();
      updatePreview();
    };
    el.appendChild(chip);
  });
}

async function refreshStyles() {
  await loadStyleLib();
  renderMyStyles();
}

// ---------- 提示词拼装 ----------
function assemblePrompt() {
  const custom = state.customStyles.find((c) => c.id === state.customStyleId);
  const style = custom ? custom.promptWords : (state.style && state.style.prompt ? state.style.prompt : (state.style && state.style.name ? state.style.name + '风格' : ''));
  const atObj = state.assetTypes.find((t) => t.id === state.assetType);
  const at = atObj ? atObj.prompt : '';
  const desc = $('#prompt').value.trim();
  const role = state.roles.find((r) => r.name === $('#roleSel').value);
  const parts = [];
  if (style) parts.push(style);
  if (at) parts.push(at);
  if (desc) parts.push(desc);
  if (role && role.desc) parts.push('角色设定：' + role.desc);
  return parts.join('，');
}

function updatePreview() {
  $('#preview').textContent = assemblePrompt() || '拼装后的提示词会显示在这里…';
}

// ---------- 角色卡 ----------
function renderRoles() {
  const sel = $('#roleSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">不使用角色卡</option>';
  state.roles.forEach((r) => {
    const o = document.createElement('option');
    o.value = r.name;
    o.textContent = '🎭 ' + r.name;
    sel.appendChild(o);
  });
  if (state.roles.some((r) => r.name === cur)) sel.value = cur;
}

function addRole() {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-mask"><div class="modal">
    <h3>新建角色卡</h3>
    <input id="roleName" placeholder="角色名（如：白衣剑客·阿岚）">
    <textarea id="roleDesc" placeholder="形象设定（用于锁定一致性）：白发红衣、佩长剑、眼角有泪痣…" style="min-height:80px"></textarea>
    <div class="actions">
      <button class="btn ghost" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="saveRole()">保存</button>
    </div>
  </div></div>`;
  $('#roleName').focus();
}
window.addRole = addRole;
function closeModal() { $('#modal').innerHTML = ''; }
window.closeModal = closeModal;
function saveRole() {
  const name = $('#roleName').value.trim();
  const desc = $('#roleDesc').value.trim();
  if (!name) { toast('角色名不能为空', true); return; }
  const i = state.roles.findIndex((r) => r.name === name);
  if (i >= 0) state.roles[i].desc = desc; else state.roles.push({ name, desc });
  localStorage.setItem(rolesKey(), JSON.stringify(state.roles));
  renderRoles();
  $('#roleSel').value = name;
  closeModal();
  toast('角色卡已保存');
  updatePreview();
}
window.saveRole = saveRole;
function delRole() {
  const name = $('#roleSel').value;
  if (!name) { toast('先选中要删的角色卡', true); return; }
  state.roles = state.roles.filter((r) => r.name !== name);
  localStorage.setItem(rolesKey(), JSON.stringify(state.roles));
  renderRoles();
  updatePreview();
  toast('已删除');
}
window.delRole = delRole;

// ---------- 生成 ----------
async function generate() {
  const prompt = assemblePrompt();
  if (!prompt || !$('#prompt').value.trim()) { toast('请先写一句描述', true); return; }
  if (!state.modelId) { toast('请先在「API 管理」里测试通过至少一个生图模型', true); return; }
  const btn = $('#genBtn');
  btn.disabled = true;
  btn.textContent = '生成中…';
  $('#empty').style.display = 'none';
  $('#loading').innerHTML = '<div class="loading"><div class="spinner"></div>生成中，稍等…</div>';
  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: state.modelId, prompt, ratio: $('#ratioSel').value, n: 1, styleCardId: state.customStyleId || '', apiKey: getLocalKey(state.modelId) }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || ('HTTP ' + resp.status));
    const imgs = (d.images || []).map((im) => ({
      src: im.url || (im.b64 ? 'data:image/png;base64,' + im.b64 : ''),
      prompt,
      desc: $('#prompt').value.trim(),
      styleName: (state.style && state.style.name) || '',
      typeName: (state.assetTypes.find((t) => t.id === state.assetType) || {}).name || '',
      ratio: $('#ratioSel').value,
      model: state.modelId,
      time: Date.now(),
    }));
    state.history = imgs.concat(state.history);
    localStorage.setItem(histKey(), JSON.stringify(state.history));
    renderGallery();
  } catch (e) {
    toast(e.message || '生成失败', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成';
    $('#loading').innerHTML = '';
  }
}

// ---------- 一键优化（分词解析 + 风格/类型匹配 + 优化 prompt） ----------
async function optimize() {
  const desc = $('#prompt').value.trim();
  if (!desc) { toast('先写一句描述再优化', true); return; }
  const btn = $('#optimizeBtn');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const chat = state.models.find((m) => m.provider === 'chat');
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: desc, apiKey: chat ? getLocalKey(chat.id) : '' }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || '优化失败');
    // 自动选中匹配到的风格 / 类型
    if (d.matched && d.matched.styleId) {
      const st = state.styles.find((s) => s.id === d.matched.styleId);
      if (st) { state.style = st; state.customStyleId = ''; renderStyleGrid(); renderCustomChips(); }
    }
    if (d.matched && d.matched.typeId) {
      state.assetType = d.matched.typeId;
      renderTypeGrid();
    }
    // 填入优化后的描述（可继续手动改）
    if (d.optimizedPrompt) { $('#prompt').value = d.optimizedPrompt.trim(); updatePreview(); }
    renderOptimizeResult(d);
    toast('已优化，风格/类型已自动匹配');
  } catch (e) {
    toast(e.message || '优化失败（可能未配置 LLM 的 Key）', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨';
  }
}

// 展示 AI 解析结果：要素标签 + 匹配风格/类型 + 负面词
function renderOptimizeResult(d) {
  const box = $('#optimizeResult');
  if (!box) return;
  const p = d.parsed || {};
  const tags = [];
  if (p.subject) tags.push(['主体', p.subject]);
  if (p.appearance) tags.push(['外观', p.appearance]);
  if (p.action) tags.push(['动作', p.action]);
  if (p.scene) tags.push(['场景', p.scene]);
  if (p.emotion) tags.push(['情绪', p.emotion]);
  const tagHtml = tags.map(([k, v]) => `<span class="opt-tag"><b>${esc(k)}</b>${esc(v)}</span>`).join('');
  const matchHtml = d.matched
    ? `<span class="opt-match">🎨 ${esc(d.matched.styleName || '—')} · 📦 ${esc(d.matched.typeName || '—')}</span>`
    : '';
  const negHtml = d.negative ? `<div class="opt-neg">负面词：${esc(d.negative)}</div>` : '';
  box.innerHTML = `<div class="opt-head">AI 解析结果 ${matchHtml}</div><div class="opt-tags">${tagHtml}</div>${negHtml}`;
  box.style.display = 'block';
}

// ---------- 画廊 ----------
function renderGallery() {
  const g = $('#gallery');
  const empty = $('#empty');
  $('#count').innerHTML = '共 ' + state.history.length + ' 张 · <a href="#" id="clearBtn2" style="color:var(--err)">清空</a>';
  g.innerHTML = '';
  if (!state.history.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  state.history.forEach((im, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    const modelName = (state.models.find((m) => m.id === im.model) || {}).name || im.model;
    card.innerHTML = `
      <img src="${im.src}" loading="lazy" onerror="this.style.opacity=.3" class="zoomable" title="点击放大查看" onclick="openLightbox(${idx})">
      <div class="meta"><div class="p">${im.prompt}</div><div>${modelName}</div></div>
      <div class="acts">
        <button onclick="openLightbox(${idx})">放大</button>
        <button onclick="openImg(${idx})">打开</button>
        <button onclick="copyPrompt(${idx})">复制词</button>
        <button onclick="cvAdd(${idx})" title="加入当前项目的画布">入画布</button>
        <button onclick="delImg(${idx})">删</button>
      </div>`;
    g.appendChild(card);
  });
  document.getElementById('clearBtn2').onclick = (e) => { e.preventDefault(); clearHistory(); };
}
window.openImg = (idx) => { window.open(state.history[idx].src, '_blank'); };

// ---------- 灯箱：点击放大查看大图 + 完整提示词 ----------
let lbIdx = -1;
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function ensureLightbox() {
  let lb = document.getElementById('lightbox');
  if (lb) return lb;
  lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `
    <div class="lb-mask"></div>
    <div class="lb-body">
      <button class="lb-close" title="关闭 (Esc)">✕</button>
      <button class="lb-nav lb-prev" title="上一张 (←)">‹</button>
      <button class="lb-nav lb-next" title="下一张 (→)">›</button>
      <div class="lb-imgwrap"><img id="lbImg" src="" alt=""></div>
      <div class="lb-side">
        <div class="lb-title">生成详情</div>
        <div class="lb-sec"><label>完整提示词</label><div class="lb-prompt" id="lbPrompt"></div></div>
        <div class="lb-sec" id="lbDescSec"><label>原始描述</label><div class="lb-prompt" id="lbDesc"></div></div>
        <div class="lb-tags" id="lbTags"></div>
        <div class="lb-acts">
          <button id="lbCopy">复制提示词</button>
          <button id="lbOpen">打开原图</button>
          <button id="lbDownload">下载</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(lb);
  lb.querySelector('.lb-mask').onclick = closeLightbox;
  lb.querySelector('.lb-close').onclick = closeLightbox;
  lb.querySelector('.lb-prev').onclick = () => stepLightbox(-1);
  lb.querySelector('.lb-next').onclick = () => stepLightbox(1);
  lb.querySelector('#lbCopy').onclick = () => {
    navigator.clipboard.writeText(state.history[lbIdx].prompt).then(() => toast('提示词已复制')).catch(() => toast('复制失败', true));
  };
  lb.querySelector('#lbOpen').onclick = () => window.open(state.history[lbIdx].src, '_blank');
  lb.querySelector('#lbDownload').onclick = () => {
    const im = state.history[lbIdx];
    const a = document.createElement('a');
    a.href = im.src;
    a.download = 'asset-' + new Date(im.time || Date.now()).getTime() + '.png';
    a.target = '_blank';
    a.click();
  };
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('on')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
  });
  return lb;
}
function fillLightbox() {
  const im = state.history[lbIdx];
  const lb = document.getElementById('lightbox');
  lb.querySelector('#lbImg').src = im.src;
  lb.querySelector('#lbPrompt').textContent = im.prompt || '（无）';
  const descSec = lb.querySelector('#lbDescSec');
  if (im.desc && im.desc !== im.prompt) { descSec.style.display = ''; lb.querySelector('#lbDesc').textContent = im.desc; }
  else descSec.style.display = 'none';
  const modelName = (state.models.find((m) => m.id === im.model) || {}).name || im.model || '';
  const tags = [modelName, im.styleName && '风格：' + im.styleName, im.typeName && '类型：' + im.typeName, im.ratio && '比例：' + im.ratio, im.time && fmtTime(im.time)].filter(Boolean);
  lb.querySelector('#lbTags').innerHTML = tags.map((t) => '<span>' + esc(t) + '</span>').join('');
  lb.querySelector('.lb-prev').style.display = state.history.length > 1 ? '' : 'none';
  lb.querySelector('.lb-next').style.display = state.history.length > 1 ? '' : 'none';
}
window.openLightbox = (idx) => {
  if (!state.history[idx]) return;
  lbIdx = idx;
  ensureLightbox();
  fillLightbox();
  document.getElementById('lightbox').classList.add('on');
};
function closeLightbox() { const lb = document.getElementById('lightbox'); if (lb) lb.classList.remove('on'); }
function stepLightbox(dir) {
  if (!state.history.length) return;
  lbIdx = (lbIdx + dir + state.history.length) % state.history.length;
  fillLightbox();
}
window.copyPrompt = (idx) => {
  navigator.clipboard.writeText(state.history[idx].prompt).then(() => toast('提示词已复制')).catch(() => toast('复制失败', true));
};
window.delImg = (idx) => { state.history.splice(idx, 1); localStorage.setItem(histKey(), JSON.stringify(state.history)); closeLightbox(); renderGallery(); };
function clearHistory() { state.history = []; localStorage.setItem(histKey(), JSON.stringify(state.history)); renderGallery(); }
window.clearHistory = clearHistory;
window.toastMsg = toast;
// 「入画布」：把生成结果写入当前项目的画布数据（画布是独立页，这里只负责落库）
window.cvAdd = (idx) => {
  const im = state.history[idx];
  if (!im || !im.src) { toast('该记录没有图片', true); return; }
  const ck = 'aap_canvas_' + state.projectId;
  let nodes = [];
  try { nodes = JSON.parse(localStorage.getItem(ck) || '[]'); } catch (e) {}
  nodes.push({ id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), type: 'image', src: im.src, cap: im.desc || '', x: 40 + (nodes.length % 6) * 48, y: 40 + (nodes.length % 6) * 48, w: 220 });
  localStorage.setItem(ck, JSON.stringify(nodes));
  toast('已加入画布，点右上角「🗺️ 画布」查看');
};

// ---------- 事件绑定 ----------
$('#prompt').addEventListener('input', updatePreview);
$('#genBtn').onclick = generate;
$('#optimizeBtn').onclick = optimize;
$('#addRole').onclick = addRole;
$('#delRole').onclick = delRole;
$('#clearBtn').onclick = (e) => { e.preventDefault(); clearHistory(); };
$('#canvasBtn').onclick = () => { location.href = '/canvas.html?pid=' + state.projectId; };

// ---------- 启动 ----------
loadConfig().then(() => {
  renderRoles();
  renderGallery();
});

// ========== API 管理面板 ==========
const PROVIDERS = [
  { v: 'openai', label: '图片·OpenAI兼容' },
  { v: 'dashscope', label: '图片·阿里百炼' },
  { v: 'chat', label: '对话·LLM润色' },
];
// 供应商预设：选平台 → 自动带出 baseUrl + 常用模型，用户只需填 Key
const SUPPLIERS = [
  { id: 'cherryin', name: 'CherryIN 网关（聚合中转）', baseUrl: 'https://open.cherryin.net/v1', kind: 'openai', models: [] },
  { id: 'volc', name: '火山方舟（Seedream / 豆包）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', kind: 'openai', models: [
    { m: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0 · 生图', type: 'image' },
    { m: 'doubao-seed-1-6-vision-250815', label: '豆包视觉 · 润色/风格分析', type: 'chat' },
  ]},
  { id: 'ali', name: '阿里百炼（通义万相）', baseUrl: 'https://dashscope.aliyuncs.com', kind: 'dashscope', models: [
    { m: 'wanx2.1-t2i-turbo', label: '通义万相 · 生图', type: 'image' },
  ]},
  { id: 'siliconflow', name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', kind: 'openai', models: [
    { m: 'Kwai-Kolors/Kolors', label: '可图 Kolors · 生图', type: 'image' },
    { m: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3 · 对话', type: 'chat' },
  ]},
  { id: 'deepseek', name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com', kind: 'chat', models: [
    { m: 'deepseek-chat', label: 'DeepSeek · 对话', type: 'chat' },
  ]},
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', kind: 'openai', models: [
    { m: 'glm-4-plus', label: 'GLM-4-Plus · 对话', type: 'chat' },
    { m: 'cogview-3-flash', label: 'CogView-3 · 生图', type: 'image' },
  ]},
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', kind: 'chat', models: [
    { m: 'moonshot-v1-8k', label: 'Kimi · 对话', type: 'chat' },
  ]},
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', kind: 'openai', models: [
    { m: 'gpt-image-1', label: 'gpt-image-1 · 生图', type: 'image' },
    { m: 'gpt-4o', label: 'GPT-4o · 对话', type: 'chat' },
  ]},
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai', models: [
    { m: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash · 对话', type: 'chat' },
  ]},
  { id: 'custom', name: '自定义（OpenAI 兼容中转 / one-api / new-api）', baseUrl: '', kind: 'openai', models: [] },
];
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function openSettings() { $('#settingsMask').style.display = 'flex'; state.modelTab = 'all'; syncModelTabs(); renderModelList(); }
function closeSettings() { $('#settingsMask').style.display = 'none'; }

// 模型分类：provider=chat → 文字（LLM），其余 → 图片（生图）
function modelKind(m) { return m.provider === 'chat' ? 'chat' : 'image'; }
function syncModelTabs() {
  document.querySelectorAll('#modelTabs .mc-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.modelTab));
}
document.getElementById('modelTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.mc-tab');
  if (!btn) return;
  state.modelTab = btn.dataset.tab;
  syncModelTabs();
  renderModelList();
});

function renderModelList() {
  const box = $('#modelList');
  box.innerHTML = '';
  const shown = state.models.filter((m) => state.modelTab === 'all' || modelKind(m) === state.modelTab);
  if (!shown.length) {
    box.innerHTML = `<div class="mc-empty">${state.modelTab === 'chat' ? '还没有文字模型（对话 LLM，用于提示词优化/风格分析）' : '还没有图片模型（生图用）'}——用上方「快速接入」或「手动新增模型」添加。</div>`;
    return;
  }
  state.models.forEach((m, idx) => {
    if (state.modelTab !== 'all' && modelKind(m) !== state.modelTab) return;
    const card = document.createElement('div');
    card.className = 'model-card';
    card.dataset.idx = String(idx);
    const hasKey = !!(m.hasKey || m.apiKey);
    const keyDot = hasKey ? '<span class="mc-keydot on">● 已配 Key</span>' : '<span class="mc-keydot off">○ 未配 Key</span>';
    const verifyDot = m.verified ? '<span class="mc-keydot ok">✓ 已测试通过</span>' : '<span class="mc-keydot warn">○ 待测试</span>';
    card.innerHTML = `
      <div class="mc-head">
        <span class="mc-title">${esc(m.name)}</span>
        <span class="mc-tag">${esc((PROVIDERS.find((p) => p.v === m.provider) || {}).label || m.provider)}</span>
        ${keyDot}
        ${verifyDot}
        <button class="mc-test" data-act="test" data-idx="${idx}">测试</button>
        <button class="mc-more" data-act="more" data-idx="${idx}">高级 ▾</button>
        <button class="mc-del" data-act="del" data-idx="${idx}">删除</button>
      </div>
      <div class="mc-grid mc-adv" data-adv="${idx}" style="display:none">
        <div class="mc-field full"><label>显示名称</label><input data-f="name" data-idx="${idx}" value="${esc(m.name)}"></div>
        <div class="mc-field"><label>接口类型</label><select data-f="provider" data-idx="${idx}">${PROVIDERS.map((p) => `<option value="${p.v}"${p.v === m.provider ? ' selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="mc-field"><label>模型 ID</label><input data-f="model" data-idx="${idx}" value="${esc(m.model)}" placeholder="doubao-seedream-4-0-250828"></div>
        <div class="mc-field full"><label>Base URL</label><input data-f="baseUrl" data-idx="${idx}" value="${esc(m.baseUrl)}" placeholder="https://..."></div>
        <div class="mc-field full"><label>API Key</label>
          <div class="kv-wrap">
            <input data-f="apiKey" data-idx="${idx}" type="password" placeholder="${hasKey ? '已配置（留空则不修改）' : '粘贴你的 API Key'}">
            <button class="kv-toggle" data-act="toggle" data-idx="${idx}">显示</button>
          </div>
          ${hasKey
            ? `<div class="mc-keyhint">已存 Key：<code>${esc(m.keyMask || '已配置')}</code>　<button class="mini" data-act="viewkey" data-idx="${idx}">查看完整</button>　输入框留空 = 继续用这把 Key</div>`
            : '<div class="mc-keyhint off">尚未配置 Key，粘贴后点「测试」验证、再「保存配置」生效</div>'}
        </div>
      </div>
      <div class="mc-status" data-idx="${idx}"></div>`;
    box.appendChild(card);
  });
}

// 事件委托：测试 / 删除 / 显示 Key
$('#modelList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const idx = +btn.dataset.idx;
  if (act === 'test') testModelConn(idx);
  else if (act === 'del') delModel(idx);
  else if (act === 'viewkey') viewStoredKey(idx);
  else if (act === 'more') {
    const adv = document.querySelector(`.mc-adv[data-adv="${idx}"]`);
    const show = adv.style.display === 'none';
    adv.style.display = show ? 'grid' : 'none';
    btn.textContent = show ? '高级 ▴' : '高级 ▾';
  }
  else if (act === 'toggle') {
    const inp = btn.closest('.kv-wrap').querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.textContent = show ? '隐藏' : '显示';
  }
});

function readCardModel(idx) {
  const card = document.querySelector(`.model-card[data-idx="${idx}"]`);
  const g = (f) => card.querySelector(`[data-f="${f}"]`).value.trim();
  let apiKey = g('apiKey');
  // BYOK：Key 输入框留空时，回退本机 localStorage，再回退内存临时 Key（新接入模型）
  if (!apiKey) apiKey = getLocalKey(state.models[idx].id);
  if (!apiKey && state.models[idx] && state.models[idx].apiKey) apiKey = state.models[idx].apiKey;
  return {
    id: state.models[idx].id,
    name: g('name'),
    provider: g('provider'),
    baseUrl: g('baseUrl'),
    model: g('model'),
    apiKey,
  };
}

async function viewStoredKey(idx) {
  const card = document.querySelector(`.model-card[data-idx="${idx}"]`);
  const inp = card.querySelector('[data-f="apiKey"]');
  const m = state.models[idx];
  if (!m) return;
  try {
    const resp = await fetch('/api/config/key?id=' + encodeURIComponent(m.id));
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || '读取失败');
    inp.value = d.key || '';
    inp.type = 'text';
    inp.focus();
    if (!d.key) toast('该模型未配置 Key', true);
  } catch (e) {
    toast('读取 Key 失败：' + e.message, true);
  }
}

async function testModelConn(idx) {
  const card = document.querySelector(`.model-card[data-idx="${idx}"]`);
  const btn = card.querySelector('[data-act="test"]');
  const status = card.querySelector('.mc-status');
  btn.disabled = true; btn.classList.remove('ok', 'fail'); btn.classList.add('loading'); btn.textContent = '测试中…';
  status.textContent = ''; status.className = 'mc-status';
  try {
    const model = readCardModel(idx);
    const resp = await fetch('/api/config/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const d = await resp.json();
    btn.classList.remove('loading');
    const keyInput = card.querySelector('[data-f="apiKey"]');
    const usedStoredKey = d.ok && keyInput && !keyInput.value.trim() && !!(state.models[idx] && state.models[idx].hasKey);
    if (d.ok) {
      state.models[idx].verified = true;
      btn.classList.add('ok'); status.className = 'mc-status ok'; status.textContent = '✓ ' + d.message + (usedStoredKey ? '（测试用的是已存 Key）' : '') + '（已加入生图下拉）';
    } else {
      state.models[idx].verified = false;
      btn.classList.add('fail'); status.className = 'mc-status fail'; status.textContent = '✗ ' + (d.message || '失败');
    }
    renderModelSelect();
  } catch (e) {
    btn.classList.remove('loading'); btn.classList.add('fail');
    status.className = 'mc-status fail'; status.textContent = '✗ ' + e.message;
    if (state.models[idx]) { state.models[idx].verified = false; renderModelSelect(); }
  } finally {
    btn.disabled = false; btn.textContent = '测试';
  }
}

function delModel(idx) {
  if (state.models.length <= 1) { toast('至少保留一个模型', true); return; }
  state.models.splice(idx, 1);
  renderModelList();
}

function addModel() {
  state.models.push({ id: 'm_' + Date.now(), name: '新模型', provider: 'openai', baseUrl: '', model: '', apiKey: '', hasKey: false, verified: false });
  renderModelList();
}

async function saveSettings() {
  const models = [];
  let valid = true;
  document.querySelectorAll('.model-card').forEach((card) => {
    const idx = +card.dataset.idx;
    const m = readCardModel(idx);
    if (!m.name) valid = false;
    models.push(m);
  });
  if (!valid) { toast('每个模型的「显示名称」不能为空', true); return; }
  const btn = $('#saveSettings');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    // BYOK：Key 只存本机 localStorage（不上服务端），传服务端的 models 剥离 apiKey
    const keys = {};
    models.forEach((m) => { if (m.apiKey) keys[m.id] = m.apiKey; });
    if (Object.keys(keys).length) {
      const existing = JSON.parse(localStorage.getItem(DEVICE_KEYS) || '{}');
      Object.assign(existing, keys);
      localStorage.setItem(DEVICE_KEYS, JSON.stringify(existing));
    }
    const modelsForServer = models.map((m) => { const { apiKey, ...rest } = m; return rest; });
    const resp = await fetch('/api/config/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: modelsForServer }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || '保存失败');
    toast(d.message || '已保存');
    closeSettings();
    await loadConfig();
  } catch (e) {
    toast(e.message || '保存失败', true);
  } finally {
    btn.disabled = false; btn.textContent = '保存配置';
  }
}

$('#settingsBtn').onclick = openSettings;
$('#closeSettings').onclick = closeSettings;
$('#cancelSettings').onclick = closeSettings;
$('#addModelBtn').onclick = addModel;
$('#saveSettings').onclick = saveSettings;
$('#settingsMask').addEventListener('click', (e) => { if (e.target === $('#settingsMask')) closeSettings(); });

// ========== 快速接入 ==========
function renderSuppliers() {
  const sel = $('#supplierSel');
  sel.innerHTML = SUPPLIERS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  sel.onchange = onSupplierChange;
  onSupplierChange();
}
function onSupplierChange() {
  const s = SUPPLIERS.find((x) => x.id === $('#supplierSel').value);
  const baseInput = $('#quickBaseUrl');
  const hint = $('#quickHint');
  if (s.id === 'custom') {
    baseInput.style.display = 'block';
    hint.textContent = '中转网关：填地址 + Key，接入后手动填模型名即可（任意 OpenAI 兼容中转都行）。';
  } else {
    baseInput.style.display = 'none';
    hint.textContent = '接入后自动加入：' + (s.models.length ? s.models.map((m) => m.label).join('、') : '（此平台需手动填模型名）');
  }
}
async function quickConnect() {
  const s = SUPPLIERS.find((x) => x.id === $('#supplierSel').value);
  const key = $('#quickKey').value.trim();
  const baseUrl = (s.id === 'custom' ? $('#quickBaseUrl').value.trim() : s.baseUrl);
  if (!key) { toast('请先粘贴 API Key', true); return; }
  if (!baseUrl) { toast('请填写网关地址', true); return; }
  const btn = $('#quickConnect');
  btn.disabled = true; btn.textContent = '验证中…';
  $('#quickResult').innerHTML = '';
  try {
    if (s.models.length) {
      // 预设供应商：验证 Key 后直接接入预设模型
      const first = s.models[0];
      const probeProvider = s.kind === 'dashscope' ? 'dashscope' : (first && first.type === 'chat' ? 'chat' : 'openai');
      const resp = await fetch('/api/config/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: { id: s.id, provider: probeProvider, baseUrl, model: (first && first.m) || 'ping', apiKey: key } }),
      });
      const d = await resp.json();
      if (!d.ok) { $('#quickResult').innerHTML = `<div class="qc-msg fail">✗ ${esc(d.message || '验证失败')}</div>`; return; }
      let added = 0;
      s.models.forEach((mi) => {
        const provider = s.kind === 'dashscope' ? 'dashscope' : (mi.type === 'chat' ? 'chat' : 'openai');
        const exist = state.models.find((x) => x.baseUrl === baseUrl && x.model === mi.m);
        if (exist) return; // 已存在则跳过
        state.models.push({ id: s.id + '_' + mi.m.replace(/[^a-zA-Z0-9]/g, ''), name: mi.label, provider, baseUrl, model: mi.m, apiKey: key, hasKey: true, verified: true });
        added++;
      });
      renderModelList();
      $('#quickResult').innerHTML = `<div class="qc-msg ok">✓ 验证通过，已接入 ${added} 个模型。点下方「保存配置」生效。</div>`;
    } else {
      // 空模型供应商（CherryIN / 自定义网关）：探测 /models 列表，成功后弹勾选面板
      const resp = await fetch('/api/models/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: key }),
      });
      const d = await resp.json();
      if (d.ok && d.models && d.models.length) {
        renderModelPicker(d.models, baseUrl, key);
        return;
      }
      // 探测失败：Key 可能仍有效（网关不支持 /models），降级保存网关，留空模型名待填
      state.models.push({ id: 'm_' + Date.now(), name: '自定义模型（点「高级」填模型名）', provider: 'openai', baseUrl, model: '', apiKey: key, hasKey: true, verified: false });
      renderModelList();
      $('#quickResult').innerHTML = `<div class="qc-msg ok">✓ 网关已保存（未返回模型列表，可能不支持探测）。点该模型「高级」填模型名后点「保存配置」。</div>`;
    }
    $('#quickKey').value = '';
  } catch (e) {
    $('#quickResult').innerHTML = `<div class="qc-msg fail">✗ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '接入并验证';
    // BYOK：快速接入的 Key 立即存本机浏览器（Key 不上云）
    state.models.forEach((m) => { if (m.apiKey) setLocalKey(m.id, m.apiKey); });
  }
}
$('#quickConnect').onclick = quickConnect;
renderSuppliers();

// 模型类型启发式判断：生图关键词 → image，其余按 chat
function inferModelType(id) {
  const s = String(id).toLowerCase();
  if (/(image|dall|imagen|flux|stable|seedream|wanx|cogview|kolors|t2i|i2i|diffus|midjourney|pixel)/.test(s)) return 'image';
  return 'chat';
}

// 探测结果勾选面板：批量勾选接入
function renderModelPicker(models, baseUrl, key) {
  const m = $('#modal');
  const types = models.map((id) => ({ id, type: inferModelType(id) }));
  const imgCount = types.filter((t) => t.type === 'image').length;
  const pre = types.filter((t) => t.type === 'image');
  const sel = new Set((pre.length ? pre : types.slice(0, 8)).map((t) => t.id));
  m.innerHTML = `<div class="modal-mask"><div class="modal picker">
    <h3>探测到 ${models.length} 个模型</h3>
    <div class="picker-bar">
      <button class="btn ghost" id="pickAll">全选</button>
      <button class="btn ghost" id="pickNone">清空</button>
      <button class="btn ghost" id="pickImg">只选生图(${imgCount})</button>
      <input id="pickSearch" placeholder="搜索模型名…">
    </div>
    <div class="picker-list" id="pickList"></div>
    <div class="actions">
      <button class="btn ghost" onclick="closeModal()">取消</button>
      <button class="btn primary" id="pickConfirm">接入所选模型</button>
    </div>
  </div></div>`;
  const render = (filter) => {
    const list = $('#pickList');
    list.innerHTML = '';
    types.forEach((t) => {
      if (filter && !t.id.toLowerCase().includes(filter)) return;
      const row = document.createElement('label');
      row.className = 'pick-row';
      row.innerHTML = `<input type="checkbox" ${sel.has(t.id) ? 'checked' : ''}><span class="pt-icon">${t.type === 'image' ? '🎨' : '💬'}</span><span class="pt-id">${esc(t.id)}</span>`;
      row.querySelector('input').onchange = (e) => { e.target.checked ? sel.add(t.id) : sel.delete(t.id); };
      list.appendChild(row);
    });
  };
  render('');
  $('#pickAll').onclick = () => { types.forEach((t) => sel.add(t.id)); render($('#pickSearch').value.trim().toLowerCase()); };
  $('#pickNone').onclick = () => { sel.clear(); render($('#pickSearch').value.trim().toLowerCase()); };
  $('#pickImg').onclick = () => { sel.clear(); types.filter((t) => t.type === 'image').forEach((t) => sel.add(t.id)); render($('#pickSearch').value.trim().toLowerCase()); };
  $('#pickSearch').oninput = (e) => render(e.target.value.trim().toLowerCase());
  $('#pickConfirm').onclick = () => {
    const chosen = types.filter((t) => sel.has(t.id));
    if (!chosen.length) { toast('至少勾选一个模型', true); return; }
    let added = 0;
    chosen.forEach((t) => {
      const provider = t.type === 'image' ? 'openai' : 'chat';
      const exist = state.models.find((x) => x.baseUrl === baseUrl && x.model === t.id);
      if (exist) return;
      const id = 'm_' + Date.now() + '_' + (added++);
      state.models.push({ id, name: (t.type === 'image' ? '🎨 ' : '💬 ') + t.id, provider, baseUrl, model: t.id, apiKey: key, hasKey: true, verified: true });
      setLocalKey(id, key);
    });
    closeModal();
    renderModelList();
    $('#quickResult').innerHTML = `<div class="qc-msg ok">✓ 已接入 ${added} 个模型，点「保存配置」生效。</div>`;
    $('#quickKey').value = '';
  };
}

// ========== 风格工坊 ==========
function openStyleLib() { $('#styleLibMask').style.display = 'flex'; renderMyStyles(); }
function closeStyleLib() { $('#styleLibMask').style.display = 'none'; }

// 图片压缩：最长边 512px，JPEG 0.85
function compressImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('请选择图片文件', true); return; }
  $('#analyzeResult').style.display = 'none';
  $('#uploadZone').querySelector('.upload-inner').innerHTML = '<div class="analyzing"><div class="spinner"></div>AI 正在分析风格特征…</div>';
  try {
    const dataUrl = await compressImage(file, 512);
    const resp = await fetch('/api/style/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || '分析失败');
    state.pendingCard = Object.assign({}, d.card, { refImage: dataUrl });
    fillCardForm(d.card, dataUrl);
  } catch (e) {
    toast(e.message || '分析失败', true);
  } finally {
    $('#uploadZone').querySelector('.upload-inner').innerHTML = '📷 点击选择或拖拽图片到这里<br><span>单张参考图即可 · 自动压缩后交给视觉模型分析</span>';
  }
}

function fillCardForm(card, imgSrc) {
  $('#previewImg').src = imgSrc || (state.pendingCard && state.pendingCard.refImage) || '';
  $('#cardName').value = card.name || '';
  $('#cardSummary').value = card.summary || '';
  $('#cardWords').value = card.promptWords || '';
  $('#cardPixel').value = card.pixelHint || '';
  const feats = $('#cardFeatures');
  feats.innerHTML = '';
  (card.features || []).forEach((f) => {
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = f;
    feats.appendChild(c);
  });
  $('#analyzeResult').style.display = 'block';
}

async function saveCard() {
  if (!state.pendingCard) { toast('请先上传并分析一张图片', true); return; }
  const name = $('#cardName').value.trim();
  const words = $('#cardWords').value.trim();
  if (!name || !words) { toast('风格名称和修饰词不能为空', true); return; }
  const btn = $('#saveCard');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const resp = await fetch('/api/styles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        summary: $('#cardSummary').value.trim(),
        features: state.pendingCard.features || [],
        promptWords: words,
        pixelHint: $('#cardPixel').value,
        refImage: state.pendingCard.refImage,
      }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || '保存失败');
    state.pendingCard = null;
    $('#analyzeResult').style.display = 'none';
    $('#fileInput').value = '';
    await refreshStyles();
    toast('风格卡已保存，生成页可直接套用');
  } catch (e) {
    toast(e.message || '保存失败', true);
  } finally {
    btn.disabled = false; btn.textContent = '保存风格卡';
  }
}

function renderMyStyles() {
  const box = $('#myStyles');
  box.innerHTML = '';
  if (!state.customStyles.length) {
    box.innerHTML = '<div class="empty" style="padding:24px">还没有风格卡。上传一张图试试 →</div>';
    return;
  }
  state.customStyles.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'style-card';
    card.innerHTML = `
      ${c.refImage ? `<img src="${c.refImage}" loading="lazy">` : ''}
      <div class="sc-body">
        <div class="sc-name">🎨 ${esc(c.name)}</div>
        <div class="sc-sum">${esc(c.summary || '')}</div>
        <div class="sc-words">${esc(c.promptWords)}</div>
      </div>
      <div class="sc-acts"><button data-del="${c.id}">删除</button></div>`;
    card.querySelector('[data-del]').onclick = async () => {
      await fetch('/api/styles?id=' + encodeURIComponent(c.id), { method: 'DELETE' });
      if (state.customStyleId === c.id) state.customStyleId = '';
      await refreshStyles();
      toast('已删除');
    };
    box.appendChild(card);
  });
}

// 上传交互：点击 + 拖拽
$('#uploadZone').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); };
$('#uploadZone').addEventListener('dragover', (e) => { e.preventDefault(); });
$('#uploadZone').addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
$('#saveCard').onclick = saveCard;
$('#discardCard').onclick = () => {
  state.pendingCard = null;
  $('#analyzeResult').style.display = 'none';
  $('#fileInput').value = '';
  toast('已清空，可重新上传分析');
};
$('#styleLibBtn').onclick = openStyleLib;
$('#closeStyleLib').onclick = closeStyleLib;
$('#openStyleLibLink').onclick = (e) => { e.preventDefault(); openStyleLib(); };
$('#styleLibMask').addEventListener('click', (e) => { if (e.target === $('#styleLibMask')) closeStyleLib(); });

// ========== 配方管理（风格词 + 素材类型规格，可视化编辑） ==========
const DEFAULT_STYLES = [
  { id: 'xianxia', name: '仙侠', prompt: '仙侠水墨风，墨色晕染，云雾缭绕，飘渺空灵，宣纸质感，淡雅配色，飞白笔触，仙气氤氲' },
  { id: 'anime', name: '二次元', prompt: '日式赛璐璐动画风，明快高饱和配色，精细线稿，干净平涂，柔和光影，动漫质感' },
  { id: 'pixel', name: '像素', prompt: '复古像素点阵风，8-bit 颗粒感，清晰色块，有限调色板，游戏像素艺术' },
  { id: 'guofeng', name: '国风', prompt: '国风水墨风，山水留白意境，宣纸肌理，古雅配色，写意笔法' },
  { id: 'cyberpunk', name: '赛博朋克', prompt: '赛博朋克风，霓虹灯牌，紫蓝冷调，金属与玻璃质感，高对比光影，未来都市氛围' },
  { id: 'dark', name: '暗黑奇幻', prompt: '暗黑奇幻风，哥特厚重暗调，冷峻氛围，电影级明暗对比，史诗神秘感' },
  { id: 'chibi', name: 'Q版可爱', prompt: 'Q版卡通风，圆润比例，糖果配色，软萌治愈，简洁扁平' },
  { id: 'steampunk', name: '蒸汽朋克', prompt: '蒸汽朋克风，黄铜齿轮机械质感，维多利亚复古，做旧金属，暖棕金配色' },
];
const DEFAULT_TYPES = [
  { id: 'avatar', name: '头像', prompt: '半身头像，干净纯色背景，主体居中，高细节特写，柔和光线' },
  { id: 'portrait', name: '角色立绘', prompt: '全身立绘，完整角色设定，动态姿势，电影级打光，精致细节' },
  { id: 'wallpaper', name: '壁纸', prompt: '横版全景，前景中景远景层次，氛围光，无文字无水印' },
  { id: 'emoji', name: '表情包', prompt: '夸张表情，情绪强烈，主体突出，纯色背景，适合聊天表情' },
  { id: 'scene', name: '游戏场景', prompt: '横版游戏场景，层次丰富，可平铺延伸，透视空间感' },
  { id: 'ui', name: 'UI图标', prompt: '扁平化图标，描边清晰，风格统一，纯色背景，游戏界面用' },
  { id: 'pixel_char', name: '像素角色', prompt: '游戏角色 sprite，全身，纯色背景，网格对齐' },
  { id: 'pixel_prop', name: '像素道具', prompt: '单件道具图标，居中，纯色背景，细节清晰' },
  { id: 'pixel_pack', name: '像素素材包', prompt: '多件道具网格排列，4x3 网格，每格一件独立道具，风格统一，纯色背景' },
  { id: 'pixel_tileset', name: '像素图块', prompt: 'tileset 图块，四方连续可平铺，游戏地图用，纯色背景' },
];

function openPromptLib() { $('#promptLibMask').style.display = 'flex'; renderPromptLib(); }
function closePromptLib() { $('#promptLibMask').style.display = 'none'; }

function renderPromptLib(styles, types) {
  const ss = styles || state.styles || [];
  const ts = types || state.assetTypes || [];
  const sb = $('#plStyles');
  sb.innerHTML = '';
  ss.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'pl-row';
    row.innerHTML = `<div class="pl-head"><span class="pl-name">${esc(s.name)}</span><code class="pl-id">${esc(s.id)}</code></div><textarea class="pl-input" data-pl="style" data-idx="${i}">${esc(s.prompt || '')}</textarea>`;
    sb.appendChild(row);
  });
  const tb = $('#plTypes');
  tb.innerHTML = '';
  ts.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'pl-row';
    row.innerHTML = `<div class="pl-head"><span class="pl-name">${esc(t.name)}</span><code class="pl-id">${esc(t.id)}</code></div><textarea class="pl-input" data-pl="type" data-idx="${i}">${esc(t.prompt || '')}</textarea>`;
    tb.appendChild(row);
  });
}

async function savePromptLib() {
  const styles = [];
  document.querySelectorAll('[data-pl="style"]').forEach((ta, i) => {
    const s = state.styles[i];
    if (!s) return;
    styles.push({ id: s.id, name: s.name, prompt: ta.value.trim() });
  });
  const assetTypes = [];
  document.querySelectorAll('[data-pl="type"]').forEach((ta, i) => {
    const t = state.assetTypes[i];
    if (!t) return;
    assetTypes.push({ id: t.id, name: t.name, prompt: ta.value.trim() });
  });
  const btn = $('#savePromptLib');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const resp = await fetch('/api/promptlib', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ styles, assetTypes }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || '保存失败');
    toast(d.message || '已保存');
    closePromptLib();
    await loadConfig();
    updatePreview();
  } catch (e) {
    toast(e.message || '保存失败', true);
  } finally {
    btn.disabled = false; btn.textContent = '保存配方';
  }
}

$('#promptLibBtn').onclick = openPromptLib;
$('#closePromptLib').onclick = closePromptLib;
$('#closePromptLib2').onclick = closePromptLib;
$('#savePromptLib').onclick = savePromptLib;
$('#plReset').onclick = () => {
  if (!confirm('恢复默认风格词和素材类型规格？会覆盖当前编辑内容（需点「保存配方」才落盘）。')) return;
  renderPromptLib(DEFAULT_STYLES, DEFAULT_TYPES);
};
$('#promptLibMask').addEventListener('click', (e) => { if (e.target === $('#promptLibMask')) closePromptLib(); });
