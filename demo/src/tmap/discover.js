// 真实街区的「位置锚点」发现
//
// PRD v0.3 约束：真实 POI 只用来提供坐标，展示名称一律使用 places.js 中的虚构名。
// 真实名称仅记录在 realName 字段里，供调试与数据来源说明使用。

import { AREA, frame, insideArea } from '../geo.js';
import { throttled, cacheGet, cacheSet } from './sdk.js';
import { mulberry32 } from '../util.js';

// 一次性关键词检索（13 次请求），结果汇总成候选池后再分配给地点槽位
const QUERIES = [
  { kw: '小区', tag: 'home' },
  { kw: '公寓', tag: 'home' },
  { kw: '住宅', tag: 'home' },
  { kw: '写字楼', tag: 'office' },
  { kw: '大厦', tag: 'office' },
  { kw: '学校', tag: 'school' },
  { kw: '书店', tag: 'books' },
  { kw: '花店', tag: 'florist' },
  { kw: '公园', tag: 'park' },
  { kw: '面包', tag: 'bread' },
  { kw: '超市', tag: 'grocery' },
  { kw: '便利店', tag: 'grocery' },
  { kw: '餐馆', tag: 'soup' },
  { kw: '咖啡', tag: 'bread' },
  { kw: '购物中心', tag: 'mall' },
];

// 槽位优先使用的候选标签，按顺序回退
const SLOTS = [
  { id: 'bakery', tags: ['bread', 'mall', 'grocery'] },
  { id: 'morning', tags: ['bread', 'grocery', 'mall'] },
  { id: 'grocery', tags: ['grocery', 'mall'] },
  { id: 'fishsoup', tags: ['soup', 'mall', 'grocery'] },
  { id: 'school', tags: ['school', 'home'] },
  { id: 'books', tags: ['books', 'mall', 'office'] },
  { id: 'florist', tags: ['florist', 'mall', 'grocery'] },
  { id: 'parkeast', tags: ['park', 'home'] },
  { id: 'office', tags: ['office', 'mall'] },
  { id: 'riverside', tags: ['office', 'mall'] },
  { id: 'tower', tags: ['office', 'home'] },
  { id: 'sakura', tags: ['home', 'office'] },
  { id: 'pine', tags: ['home', 'office'] },
  { id: 'green', tags: ['home', 'office'] },
  { id: 'harbor', tags: ['home', 'office'] },
  { id: 'slope', tags: ['home', 'office'] },
  { id: 'alley', tags: ['home', 'office'] },
];

const MIN_SPREAD_M = 90;

let lastError = '';

function poiKey(area) {
  return `poi:${area.sw.lng.toFixed(6)},${area.sw.lat.toFixed(6)}-${area.ne.lng.toFixed(6)},${area.ne.lat.toFixed(6)}`;
}

async function runQuery(TMap, search, bounds, q) {
  try {
    const res = await throttled(() => search.searchRectangle({ keyword: q.kw, bounds, pageIndex: 0 }));
    const list = (res && res.data) || [];
    return list
      .filter((p) => p && p.location && insideArea(p.location))
      .map((p) => ({
        pid: String(p.id || `${q.kw}-${p.title}`),
        realName: String(p.title || ''),
        category: String(p.category || ''),
        tag: q.tag,
        ll: { lng: Number(p.location.lng), lat: Number(p.location.lat) },
      }));
  } catch (err) {
    lastError = (err && err.message) || String(err);
    console.warn(`[饿了喵] POI 检索「${q.kw}」失败：`, lastError);
    return [];
  }
}

export async function discoverPlaces(TMap, { onProgress } = {}) {
  const cacheKey = poiKey(AREA);
  let pool = cacheGet(cacheKey);
  if (!pool || !Array.isArray(pool) || !pool.length) {
    const search = new TMap.service.Search({ pageSize: 20 });
    const bounds = new TMap.LatLngBounds(new TMap.LatLng(AREA.sw.lat, AREA.sw.lng), new TMap.LatLng(AREA.ne.lat, AREA.ne.lng));
    const found = new Map();
    let done = 0;
    const chunks = await Promise.all(
      QUERIES.map(async (q) => {
        const r = await runQuery(TMap, search, bounds, q);
        done++;
        onProgress?.(`正在识别街区地点… ${done}/${QUERIES.length}`);
        return r;
      }),
    );
    chunks.flat().forEach((p) => {
      if (!found.has(p.pid)) found.set(p.pid, p);
    });
    pool = [...found.values()];
    if (pool.length) cacheSet(cacheKey, pool);
  }

  if (!pool.length) {
    const { explainServiceError } = await import('./roadGraph.js');
    throw new Error(lastError ? `地点检索失败。${explainServiceError(lastError)}` : '该区域没有检索到可用地点：请更换营业区域。');
  }

  // 加上本地平面坐标，便于做间距与片区判断
  pool.forEach((p) => (p.local = frame.toLocal(p.ll)));

  const midLng = AREA.center.lng;
  const sideOf = (p) => (p.ll.lng < midLng ? 'w' : 'e');
  const rng = mulberry32(Math.round((AREA.sw.lng + AREA.ne.lat) * 1e5));

  const used = new Set();
  const chosen = [];
  const sideCount = { w: 0, e: 0 };

  const pickFor = (slot) => {
    for (const tag of slot.tags) {
      const cands = pool.filter((p) => p.tag === tag && !used.has(p.pid));
      if (!cands.length) continue;
      let best = null;
      let bestScore = -Infinity;
      for (const c of cands) {
        const near = chosen.length ? Math.min(...chosen.map((o) => Math.hypot(o.local.x - c.local.x, o.local.z - c.local.z))) : Infinity;
        if (chosen.length && near < MIN_SPREAD_M) continue;
        const side = sideOf(c);
        const balance = sideCount[side] <= sideCount[side === 'w' ? 'e' : 'w'] ? 140 : 0;
        const score = Math.min(near, 420) + balance + rng() * 30;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) return best;
    }
    // 最后的兜底：任何尚未使用、且满足间距的候选
    const rest = pool.filter((p) => !used.has(p.pid));
    for (const c of rest) {
      const near = chosen.length ? Math.min(...chosen.map((o) => Math.hypot(o.local.x - c.local.x, o.local.z - c.local.z))) : Infinity;
      if (near >= MIN_SPREAD_M * 0.6) return c;
    }
    return rest[0] || null;
  };

  const anchors = {};
  for (const slot of SLOTS) {
    const p = pickFor(slot);
    if (!p) continue;
    used.add(p.pid);
    chosen.push(p);
    sideCount[sideOf(p)]++;
    anchors[slot.id] = { ll: p.ll, local: p.local, realName: p.realName, category: p.category, tag: p.tag };
  }

  const missing = SLOTS.filter((s) => !anchors[s.id]).map((s) => s.id);

  return {
    anchors,
    missing,
    parks: pool.filter((p) => p.tag === 'park'),
    malls: pool.filter((p) => p.tag === 'mall' || p.tag === 'grocery'),
    poolSize: pool.length,
  };
}
