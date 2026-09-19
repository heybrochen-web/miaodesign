// AI 游戏素材平台 · 自用版服务端（零依赖，Node 22+）
// 启动：node server.js  然后浏览器打开 http://127.0.0.1:8787
// 聚合多模型：OpenAI 兼容接口（火山Seedream / 任意new-api网关的GPT/Gemini）+ 阿里百炼(万相)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const STYLELIB_PATH = path.join(ROOT, 'stylelib.json');
const PORT = process.env.PORT || 8787;
// 演示模式：DEMO_MODE=1 时只读（禁改配置、禁取 Key），用于发布无账号演示版
const DEMO = process.env.DEMO_MODE === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 尺寸映射：前端传 ratio，这里按 provider 翻译成各自格式
const RATIO_MAP = {
  '1:1': { openai: '1024x1024', dashscope: '1024*1024' },
  '16:9': { openai: '1280x720', dashscope: '1280*720' },
  '9:16': { openai: '720x1280', dashscope: '720*1280' },
  '4:3': { openai: '1152x864', dashscope: '1152*864' },
  '3:4': { openai: '864x1152', dashscope: '864*1152' },
};
// Seedream 5.x 要求总像素 ≥ 3686400（1920x1920），走 2K 档尺寸
const SEEDREAM5_RATIO = {
  '1:1': '2048x2048',
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '4:3': '2560x1920',
  '3:4': '1920x2560',
};

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    return { styles: [], assetTypes: {}, models: [] };
  }
}

// ---------- 自定义风格库（stylelib.json） ----------
function loadStylelib() {
  try {
    return JSON.parse(fs.readFileSync(STYLELIB_PATH, 'utf8'));
  } catch (e) {
    return { styles: [] };
  }
}
function saveStylelib(lib) {
  fs.writeFileSync(STYLELIB_PATH, JSON.stringify(lib, null, 2), 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 适配器1：OpenAI 兼容图片接口（火山Seedream / new-api网关的GPT-image / Gemini）
async function openaiImage(cfg, body) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const url = base + '/images/generations';
  let size = (RATIO_MAP[body.ratio] && RATIO_MAP[body.ratio].openai) || '1024x1024';
  // Seedream 5.x：最小总像素 3686400，切换到 2K 档尺寸
  if (/seedream-5/i.test(cfg.model || '')) {
    size = SEEDREAM5_RATIO[body.ratio] || '2048x2048';
  }
  const payload = {
    model: cfg.model,
    prompt: body.prompt,
    n: body.n || 1,
    size: size,
    response_format: 'url',
  };
  // 参考图（风格复刻）：Seedream 4.0 / GPT-image 支持 image 参数（data URL 或 url）
  if (body.refImage) payload.image = [body.refImage];
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`[${resp.status}] ${text.slice(0, 600)}`);
  const d = JSON.parse(text);
  const images = (d.data || []).map((it) => {
    if (it.url) return { url: it.url };
    if (it.b64_json) return { b64: it.b64_json };
    return it;
  });
  if (!images.length) throw new Error('接口未返回图片: ' + JSON.stringify(d).slice(0, 400));
  return { images };
}

// 适配器2：阿里百炼 DashScope（万相，异步任务）
async function dashscopeImage(cfg, body) {
  const size = (RATIO_MAP[body.ratio] && RATIO_MAP[body.ratio].dashscope) || '1024*1024';
  const createUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
  const payload = {
    model: cfg.model,
    input: { prompt: body.prompt },
    parameters: { size: size, n: body.n || 1 },
  };
  let resp = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(payload),
  });
  let text = await resp.text();
  if (!resp.ok) throw new Error(`[${resp.status}] ${text.slice(0, 600)}`);
  const d0 = JSON.parse(text);
  const taskId = d0.output && d0.output.task_id;
  if (!taskId) throw new Error('未返回 task_id: ' + JSON.stringify(d0).slice(0, 400));
  const pollUrl = 'https://dashscope.aliyuncs.com/api/v1/tasks/' + taskId;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    resp = await fetch(pollUrl, { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
    text = await resp.text();
    if (!resp.ok) throw new Error(`[${resp.status}] ${text.slice(0, 600)}`);
    const d = JSON.parse(text);
    const st = d.output && d.output.task_status;
    if (st === 'SUCCEEDED') {
      const results = d.output.results || [];
      return { images: results.map((r) => ({ url: r.url })) };
    }
    if (st === 'FAILED' || st === 'CANCELED') {
      throw new Error('任务 ' + st + ': ' + JSON.stringify(d.output).slice(0, 400));
    }
  }
  throw new Error('生成超时（3分钟）');
}

