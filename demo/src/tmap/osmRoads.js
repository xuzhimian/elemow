// 真实步行路网（OpenStreetMap）——与腾讯底图对齐
//
// 背景：腾讯「步行路线规划」属于 WebServiceAPI，需要 Key 开通配额；没有配额时
// 无法取得真实道路几何，示意网格又必然和底图错位。本模块改为直接取真实道路
// 中心线，再换算到腾讯底图使用的 GCJ-02 坐标，从而让猫咪沿真实街道行走。
//
// 要点：
// 1. OSM 为 WGS-84，腾讯底图为 GCJ-02，两者在国内有数百米系统偏移，必须转换；
// 2. 查询范围要按 GCJ-02 → WGS-84 反解，否则会取到错位的区域；
// 3. 结果经抽稀 + 网格聚类后进入 TmapGraph，与腾讯路线模式共用同一套寻路。

import { AREA, AREA_LOCAL, frame, insideArea } from '../geo.js';
import { TmapGraph } from './roadGraph.js';
import { bindAnchors, SHOPS, CUSTOMERS } from '../places.js';

// 公共 Overpass 镜像：按顺序重试（限流时返回 429/504）
const MIRRORS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TIMEOUT_MS = 90000;
const PAD_DEG = 0.004; // 查询范围外扩，避免边界道路被截断

// 可步行道路；排除高速与明确禁止步行的路段。
// 注意：过滤在本地做，Overpass 查询保持最简，否则公共镜像容易超时。
const WALKABLE = new Set([
  'residential',
  'living_street',
  'pedestrian',
  'footway',
  'path',
  'service',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'primary',
  'primary_link',
  'trunk',
  'trunk_link',
  'cycleway',
  'steps',
]);

// ---------------- WGS-84 <-> GCJ-02 ----------------

const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return r;
}

function transformLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return r;
}

export function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  const dLat0 = transformLat(lng - 105, lat - 35);
  const dLng0 = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat = (dLat0 * 180) / (((AXIS * (1 - EE)) / (magic * sqrtMagic)) * PI);
  const dLng = (dLng0 * 180) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

// 迭代反解：GCJ-02 → WGS-84（三次即可收敛到厘米级）
export function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let wLng = lng;
  let wLat = lat;
  for (let i = 0; i < 3; i++) {
    const f = wgs84ToGcj02(wLng, wLat);
    wLng += lng - f.lng;
    wLat += lat - f.lat;
  }
  return { lng: wLng, lat: wLat };
}

// ---------------- 数据获取 ----------------

function areaBbox() {
  const sw = gcj02ToWgs84(AREA.sw.lng, AREA.sw.lat);
  const ne = gcj02ToWgs84(AREA.ne.lng, AREA.ne.lat);
  return [sw.lat - PAD_DEG, sw.lng - PAD_DEG, ne.lat + PAD_DEG, ne.lng + PAD_DEG].map((n) => n.toFixed(6)).join(',');
}

// 道路：查询保持最简，类型过滤在本地做
function roadsQuery() {
  return `[out:json][timeout:60];way["highway"](${areaBbox()});out geom;`;
}

// 绿地与商业体：次要数据，失败不影响玩法（markBirds / markCovered 有兜底）
function placesQuery() {
  const b = areaBbox();
  return `[out:json][timeout:45];(way["leisure"="park"](${b});node["leisure"="park"](${b});way["shop"="mall"](${b});node["shop"="mall"](${b}););out center;`;
}

