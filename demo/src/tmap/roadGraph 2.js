// 由腾讯位置服务「步行路线规划」结果自建可寻路路网
//
// 思路：在营业区域内选取若干锚点（真实地点 + 均匀网格），互相请求步行路线，
// 把返回的 polyline 抽稀后按空间网格聚类成节点，再连成无向加权图。
// 这样得到的路网来自真实街道几何，瓶颈（主干道、过街点）也是真实存在的。

import { RoadGraph } from '../roadgraph.js';
import { AREA, AREA_LOCAL, frame, thin, distM, areaSummary } from '../geo.js';
import { throttled, cacheGet, cacheSet } from './sdk.js';
import { bindAnchors, PLACES } from '../places.js';

const CELL_M = 16; // 节点聚类网格边长（米）
const THIN_M = 8; // polyline 抽稀间距（米）
const MAX_ROUTES = 50; // 单次构建的最大路线请求数
const NEIGHBORS = 3; // 每个锚点连接最近的 N 个锚点
const MALL_COVER_M = 70; // 商业体周边视为有雨棚
const PARK_BIRD_M = 140; // 公园周边视为观鸟点
const MIN_NODES = 60;

export class TmapGraph extends RoadGraph {
  // source: 'tencent' = 真实步行路网；'grid' = 腾讯底图 + 示意网格路网
  constructor(source = 'tencent') {
    super({ unitM: 1, sideNames: { w: '西町', e: '东町' }, complexDegree: 4, shelterPenalty: 1.45 });
    this.mode = 'tmap';
    this.realMap = true;
    this.source = source;
    this.overshootM = 30;
    this.slot = { spacing: 2.4, front: 5 };
    this.shelterNote = '沿街商业体附近有连续雨棚，不受影响。';
    this.shelterRouteNote = '优先经过沿街雨棚路段 · 可能绕行';
    const road = source === 'tencent' ? '路网来自腾讯步行路线规划' : '路网为示意网格（未接入真实路网数据）';
    this.mapNote = source === 'tencent' ? '腾讯地图真实街区（店名与顾客名为虚构）' : '腾讯地图底图 + 示意路网';
    this.bottleneckNote = source === 'tencent' ? '真实主干道与过街点瓶颈' : '主干道只有两处过街点';
    this.attribution = `地图底图 © 腾讯位置服务 · ${road} · 营业区域 ${areaSummary()} · 店名与顾客名为虚构 · 时间为游戏模拟时间`;
    this.stats = { routes: 0, cached: 0, failed: 0 };
  }

  // 由 polyline（本地米坐标数组）增量构建节点与边
  ingest(lines) {
    const cells = new Map(); // cellKey -> { sx, sz, n }
    const seqs = [];
    const ck = (p) => `${Math.round(p.x / CELL_M)}_${Math.round(p.z / CELL_M)}`;
    for (const raw of lines) {
      if (!raw || raw.length < 2) continue;
      const pts = thin(raw, THIN_M);
      const seq = [];
      for (const p of pts) {
        const k = ck(p);
        const c = cells.get(k) || { sx: 0, sz: 0, n: 0 };
        c.sx += p.x;
        c.sz += p.z;
        c.n++;
        cells.set(k, c);
        if (seq[seq.length - 1] !== k) seq.push(k);
      }
      if (seq.length > 1) seqs.push(seq);
    }
    const midX = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
    for (const [k, c] of cells) {
      const x = c.sx / c.n;
      const z = c.sz / c.n;
      this.addNode(k, x, z, { side: x < midX ? 'w' : 'e' });
    }
    for (const seq of seqs) {
      for (let i = 1; i < seq.length; i++) this.addEdge(seq[i - 1], seq[i]);
    }
  }

