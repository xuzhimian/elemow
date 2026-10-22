// Three.js 街区地图：导航风格底图 + 游戏设施层 + 调度信息层
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARK_CELLS, PLAZA_CELLS } from './graph.js';
import { STATION, SHOPS, CUSTOMERS } from './places.js';
import { mulberry32 } from './util.js';
import { ICONS } from './icons.js';
import { createCatModel } from './catModel.js';
import { createPoiLabel, setPoiScale, POI_ART } from './poiArt.js';

const ROAD_W = 2.6;
const CASING_W = 3.4;
const RIVER_HALF = 5.6;

const C = {
  ground: '#ECE5D8',
  lot: '#E3DDD1',
  road: '#FCFAF5',
  casing: '#D3C9B9',
  water: '#A9C2C6',
  waterDeep: '#9DB8BD',
  park: '#C4CFAF',
  parkEdge: '#AFBE98',
  bank: '#CBD4BA',
  plaza: '#EBE2D2',
  building: '#D9D8D1',
};

function basic(color, extra = {}) {
  return new THREE.MeshBasicMaterial({ color, ...extra });
}

function flatQuad(ax, az, bx, bz, w, y) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const g = new THREE.PlaneGeometry(len, w);
  g.rotateX(-Math.PI / 2);
  g.rotateY(-Math.atan2(dz, dx));
  g.translate((ax + bx) / 2, y, (az + bz) / 2);
  return g;
}

function disc(x, z, r, y, seg = 16) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function shapeGeo(points, y) {
  const s = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function insetQuad(pts, d) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return pts.map((p) => {
    const vx = cx - p.x;
    const vz = cz - p.z;
    const l = Math.hypot(vx, vz);
    return { x: p.x + (vx / l) * d * 1.41, z: p.z + (vz / l) * d * 1.41 };
  });
}

function bilinear(q, u, v) {
  // q: [A(0,0), B(1,0), Cc(1,1), D(0,1)]
  const [A, B, Cc, D] = q;
  const x = A.x * (1 - u) * (1 - v) + B.x * u * (1 - v) + Cc.x * u * v + D.x * (1 - u) * v;
  const z = A.z * (1 - u) * (1 - v) + B.z * u * (1 - v) + Cc.z * u * v + D.z * (1 - u) * v;
  return { x, z };
}

export function groundY(x) {
  return Math.abs(x) < 7.8 ? 0.62 : 0;
}

export class World {
  constructor(container, graph) {
    this.container = container;
    this.graph = graph;
    this.routes = new Map();
    this.placeLabels = new Map();
    this.catObjs = new Map();
    this.raining = false;
    this.rainMix = 0;

    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);
    this.labelRoot = this.labelRenderer.domElement;

    // 纸纹与晕影（不加 cozy-tmap：灰盒本身就是暖米色示意图，再染色会过）
    const wrap = container.closest('#map-wrap');
    if (wrap) wrap.classList.add('cozy');

    this.scene = new THREE.Scene();
    this.bg = new THREE.Color(C.ground);
    this.scene.background = this.bg;
    this.scene.fog = new THREE.Fog(C.ground, 260, 480);

    this.camera = new THREE.PerspectiveCamera(36, w / h, 1, 1200);
    this.camera.position.set(0, 175, 120);
    this.controls = new MapControls(this.camera, this.labelRenderer.domElement);
    this.controls.enableRotate = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 300;
    this.controls.target.set(0, 0, 0);
    this.controls.zoomToCursor = true;
    this.controls.update();
    this.focusTarget = null;

    this.hemi = new THREE.HemisphereLight('#FFF8EC', '#CFC4B2', 2.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#FFE7C8', 1.9);
    this.sun.position.set(-70, 130, 50);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -120;
    sc.right = 120;
    sc.top = 100;
    sc.bottom = -100;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);

    this.buildMap();
    this.buildPlaces();
    this.fitPoiView();
    this.buildRain();

    this.storyGroup = new THREE.Group();
    this.scene.add(this.storyGroup);

