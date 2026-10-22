#!/usr/bin/env node
// 预烘焙真实路网：OpenStreetMap 道路中心线 -> 腾讯底图（GCJ-02）对齐的可寻路路网
//
// 用法：
//   1) 取数据（任选其一，保存为 UTF-8 JSON 数组，元素含 tags 与 geometry）：
//      curl -G https://overpass-api.de/api/interpreter --data-urlencode \
//        'data=[out:json][timeout:60];way["highway"](<minLat>,<minLng>,<maxLat>,<maxLng>);out geom;' \
//        -o roads.json
//      注意 bbox 用 WGS-84；可先用 node tools/bake-road-network.mjs --bbox 打印换算结果。
//   2) node tools/bake-road-network.mjs roads.json
//      产出 demo/public/road-network.json，应用启动时会自动加载，无需任何在线接口。
//
// 营业区域取自 demo/.env.local 的 VITE_AREA_SW / VITE_AREA_NE（缺省用内置默认值）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(HERE, '..');

// ---------------- 营业区域 ----------------

function readEnvArea() {
  const out = {};
  const f = resolve(DEMO, '.env.local');
  if (existsSync(f)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*(VITE_AREA_SW|VITE_AREA_NE)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

function parseLngLat(text, fallback) {
  if (typeof text === 'string') {
    const p = text.split(',').map((s) => Number(s.trim()));
    if (p.length === 2 && p.every(Number.isFinite)) return { lng: p[0], lat: p[1] };
  }
  return fallback;
}

const env = readEnvArea();
const SW0 = parseLngLat(env.VITE_AREA_SW, { lng: 116.386907, lat: 40.001739 });
const NE0 = parseLngLat(env.VITE_AREA_NE, { lng: 116.407946, lat: 40.009472 });
const AREA = {
  sw: { lng: Math.min(SW0.lng, NE0.lng), lat: Math.min(SW0.lat, NE0.lat) },
  ne: { lng: Math.max(SW0.lng, NE0.lng), lat: Math.max(SW0.lat, NE0.lat) },
};
AREA.center = { lng: (AREA.sw.lng + AREA.ne.lng) / 2, lat: (AREA.sw.lat + AREA.ne.lat) / 2 };

// ---------------- WGS-84 <-> GCJ-02 ----------------

const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

const outOfChina = (lng, lat) => !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);

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

function wgs84ToGcj02(lng, lat) {
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

function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let a = lng;
  let b = lat;
  for (let i = 0; i < 3; i++) {
    const f = wgs84ToGcj02(a, b);
    a += lng - f.lng;
    b += lat - f.lat;
  }
  return { lng: a, lat: b };
}

// ---------------- 本地平面坐标 ----------------

const M_PER_LAT = 111320;
const mPerLng = M_PER_LAT * Math.cos((AREA.center.lat * PI) / 180);
const toLocal = (ll) => ({ x: (ll.lng - AREA.center.lng) * mPerLng, z: -(ll.lat - AREA.center.lat) * M_PER_LAT });

const cornerA = toLocal(AREA.sw);
const cornerB = toLocal(AREA.ne);
const AREA_LOCAL = {
  minX: Math.min(cornerA.x, cornerB.x),
  maxX: Math.max(cornerA.x, cornerB.x),
  minZ: Math.min(cornerA.z, cornerB.z),
  maxZ: Math.max(cornerA.z, cornerB.z),
};
AREA_LOCAL.width = AREA_LOCAL.maxX - AREA_LOCAL.minX;
AREA_LOCAL.height = AREA_LOCAL.maxZ - AREA_LOCAL.minZ;

const insideArea = (ll, pad = 0) =>
  ll.lng >= AREA.sw.lng - pad && ll.lng <= AREA.ne.lng + pad && ll.lat >= AREA.sw.lat - pad && ll.lat <= AREA.ne.lat + pad;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function thin(points, minStep) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (dist(out[out.length - 1], points[i]) >= minStep) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

// ---------------- 路网构建（与 src/tmap 保持一致） ----------------

const CELL_M = 16;
const THIN_M = 8;
const WALKABLE = new Set([
  'residential', 'living_street', 'pedestrian', 'footway', 'path', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link',
  'trunk', 'trunk_link', 'cycleway', 'steps',
]);

function walkable(tags = {}) {
  if (!WALKABLE.has(tags.highway)) return false;
  if (tags.foot === 'no' || tags.access === 'private' || tags.access === 'no') return false;
  return true;
}

// 路网允许比营业区域略宽一圈，保证边界处的道路不被截断得太生硬；但必须有上限，
// 否则 OSM 上相邻两点可能隔着几百米，“连到区域边缘”会把节点拖到区域外很远的地方。
const ROAD_PAD_M = 90;

function clampToRoadBox(p) {
  const cx = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const cz = (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2;
  const hx = AREA_LOCAL.width / 2 + ROAD_PAD_M;
  const hz = AREA_LOCAL.height / 2 + ROAD_PAD_M;
  return {
    x: Math.min(Math.max(p.x, cx - hx), cx + hx),
    z: Math.min(Math.max(p.z, cz - hz), cz + hz),
  };
}

function clipWay(geometry) {
  const out = [];
  let cur = [];
  for (const p of geometry) {
    const ll = wgs84ToGcj02(p.lon, p.lat);
    const local = toLocal(ll);
    if (insideArea(ll, 0.0008)) {
      cur.push(local);
    } else {
      if (cur.length) {
        cur.push(clampToRoadBox(local)); // 连到区域边缘，但不越过上限
        out.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

class Graph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.adj = new Map();
  }
  key(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
  addNode(id, x, z, side) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, x, z, side });
      this.adj.set(id, []);
    }
    return this.nodes.get(id);
  }
  addEdge(a, b) {
    if (a === b) return;
    const k = this.key(a, b);
    if (this.edges.has(k) || !this.nodes.has(a) || !this.nodes.has(b)) return;
    this.edges.set(k, { a, b, covered: false });
    this.adj.get(a).push(b);
    this.adj.get(b).push(a);
  }
  degree(id) {
    return (this.adj.get(id) || []).length;
  }
  pos(id) {
    return this.nodes.get(id);
  }
  largestComponent() {
    const seen = new Set();
    let best = [];
    for (const id of this.nodes.keys()) {
      if (seen.has(id)) continue;
      const comp = [];
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const nb of this.adj.get(cur) || []) if (!seen.has(nb)) (seen.add(nb), stack.push(nb));
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  }
  keepOnly(ids) {
    const keep = new Set(ids);
    for (const id of [...this.nodes.keys()]) if (!keep.has(id)) (this.nodes.delete(id), this.adj.delete(id));
    for (const [k, e] of [...this.edges]) if (!keep.has(e.a) || !keep.has(e.b)) this.edges.delete(k);
    for (const [id, list] of this.adj) this.adj.set(id, list.filter((n) => keep.has(n)));
  }
  reachable(from) {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop();
      for (const nb of this.adj.get(cur) || []) if (!seen.has(nb)) (seen.add(nb), stack.push(nb));
    }
    return seen;
  }
}