  markCovered(malls) {
    const cover = (locals, radius) => {
      let n = 0;
      for (const e of this.edges.values()) {
        const a = this.pos(e.a);
        const b = this.pos(e.b);
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        if (locals.some((l) => Math.hypot(l.x - mx, l.z - mz) < radius)) {
          if (!e.covered) n++;
          e.covered = true;
        }
      }
      return n;
    };
    let marked = 0;
    if (malls && malls.length) marked = cover(malls.map((m) => m.local || frame.toLocal(m.ll)), MALL_COVER_M);
    // 兜底：以人流最密集的几个路口为中心，视为「沿街商铺雨棚」
    if (marked < 6) {
      const hubs = [...this.nodes.values()].sort((a, b) => this.degree(b.id) - this.degree(a.id)).slice(0, 3);
      cover(hubs, 120);
    }
  }

  markBirds(parks, avoid = []) {
    let locals = (parks || []).map((p) => p.local || frame.toLocal(p.ll)).slice(0, 4);
    // 兜底：没检索到公园时，取离各地点最远的两个安静路口作为绿地
    if (!locals.length) {
      const quiet = [...this.nodes.values()]
        .map((n) => ({ n, d: avoid.length ? Math.min(...avoid.map((a) => Math.hypot(a.x - n.x, a.z - n.z))) : 0 }))
        .sort((a, b) => b.d - a.d)
        .slice(0, 2)
        .map((o) => o.n);
      locals = quiet;
    }
    const cap = Math.max(4, Math.round(this.nodes.size * 0.12));
    for (const n of this.nodes.values()) {
      if (this.birdNodes.size >= cap) break;
      if (locals.some((l) => Math.hypot(l.x - n.x, l.z - n.z) < PARK_BIRD_M)) this.birdNodes.add(n.id);
    }
    this.parkSpots = locals;
  }

