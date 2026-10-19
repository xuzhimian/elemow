// 经纬度 <-> 本地平面米坐标
//
// 本地坐标系与 three.js 场景一致：x 向东，z 向南（屏幕向下），1 单位 = 1 米。
// 营业区域由环境变量提供，便于更换街区而不改代码。

export function parseLngLat(text, fallback) {
  if (typeof text === 'string') {
    const m = text.split(',').map((s) => Number(s.trim()));
    if (m.length === 2 && m.every((n) => Number.isFinite(n))) {
      const [lng, lat] = m;
      if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) return { lng, lat };
    }
  }
  return fallback;
}

const SW = parseLngLat(import.meta.env?.VITE_AREA_SW, { lng: 116.386907, lat: 40.001739 });
const NE = parseLngLat(import.meta.env?.VITE_AREA_NE, { lng: 116.407946, lat: 40.009472 });

export const AREA = {
  sw: { lng: Math.min(SW.lng, NE.lng), lat: Math.min(SW.lat, NE.lat) },
  ne: { lng: Math.max(SW.lng, NE.lng), lat: Math.max(SW.lat, NE.lat) },
  get center() {
    return { lng: (this.sw.lng + this.ne.lng) / 2, lat: (this.sw.lat + this.ne.lat) / 2 };
  },
};

const M_PER_LAT = 111320;

export class LocalFrame {
  constructor(center) {
    this.lng0 = center.lng;
    this.lat0 = center.lat;
    this.mPerLng = M_PER_LAT * Math.cos((center.lat * Math.PI) / 180);
    this.mPerLat = M_PER_LAT;
  }

  toLocal(ll) {
    return { x: (ll.lng - this.lng0) * this.mPerLng, z: -(ll.lat - this.lat0) * this.mPerLat };
  }

  toLngLat(p) {
    return { lng: this.lng0 + p.x / this.mPerLng, lat: this.lat0 - p.z / this.mPerLat };
  }
}

export const frame = new LocalFrame(AREA.center);

export const AREA_LOCAL = (() => {
  const a = frame.toLocal(AREA.sw);
  const b = frame.toLocal(AREA.ne);
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
    get width() {
      return this.maxX - this.minX;
    },
    get height() {
      return this.maxZ - this.minZ;
    },
  };
})();

export function insideArea(ll, pad = 0) {
  return ll.lng >= AREA.sw.lng - pad && ll.lng <= AREA.ne.lng + pad && ll.lat >= AREA.sw.lat - pad && ll.lat <= AREA.ne.lat + pad;
}

export function distM(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// 道格拉斯-普克之外的简单等距抽稀：保证相邻点间距不小于 minStep 米
export function thin(points, minStep) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distM(out[out.length - 1], points[i]) >= minStep) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function areaSummary() {
  const w = AREA_LOCAL.width;
  const h = AREA_LOCAL.height;
  return `${(w / 1000).toFixed(2)} km × ${(h / 1000).toFixed(2)} km（约 ${((w * h) / 1e6).toFixed(2)} km²）`;
}
