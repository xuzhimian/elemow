// 腾讯位置服务 JavaScript API GL 的动态加载与请求节流
//
// Key 只从环境变量读取（demo/.env.local，不入版本库）。
// 控制台需要开启「WebServiceAPI」，并把运行域名（含 localhost）加入 Key 的域名白名单。

const KEY = (import.meta.env?.VITE_TMAP_KEY || '').trim();
const SCRIPT_ID = 'tmap-gljs';
const LOAD_TIMEOUT = 15000;

export function hasKey() {
  return /^[A-Z0-9]{5}(-[A-Z0-9]{5}){5}$/i.test(KEY);
}

export function keyHint() {
  if (!KEY) return '未配置地图 Key：请在 demo/.env.local 中设置 VITE_TMAP_KEY。';
  if (!hasKey()) return '地图 Key 格式不正确：应为 6 组 5 位字符，用「-」连接。';
  return '';
}

let loading = null;

export function loadTMap() {
  if (window.TMap && window.TMap.Map) return Promise.resolve(window.TMap);
  if (loading) return loading;
  if (!hasKey()) return Promise.reject(new Error(keyHint()));

  loading = new Promise((resolve, reject) => {
    const cbName = `__tmapInit_${Date.now().toString(36)}`;
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      delete window[cbName];
    };
    window[cbName] = () => {
      cleanup();
      if (window.TMap && window.TMap.Map) resolve(window.TMap);
      else reject(new Error('腾讯地图脚本已加载，但未暴露 TMap 对象。'));
    };
    const old = document.getElementById(SCRIPT_ID);
    if (old) old.remove();
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.async = true;
    s.src = `https://map.qq.com/api/gljs?v=1.exp&libraries=service&callback=${cbName}&key=${encodeURIComponent(KEY)}`;
    s.onerror = () => {
      cleanup();
      s.remove();
      reject(new Error('腾讯地图脚本加载失败：请检查网络，或确认 Key 的域名白名单已包含当前地址。'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('腾讯地图脚本加载超时（15 秒）。'));
    }, LOAD_TIMEOUT);
    document.head.appendChild(s);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

// ---------------- 并发与节流 ----------------
// 腾讯位置服务对 QPS 有限制，这里统一收口：最多 2 个并发，相邻请求间隔 120ms。

const QUEUE = [];
let active = 0;
let lastAt = 0;
const MAX_ACTIVE = 2;
const MIN_GAP = 120;

function drain() {
  if (!QUEUE.length || active >= MAX_ACTIVE) return;
  const gap = Math.max(0, lastAt + MIN_GAP - Date.now());
  setTimeout(() => {
    const job = QUEUE.shift();
    if (!job) return;
    active++;
    lastAt = Date.now();
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        drain();
      });
    drain();
  }, gap);
}

export function throttled(fn) {
  return new Promise((resolve, reject) => {
    QUEUE.push({ fn, resolve, reject });
    drain();
  });
}

export function pendingRequests() {
  return QUEUE.length + active;
}

// ---------------- 结果缓存 ----------------
// 路线与 POI 结果写入 localStorage，减少重复配额消耗；超限时自动降级为内存缓存。

const CACHE_PREFIX = 'meow-tmap-v1:';
const mem = new Map();
let storageOk = true;

export function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  if (!storageOk) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    mem.set(key, v);
    return v;
  } catch {
    return null;
  }
}

export function cacheSet(key, value) {
  mem.set(key, value);
  if (!storageOk) return;
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    storageOk = false;
  }
}

export function cacheClear() {
  mem.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    storageOk = true;
  } catch {
    /* ignore */
  }
}