function ingest(graph, lines) {
  const cells = new Map();
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
    graph.addNode(k, x, z, x < midX ? 'w' : 'e');
  }
  for (const seq of seqs) for (let i = 1; i < seq.length; i++) graph.addEdge(seq[i - 1], seq[i]);
}

// ---------------- 真实功能属性（OSM 标签 -> 功能类别） ----------------
//
// 只用来回答「这个路口周边实际是什么地方」：住宅区、写字楼、公园、学校……
// 真实 POI 名称一律不作为店名展示（PRD v0.3 约定），仅写入 realName 供调试与数据来源说明。

const POI_RADIUS_M = 170; // 路口周边多大范围内的属性算作「这一带的性质」
const POI_FALLOFF_M = 40; // 距离权重软化：避免贴着路口的单个点一票独大

function categoryOf(t = {}) {
  const { building: b, landuse: l, leisure: le, amenity: a, shop: s, office: o } = t;
  if (a === 'school' || a === 'kindergarten' || a === 'university' || a === 'college' || b === 'school') return 'school';
  if (le === 'park' || le === 'garden' || le === 'nature_reserve' || l === 'forest' || l === 'grass' || l === 'meadow') return 'park';
  if (le === 'pitch' || le === 'sports_centre' || le === 'stadium' || le === 'track') return 'sports';
  if (s === 'books' || a === 'library' || a === 'cinema' || a === 'theatre' || a === 'arts_centre' || a === 'museum' || a === 'research_institute' || o === 'research') return 'culture';
  if (a === 'restaurant' || a === 'cafe' || a === 'fast_food' || a === 'food_court' || s === 'bakery' || s === 'confectionery') return 'food';
  if (s === 'mall' || s === 'department_store' || s === 'supermarket' || s === 'convenience' || l === 'retail' || b === 'retail' || b === 'commercial') return 'retail';
  if (o || b === 'office' || l === 'commercial') return 'office';
  if (b === 'apartments' || b === 'residential' || b === 'house' || b === 'dormitory' || l === 'residential') return 'residential';
  return null;
}