// 适配器3：LLM 对话（提示词润色用，任意 OpenAI 兼容 LLM）
async function chatCompletion(cfg, body) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const payload = {
    model: cfg.model,
    messages: body.messages,
    temperature: 0.7,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`[${resp.status}] ${text.slice(0, 600)}`);
  const d = JSON.parse(text);
  const content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  return { text: content };
}

// 测试模型连通性（验证 Key / baseUrl 是否有效，尽量不消耗生成额度）
async function testModel(cfg) {
  if (!cfg.apiKey) return { ok: false, message: '未填写 API Key' };
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const headers = { Authorization: 'Bearer ' + cfg.apiKey };
  const tryModels = async (url) => {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return { ok: false, http: resp.status, text: (await resp.text()).slice(0, 220) };
    let ids = [];
    try { const d = await resp.json(); ids = (d.data || []).map((x) => x.id).filter(Boolean); } catch (e) {}
    return { ok: true, ids };
  };
  try {
    if (cfg.provider === 'dashscope') {
      // 阿里百炼：优先用 OpenAI 兼容模式的 /models 列表验证
      const r = await tryModels('https://dashscope.aliyuncs.com/compatible-mode/v1/models');
      if (r.ok) return { ok: true, message: '连接成功，Key 有效' + (r.ids.length ? `（账号下 ${r.ids.length} 个可用模型）` : '') };
      // 兼容端点不可用，说明该 Key 非兼容模式或权限受限
      return { ok: false, message: `HTTP ${r.http}: ${r.text}` };
    }
    // openai 兼容（火山 Seedream / new-api 网关 / chat LLM）
    const r = await tryModels(base + '/models');
    if (r.ok) return { ok: true, message: '连接成功，Key 有效' + (r.ids.length ? `（账号下 ${r.ids.length} 个可用模型）` : '') };
    return { ok: false, message: `HTTP ${r.http}: ${r.text}` };
  } catch (e) {
    return { ok: false, message: '网络错误：' + e.message };
  }
}

// 探测网关模型列表（OpenAI 兼容 /models 端点）
async function listModels(baseUrl, apiKey) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const resp = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + apiKey } });
  if (!resp.ok) throw new Error(`[${resp.status}] ${(await resp.text()).slice(0, 300)}`);
  const d = await resp.json();
  const ids = (d.data || []).map((x) => x.id).filter(Boolean);
  return { ok: true, models: ids };
}

// 风格分析：视觉 LLM 拆解上传图片的美术风格，产出可复用的风格卡
async function analyzeStyle(cfg, imageDataUrl) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const sys = '你是游戏美术风格分析专家。分析用户上传图片的美术风格，只输出严格 JSON（禁止 markdown 代码块），格式：'
    + '{"name":"风格名，8字内","summary":"一句话风格总结","features":["配色特征","线条特征","光影特征","质感特征"],'
    + '"promptWords":"可直接拼接使用的风格修饰词，40-80字，中文，涵盖配色/线条/光影/质感/氛围",'
    + '"pixelHint":"是否像素风及适合的游戏素材类型建议，30字内"}';
  const payload = {
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'text', text: '分析这张图片的美术风格，输出 JSON。' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] },
    ],
    temperature: 0.3,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`[${resp.status}] ${text.slice(0, 400)}`);
  const d = JSON.parse(text);
  const content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  // 容错提取 JSON（模型可能裹 markdown 或前后缀）
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型未返回 JSON：' + content.slice(0, 200));
  const card = JSON.parse(m[0]);
  if (!card.name || !card.promptWords) throw new Error('风格卡字段缺失：' + content.slice(0, 200));
  return card;
}