    window.addEventListener('resize', () => this.resize());
  }

  fitPoiView() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    let distance = this.camera.position.distanceTo(this.controls.target);
    const all = [STATION, ...SHOPS, ...CUSTOMERS];
    for (let attempt = 0; attempt < 20; attempt++) {
      this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
      this.camera.lookAt(this.controls.target);
      this.camera.updateMatrixWorld();
      const scale = Math.max(0.68, Math.min(1.28, Math.pow(210 / distance, 0.4)));
      const fits = all.every((place) => {
        const pos = this.graph.placePos(place);
        const point = new THREE.Vector3(pos.x, 0.16, pos.z).project(this.camera);
        const x = (point.x + 1) * width / 2;
        const y = (1 - point.y) * height / 2;
        const imageWidth = (POI_ART[place.id]?.width || 31.8) * scale;
        const markerHeight = imageWidth * 0.91 + 24;
        return x - imageWidth / 2 >= 14 && x + imageWidth / 2 <= width - 14 && y - markerHeight * 0.92 >= 14 && y + markerHeight * 0.08 <= height - 14;
      });
      if (fits || distance >= 450) break;
      distance = Math.min(450, distance * 1.06);
    }
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance);
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  // ---------------- 底图 ----------------
  buildMap() {
    const g = this.graph;
    const rng = mulberry32(7);
    const scene = this.scene;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 600), basic(C.ground));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // 河流
    const riverPts = [];
    const riverPts2 = [];
    for (let z = -200; z <= 200; z += 8) {
      const wob = Math.sin(z * 0.045) * 0.5;
      riverPts.push({ x: -RIVER_HALF + wob, z });
      riverPts2.unshift({ x: RIVER_HALF + wob, z });
    }
    scene.add(new THREE.Mesh(shapeGeo([...riverPts, ...riverPts2], 0.01), basic(C.water)));
    const mid = [];
    const mid2 = [];
    for (let z = -200; z <= 200; z += 8) {
      const wob = Math.sin(z * 0.045) * 0.5;
      mid.push({ x: -2 + wob, z });
      mid2.unshift({ x: 2 + wob, z });
    }
    scene.add(new THREE.Mesh(shapeGeo([...mid, ...mid2], 0.015), basic(C.waterDeep)));
    // 河岸绿带
    [-1, 1].forEach((s) => {
      const a = [];
      const b = [];
      for (let z = -200; z <= 200; z += 8) {
        const wob = Math.sin(z * 0.045) * 0.5;
        a.push({ x: s * (RIVER_HALF - 0.1) + wob, z });
        b.unshift({ x: s * 7.6, z });
      }
      scene.add(new THREE.Mesh(shapeGeo([...a, ...b], 0.012), basic(C.bank)));
    });

    // 街区：地块、建筑、公园、广场
    const isCell = (list, side, c, r) => list.some((p) => p.side === side && p.c === c && p.r === r);
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    buildingGeo.translate(0, 0.5, 0);
    const bData = [];
    const trees = [];
    const lotGeos = [];
    const parkGeos = [];
    const parkEdgeGeos = [];
    const plazaGeos = [];

    const st = g.placePos(STATION);
    const keepOut = [{ x: st.x - 1.4, z: st.z + 2.1, r: 6 }, ...[...SHOPS, ...CUSTOMERS].map((p) => ({ ...g.placePos(p), r: 2.2 }))];
    const blocked = (x, z, half) => keepOut.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + half);
    ['w', 'e'].forEach((side) => {
      for (let c = 0; c < g.cols[side] - 1; c++) {
        for (let r = 0; r < g.rows[side] - 1; r++) {
          const q = [
            g.pos(`${side}${c}_${r}`),
            g.pos(`${side}${c + 1}_${r}`),
            g.pos(`${side}${c + 1}_${r + 1}`),
            g.pos(`${side}${c}_${r + 1}`),
          ].map((p) => ({ x: p.x, z: p.z }));
          const inner = insetQuad(q, 2.3);
          if (isCell(PARK_CELLS, side, c, r)) {
            parkEdgeGeos.push(shapeGeo(insetQuad(q, 1.9), 0.02));
            parkGeos.push(shapeGeo(insetQuad(q, 2.5), 0.025));
            const inn = insetQuad(q, 3.5);
            for (let i = 0; i < 26; i++) {
              const p = bilinear(inn, rng(), rng());
              trees.push({ ...p, s: 0.8 + rng() * 0.7 });
            }
            const cen = bilinear(inn, 0.5, 0.55);
            const pond = disc(cen.x, cen.z, 3.2, 0.03, 18);
            pond.scale(1, 1, 1);
            scene.add(new THREE.Mesh(pond, basic(C.water)));
            continue;
          }
          if (isCell(PLAZA_CELLS, side, c, r)) {
            plazaGeos.push(shapeGeo(inner, 0.02));
            const inn = insetQuad(q, 3.2);
            [[0.15, 0.85], [0.85, 0.15], [0.2, 0.2], [0.8, 0.8]].forEach(([u, v]) => {
              const p = bilinear(inn, u, v);
              trees.push({ ...p, s: 0.8 });
            });
            continue;
          }
          lotGeos.push(shapeGeo(inner, 0.02));
          const wd = Math.hypot(inner[1].x - inner[0].x, inner[1].z - inner[0].z);
          const dp = Math.hypot(inner[3].x - inner[0].x, inner[3].z - inner[0].z);
          const nx = Math.max(1, Math.round(wd / 8));
          const nz = Math.max(1, Math.round(dp / 8));
          const ang = -Math.atan2(inner[1].z - inner[0].z, inner[1].x - inner[0].x);
          const east = side === 'e';
          for (let i = 0; i < nx; i++) {
            for (let j = 0; j < nz; j++) {
              if (rng() < 0.12) continue;
              const p = bilinear(inner, (i + 0.5) / nx, (j + 0.5) / nz);
              const bw = (wd / nx) * (0.62 + rng() * 0.25);
              const bd = (dp / nz) * (0.62 + rng() * 0.25);
              const bh = (east ? 2.5 : 1.6) + rng() * (east ? 7 : 4.5);
              if (blocked(p.x, p.z, Math.min(bw, bd) * 0.45)) continue;
              bData.push({ x: p.x, z: p.z, w: bw, d: bd, h: bh, a: ang + (rng() - 0.5) * 0.06 });
            }
          }
        }
      }
    });

    if (lotGeos.length) scene.add(new THREE.Mesh(mergeGeometries(lotGeos), basic(C.lot)));
    if (parkEdgeGeos.length) scene.add(new THREE.Mesh(mergeGeometries(parkEdgeGeos), basic(C.parkEdge)));
    if (parkGeos.length) scene.add(new THREE.Mesh(mergeGeometries(parkGeos), basic(C.park)));
    if (plazaGeos.length) scene.add(new THREE.Mesh(mergeGeometries(plazaGeos), basic(C.plaza)));

    const bMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const inst = new THREE.InstancedMesh(buildingGeo, bMat, bData.length);
    const m4 = new THREE.Matrix4();
    const q4 = new THREE.Quaternion();
    const col = new THREE.Color();
    const tones = ['#DCDAD3', '#D6D4CC', '#DDD6CA', '#D2D3CE', '#E0DBD0'];
    bData.forEach((b, i) => {
      q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.a);
      m4.compose(new THREE.Vector3(b.x, 0, b.z), q4, new THREE.Vector3(b.w, b.h, b.d));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.set(tones[i % tones.length]));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);

    // 树
    const crownGeo = new THREE.IcosahedronGeometry(1.25, 0);
    crownGeo.translate(0, 2.2, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.4, 5);
    trunkGeo.translate(0, 0.7, 0);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#8B6F55' }), trees.length);
    const greens = ['#93A57F', '#87977A', '#9DAE86', '#A3B08C'];
    trees.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, 0, t.z), q4.identity(), new THREE.Vector3(t.s, t.s, t.s));
      crowns.setMatrixAt(i, m4);
      trunks.setMatrixAt(i, m4);
      crowns.setColorAt(i, col.set(greens[i % greens.length]));
    });
    crowns.castShadow = true;
    trunks.castShadow = true;
    scene.add(crowns, trunks);

    // 道路（外描边 + 路面）
    const casing = [];
    const surface = [];
    const bridgeDecks = [];
    for (const e of g.edges.values()) {
      const a = g.pos(e.a);
      const b = g.pos(e.b);
      if (e.bridge) {
        bridgeDecks.push(e);
        continue;
      }
      casing.push(flatQuad(a.x, a.z, b.x, b.z, CASING_W, 0.03));
      surface.push(flatQuad(a.x, a.z, b.x, b.z, ROAD_W, 0.05));
    }
    for (const n of g.nodes.values()) {
      casing.push(disc(n.x, n.z, CASING_W / 2, 0.03));
      surface.push(disc(n.x, n.z, ROAD_W / 2, 0.05));
    }
    // 河岸路延伸出地图
    [-9, 9].forEach((x) => {
      casing.push(flatQuad(x, -52, x, -150, CASING_W, 0.03));
      surface.push(flatQuad(x, -52, x, -150, ROAD_W, 0.05));
      casing.push(flatQuad(x, 50, x, 150, CASING_W, 0.03));
      surface.push(flatQuad(x, 50, x, 150, ROAD_W, 0.05));
    });
    scene.add(new THREE.Mesh(mergeGeometries(casing), basic(C.casing)));
    scene.add(new THREE.Mesh(mergeGeometries(surface), basic(C.road)));

    // 遮蔽路段（商店街雨棚）
    const awnA = [];
    const awnB = [];
    for (const e of g.edges.values()) {
      if (!e.covered) continue;
      const a = g.pos(e.a);
      const b = g.pos(e.b);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      const n = Math.floor(len / 2.2);
      for (let i = 1; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 0.8) / n;
        [-1, 1].forEach((s) => {
          const gq = flatQuad(a.x + dx * t0 + nx * s * 2.2, a.z + dz * t0 + nz * s * 2.2, a.x + dx * Math.min(t1, 1) + nx * s * 2.2, a.z + dz * Math.min(t1, 1) + nz * s * 2.2, 1.3, 1.5);
          (i % 2 ? awnA : awnB).push(gq);
        });
      }
    }
    const awnMatA = new THREE.MeshLambertMaterial({ color: '#C77E5F', side: THREE.DoubleSide });
    const awnMatB = new THREE.MeshLambertMaterial({ color: '#F1E4D0', side: THREE.DoubleSide });
    const ma = new THREE.Mesh(mergeGeometries(awnA), awnMatA);
    const mb = new THREE.Mesh(mergeGeometries(awnB), awnMatB);
    ma.castShadow = mb.castShadow = true;
    scene.add(ma, mb);

    // 桥
    bridgeDecks.forEach((e) => {
      const a = g.pos(e.a);
      const b = g.pos(e.b);
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 2;
      const grp = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 3.6), new THREE.MeshLambertMaterial({ color: '#E3DACB' }));
      deck.position.y = 0.3;
      deck.castShadow = true;
      deck.receiveShadow = true;
      grp.add(deck);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_W), basic(C.road));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.61;
      grp.add(top);
      [-1, 1].forEach((s) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.45, 0.16), new THREE.MeshLambertMaterial({ color: '#A79478' }));
        rail.position.set(0, 0.85, s * 1.75);
        rail.castShadow = true;
        grp.add(rail);
      });
      [-1, 1].forEach((s) => {
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.2, 8), new THREE.MeshLambertMaterial({ color: '#BDB2A0' }));
        pier.position.set(s * 2.5, -0.2, 0);
        grp.add(pier);
      });
      grp.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      grp.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      scene.add(grp);
    });

    // 复杂路口提示环
    const ringMat = basic('#D99A63', { transparent: true, opacity: 0.55, depthWrite: false });
    g.complexNodes.forEach((id) => {
      const n = g.pos(id);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.55, 28), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(n.x, 0.07, n.z);
      scene.add(ring);
    });

    // 纸箱标记（事件预兆）
    [...g.boxNodes].forEach((id, i) => {
      const n = g.pos(id);
      const grp = new THREE.Group();
      const bx = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 1.05), new THREE.MeshLambertMaterial({ color: '#C9A67C' }));
      bx.position.y = 0.48;
      bx.castShadow = true;
      grp.add(bx);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.05, 0.25), new THREE.MeshLambertMaterial({ color: '#E8D6B6' }));
      tape.position.y = 0.96;
      grp.add(tape);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 1.05), new THREE.MeshLambertMaterial({ color: '#B8946A' }));
      flap.position.set(-0.75, 1.1, 0);
      flap.rotation.z = 0.9;
      grp.add(flap);
      grp.position.set(n.x + 2.3, 0, n.z - 2.3);
      grp.rotation.y = i * 0.7;
      scene.add(grp);
    });

    // 阴影接收层
    const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.ShadowMaterial({ opacity: 0.13 }));
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.08;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    // 地名标注
    const addText = (text, x, z, cls = 'map-text', y = 0.5) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      const o = new CSS2DObject(el);
      o.position.set(x, y, z);
      scene.add(o);
      return o;
    };
    addText('樱 川', 0, -2, 'map-text river');
    addText('樱 川', 0, 70, 'map-text river');
    addText('北桥', 0, -33.5, 'map-text bridge');
    addText('南桥', 0, 26.5, 'map-text bridge');
    const sp = g.pos('w2_2');
    addText('樱川商店街 · 有遮蔽', sp.x + 2, sp.z - 3.2, 'map-text street');
    const ap = g.pos('e1_3');
    addText('东町拱廊 · 有遮蔽', ap.x - 3, ap.z, 'map-text street vertical');
    PARK_CELLS.forEach(({ side, c, r, name }) => {
      const a = g.pos(`${side}${c}_${r}`);
      const b = g.pos(`${side}${c + 1}_${r + 1}`);
      addText(name, (a.x + b.x) / 2, (a.z + b.z) / 2 - 4, 'map-text park');
    });
    addText(g.sideName('w'), -60, -62, 'map-text district');
    addText(g.sideName('e'), 52, -62, 'map-text district');
  }

  // 猫咪/道具贴地高度（桥面抬高）
  groundY(x) {
    return groundY(x);
  }

  // ---------------- 地点标记 ----------------
  buildPlaces() {
    const g = this.graph;
    const all = [STATION, ...SHOPS, ...CUSTOMERS];
    all.forEach((p) => {
      const pos = g.placePos(p);
      // The illustration replaces the old spheres/stems and station mesh.
      const el = createPoiLabel(p);
      const marker = new CSS2DObject(el);
      marker.center.set(0.5, 0.92);
      marker.position.set(pos.x, 0.16, pos.z);
      this.scene.add(marker);
      this.placeLabels.set(p.id, el);
    });
  }

  highlightPlaces(ids = []) {
    const set = new Set(ids);
    for (const [id, el] of this.placeLabels) el.classList.toggle('hl', set.has(id));
  }

  // ---------------- 猫咪 ----------------
  addCat(def, onClick) {
    const model = createCatModel(def);
    this.scene.add(model.root);
    const el = document.createElement('div');
    el.className = 'cat-marker';
    el.style.setProperty('--cat', def.route);
    el.innerHTML = `<div class="cm-bubble"></div><div class="cm-avatar"><img alt=""></div><div class="cm-name"></div>`;
    el.querySelector('.cm-name').textContent = def.name;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick(def.id);
    });
    const label = new CSS2DObject(el);
    label.position.set(0, 5.2, 0);
    model.root.add(label);
    this.catObjs.set(def.id, { model, el, label });
    return { model, el };
  }

  placeCat(id, pos, yaw, visible = true) {
    const o = this.catObjs.get(id);
    if (!o) return;
    o.model.root.visible = visible;
    if (!visible) return;
    o.model.root.position.set(pos.x, groundY(pos.x), pos.z);
    o.model.root.rotation.y = yaw;
  }

  // ---------------- 路线 ----------------
  setRoute(key, pts, { color = '#D99A63', width = 1.1, opacity = 0.9, dashed = false, y = 0.18 } = {}) {
    this.clearRoute(key);
    if (!pts || pts.length < 2) return;
    const geos = [];
    const yAt = (x) => y + groundY(x);
    const pushSeg = (a, b) => {
      const g = flatQuad(a.x, a.z, b.x, b.z, width, 0);
      const yy = Math.max(yAt(a.x), yAt(b.x));
      g.translate(0, yy, 0);
      geos.push(g);
    };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      if (dashed) {
        const dash = 1.6;
        const gap = 1.1;
        for (let s = 0; s < len; s += dash + gap) {
          const e = Math.min(len, s + dash);
          pushSeg({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len }, { x: a.x + ((b.x - a.x) * e) / len, z: a.z + ((b.z - a.z) * e) / len });
        }
      } else {
        pushSeg(a, b);
        geos.push(disc(b.x, b.z, width / 2, yAt(b.x), 10));
      }
    }
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), basic(color, { transparent: true, opacity, depthWrite: false }));
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.routes.set(key, mesh);
  }

  clearRoute(key) {
    const m = this.routes.get(key);
    if (m) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      this.routes.delete(key);
    }
  }

  // ---------------- 雨 ----------------
  buildRain() {
    const N = 1600;
    const pos = new Float32Array(N * 6);
    this.rainSeeds = [];
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 220;
      const y = Math.random() * 70;
      const z = (Math.random() - 0.5) * 170;
      this.rainSeeds.push({ x, y, z, v: 55 + Math.random() * 25 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#7F97A3', transparent: true, opacity: 0.4 }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  setRain(on) {
    this.raining = on;
  }

  updateRain(dt) {
    this.rainMix += ((this.raining ? 1 : 0) - this.rainMix) * Math.min(1, dt * 1.5);
    const k = this.rainMix;
    this.hemi.intensity = 2.1 - k * 0.6;
    this.sun.intensity = 1.9 - k * 1.2;
    this.bg.set(C.ground).lerp(new THREE.Color('#DCDDD8'), k * 0.8);
    this.scene.fog.color.copy(this.bg);
    this.rain.visible = k > 0.05;
    if (!this.rain.visible) return;
    this.rain.material.opacity = 0.42 * k;
    const arr = this.rain.geometry.attributes.position.array;
    const t = this.controls.target;
    this.rainSeeds.forEach((d, i) => {
      d.y -= d.v * dt;
      if (d.y < 0) d.y += 70;
      const x = t.x + d.x;
      const z = t.z + d.z;
      arr.set([x, d.y, z, x + 0.25, d.y + 1.8, z - 0.15], i * 6);
    });
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------- 故事装饰 ----------------
  setStoryDecor(stage) {
    this.storyGroup.clear();
    const alley = CUSTOMERS.find((c) => c.story);
    const p = this.graph.placePos(alley);
    if (stage >= 1) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 0.3, 12), new THREE.MeshLambertMaterial({ color: '#F1ECE3' }));
      bowl.position.set(p.x - 1.4, 0.15, p.z + 0.4);
      this.storyGroup.add(bowl);
    }
    if (stage >= 2) {
      const pawMat = basic('#8C7462', { transparent: true, opacity: 0.75 });
      for (let i = 0; i < 6; i++) {
        const pw = new THREE.Mesh(new THREE.CircleGeometry(0.22, 8), pawMat);
        pw.rotation.x = -Math.PI / 2;
        pw.position.set(p.x - 2.6 - i * 0.7, 0.1, p.z + 1 + (i % 2 ? 0.35 : -0.35));
        this.storyGroup.add(pw);
      }
    }
    if (stage >= 3) {
      const momDef = {
        id: 'mom',
        colors: { body: '#E8E1D6', belly: '#FAF6EF', patch: '#7E7A75', ear: '#7E7A75', inner: '#E2B0A0', eye: '#C9A33A', bag: null, scarf: null },
        scale: 0.9,
      };
      const mom = createCatModel(momDef);
      mom.root.position.set(p.x - 1.2, 0, p.z + 2.2);
      mom.root.rotation.y = Math.PI * 0.8;
      this.storyGroup.add(mom.root);
      this.storyModels = [mom];
      [0, 1].forEach((i) => {
        const k = createCatModel({ ...momDef, artId: i ? 'kitten-orange' : 'kitten-gray', colors: { ...momDef.colors, body: i ? '#E39A52' : '#9A9086' } }, { kitten: true });
        k.root.position.set(p.x - 3 - i * 1.3, 0, p.z + 2.6 + i * 0.6);
        k.root.rotation.y = Math.PI * (0.6 + i * 0.4);
        this.storyGroup.add(k.root);
        this.storyModels.push(k);
      });
    }
  }

  // ---------------- 相机 ----------------
  focus(x, z) {
    this.focusTarget = new THREE.Vector3(x, 0, z);
  }

  scaleBar() {
    const t = this.controls.target;
    const a = t.clone().project(this.camera);
    const b = t.clone().add(new THREE.Vector3(10, 0, 0)).project(this.camera);
    const w = this.container.clientWidth;
    const pxPer10u = Math.abs(b.x - a.x) * 0.5 * w;
    const pxPerM = pxPer10u / (10 * this.graph.unitM);
    const nice = [25, 50, 100, 200, 250, 500, 1000];
    let m = nice.find((n) => n * pxPerM >= 70) || 1000;
    return { px: m * pxPerM, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
  }

  render(dt) {
    if (this.focusTarget) {
      const t = this.controls.target;
      const d = this.focusTarget.clone().sub(t);
      if (d.length() < 0.3) this.focusTarget = null;
      else {
        const step = d.multiplyScalar(Math.min(1, dt * 5));
        t.add(step);
        this.camera.position.add(step);
      }
    }
    this.controls.update();
    const distance = this.camera.position.distanceTo(this.controls.target);
    setPoiScale(this.labelRoot, Math.pow(210 / Math.max(1, distance), 0.4));
    this.updateRain(dt);
    if (this.storyModels) this.storyModels.forEach((m) => m.update(dt, 'idle'));
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