function readPoi(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const elements = Array.isArray(raw) ? raw : raw.elements || [];
  const pts = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const cat = categoryOf(el.tags);
    if (!cat) continue;
    const p = toLocal(wgs84ToGcj02(lon, lat));
    pts.push({ x: p.x, z: p.z, cat, name: el.tags?.name || null });
  }
  return pts;
}

// 每个路口的类别得票 + 最近的真实 POI 名
function scoreNodes(graph, pts) {
  const info = new Map();
  for (const n of graph.nodes.values()) {
    const score = {};
    let near = null;
    let nearD = Infinity;
    for (const p of pts) {
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (d > POI_RADIUS_M) continue;
      score[p.cat] = (score[p.cat] || 0) + 1 / (POI_FALLOFF_M + d);
      if (p.name && d < nearD) ((nearD = d), (near = p.name));
    }
    const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    info.set(n.id, { score, main: top ? top[0] : null, realName: near });
  }
  return info;
}

// ---------------- 地点放置 ----------------

// 最远点采样：地点均匀铺开且都落在真实街道上
//
// 候选必须限制在营业区域内缩一圈的范围里：采样本身偏好「离已选点最远」，不设限就会把地点
// 全推到路网最外围——而路网为了保持道路连续性是允许溢出营业区域的，结果地点跑到地图可视
// 范围之外。INSET 既保证地点在区域内，也给标签留出不贴边的余量。
const ANCHOR_INSET = 0.86;
const MIN_GAP_M = 150; // 相邻地点的硬性最小间距，避免两家店挤在同一个路口

function anchorCandidates(graph) {
  const cx = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const cz = (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2;
  const hx = (AREA_LOCAL.width / 2) * ANCHOR_INSET;
  const hz = (AREA_LOCAL.height / 2) * ANCHOR_INSET;
  const all = [...graph.nodes.values()];
  const inside = all.filter((n) => Math.abs(n.x - cx) <= hx && Math.abs(n.z - cz) <= hz);
  return inside.length >= 40 ? inside : all;
}

function centermost(nodes) {
  const cx = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const cz = (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2;
  let seed = nodes[0];
  let best = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - cx, n.z - cz);
    if (d < best) ((best = d), (seed = n));
  }
  return seed;
}

function spreadAnchors(graph, count) {
  const nodes = anchorCandidates(graph);
  const seed = centermost(nodes);
  const picked = [seed];
  const dmap = new Map(nodes.map((n) => [n.id, Math.hypot(n.x - seed.x, n.z - seed.z)]));
  while (picked.length < count) {
    let far = null;
    let farD = -1;
    for (const n of nodes) {
      const d = dmap.get(n.id);
      if (d > farD) ((farD = d), (far = n));
    }
    if (!far || farD <= 0) break;
    picked.push(far);
    for (const n of nodes) {
      const d = Math.hypot(n.x - far.x, n.z - far.z);
      if (d < dmap.get(n.id)) dmap.set(n.id, d);
    }
  }
  return picked;
}