async function fetchOverpass(query, onProgress, label) {
  let lastErr = null;
  for (let i = 0; i < MIRRORS.length; i++) {
    const url = MIRRORS[i];
    onProgress?.(`正在获取${label}…（数据源 ${i + 1}/${MIRRORS.length}）`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${url}?data=${encodeURIComponent(query)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.elements)) throw new Error('返回数据格式不正确');
      return json.elements;
    } catch (err) {
      lastErr = err;
      console.warn('[饿了喵] 路网数据源失败：', url, err && err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label}获取失败（${(lastErr && lastErr.message) || '未知错误'}）。`);
}

// ---------------- 几何处理 ----------------

// 把一条 way 转成本地米坐标，并按营业区域裁剪成若干段
function clipWay(geometry) {
  const out = [];
  let cur = [];
  for (const p of geometry) {
    const ll = wgs84ToGcj02(p.lon, p.lat);
    if (insideArea(ll, 0.0012)) {
      cur.push(frame.toLocal(ll));
    } else {
      if (cur.length > 1) out.push(cur);
      // 保留一个区域外的点，让边界道路能连到区域边缘
      cur = cur.length ? [cur[cur.length - 1], frame.toLocal(ll)] : [frame.toLocal(ll)];
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function walkable(tags = {}) {
  if (!WALKABLE.has(tags.highway)) return false;
  if (tags.foot === 'no' || tags.access === 'private' || tags.access === 'no') return false;
  return true;
}

// ---------------- 地点锚点 ----------------

// 在真实路网上用「最远点采样」铺开地点，保证分布均匀且都落在街道上
function spreadAnchors(graph, count) {
  const nodes = [...graph.nodes.values()];
  if (!nodes.length) return [];
  const cx = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const cz = (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2;
  // 从最接近区域中心的路口起步
  let seed = nodes[0];
  let best = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - cx, n.z - cz);
    if (d < best) {
      best = d;
      seed = n;
    }
  }
  const picked = [seed];
  const dist = new Map(nodes.map((n) => [n.id, Math.hypot(n.x - seed.x, n.z - seed.z)]));
  while (picked.length < count) {
    let far = null;
    let farD = -1;
    for (const n of nodes) {
      const d = dist.get(n.id);
      if (d > farD) {
        farD = d;
        far = n;
      }
    }
    if (!far || farD <= 0) break;
    picked.push(far);
    for (const n of nodes) {
      const d = Math.hypot(n.x - far.x, n.z - far.z);
      if (d < dist.get(n.id)) dist.set(n.id, d);
    }
  }
  return picked;
}

// ---------------- 对外入口 ----------------

export async function buildOsmRoadGraph({ onProgress } = {}) {
  const roads = await fetchOverpass(roadsQuery(), onProgress, '真实路网');

  onProgress?.('正在整理真实路网…');
  const lines = [];
  for (const el of roads) {
    if (el.type !== 'way' || !el.geometry || !walkable(el.tags)) continue;
    for (const seg of clipWay(el.geometry)) lines.push(seg);
  }
  if (lines.length < 20) throw new Error(`该区域的真实路网数据过少（${lines.length} 段），请更换营业区域。`);

  const graph = new TmapGraph('osm');
  graph.ingest(lines);
  graph.keepOnly(graph.largestComponent());
  if (graph.nodes.size < 80) throw new Error(`路网节点过少（${graph.nodes.size}）：该区域步行数据不足。`);

  // 绿地与商业体属于次要数据，取不到就用兜底规则
  const parks = [];
  const malls = [];
  try {
    const extra = await fetchOverpass(placesQuery(), onProgress, '绿地与商业体');
    for (const el of extra) {
      const c = el.center || (el.type === 'node' ? { lon: el.lon, lat: el.lat } : null);
      if (!c) continue;
      const ll = wgs84ToGcj02(c.lon, c.lat);
      if (!insideArea(ll, 0.001)) continue;
      (el.tags?.leisure ? parks : malls).push({ local: frame.toLocal(ll) });
    }
  } catch (err) {
    console.warn('[饿了喵] 绿地与商业体数据不可用，改用兜底规则：', err && err.message);
  }

  onProgress?.('正在安排街区地点…');
  const need = 1 + SHOPS.length + CUSTOMERS.length;
  const spots = spreadAnchors(graph, need);
  if (spots.length < need) throw new Error(`路网可用路口不足（${spots.length}/${need}）。`);

  const bound = { station: { node: spots[0].id, pos: null, off: [-1, 1], offScale: 11 } };
  let i = 1;
  for (const s of SHOPS) {
    bound[s.id] = { node: spots[i].id, pos: null, off: i % 2 ? [1, 1] : [1, -1], offScale: 9 };
    i++;
  }
  for (const c of CUSTOMERS) {
    bound[c.id] = { node: spots[i].id, pos: null, off: i % 2 ? [1, 1] : [-1, 1], offScale: 9 };
    i++;
  }
  bindAnchors(bound);

  const placed = spots.map((n) => ({ x: n.x, z: n.z }));
  graph.markCovered(malls);
  graph.markBirds(parks, placed);
  graph.markBoxes(placed);

  // 可达性校验：所有地点必须互相可达
  const stationNode = bound.station.node;
  const unreachable = Object.values(bound).filter((b) => !graph.path(stationNode, b.node));
  if (unreachable.length) throw new Error(`有 ${unreachable.length} 个地点在路网上不可达。`);

  graph.coveredCount = [...graph.edges.values()].filter((e) => e.covered).length;
  graph.stats = { ways: lines.length, parks: parks.length, malls: malls.length };
  return graph;
}