// Prompt 优化：LLM 结构化解析用户输入（分词/要素抽取）+ 识别风格类型 + 生成优化后描述
// 职责边界：LLM 只负责「理解 + 优化主体描述」，风格/类型的约束词由配方层（config）负责拼入
async function optimizePrompt(cfg, text, styles, assetTypes) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const styleNames = (styles || []).map((s) => s.name).join(' / ');
  const typeNames = (assetTypes || []).map((t) => t.name).join(' / ');
  const sys = '你是游戏美术提示词专家。用户输入一句简短中文描述（可能口语化），完成三件事：'
    + '1) 分词解析为结构化要素；2) 从候选识别最接近的风格与类型；3) 生成优化后的主体描述。\n'
    + '美术风格候选（选1个）：' + styleNames + '\n'
    + '素材类型候选（选1个）：' + typeNames + '\n'
    + '只输出严格 JSON（禁止 markdown 代码块），格式：'
    + '{"subject":"主体","appearance":"外观服装特征","action":"动作姿态","scene":"场景背景","emotion":"情绪氛围",'
    + '"styleTendency":"候选风格名","typeTendency":"候选类型名",'
    + '"optimizedPrompt":"优化后的主体描述，50-70字，中文，含构图/光影/细节/材质/氛围，不重复风格名",'
    + '"negative":"负面词，15字内，如：低质量、模糊、畸形手指、多余肢体、文字、水印"}';
  const payload = {
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: String(text) },
    ],
    temperature: 0.4,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify(payload),
  });
  const t = await resp.text();
  if (!resp.ok) throw new Error(`[${resp.status}] ${t.slice(0, 400)}`);
  const d = JSON.parse(t);
  const content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型未返回 JSON：' + content.slice(0, 200));
  const r = JSON.parse(m[0]);
  if (!r.optimizedPrompt) throw new Error('优化结果缺失 optimizedPrompt：' + content.slice(0, 200));
  // 风格/类型模糊匹配（LLM 从候选里选，这里回映射到配方 id）
  const matchName = (tendency, list) => {
    if (!tendency) return null;
    const s = String(tendency);
    return (list || []).find((x) => x.name === s || s.includes(x.name) || x.name.includes(s)) || null;
  };
  const matchedStyle = matchName(r.styleTendency, styles);
  const matchedType = matchName(r.typeTendency, assetTypes);
  return {
    parsed: {
      subject: r.subject || '',
      appearance: r.appearance || '',
      action: r.action || '',
      scene: r.scene || '',
      emotion: r.emotion || '',
    },
    optimizedPrompt: r.optimizedPrompt,
    negative: r.negative || '',
    matched: {
      styleId: matchedStyle ? matchedStyle.id : null,
      styleName: matchedStyle ? matchedStyle.name : (r.styleTendency || ''),
      typeId: matchedType ? matchedType.id : null,
      typeName: matchedType ? matchedType.name : (r.typeTendency || ''),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    // 演示模式：拦截会写文件或泄露 Key 的操作，其余只读放行
    if (DEMO) {
      const writeOp = (p === '/api/config/save' || p === '/api/promptlib' || p === '/api/styles' || p === '/api/config/test') && req.method === 'POST';
      const keyOp = p === '/api/config/key' && req.method === 'GET';
      if (writeOp || keyOp) {
        json(res, 403, { error: '这是演示版（只读），无法修改配置或查看 Key' });
        return;
      }
    }
    if (p === '/api/config' && req.method === 'GET') {
      const cfg = loadConfig();
      const safe = JSON.parse(JSON.stringify(cfg));
      (safe.models || []).forEach((m) => {
        m.hasKey = !!m.apiKey;
        // 回传遮蔽版 Key（前7后4），让用户在界面上确认 Key 确实已存
        m.keyMask = m.apiKey ? String(m.apiKey).slice(0, 7) + '••••••' + String(m.apiKey).slice(-4) : '';
        delete m.apiKey;
      });
      json(res, 200, safe);
      return;
    }
    if (p === '/api/config/key' && req.method === 'GET') {
      // 按需取单个模型的完整 Key（用户点「查看」时，避免默认明文回传）
      const id = u.searchParams.get('id');
      const cfg = loadConfig();
      const m = (cfg.models || []).find((x) => x.id === id);
      if (!m) throw new Error('模型不存在');
      json(res, 200, { key: m.apiKey || '' });
      return;
    }
    if (p === '/api/promptlib' && req.method === 'POST') {
      // 配方库：保存风格词 + 素材类型规格（不影响 models）
      const body = JSON.parse((await readBody(req)) || '{}');
      const old = loadConfig();
      const hasStyles = Array.isArray(body.styles);
      const hasTypes = Array.isArray(body.assetTypes);
      if (!hasStyles && !hasTypes) throw new Error('没有可保存的配方内容');
      const next = {
        styles: hasStyles ? body.styles : (old.styles || []),
        assetTypes: hasTypes ? body.assetTypes : (old.assetTypes || []),
        models: old.models || [],
      };
      if (!next.styles.length || !next.assetTypes.length) throw new Error('风格或素材类型不能为空');
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
      json(res, 200, { ok: true, message: '配方已保存（无需重启，立即生效）' });
      return;
    }
    if (p === '/api/config/save' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const old = loadConfig();
      const oldById = {};
      (old.models || []).forEach((m) => { oldById[m.id] = m; });
      const models = Array.isArray(body.models) ? body.models : [];
      // 只更新 models；styles / assetTypes 保持不变（如需后续加编辑界面再放开）
      const next = {
        styles: Array.isArray(body.styles) && body.styles.length ? body.styles : (old.styles || []),
        assetTypes: (body.assetTypes && Object.keys(body.assetTypes).length) ? body.assetTypes : (old.assetTypes || {}),
        models: models.map((m) => {
          const prev = oldById[m.id];
          let apiKey = String(m.apiKey || '');
          if (!apiKey && prev && prev.apiKey) apiKey = prev.apiKey; // 留空继承旧 Key，避免误清空
          return {
            id: String(m.id || ''),
            name: String(m.name || ''),
            provider: String(m.provider || 'openai'),
            baseUrl: String(m.baseUrl || ''),
            model: String(m.model || ''),
            apiKey: apiKey,
            verified: (typeof m.verified === 'boolean') ? m.verified : (prev ? !!prev.verified : false),
          };
        }),
      };
      if (!next.models.length) throw new Error('至少保留一个模型');
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
      json(res, 200, { ok: true, message: '配置已保存（无需重启，立即生效）' });
      return;
    }
    if (p === '/api/config/test' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      let model = body.model || {};
      if (!model.apiKey) {
        // Key 留空时，用 config.json 里同 id 的已存 Key 来测
        const cfg = loadConfig();
        const saved = (cfg.models || []).find((m) => m.id === model.id);
        if (saved && saved.apiKey) model = Object.assign({}, model, { apiKey: saved.apiKey });
      }
      const result = await testModel(model);
      // 把「测试通过/失败」状态写回 config.json（同 id 模型），供生图下拉过滤
      if (model.id) {
        try {
          const cfg = loadConfig();
          const saved = (cfg.models || []).find((m) => m.id === model.id);
          if (saved) {
            saved.verified = !!result.ok;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
            result.verified = !!result.ok;
          }
        } catch (e) { /* 写回失败不影响测试结果返回 */ }
      }
      json(res, 200, result);
      return;
    }
    if (p === '/api/models/list' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const baseUrl = String(body.baseUrl || '');
      const apiKey = String(body.apiKey || '');
      if (!baseUrl || !apiKey) throw new Error('缺少网关地址或 API Key');
      const result = await listModels(baseUrl, apiKey);
      json(res, 200, result);
      return;
    }
    // ---------- 自定义风格库 ----------
    if (p === '/api/styles' && req.method === 'GET') {
      json(res, 200, loadStylelib());
      return;
    }
    if (p === '/api/styles' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.name || !body.promptWords) throw new Error('风格卡缺少 name / promptWords');
      if (body.refImage && body.refImage.length > 3e5) throw new Error('参考图过大，请压缩后上传');
      const lib = loadStylelib();
      const card = {
        id: body.id || ('st_' + Date.now()),
        name: String(body.name),
        summary: String(body.summary || ''),
        features: Array.isArray(body.features) ? body.features : [],
        promptWords: String(body.promptWords),
        pixelHint: String(body.pixelHint || ''),
        refImage: String(body.refImage || ''),
        createdAt: Date.now(),
      };
      const i = lib.styles.findIndex((s) => s.id === card.id);
      if (i >= 0) lib.styles[i] = Object.assign(lib.styles[i], card, { createdAt: lib.styles[i].createdAt });
      else lib.styles.unshift(card);
      saveStylelib(lib);
      json(res, 200, { ok: true, card });
      return;
    }
    if (p === '/api/styles' && req.method === 'DELETE') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const lib = loadStylelib();
      lib.styles = lib.styles.filter((s) => s.id !== id);
      saveStylelib(lib);
      json(res, 200, { ok: true });
      return;
    }
    if (p === '/api/style/analyze' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.image || !body.image.startsWith('data:image/')) throw new Error('请上传图片（data URL 格式）');
      if (body.image.length > 4e6) throw new Error('图片过大，请压缩后上传（<3MB）');
      const cfg = loadConfig();
      const model = (cfg.models || []).find((m) => m.provider === 'chat');
      if (!model || !model.apiKey) throw new Error('请先在「API 管理」给「对话·LLM润色」模型配置一个视觉理解 LLM 的 Key（如 doubao-seed-1.6-vision / qwen-vl）');
      const card = await analyzeStyle(model, body.image);
      json(res, 200, { ok: true, card });
      return;
    }
    if (p === '/api/generate' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const cfg = loadConfig();
      const model = (cfg.models || []).find((m) => m.id === body.modelId);
      if (!model) throw new Error('模型不存在: ' + body.modelId);
      if (!model.apiKey) throw new Error('模型「' + model.name + '」未配置 API Key，请到「⚙️ API 管理」里配置');
      // 风格卡参考图（仅 openai 兼容图片模型支持参考图）
      if (body.styleCardId) {
        const card = loadStylelib().styles.find((s) => s.id === body.styleCardId);
        if (card && card.refImage && model.provider === 'openai') body.refImage = card.refImage;
      }
      const out = model.provider === 'dashscope'
        ? await dashscopeImage(model, body)
        : await openaiImage(model, body);
      json(res, 200, out);
      return;
    }
    if (p === '/api/enhance' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const cfg = loadConfig();
      const model = (cfg.models || []).find((m) => m.provider === 'chat');
      if (!model || !model.apiKey) throw new Error('未配置「提示词润色」LLM，请在 config.json 里加一个 provider=chat 的模型并填 Key');
      const out = await chatCompletion(model, body);
      json(res, 200, out);
      return;
    }
    if (p === '/api/optimize' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.text || !String(body.text).trim()) throw new Error('请先输入一句描述再优化');
      const cfg = loadConfig();
      const model = (cfg.models || []).find((m) => m.provider === 'chat');
      if (!model || !model.apiKey) throw new Error('未配置「Prompt 优化」LLM（provider=chat），请在「⚙️ API 管理」配置 GPT-4o');
      const styles = (cfg.styles || []).map((s) => (typeof s === 'string' ? { id: s, name: s } : s));
      const types = Array.isArray(cfg.assetTypes)
        ? cfg.assetTypes
        : Object.keys(cfg.assetTypes || {}).map((k) => ({ id: k, name: k }));
      const out = await optimizePrompt(model, String(body.text).trim(), styles, types);
      json(res, 200, out);
      return;
    }
    // 静态文件
    let fp = p === '/' ? '/index.html' : p;
    fp = path.normalize(fp).replace(/^(\.\.[\/\\])+/, '');
    const file = path.join(PUBLIC, fp);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log(' AI 游戏素材平台（自用版）已启动');
  console.log(' 浏览器打开: http://127.0.0.1:' + PORT);
  console.log(' 先编辑 config.json 填入 API Key 再生成');
  console.log('==============================================');
});