// 带功能属性约束的放置：
// 先满足稀缺类别（学校、写字楼、住宅点位少），再安排充裕类别（公园、餐饮多），
// 每个槽位都在「该类别有得票」的路口里挑一个离已放置地点最远的，兼顾贴合与铺开。
function placeByCategory(graph, slots, info) {
  const nodes = anchorCandidates(graph);
  const supply = {};
  for (const n of nodes) for (const c of Object.keys(info.get(n.id)?.score || {})) supply[c] = (supply[c] || 0) + 1;

  const station = centermost(nodes);
  const taken = new Map([['station', station]]);
  const used = new Set([station.id]);

  // 排序：人设绑定属性的地点（耐心顾客要住宅、银杏小学要学校）先挑，
  // 其余按类别稀缺度排，最后才是点位充裕的。否则充裕类别会把稀缺类别的好位置占掉。
  const scarcity = (s) => Math.min(...s.prefer.map((c) => supply[c] || 0));
  const queue = slots
    .filter((s) => s.id !== 'station')
    .sort((a, b) => (b.strict ? 1 : 0) - (a.strict ? 1 : 0) || scarcity(a) - scarcity(b));

  const relaxed = [];
  for (const slot of queue) {
    let best = null;
    // 先按期望间距找；找不到再放宽到 60%，宁可挨近一点也不丢掉属性匹配
    for (const minGap of [MIN_GAP_M, MIN_GAP_M * 0.6]) {
      let bestKey = null;
      for (const pref of slot.prefer) {
        for (const n of nodes) {
          if (used.has(n.id)) continue;
          const sc = info.get(n.id)?.score?.[pref];
          if (!sc) continue;
          const gap = Math.min(...[...taken.values()].map((t) => Math.hypot(t.x - n.x, t.z - n.z)));
          if (gap < minGap) continue;
          // 先保证离已放置地点足够远，同等距离下取属性更突出的点
          const key = Math.min(gap, MIN_GAP_M * 2.2) * 1000 + sc;
          if (key > (bestKey ?? -1)) ((bestKey = key), (best = { n, cat: pref }));
        }
        if (best) break;
      }
      if (best) break;
    }
    if (best) {
      taken.set(slot.id, best.n);
      used.add(best.n.id);
      best.n._cat = best.cat;
    } else {
      relaxed.push(slot);
    }
  }

  // 偏好类别无点位可用时，退回纯分散采样，并按该路口的实际主类别命名
  for (const slot of relaxed) {
    let far = null;
    let farD = -1;
    for (const n of nodes) {
      if (used.has(n.id)) continue;
      const gap = Math.min(...[...taken.values()].map((t) => Math.hypot(t.x - n.x, t.z - n.z)));
      if (gap > farD) ((farD = gap), (far = n));
    }
    if (!far) continue;
    taken.set(slot.id, far);
    used.add(far.id);
    far._cat = info.get(far.id)?.main || null;
  }
  return taken;
}

// ---------------- 地点（与 src/places.js 对应） ----------------

const SHOP_IDS = ['bakery', 'grocery', 'fishsoup', 'morning'];
const CUSTOMER_IDS = [
  'sakura', 'school', 'office', 'books', 'pine', 'green', 'riverside',
  'parkeast', 'harbor', 'florist', 'slope', 'tower', 'alley',
];

// 命名规则：保留原有的日式治愈风词根，后缀改由该路口的真实功能属性决定。
//
// 于是「樱花」在住宅区是樱花公寓、在公园边就是樱花园，名字始终虚构（PRD v0.3），
// 但类型和真实地图对得上，不会出现写字楼里住着老奶奶这种违和感。
//
// root    风格词根（沿用 src/places.js 的既有命名）
// prefer  期望的功能类别，按优先级排列；放置时稀缺类别优先占位
// suffix  各类别对应的后缀；缺省用 fallback
const SUFFIX_FALLBACK = {
  residential: '公寓',
  office: '写字楼',
  park: '公园',
  school: '小学',
  culture: '书店',
  retail: '商店街',
  sports: '运动场',
  food: '食堂',
};

