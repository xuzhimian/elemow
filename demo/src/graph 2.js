// 灰盒街区路网（备用 / 离线模式）：一条河 + 两座桥形成路线瓶颈
// 真实地图模式见 src/tmap/roadGraph.js，两者共用 RoadGraph 接口
import { mulberry32 } from './util.js';
import { RoadGraph } from './roadgraph.js';
import { bindAnchors } from './places.js';

const WEST_X = [-80, -61, -43, -25, -9];
const EAST_X = [9, 26, 43, 61, 80];
const WEST_Z = [-52, -30, -11, 9, 30, 50];
const EAST_Z = [-52, -30, -8, 12, 30, 50];
const BRIDGE_ROWS = [1, 4];

const REMOVED = new Set(['w0_1|w0_2', 'w3_4|w3_5', 'e3_0|e4_0', 'e4_2|e4_3', 'w1_0|w2_0', 'e0_4|e0_5']);
const DIAGONALS = [
  ['e1_2', 'e2_3'],
  ['e2_3', 'e3_4'],
  ['w1_1', 'w2_2'],
];
const COVERED = new Set(['w1_2|w2_2', 'w2_2|w3_2', 'w3_2|w4_2', 'e1_2|e1_3', 'e1_3|e1_4']);

export const PARK_CELLS = [
  { side: 'w', c: 1, r: 3, name: '樱川公园' },
  { side: 'e', c: 3, r: 1, name: '东丘公园' },
];
export const PLAZA_CELLS = [
  { side: 'e', c: 1, r: 2 },
  { side: 'e', c: 2, r: 3 },
  { side: 'w', c: 1, r: 1 },
];
const BOX_NODES = ['w3_4', 'e2_1', 'e3_3', 'w0_3'];

// 灰盒街区的地点锚点（名称在 places.js 中统一定义）
const ANCHORS = {
  station: { node: 'w3_3', off: [-1, 1], offScale: 4.2 },
  bakery: { node: 'w3_2', off: [1, -1] },
  grocery: { node: 'w4_1', off: [-1, -1] },
  fishsoup: { node: 'e2_2', off: [1, -1] },
  morning: { node: 'e2_4', off: [1, 1] },
  sakura: { node: 'w0_1', off: [1, 1] },
  school: { node: 'w1_0', off: [1, -1] },
  office: { node: 'w0_4', off: [1, 1] },
  books: { node: 'w1_5', off: [1, 1] },
  pine: { node: 'w2_5', off: [1, 1] },
  green: { node: 'w4_5', off: [-1, 1] },
  riverside: { node: 'e0_3', off: [1, 1] },
  parkeast: { node: 'e4_1', off: [1, 1] },
  harbor: { node: 'e4_5', off: [-1, 1] },
  florist: { node: 'e1_4', off: [-1, 1] },
  slope: { node: 'e3_0', off: [1, -1] },
  tower: { node: 'e1_0', off: [-1, -1] },
  alley: { node: 'e4_3', off: [1, 1] },
};

export class GreyboxGraph extends RoadGraph {
  constructor() {
    super({ unitM: 10, sideNames: { w: '西町', e: '东町' }, complexDegree: 5 });
    this.mode = 'greybox';
    this.realMap = false;
    this.mapNote = '地图为灰盒示意街区（非真实地图数据）';
    this.bottleneckNote = '樱川与两座桥形成瓶颈';
    this.attribution = '灰盒示意街区 · 非真实地图数据 · 时间为游戏模拟时间';
    this.shelterNote = '商店街与拱廊有遮蔽，不受影响。';
    this.shelterRouteNote = '优先经过商店街与拱廊 · 可能绕行';
    this.build();
    bindAnchors(ANCHORS);
  }

  build() {
    const rng = mulberry32(20261017);
    const addSide = (side, XS, ZS) => {
      XS.forEach((x0, c) => {
        ZS.forEach((z0, r) => {
          const riverside = (side === 'w' && c === XS.length - 1) || (side === 'e' && c === 0);
          const fixedZ = riverside && BRIDGE_ROWS.includes(r);
          const jx = riverside ? 0 : (rng() - 0.5) * 3.2;
          const jz = fixedZ ? 0 : (rng() - 0.5) * 3.2;
          this.addNode(`${side}${c}_${r}`, x0 + jx, z0 + jz, { side, c, r });
        });
      });
      XS.forEach((_, c) => {
        ZS.forEach((_, r) => {
          if (c < XS.length - 1) this.link(`${side}${c}_${r}`, `${side}${c + 1}_${r}`);
          if (r < ZS.length - 1) this.link(`${side}${c}_${r}`, `${side}${c}_${r + 1}`);
        });
      });
    };
    addSide('w', WEST_X, WEST_Z);
    addSide('e', EAST_X, EAST_Z);
    DIAGONALS.forEach(([a, b]) => this.link(a, b));
    BRIDGE_ROWS.forEach((r) => this.link(`w4_${r}`, `e0_${r}`, { bridge: true, noPenalty: true }));
    this.cols = { w: WEST_X.length, e: EAST_X.length };
    this.rows = { w: WEST_Z.length, e: EAST_Z.length };

    BOX_NODES.forEach((id) => this.boxNodes.add(id));
    PARK_CELLS.forEach(({ side, c, r }) => {
      [[c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1]].forEach(([cc, rr]) => this.birdNodes.add(`${side}${cc}_${rr}`));
    });
  }

  link(a, b, extra = {}) {
    const k = RoadGraph.key(a, b);
    if (REMOVED.has(k)) return;
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) return;
    this.addEdge(a, b, {
      covered: COVERED.has(k),
      diagonal: na.c !== nb.c && na.r !== nb.r && na.side === nb.side,
      ...extra,
    });
  }
}

export { GreyboxGraph as Graph };
