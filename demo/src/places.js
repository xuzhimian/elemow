// 地点注册表（灰盒街区与腾讯地图真实街区共用）
//
// 设计约定（PRD v0.3）：
// - 店名、顾客名、配送站名全部虚构，真实地图只提供「位置锚点」；
// - 本模块导出的对象标识（引用）在运行期保持不变，锚点通过 bindAnchors() 就地写入，
//   因此 game / ui / world 可以安全地长期持有这些引用。
//
// 锚点字段：
//   node     所在路网节点 id（必填）
//   pos      { x, z } 场景坐标；给定时直接使用（真实地图模式）
//   off      [sx, sz] 相对节点的偏移方向（灰盒模式）
//   offScale 偏移距离（场景单位）
//   realName 真实 POI 名称，仅用于调试与数据来源说明，不展示为店名

export const STATION = {
  id: 'station',
  name: '喵喵配送站',
  kind: 'station',
  off: [-1, 1],
  offScale: 4.2,
};

export const SHOPS = [
  { id: 'bakery', name: '麦香面包坊', kind: 'shop', goods: 'bread', off: [1, -1] },
  { id: 'grocery', name: '桥边杂货', kind: 'shop', goods: 'grocery', off: [-1, -1] },
  { id: 'fishsoup', name: '胡须鱼汤', kind: 'shop', goods: 'soup', off: [1, -1] },
  { id: 'morning', name: '晨光面包', kind: 'shop', goods: 'bread', off: [1, 1] },
];

export const CUSTOMERS = [
  { id: 'sakura', name: '樱花公寓', kind: 'customer', off: [1, 1], patience: true, patienceNote: '怕生，希望慢慢确认' },
  { id: 'school', name: '银杏小学', kind: 'customer', off: [1, -1] },
  { id: 'office', name: '西町写字楼', kind: 'customer', off: [1, 1] },
  { id: 'books', name: '钟楼书店', kind: 'customer', off: [1, 1] },
  { id: 'pine', name: '松风公寓', kind: 'customer', off: [1, 1] },
  { id: 'green', name: '绿荫小区', kind: 'customer', off: [-1, 1] },
  { id: 'riverside', name: '河畔写字楼', kind: 'customer', off: [1, 1] },
  { id: 'parkeast', name: '东丘公园东门', kind: 'customer', off: [1, 1] },
  { id: 'harbor', name: '港湾小区', kind: 'customer', off: [-1, 1], patience: true, patienceNote: '希望安静交接' },
  { id: 'florist', name: '云雀花店', kind: 'customer', off: [-1, 1] },
  { id: 'slope', name: '坂道二丁目', kind: 'customer', off: [1, -1], patience: true, patienceNote: '独居的老奶奶，需要缓慢确认' },
  { id: 'tower', name: '钟塔公寓', kind: 'customer', off: [-1, -1] },
  { id: 'alley', name: '巷尾小屋', kind: 'story', off: [1, 1], story: true },
];

export const PLACES = [STATION, ...SHOPS, ...CUSTOMERS];
export const PLACE_BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));

export const SHOP_IDS = SHOPS.map((s) => s.id);
export const CUSTOMER_IDS = CUSTOMERS.map((c) => c.id);

// 上面写死的名字是「默认名」：灰盒与示意路网模式用它，真实地图模式会按功能属性覆盖。
// 单独存一份，保证 bindAnchors 可以重复调用而不残留上一个模式的命名。
const DEFAULT_NAMES = Object.fromEntries(PLACES.map((p) => [p.id, p.name]));

// 真实地图模式下可以按片区重命名（保持虚构），例如把「西町写字楼」换成同风格的名字
export function bindAnchors(anchors) {
  for (const [id, a] of Object.entries(anchors || {})) {
    const p = PLACE_BY_ID[id];
    if (!p || !a) continue;
    p.node = a.node;
    p.pos = a.pos || null;
    if (a.off) p.off = a.off;
    if (a.offScale != null) p.offScale = a.offScale;
    p.realName = a.realName || null;
    // 没给 name 的模式（灰盒 / 示意路网）必须回到默认名，否则会沿用上一次的属性化命名
    p.name = a.name || DEFAULT_NAMES[id];
  }
}

export function anchorsReady() {
  return PLACES.every((p) => !!p.node);
}