const SLOT_STYLE = {
  // 店铺：品类由 goods 决定，后缀不能随属性改，只挑贴合的位置
  bakery: { root: '麦香', prefer: ['food', 'retail'], fixed: '面包坊' },
  morning: { root: '晨光', prefer: ['food', 'retail'], fixed: '面包' },
  fishsoup: { root: '胡须', prefer: ['food', 'retail'], fixed: '鱼汤' },
  grocery: { root: '桥边', prefer: ['retail', 'food'], fixed: '杂货' },

  // 顾客：后缀跟随真实属性。strict 表示人设与属性强绑定，放置时优先保证
  sakura: { root: '樱花', prefer: ['residential', 'park'], strict: true, suffix: { park: '园', residential: '公寓' } },
  pine: { root: '松风', prefer: ['residential', 'park'], suffix: { park: '绿地', residential: '公寓' } },
  green: { root: '绿荫', prefer: ['residential', 'park'], suffix: { park: '绿地', residential: '小区' } },
  harbor: { root: '港湾', prefer: ['residential', 'retail'], strict: true, suffix: { residential: '小区', retail: '商店街' } },
  tower: { root: '钟塔', prefer: ['residential', 'office'], suffix: { residential: '公寓', office: '写字楼' } },
  slope: { root: '坂道', prefer: ['residential', 'food'], strict: true, suffix: { residential: '二丁目', food: '二丁目' } },
  alley: { root: '巷尾', prefer: ['residential', 'park', 'food'], suffix: { residential: '小屋', park: '小屋', food: '小屋' } },
  office: { root: '西町', prefer: ['office', 'retail'], suffix: { office: '写字楼', retail: '商务楼' } },
  riverside: { root: '河畔', prefer: ['office', 'culture'], suffix: { office: '写字楼', culture: '文创园' } },
  school: { root: '银杏', prefer: ['school', 'sports'], strict: true, suffix: { school: '小学', sports: '运动场' } },
  books: { root: '钟楼', prefer: ['culture', 'retail'], suffix: { culture: '书店', retail: '商店街' } },
  florist: { root: '云雀', prefer: ['retail', 'food'], suffix: { retail: '花店', food: '花店' } },
  parkeast: { root: '东丘', prefer: ['park', 'sports'], strict: true, suffix: { park: '公园东门', sports: '运动场' } },
};

function nameFor(id, cat) {
  const st = SLOT_STYLE[id];
  if (!st) return null;
  if (st.fixed) return st.root + st.fixed;
  const suf = (cat && st.suffix?.[cat]) || (cat && SUFFIX_FALLBACK[cat]) || st.suffix?.[st.prefer[0]] || '';
  return st.root + suf;
}

const SLOTS = [
  { id: 'station', prefer: [] },
  ...SHOP_IDS.map((id) => ({ id, prefer: SLOT_STYLE[id].prefer, strict: !!SLOT_STYLE[id].strict })),
  ...CUSTOMER_IDS.map((id) => ({ id, prefer: SLOT_STYLE[id].prefer, strict: !!SLOT_STYLE[id].strict })),
];

// ---------------- 主流程 ----------------

if (process.argv.includes('--bbox')) {
  const sw = gcj02ToWgs84(AREA.sw.lng, AREA.sw.lat);
  const ne = gcj02ToWgs84(AREA.ne.lng, AREA.ne.lat);
  const pad = 0.004;
  console.log('营业区域（GCJ-02，用于腾讯地图）:', AREA.sw, AREA.ne);
  console.log('Overpass bbox（WGS-84，minLat,minLng,maxLat,maxLng）:');
  console.log([sw.lat - pad, sw.lng - pad, ne.lat + pad, ne.lng + pad].map((n) => n.toFixed(6)).join(','));
  process.exit(0);
}

const args = process.argv.slice(2);
const poiAt = args.indexOf('--poi');
const poiFile = poiAt >= 0 ? args[poiAt + 1] : null;
const input = args.find((a, i) => !a.startsWith('--') && i !== poiAt + 1);
if (!input) {
  console.error(
    '用法：node tools/bake-road-network.mjs <roads.json> [--poi poi.json]\n' +
      '      node tools/bake-road-network.mjs public/road-network.json --poi poi.json   # 仅重算地点与命名\n' +
      '      node tools/bake-road-network.mjs --bbox',
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));

// 两种输入：Overpass 原始道路数据，或已经烘焙好的 road-network.json。
// 后者用于在不重新抓取 OSM 的情况下，按当前规则重新收束路网范围并重选地点。
const refit = !Array.isArray(raw) && raw.v === 1 && Array.isArray(raw.nodes) && raw.anchors;
const elements = refit ? [] : Array.isArray(raw) ? raw : raw.elements || [];

