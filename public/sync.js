// ============ 云端同步层：邮箱登录 + 数据跨设备同步（localStorage 无侵入代理） ============
// 策略：
//  1. 代理 localStorage 的 setItem/removeItem —— 现有 app.js/canvas.js 代码零改动，写入时自动上云
//  2. 登录后：云端有数据则拉取覆盖本地（跨设备同步），云端为空则把本地推上去（首次登录）
//  3. Key（API Key）仍只存本机 localStorage，永不上云 —— 符合「Key 本地配」的安全诉求
(function () {
  'use strict';
  const PREFIX = 'aap_';
  const PULLED_KEY = 'aap_sync_pulled'; // sessionStorage 标记，防止登录态下每次刷新都 pull+reload 死循环

  let cloud = null;
  let loggedIn = false;
  let userEmail = '';
  let otpEmail = '';
  let otpVerify = null; // signInWithOtp 返回的 verify 函数
  let writeChain = Promise.resolve();

  const $ = (s) => document.getElementById(s);
  const isLocal = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  // ---------- localStorage 代理 ----------
  const _set = Storage.prototype.setItem;
  const _remove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key, value) {
    _set.call(this, key, value);
    if (typeof key === 'string' && key.indexOf(PREFIX) === 0 && loggedIn && cloud) {
      let v;
      try { v = JSON.parse(value); } catch (e) { v = value; }
      writeChain = writeChain.then(() => writeKV(key, v)).catch((e) => console.warn('[sync]', e && e.message));
    }
  };
  Storage.prototype.removeItem = function (key) {
    _remove.call(this, key);
    if (typeof key === 'string' && key.indexOf(PREFIX) === 0 && loggedIn && cloud) {
      writeChain = writeChain.then(() => cloud.database.from('user_kv').delete().eq('k', key)).catch(() => {});
    }
  };

  async function writeKV(k, v) {
    const { data, error } = await cloud.database.from('user_kv').select('id').eq('k', k).maybeSingle();
    if (error) throw error;
    if (data && data.id) await cloud.database.from('user_kv').update({ v }).eq('id', data.id);
    else await cloud.database.from('user_kv').insert({ k, v });
  }

  async function pullFromCloud() {
    const { data, error } = await cloud.database.from('user_kv').select('k, v');
    if (error) throw error;
    const rows = data || [];
    rows.forEach((row) => { try { _set.call(localStorage, row.k, JSON.stringify(row.v)); } catch (e) {} });
    return rows.length;
  }

  function pushAllLocalToCloud() {
    const tasks = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (typeof k === 'string' && k.indexOf(PREFIX) === 0) {
        let v; try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { v = localStorage.getItem(k); }
        tasks.push(writeKV(k, v));
      }
    }
    return Promise.all(tasks);
  }

  // ---------- 初始化 ----------
  async function init() {
    try {
      const resp = await fetch('/api/cloudconfig');
      const cfg = await resp.json();
      if (!cfg.endpoint || !cfg.publishableKey || !window.WorkBuddyCloud) { renderAuthUI(); return; }
      cloud = window.WorkBuddyCloud.createWorkBuddyCloud({ endpoint: cfg.endpoint, publishableKey: cfg.publishableKey });
      const { data: session } = await cloud.auth.getSession();
      loggedIn = !!(session && session.user);
      userEmail = loggedIn && session.user ? (session.user.email || '') : '';
      if (loggedIn && !isLocal() && !sessionStorage.getItem(PULLED_KEY)) {
        const cnt = await pullFromCloud();
        if (cnt === 0) await pushAllLocalToCloud(); // 云端为空：首次登录，把本地数据推上去
        sessionStorage.setItem(PULLED_KEY, '1');
        location.reload();
        return;
      }
    } catch (e) {
      console.warn('[sync] init fail', e && e.message);
    }
    renderAuthUI();
  }

  // ---------- 登录 UI ----------
  function renderAuthUI() {
    const btn = $('authBtn');
    if (!btn) return;
    if (loggedIn) {
      btn.textContent = '👤 ' + (userEmail || '已登录');
      btn.title = '已登录（点击退出）';
      btn.onclick = signOut;
    } else {
      btn.textContent = '🔐 登录';
      btn.title = '登录后历史/风格卡/画布跨设备同步';
      btn.onclick = openAuth;
    }
  }

  function openAuth() {
    if (isLocal()) {
      alert('登录与跨设备同步仅在线上地址可用，本地预览不支持。\n请访问线上地址后登录（本机仍可正常生成，数据存本机）。');
      return;
    }
    $('authMask').style.display = 'flex';
    $('authStepEmail').style.display = '';
    $('authStepCode').style.display = 'none';
    setAuthStatus('');
    $('authEmail').value = '';
    $('authCode').value = '';
  }
  function closeAuth() { $('authMask').style.display = 'none'; }

  function setAuthStatus(msg, isErr) {
    const el = $('authStatus');
    el.textContent = msg;
    el.className = 'auth-status' + (isErr ? ' err' : '');
  }

  async function sendCode() {
    const email = $('authEmail').value.trim();
    if (!email) { setAuthStatus('请输入邮箱', true); return; }
    const btn = $('authSendBtn');
    btn.disabled = true; btn.textContent = '发送中…';
    const started = await cloud.auth.signInWithOtp({ email });
    btn.disabled = false; btn.textContent = '发送验证码';
    if (started.error) { setAuthStatus('发送失败：' + (started.error.message || '请稍后重试'), true); return; }
    otpVerify = started.data && started.data.verify;
    otpEmail = email;
    $('authEmailShow').textContent = email;
    $('authStepEmail').style.display = 'none';
    $('authStepCode').style.display = '';
    setAuthStatus('验证码已发送，请查收邮箱');
  }

  async function verifyCode() {
    const code = $('authCode').value.trim();
    if (!code) { setAuthStatus('请输入验证码', true); return; }
    if (!otpVerify) { setAuthStatus('请先发送验证码', true); return; }
    const btn = $('authVerifyBtn');
    btn.disabled = true; btn.textContent = '登录中…';
    const completed = await otpVerify({ token: code });
    if (completed.error) {
      btn.disabled = false; btn.textContent = '验证并登录';
      setAuthStatus('验证失败：' + (completed.error.message || '验证码错误'), true);
      return;
    }
    loggedIn = true;
    userEmail = completed.data && completed.data.user ? (completed.data.user.email || otpEmail) : otpEmail;
    try {
      const cnt = await pullFromCloud();
      if (cnt === 0) await pushAllLocalToCloud();
    } catch (e) { console.warn('[sync] pull after login', e && e.message); }
    sessionStorage.setItem(PULLED_KEY, '1');
    location.reload();
  }

  async function signOut() {
    if (!confirm('退出登录？退出后数据仅存本机，不再跨设备同步。')) return;
    try { await cloud.auth.signOut(); } catch (e) {}
    loggedIn = false;
    sessionStorage.removeItem(PULLED_KEY);
    location.reload();
  }

  // ---------- 绑定事件 + 启动 ----------
  function bind() {
    const send = $('authSendBtn'); if (send) send.onclick = sendCode;
    const ver = $('authVerifyBtn'); if (ver) ver.onclick = verifyCode;
    const resend = $('authResendBtn'); if (resend) resend.onclick = sendCode;
    const close = $('authClose'); if (close) close.onclick = closeAuth;
    const mask = $('authMask');
    if (mask) mask.addEventListener('click', (e) => { if (e.target === mask) closeAuth(); });
    const emailInput = $('authEmail');
    if (emailInput) emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCode(); });
    const codeInput = $('authCode');
    if (codeInput) codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });
  }

  window.CloudSync = { init, isLoggedIn: () => loggedIn };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bind(); init(); });
  else { bind(); init(); }
})();
