// 通用路网层：灰盒街区与腾讯地图真实路网共用同一套寻路与度量接口
//
// 统一约定：
// - 场景坐标为 three.js 的 (x, z)，单位由 unitM 决定（1 场景单位 = unitM 米）；
// - len 为场景单位长度，lenM 为米；玩法一律用米计算，渲染一律用场景单位；
// - sideOf(node) 返回片区键（'w' / 'e'），sideNames 给出展示名称。

class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(key, pri) {
    const a = this.a;
    a.push([pri, key]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class RoadGraph {
  constructor({ unitM = 1, sideNames = { w: '西区', e: '东区' }, complexDegree = 5, shelterPenalty = 1.6 } = {}) {
    this.unitM = unitM;
    this.sideNames = sideNames;
    this.complexDegree = complexDegree;
    this.shelterPenalty = shelterPenalty;
    this.nodes = new Map(); // id -> { id, x, z, side, ... }
    this.edges = new Map(); // key -> { a, b, len, lenM, covered, bridge }
    this.adj = new Map(); // id -> [neighborId]
    this.boxNodes = new Set();
    this.birdNodes = new Set();
    this.slot = { spacing: 2.2, front: 4.2 };
    this.overshootM = 55; // 复杂路口「跑过头」的冲出距离（米）
    this.shelterNote = '有雨棚的路段不受影响。';
    this.shelterRouteNote = '优先经过有雨棚的路段 · 可能绕行';
    this.mapNote = '地图为示意街区';
    this.bottleneckNote = '主干道与过街点瓶颈';
    this.attribution = '时间为游戏模拟时间';
    this._distCache = new Map();
  }

  static key(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  addNode(id, x, z, extra = {}) {
    if (this.nodes.has(id)) return this.nodes.get(id);
    const n = { id, x, z, side: 'w', ...extra };
    this.nodes.set(id, n);
    this.adj.set(id, []);
    return n;
  }

  addEdge(a, b, extra = {}) {
    if (a === b) return null;
    const k = RoadGraph.key(a, b);
    if (this.edges.has(k)) return this.edges.get(k);
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) return null;
    const len = Math.hypot(na.x - nb.x, na.z - nb.z);
    const e = { a, b, len, lenM: len * this.unitM, covered: false, bridge: false, ...extra };
    this.edges.set(k, e);
    this.adj.get(a).push(b);
    this.adj.get(b).push(a);
    this._distCache.clear();
    return e;
  }

  edge(a, b) {
    return this.edges.get(RoadGraph.key(a, b));
  }

  pos(id) {
    return this.nodes.get(id);
  }

  degree(id) {
    return (this.adj.get(id) || []).length;
  }

  isComplex(id) {
    return this.degree(id) >= this.complexDegree;
  }

  get complexNodes() {
    return [...this.nodes.keys()].filter((id) => this.isComplex(id));
  }

  sideOf(id) {
    const n = this.nodes.get(id);
    return n ? n.side : 'w';
  }

  sideName(side) {
    return this.sideNames[side] || side;
  }

  // Dijkstra（二叉堆）；shelter 模式下非遮蔽路段代价上升，促使绕行到有雨棚的路线
  path(from, to, { shelter = false } = {}) {
    if (from === to) return [from];
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const done = new Set();
    const heap = new MinHeap();
    heap.push(from, 0);
    while (heap.size) {
      const [d, cur] = heap.pop();
      if (done.has(cur)) continue;
      done.add(cur);
      if (cur === to) break;
      for (const nb of this.adj.get(cur)) {
        if (done.has(nb)) continue;
        const e = this.edge(cur, nb);
        const w = e.len * (shelter && !e.covered && !e.noPenalty ? this.shelterPenalty : 1);
        const nd = d + w;
        if (nd < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, nd);
          prev.set(nb, cur);
          heap.push(nb, nd);
        }
      }
    }
    if (!prev.has(to)) return null;
    const out = [to];
    let c = to;
    while (c !== from) {
      c = prev.get(c);
      out.push(c);
    }
    return out.reverse();
  }

  pathLength(path) {
    if (!path) return Infinity;
    let s = 0;
    for (let i = 1; i < path.length; i++) s += this.edge(path[i - 1], path[i]).len;
    return s;
  }

  pathLengthM(path) {
    return this.pathLength(path) * this.unitM;
  }

  distance(a, b) {
    const k = RoadGraph.key(a, b);
    let v = this._distCache.get(k);
    if (v === undefined) {
      v = this.pathLength(this.path(a, b));
      if (this._distCache.size > 4000) this._distCache.clear();
      this._distCache.set(k, v);
    }
    return v;
  }

  distanceM(a, b) {
    return this.distance(a, b) * this.unitM;
  }

  // 地点落点：真实地图模式直接给坐标，灰盒模式按节点偏移
  placePos(place) {
    if (place.pos) return place.pos;
    const n = this.nodes.get(place.node);
    if (!n) return { x: 0, z: 0 };
    const [sx, sz] = place.off || [1, 1];
    const k = place.offScale ?? 2.6;
    return { x: n.x + sx * k, z: n.z + sz * k };
  }

  // 配送站门前的待命位
  homeSlot(station, i, total = 4) {
    const p = this.placePos(station);
    const { spacing, front } = this.slot;
    return { x: p.x - ((total - 1) * spacing) / 2 + i * spacing, z: p.z + front };
  }

  nearestNode(x, z) {
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  isConnected() {
    if (!this.nodes.size) return false;
    const start = this.nodes.keys().next().value;
    const seen = new Set([start]);
    const st = [start];
    while (st.length) {
      const n = st.pop();
      for (const nb of this.adj.get(n)) if (!seen.has(nb)) seen.add(nb), st.push(nb);
    }
    return seen.size === this.nodes.size;
  }

  // 返回最大连通子集的节点集合（真实路网清洗用）
  largestComponent() {
    const seenAll = new Set();
    let best = [];
    for (const id of this.nodes.keys()) {
      if (seenAll.has(id)) continue;
      const comp = [];
      const st = [id];
      seenAll.add(id);
      while (st.length) {
        const n = st.pop();
        comp.push(n);
        for (const nb of this.adj.get(n))
          if (!seenAll.has(nb)) {
            seenAll.add(nb);
            st.push(nb);
          }
      }
      if (comp.length > best.length) best = comp;
    }
    return new Set(best);
  }

  keepOnly(ids) {
    for (const id of [...this.nodes.keys()]) {
      if (ids.has(id)) continue;
      this.nodes.delete(id);
      this.adj.delete(id);
    }
    for (const [k, e] of [...this.edges]) {
      if (!ids.has(e.a) || !ids.has(e.b)) this.edges.delete(k);
    }
    for (const [id, list] of this.adj) this.adj.set(id, list.filter((n) => ids.has(n)));
    this._distCache.clear();
  }
}