const graph = new Graph();
const lines = [];
let skipped = 0;

if (refit) {
  const cx = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const cz = (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2;
  const hx = AREA_LOCAL.width / 2 + ROAD_PAD_M;
  const hz = AREA_LOCAL.height / 2 + ROAD_PAD_M;
  let dropped = 0;
  for (const [id, x, z, side] of raw.nodes) {
    if (Math.abs(x - cx) > hx || Math.abs(z - cz) > hz) {
      dropped++;
      continue;
    }
    graph.addNode(id, x, z, side);
  }
  for (const [a, b, cov] of raw.edges) {
    graph.addEdge(a, b);
    const e = graph.edges.get(graph.key(a, b));
    if (e && cov) e.covered = true;
  }
  console.log(`重拟合：丢弃越界节点 ${dropped}，保留 ${graph.nodes.size}`);
} else {
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry) continue;
    if (!walkable(el.tags)) {
      skipped++;
      continue;
    }
    for (const seg of clipWay(el.geometry)) lines.push(seg);
  }
  ingest(graph, lines);
}

graph.keepOnly(graph.largestComponent());

const need = 1 + SHOP_IDS.length + CUSTOMER_IDS.length;

// 有 POI 数据时按真实功能属性放置并命名；没有就退回纯分散采样、沿用 places.js 的默认名
const poiPts = poiFile ? readPoi(poiFile) : [];
const info = poiPts.length ? scoreNodes(graph, poiPts) : null;

const order = [...SHOP_IDS, ...CUSTOMER_IDS];
const anchors = {};
const spots = [];

if (info) {
  const taken = placeByCategory(graph, SLOTS, info);
  if (taken.size < need) {
    console.error(`路网可用路口不足：${taken.size}/${need}`);
    process.exit(1);
  }
  const st = taken.get('station');
  anchors.station = { node: st.id, pos: null, off: [-1, 1], offScale: 11, realName: null };
  spots.push(st);
  let k = 1;
  for (const id of order) {
    const n = taken.get(id);
    const cat = n._cat || info.get(n.id)?.main || null;
    anchors[id] = {
      node: n.id,
      pos: null,
      off: k % 2 ? [1, 1] : [1, -1],
      offScale: 9,
      name: nameFor(id, cat),
      cat,
      realName: info.get(n.id)?.realName || null,
    };
    spots.push(n);
    k++;
  }
} else {
  const picked = spreadAnchors(graph, need);
  if (picked.length < need) {
    console.error(`路网可用路口不足：${picked.length}/${need}`);
    process.exit(1);
  }
  anchors.station = { node: picked[0].id, pos: null, off: [-1, 1], offScale: 11, realName: null };
  spots.push(picked[0]);
  let k = 1;
  for (const id of order) {
    anchors[id] = { node: picked[k].id, pos: null, off: k % 2 ? [1, 1] : [1, -1], offScale: 9, realName: null };
    spots.push(picked[k]);
    k++;
  }
}

// 可达性校验
const reach = graph.reachable(anchors.station.node);
const bad = Object.entries(anchors).filter(([, a]) => !reach.has(a.node));
if (bad.length) {
  console.error('有地点不可达：', bad.map(([k]) => k).join(', '));
  process.exit(1);
}

// 遮蔽路段（雨棚）：以步行街为主，不足时取度数最高的路口周边
const placed = spots.map((n) => ({ x: n.x, z: n.z }));
const pedestrianCells = new Set();
for (const el of elements) {
  if (el.type !== 'way' || !el.geometry) continue;
  if (el.tags?.highway !== 'pedestrian' && el.tags?.covered !== 'yes') continue;
  for (const seg of clipWay(el.geometry)) for (const p of seg) pedestrianCells.add(`${Math.round(p.x / CELL_M)}_${Math.round(p.z / CELL_M)}`);
}
// 重拟合时 elements 为空，沿用原文件里已标好的遮蔽路段
let covered = refit ? [...graph.edges.values()].filter((e) => e.covered).length : 0;
for (const e of graph.edges.values()) {
  if (pedestrianCells.has(e.a) && pedestrianCells.has(e.b) && !e.covered) {
    e.covered = true;
    covered++;
  }
}
if (covered < 6) {
  const hubs = [...graph.nodes.values()].sort((a, b) => graph.degree(b.id) - graph.degree(a.id)).slice(0, 3);
  for (const e of graph.edges.values()) {
    const a = graph.pos(e.a);
    const b = graph.pos(e.b);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (hubs.some((h) => Math.hypot(h.x - mx, h.z - mz) < 120)) {
      if (!e.covered) covered++;
      e.covered = true;
    }
  }
}

