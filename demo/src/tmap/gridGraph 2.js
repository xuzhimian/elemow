// 腾讯底图 + 示意路网（不消耗 WebServiceAPI 配额）
//
// 用途：当真实路网数据暂不可用（配额未开通 / 已用尽）时，仍然在真实的腾讯底图上游玩。
// 路网为营业区域内按真实米制生成的规则街网，并保留玩法所需的结构：
//   · 一条贯穿东西的主干道，只有两处过街点 → 路线瓶颈
//   · 一段连续的沿街雨棚 → 雨天遮蔽路线
//   · 两处绿地（观鸟点）与四处纸箱点
// attribution 会明确标注「示意路网」，不会把它说成真实道路数据。

import { TmapGraph } from './roadGraph.js';
import { AREA_LOCAL } from '../geo.js';
import { bindAnchors, SHOPS, CUSTOMERS } from '../places.js';
import { mulberry32 } from '../util.js';

const SPACING = 110; // 街网间距（米）
const JITTER = 14;

export function buildGridGraph() {
  const g = new TmapGraph('grid');
  const rng = mulberry32(90125);

  const cols = Math.max(6, Math.round(AREA_LOCAL.width / SPACING));
  const rows = Math.max(4, Math.round(AREA_LOCAL.height / SPACING));
  const dx = AREA_LOCAL.width / cols;
  const dz = AREA_LOCAL.height / rows;
  const midX = (AREA_LOCAL.minX + AREA_LOCAL.maxX) / 2;
  const trunkRow = Math.floor(rows / 2); // 主干道所在横向街道
  const crossCols = [Math.round(cols * 0.26), Math.round(cols * 0.72)]; // 仅此两处可过街

  const id = (c, r) => `g${c}_${r}`;
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      const onTrunk = r === trunkRow;
      const x = AREA_LOCAL.minX + c * dx + (onTrunk ? 0 : (rng() - 0.5) * JITTER * 2);
      const z = AREA_LOCAL.minZ + r * dz + (onTrunk ? 0 : (rng() - 0.5) * JITTER * 2);
      g.addNode(id(c, r), x, z, { side: x < midX ? 'w' : 'e', c, r });
    }
  }

  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      // 横向街道
      if (c < cols) {
        const trunk = r === trunkRow;
        if (trunk || rng() > 0.1) g.addEdge(id(c, r), id(c + 1, r), { trunk, noPenalty: trunk });
      }
      // 纵向街道：穿越主干道时只保留两处过街点
      if (r < rows) {
        const crossesTrunk = r === trunkRow - 1 || r === trunkRow;
        if (crossesTrunk && !crossCols.includes(c)) continue;
        if (crossesTrunk || rng() > 0.1) g.addEdge(id(c, r), id(c, r + 1), { crossing: crossesTrunk, noPenalty: crossesTrunk });
      }
    }
  }

  g.keepOnly(g.largestComponent());

  // 沿街雨棚：主干道北侧一段连续的横向街道
  const coverRow = Math.max(0, trunkRow - 1);
  const coverFrom = Math.round(cols * 0.2);
  const coverTo = Math.round(cols * 0.55);
  for (let c = coverFrom; c < coverTo; c++) {
    const e = g.edge(id(c, coverRow), id(c + 1, coverRow));
    if (e) e.covered = true;
  }

  // 绿地（观鸟点）：两处 2×2 街区
  [
    [Math.round(cols * 0.12), Math.max(0, trunkRow - 2)],
    [Math.round(cols * 0.84), Math.min(rows - 1, trunkRow + 2)],
  ].forEach(([c0, r0]) => {
    for (let c = c0; c <= c0 + 1; c++) for (let r = r0; r <= r0 + 1; r++) if (g.nodes.has(id(c, r))) g.birdNodes.add(id(c, r));
  });

  // 地点锚点：沿区域均匀铺开，店铺贴主干道，顾客分散到街区内
  const slots = [];
  const take = (c, r) => {
    const n = g.nodes.get(id(c, r));
    if (n && !slots.includes(n.id)) slots.push(n.id);
    return n;
  };
  const bound = {};
  const place = (pid, c, r, off) => {
    const n = take(c, r);
    if (!n) return null;
    bound[pid] = { node: n.id, pos: null, off, offScale: 9 };
    return n;
  };

  // 配送站：主干道南侧、区域中部
  place('station', Math.round(cols * 0.48), Math.min(rows, trunkRow + 1), [-1, 1]);
  if (bound.station) bound.station.offScale = 11;

  const shopCells = [
    [Math.round(cols * 0.3), trunkRow - 1],
    [Math.round(cols * 0.62), trunkRow + 1],
    [Math.round(cols * 0.44), trunkRow - 1],
    [Math.round(cols * 0.8), trunkRow - 1],
  ];
  SHOPS.forEach((s, i) => {
    const [c, r] = shopCells[i % shopCells.length];
    place(s.id, c, Math.max(0, Math.min(rows, r)), i % 2 ? [1, 1] : [1, -1]);
  });

  // 顾客：按黄金角在网格上铺开，保证东西两片都有
  const custCells = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const u = (i * 0.618033988749895) % 1;
    const c = Math.round(u * cols);
    const r = Math.round(((i * 7) % (rows + 1)) * 1);
    custCells.push([c, r]);
  }
  CUSTOMERS.forEach((cu, i) => {
    let [c, r] = custCells[i];
    let n = null;
    for (let t = 0; t < 24 && !n; t++) {
      const cc = Math.min(cols, Math.max(0, c + (t % 5) - 2));
      const rr = Math.min(rows, Math.max(0, r + Math.floor(t / 5) - 2));
      if (!slots.includes(id(cc, rr)) && g.nodes.has(id(cc, rr))) n = place(cu.id, cc, rr, i % 2 ? [1, 1] : [-1, 1]);
    }
    if (!n) place(cu.id, Math.min(cols, c), Math.min(rows, r), [1, 1]);
  });

  // 兜底：仍未落点的地点，挨个补到尚未占用的路口上
  const freeNodes = [...g.nodes.keys()].filter((n) => !slots.includes(n));
  [...SHOPS, ...CUSTOMERS].forEach((p) => {
    if (bound[p.id]) return;
    const n = freeNodes.shift();
    if (n) {
      slots.push(n);
      bound[p.id] = { node: n, pos: null, off: [1, 1], offScale: 9 };
    }
  });

  bindAnchors(bound);

  // 纸箱点：四个象限各一处，远离地点
  const avoid = Object.values(bound)
    .map((b) => g.pos(b.node))
    .filter(Boolean);
  g.markBoxes(avoid);

  g.coveredCount = [...g.edges.values()].filter((e) => e.covered).length;
  return g;
}