  // 纸箱点：在四个象限各选一个远离地点的路口，保证分布均匀
  markBoxes(avoid) {
    const quads = [
      [AREA_LOCAL.minX, (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2, AREA_LOCAL.minZ, (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2],
      [(AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2, AREA_LOCAL.maxX, AREA_LOCAL.minZ, (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2],
      [AREA_LOCAL.minX, (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2, (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2, AREA_LOCAL.maxZ],
      [(AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2, AREA_LOCAL.maxX, (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2, AREA_LOCAL.maxZ],
    ];
    for (const [x0, x1, z0, z1] of quads) {
      let best = null;
      let bestScore = -Infinity;
      for (const n of this.nodes.values()) {
        if (n.x < x0 || n.x > x1 || n.z < z0 || n.z > z1) continue;
        const near = avoid.length ? Math.min(...avoid.map((a) => Math.hypot(a.x - n.x, a.z - n.z))) : 999;
        const score = Math.min(near, 160) + this.degree(n.id) * 12;
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best) this.boxNodes.add(best.id);
    }
  }
}

// ---------------- 路线请求 ----------------

function llKey(a, b) {
  return `walk:${a.lng.toFixed(5)},${a.lat.toFixed(5)}>${b.lng.toFixed(5)},${b.lat.toFixed(5)}`;
}

function readPolyline(res) {
  const routes = res?.result?.routes || res?.routes || [];
  const r = routes[0];
  if (!r || !Array.isArray(r.polyline) || r.polyline.length < 2) return null;
  return r.polyline.map((p) => ({
    lng: typeof p.lng === 'number' ? p.lng : p.getLng(),
    lat: typeof p.lat === 'number' ? p.lat : p.getLat(),
  }));
}

async function walkRoute(TMap, walking, a, b, stats) {
  const key = llKey(a, b);
  const hit = cacheGet(key) || cacheGet(llKey(b, a));
  if (hit) {
    stats.cached++;
    return hit.map(([lng, lat]) => ({ lng, lat }));
  }
  try {
    const res = await throttled(() => walking.search({ from: new TMap.LatLng(a.lat, a.lng), to: new TMap.LatLng(b.lat, b.lng) }));
    const poly = readPolyline(res);
    if (!poly) {
      stats.failed++;
      return null;
    }
    stats.routes++;
    cacheSet(key, poly.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]));
    return poly;
  } catch (err) {
    stats.failed++;
    stats.lastError = (err && err.message) || String(err);
    console.warn('[饿了喵] 步行路线请求失败：', stats.lastError);
    return null;
  }
}

// 把常见的服务端错误翻译成站长能看懂的处置建议
export function explainServiceError(msg) {
  const s = String(msg || '');
  if (/调用量|上限|配额|quota/i.test(s)) {
    return '腾讯位置服务配额已用尽（WebServiceAPI 每日调用量达到上限）。可等次日配额重置，或在控制台为该 Key 申请更高配额后重试；此前可先用下面的备用模式试玩。';
  }
  if (/白名单|referer|域名/i.test(s)) return '该 Key 的域名白名单不包含当前访问地址：请在控制台把 localhost 加入白名单。';
  if (/签名|sig|secret/i.test(s)) return '该 Key 开启了签名校验（SK）：请在控制台关闭签名校验，或改为服务端代理调用。';
  if (/未开启|未授权|无权限|权限/i.test(s)) return '该 Key 尚未开启 WebServiceAPI：请在控制台的「配额与产品」中启用后重试。';
  return s;
}

// ---------------- 锚点与配对 ----------------

function gridSeeds() {
  const out = [];
  const inset = 0.14;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const u = inset + (i * (1 - 2 * inset)) / 2;
      const v = inset + j * (1 - 2 * inset);
      out.push({
        lng: AREA.sw.lng + (AREA.ne.lng - AREA.sw.lng) * u,
        lat: AREA.sw.lat + (AREA.ne.lat - AREA.sw.lat) * v,
      });
    }
  }
  return out;
}

function buildPairs(seeds) {
  const pairs = new Map();
  const add = (i, j) => {
    if (i === j) return;
    const k = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!pairs.has(k)) pairs.set(k, [Math.min(i, j), Math.max(i, j)]);
  };
  const d = (i, j) => Math.hypot(seeds[i].local.x - seeds[j].local.x, seeds[i].local.z - seeds[j].local.z);

  // 1) 每个锚点连接最近的 N 个锚点，覆盖局部街道
  seeds.forEach((_, i) => {
    const near = seeds
      .map((_, j) => ({ j, d: d(i, j) }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBORS);
    near.forEach((o) => add(i, o.j));
  });

  // 2) 欧氏最小生成树（Prim），保证整体连通
  const inTree = new Set([0]);
  while (inTree.size < seeds.length) {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < seeds.length; j++) {
        if (inTree.has(j)) continue;
        const dd = d(i, j);
        if (dd < bd) {
          bd = dd;
          bi = i;
          bj = j;
        }
      }
    }
    if (bj < 0) break;
    inTree.add(bj);
    add(bi, bj);
  }

  return [...pairs.values()].sort((p, q) => d(p[0], p[1]) - d(q[0], q[1])).slice(0, MAX_ROUTES);
}

// ---------------- 对外入口 ----------------

export async function buildRoadGraph(TMap, { anchors, parks, malls, onProgress } = {}) {
  const graph = new TmapGraph();
  const walking = new TMap.service.Walking({});

  const slotIds = Object.keys(anchors || {});
  const seeds = [
    { id: 'station', ...AREA.center, local: frame.toLocal(AREA.center) },
    ...slotIds.map((id) => ({ id, ...anchors[id].ll, local: anchors[id].local })),
    ...gridSeeds().map((ll, i) => ({ id: `grid${i}`, ...ll, local: frame.toLocal(ll) })),
  ];

  const pairs = buildPairs(seeds);
  const lines = [];
  let done = 0;
  await Promise.all(
    pairs.map(async ([i, j]) => {
      const poly = await walkRoute(TMap, walking, seeds[i], seeds[j], graph.stats);
      done++;
      onProgress?.(`正在构建步行路网… ${done}/${pairs.length}`);
      if (poly) lines.push(poly.map((ll) => frame.toLocal(ll)));
    }),
  );

  if (!lines.length) throw new Error(`步行路线请求全部失败。${explainServiceError(graph.stats.lastError)}`);

  graph.ingest(lines);
  graph.keepOnly(graph.largestComponent());
  if (graph.nodes.size < MIN_NODES) throw new Error(`路网节点过少（${graph.nodes.size}）：该区域步行数据不足，建议更换营业区域。`);

  // 地点落到路网上：node 取最近路口，pos 取真实位置（过远时拉回到路口附近）
  const bound = {};
  const placed = [];
  for (const id of slotIds) {
    const a = anchors[id];
    const n = graph.nearestNode(a.local.x, a.local.z);
    if (!n) continue;
    let pos = { x: a.local.x, z: a.local.z };
    const d = distM(n, pos);
    if (d > 60) {
      const t = 14 / d;
      pos = { x: n.x + (pos.x - n.x) * t, z: n.z + (pos.z - n.z) * t };
    }
    bound[id] = { node: n.id, pos, realName: a.realName };
    placed.push(pos);
  }

  // 配送站：锚在最靠近区域中心的路口，门前留出前院
  const center = frame.toLocal(AREA.center);
  const sn = graph.nearestNode(center.x, center.z);
  bound.station = { node: sn.id, pos: null, off: [-1, 1], offScale: 6 };

  graph.markCovered(malls);
  graph.markBirds(parks, placed);
  graph.markBoxes(placed);
  bindAnchors(bound);

  // 可达性校验：所有地点必须互相可达
  const nodesOfPlaces = [sn.id, ...Object.values(bound).map((b) => b.node)];
  const unreachable = nodesOfPlaces.filter((id) => !graph.path(sn.id, id));
  if (unreachable.length) throw new Error('部分地点在路网上不可达：请重试或更换营业区域。');

  graph.coveredCount = [...graph.edges.values()].filter((e) => e.covered).length;
  return graph;
}

// ---------------- 固化：建好一次就不再消耗配额 ----------------

const AREA_TAG = () => `${AREA.sw.lng.toFixed(6)},${AREA.sw.lat.toFixed(6)},${AREA.ne.lng.toFixed(6)},${AREA.ne.lat.toFixed(6)}`;

export function serializeGraph(graph) {
  return {
    v: 1,
    area: AREA_TAG(),
    source: graph.source,
    nodes: [...graph.nodes.values()].map((n) => [n.id, Number(n.x.toFixed(2)), Number(n.z.toFixed(2)), n.side]),
    edges: [...graph.edges.values()].map((e) => [e.a, e.b, e.covered ? 1 : 0, e.noPenalty ? 1 : 0]),
    box: [...graph.boxNodes],
    bird: [...graph.birdNodes],
    anchors: Object.fromEntries(
      PLACES.map((p) => [p.id, { node: p.node, pos: p.pos || null, off: p.off, offScale: p.offScale, realName: p.realName || null }]),
    ),
  };
}

export function deserializeGraph(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('路网数据格式不正确。');
  if (data.area !== AREA_TAG()) throw new Error('路网数据与当前营业区域不匹配。');
  const g = new TmapGraph(data.source === 'grid' ? 'grid' : 'tencent');
  data.nodes.forEach(([id, x, z, side]) => g.addNode(String(id), Number(x), Number(z), { side: side === 'e' ? 'e' : 'w' }));
  data.edges.forEach(([a, b, cov, np]) => g.addEdge(String(a), String(b), { covered: !!cov, noPenalty: !!np }));
  (data.box || []).forEach((id) => g.nodes.has(id) && g.boxNodes.add(id));
  (data.bird || []).forEach((id) => g.nodes.has(id) && g.birdNodes.add(id));
  bindAnchors(data.anchors || {});
  for (const p of PLACES) {
    if (!p.node || !g.nodes.has(p.node)) throw new Error('路网数据缺少地点锚点。');
  }
  g.coveredCount = [...g.edges.values()].filter((e) => e.covered).length;
  return g;
}

const BAKE_KEY = 'graph';

export function loadBakedGraph() {
  const data = cacheGet(BAKE_KEY);
  if (!data) return null;
  try {
    return deserializeGraph(data);
  } catch {
    return null;
  }
}

export function bakeGraph(graph) {
  try {
    cacheSet(BAKE_KEY, serializeGraph(graph));
  } catch {
    /* 容量不足时忽略 */
  }
}