// 观鸟点：离各地点最远的两片安静路口
const bird = new Set();
{
  const quiet = [...graph.nodes.values()]
    .map((n) => ({ n, d: Math.min(...placed.map((p) => Math.hypot(p.x - n.x, p.z - n.z))) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 2)
    .map((o) => o.n);
  const cap = Math.max(4, Math.round(graph.nodes.size * 0.12));
  for (const n of graph.nodes.values()) {
    if (bird.size >= cap) break;
    if (quiet.some((q) => Math.hypot(q.x - n.x, q.z - n.z) < 140)) bird.add(n.id);
  }
}

// 纸箱点：四象限各一处
const box = new Set();
{
  const mx = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const mz = (AREA_LOCAL.minZ + AREA_LOCAL.maxZ) / 2;
  const quads = [
    [AREA_LOCAL.minX, mx, AREA_LOCAL.minZ, mz],
    [mx, AREA_LOCAL.maxX, AREA_LOCAL.minZ, mz],
    [AREA_LOCAL.minX, mx, mz, AREA_LOCAL.maxZ],
    [mx, AREA_LOCAL.maxX, mz, AREA_LOCAL.maxZ],
  ];
  for (const [x0, x1, z0, z1] of quads) {
    let best = null;
    let bestScore = -Infinity;
    for (const n of graph.nodes.values()) {
      if (n.x < x0 || n.x > x1 || n.z < z0 || n.z > z1) continue;
      const near = Math.min(...placed.map((p) => Math.hypot(p.x - n.x, p.z - n.z)));
      const score = Math.min(near, 160) + graph.degree(n.id) * 12;
      if (score > bestScore) ((bestScore = score), (best = n));
    }
    if (best) box.add(best.id);
  }
}

const out = {
  v: 1,
  area: `${AREA.sw.lng.toFixed(6)},${AREA.sw.lat.toFixed(6)},${AREA.ne.lng.toFixed(6)},${AREA.ne.lat.toFixed(6)}`,
  source: 'osm',
  nodes: [...graph.nodes.values()].map((n) => [n.id, Number(n.x.toFixed(2)), Number(n.z.toFixed(2)), n.side]),
  edges: [...graph.edges.values()].map((e) => [e.a, e.b, e.covered ? 1 : 0, 0]),
  box: [...box],
  bird: [...bird],
  anchors,
};

const dest = resolve(DEMO, 'public/road-network.json');
writeFileSync(dest, JSON.stringify(out));
if (!refit) console.log(`道路 ${elements.length} 条（可步行 ${elements.length - skipped}），裁剪后 ${lines.length} 段`);
console.log(`路网 ${out.nodes.length} 节点 / ${out.edges.length} 边，遮蔽 ${covered}，观鸟 ${bird.size}，纸箱 ${box.size}`);
if (info) {
  const CN = { residential: '住宅', office: '办公', park: '公园绿地', school: '学校', culture: '文化', retail: '商业', sports: '运动', food: '餐饮' };
  console.log(`\n真实属性点 ${poiPts.length} 个，地点命名：`);
  for (const id of order) {
    const a = anchors[id];
    const want = SLOT_STYLE[id].prefer[0];
    const hit = a.cat === want ? ' ' : '~'; // ~ 表示退到了次优属性
    console.log(`  ${hit} ${(a.name || id).padEnd(12)} ${(CN[a.cat] || '未知').padEnd(6)} ${a.realName ? '实际近邻：' + a.realName : ''}`);
  }
  console.log('  （真实 POI 名仅作调试记录，展示名一律虚构）');
}
console.log(`\n已写入 ${dest}（${(JSON.stringify(out).length / 1024).toFixed(0)} KB）`);
