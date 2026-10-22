// 腾讯地图渲染层：矢量底图 + GLCustomLayer(three.js) 猫咪 + MultiPolyline 路线 + DOM 标注
//
// 对外接口与 src/world.js（灰盒）保持一致，便于 main.js / ui.js 共用一套调度逻辑。

import * as THREE from 'three';
import { AREA, frame } from '../geo.js';
import { STATION, SHOPS, CUSTOMERS } from '../places.js';
import { ICONS } from '../icons.js';
import { createCatModel } from '../catModel.js';

const CAT_SCALE = 3; // 猫咪模型放大倍数（真实地图下 1 场景单位 = 1 米，需要夸张才看得清）
const LAYER_LEVEL = 9; // 自定义图层层级：必须高于底图，否则会被底图覆盖
const EARTH_PX = 156543.03392;

function hexToRgba(color, alpha = 1) {
  if (/^rgba?\(/i.test(color)) return color;
  const h = color.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export class TmapWorld {
  constructor(container, graph, TMap) {
    this.container = container;
    this.graph = graph;
    this.TMap = TMap;
    this.raining = false;
    this.catObjs = new Map();
    this.catMarkers = new Map();
    this.placeLabels = new Map();
    this.placeAnchors = new Map();
    this.routeGeos = new Map();
    this.styles = {};
    this.routesDirty = false;
    this.ready = false;

    const bounds = new TMap.LatLngBounds(new TMap.LatLng(AREA.sw.lat, AREA.sw.lng), new TMap.LatLng(AREA.ne.lat, AREA.ne.lng));
    this.map = new TMap.Map(container, {
      center: new TMap.LatLng(AREA.center.lat, AREA.center.lng),
      zoom: 16,
      pitch: 0,
      rotation: 0,
      viewMode: '3D',
      showControl: false,
      boundary: bounds,
      mapStyleId: 'style1',
      baseMap: { type: 'vector', features: ['base', 'building2d', 'building3d', 'point', 'label'] },
    });
    this.map.fitBounds(bounds, { padding: 24 });
    this.bounds = bounds;

    this.polyLayer = new TMap.MultiPolyline({ id: 'meow-routes', map: this.map, zIndex: 20, styles: {}, geometries: [] });

    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'label-layer';
    Object.assign(this.labelRoot.style, { width: '100%', height: '100%', pointerEvents: 'none', inset: '0' });
    container.appendChild(this.labelRoot);

    this.rainEl = document.createElement('div');
    this.rainEl.className = 'tmap-rain';
    this.rainEl.hidden = true;
    container.appendChild(this.rainEl);

    this.buildPlaceLabels();
    this.buildDecor();
    this.initGLLayer();
  }

  // 玩法可视化：纸箱点、复杂路口、遮蔽路段
  buildDecor() {
    const TMap = this.TMap;
    const g = this.graph;
    this.decor = [];
    const dot = (node, cls, title) => {
      const el = document.createElement('div');
      el.className = `map-dot ${cls}`;
      el.title = title;
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
      this.labelRoot.appendChild(el);
      this.decor.push({ el, pos: { x: node.x, z: node.z } });
    };
    [...g.boxNodes].forEach((id) => {
      const n = g.pos(id);
      if (n) dot(n, 'box', '纸箱点：可能触发停留事件');
    });
    g.complexNodes
      .map((id) => g.pos(id))
      .filter(Boolean)
      .sort((a, b) => g.degree(b.id) - g.degree(a.id))
      .slice(0, 12)
      .forEach((n) => dot(n, 'cross', '复杂路口：闪电可能跑过头'));

    // 示意路网模式：把游戏实际使用的街网淡淡画出来，避免看起来像在楼里穿行
    if (g.source === 'grid') {
      this.netLayer = new TMap.MultiPolyline({
        id: 'meow-net',
        map: this.map,
        zIndex: 8,
        styles: {
          // 注意（实测）：腾讯 PolylineStyle 在 borderWidth 为 0、或线宽 ≤4 且加 dashArray / 半透明时不绘制，这里用宽 5 的浅色实线
          net: new TMap.PolylineStyle({ color: '#CFC6BA', width: 5, borderWidth: 1, borderColor: '#FFFDF9', lineCap: 'round' }),
          trunk: new TMap.PolylineStyle({ color: '#A89C8E', width: 7, borderWidth: 1, borderColor: '#FFFDF9', lineCap: 'round' }),
        },
        geometries: [...g.edges.values()].map((e, i) => ({
          id: `nt${i}`,
          styleId: e.trunk ? 'trunk' : 'net',
          paths: [this.toLatLng(g.pos(e.a)), this.toLatLng(g.pos(e.b))],
        })),
      });
    }

    const covered = [...g.edges.values()].filter((e) => e.covered);
    if (covered.length) {
      this.coverLayer = new TMap.MultiPolyline({
        id: 'meow-cover',
        map: this.map,
        zIndex: 10,
        styles: {
          // 与图例「有遮蔽」一致：棕色条纹，和金色配送路线明显区分
          cover: new TMap.PolylineStyle({ color: 'rgba(139, 111, 85, 0.78)', width: 7, borderWidth: 1, borderColor: 'rgba(255, 253, 249, 0.7)', lineCap: 'butt', dashArray: [4, 3] }),
        },
        geometries: covered.map((e, i) => ({
          id: `cv${i}`,
          styleId: 'cover',
          paths: [this.toLatLng(g.pos(e.a)), this.toLatLng(g.pos(e.b))],
        })),
      });
    }
  }

  // ---------------- three.js 自定义图层 ----------------
  initGLLayer() {
    const self = this;
    this.glGroup = new THREE.Group();
    this.storyGroup = new THREE.Group();
    this.glGroup.add(this.storyGroup);

    this.layer = new this.TMap.GLCustomLayer({
      id: 'meow-cats',
      map: this.map,
      keepFps: true,
      level: LAYER_LEVEL,
      init(gl) {
        self.camera = new THREE.PerspectiveCamera();
        self.scene = new THREE.Scene();
        self.scene.add(self.glGroup);
        self.scene.add(new THREE.AmbientLight(0xffffff, 1.8));
        const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
        sun.position.set(-60, -50, 140); // 图层坐标系 Z 轴向上
        self.scene.add(sun);
        // 必须把地图自己的 canvas 传给 three，否则 three 会按默认 300×150 设置视口
        self.gl = gl;
        self.renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl, antialias: true, alpha: true });
        self.renderer.autoClear = false;
        if ('outputColorSpace' in self.renderer) self.renderer.outputColorSpace = THREE.SRGBColorSpace;
        self.ready = true;
        return { renderer: self.renderer, camera: self.camera, scene: self.scene, group: self.glGroup };
      },
      render() {
        if (!self.renderer) return;
        const c = self.map.getCamera();
        const cam = self.camera;
        cam.fov = c.fovy;
        cam.aspect = (c.view.right - c.view.left) / (c.view.top - c.view.bottom);
        cam.near = c.near;
        cam.far = c.far;
        cam.position.z = c.distance;
        cam.updateProjectionMatrix();
        self.renderer.resetState();
        const gl = self.gl;
        self.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        self.renderer.clearDepth(); // 底图已写入深度缓冲，先清掉再画贴地的猫咪
        self.renderer.render(self.scene, cam);
      },
    });
    this.layer.setLevel?.(LAYER_LEVEL);
  }

  toLatLng(p) {
    const ll = frame.toLngLat(p);
    return new this.TMap.LatLng(ll.lat, ll.lng);
  }

  glPos(p) {
    return this.map.glLatLngToPosition(this.toLatLng(p));
  }

  // 自定义图层的世界坐标单位不是米，这里实测标定「1 米 = 多少图层单位」
  get unitsPerMeter() {
    if (!this._upm) {
      try {
        const a = this.glPos({ x: 0, z: 0 });
        const b = this.glPos({ x: 100, z: 0 });
        const d = Math.hypot(b.x - a.x, b.y - a.y) / 100;
        if (Number.isFinite(d) && d > 0) this._upm = d;
      } catch {
        /* 图层尚未就绪 */
      }
    }
    return this._upm || 0;
  }

  applyScale(pivot, scale = CAT_SCALE) {
    const upm = this.unitsPerMeter;
    if (!upm) return false;
    pivot.scale.setScalar(scale * upm);
    return true;
  }

  // ---------------- 地点标注 ----------------
  buildPlaceLabels() {
    const all = [STATION, ...SHOPS, ...CUSTOMERS];
    all.forEach((p) => {
      const el = document.createElement('div');
      el.className = `place-label kind-${p.kind}`;
      const icon = p.kind === 'station' ? ICONS.home : p.kind === 'shop' ? ICONS[p.goods] : p.kind === 'story' ? ICONS.paw : ICONS.door;
      el.innerHTML = `<span class="pl-icon">${icon}</span><span class="pl-name"></span>`;
      el.querySelector('.pl-name').textContent = p.name;
      el.dataset.place = p.id;
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'auto', willChange: 'transform' });
      this.labelRoot.appendChild(el);
      this.placeLabels.set(p.id, el);
      this.placeAnchors.set(p.id, p);
    });
  }

  highlightPlaces(ids = []) {
    const set = new Set(ids);
    for (const [id, el] of this.placeLabels) el.classList.toggle('hl', set.has(id));
  }

  // ---------------- 猫咪 ----------------
  addCat(def, onClick) {
    const model = createCatModel(def);
    const pivot = new THREE.Group();
    pivot.rotation.x = Math.PI / 2; // Y-up 模型 → 图层的 Z-up 坐标系
    this.applyScale(pivot);
    pivot.add(model.root);
    pivot.visible = false;
    this.glGroup.add(pivot);

    const el = document.createElement('div');
    el.className = 'cat-marker';
    el.style.setProperty('--cat', def.route);
    el.innerHTML = `<div class="cm-bubble"></div><div class="cm-avatar"><img alt=""></div><div class="cm-name"></div>`;
    el.querySelector('.cm-name').textContent = def.name;
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'auto', willChange: 'transform' });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick(def.id);
    });
    this.labelRoot.appendChild(el);

    this.catObjs.set(def.id, { model, pivot, el });
    this.catMarkers.set(def.id, { el, pos: { x: 0, z: 0 }, visible: false });
    return { model, el };
  }

  placeCat(id, pos, yaw, visible = true) {
    const o = this.catObjs.get(id);
    if (!o) return;
    o.pivot.visible = visible;
    o.model.root.rotation.y = yaw;
    const m = this.catMarkers.get(id);
    m.pos.x = pos.x;
    m.pos.z = pos.z;
    m.visible = visible;
    if (visible && this.ready) {
      if (!o.scaled) o.scaled = this.applyScale(o.pivot);
      const v = this.glPos(pos);
      o.pivot.position.set(v.x, v.y, v.z || 0);
    }
  }

  groundY() {
    return 0;
  }

  // ---------------- 路线 ----------------
  ensureStyle({ color = '#D99A63', width = 1.1, opacity = 0.9, dashed = false }) {
    const key = `s_${color}_${width}_${opacity}_${dashed ? 1 : 0}`.replace(/[^a-z0-9_]/gi, '');
    if (!this.styles[key]) {
      const opt = {
        color: hexToRgba(color, opacity),
        width: width >= 1.3 ? 8 : width >= 0.95 ? 6 : 5, // 宽度 ≤4 的虚线不会绘制
        borderWidth: 1,
        borderColor: 'rgba(255, 253, 249, 0.75)',
        lineCap: 'round',
      };
      if (dashed) opt.dashArray = [4, 4];
      this.styles[key] = new this.TMap.PolylineStyle(opt);
      this.polyLayer.setStyles(this.styles);
    }
    return key;
  }

  setRoute(key, pts, opts = {}) {
    if (!pts || pts.length < 2) return this.clearRoute(key);
    const styleId = this.ensureStyle(opts);
    this.routeGeos.set(key, { id: key, styleId, paths: pts.map((p) => this.toLatLng(p)) });
    this.routesDirty = true;
  }

  clearRoute(key) {
    if (this.routeGeos.delete(key)) this.routesDirty = true;
  }

  flushRoutes() {
    if (!this.routesDirty) return;
    this.routesDirty = false;
    this.polyLayer.setGeometries([...this.routeGeos.values()]);
  }

  // ---------------- 雨 ----------------
  setRain(on) {
    this.raining = on;
    this.rainEl.hidden = !on;
  }

  // ---------------- 故事装饰 ----------------
  setStoryDecor(stage) {
    this.storyGroup.clear();
    const alley = CUSTOMERS.find((c) => c.story);
    if (!alley || !alley.node) return;
    const p = this.graph.placePos(alley);
    const mk = (obj, dx, dz, scale = CAT_SCALE) => {
      const pivot = new THREE.Group();
      pivot.rotation.x = Math.PI / 2;
      pivot.userData.scale = scale;
      this.applyScale(pivot, scale);
      pivot.add(obj);
      pivot.userData.offset = { x: p.x + dx, z: p.z + dz };
      this.storyGroup.add(pivot);
      return pivot;
    };
    this.storyModels = [];
    if (stage >= 1) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 0.3, 12), new THREE.MeshLambertMaterial({ color: '#F1ECE3' }));
      bowl.position.y = 0.15;
      mk(bowl, -3, 1);
    }
    if (stage >= 3) {
      const momDef = {
        id: 'mom',
        colors: { body: '#E8E1D6', belly: '#FAF6EF', patch: '#7E7A75', ear: '#7E7A75', inner: '#E2B0A0', eye: '#C9A33A', bag: null, scarf: null },
        scale: 0.9,
      };
      const mom = createCatModel(momDef);
      mom.root.rotation.y = Math.PI * 0.8;
      mk(mom.root, -3, 5);
      this.storyModels.push(mom);
      [0, 1].forEach((i) => {
        const k = createCatModel({ ...momDef, colors: { ...momDef.colors, body: i ? '#E39A52' : '#9A9086' } }, { kitten: true });
        k.root.rotation.y = Math.PI * (0.6 + i * 0.4);
        mk(k.root, -6 - i * 3, 6 + i * 2);
        this.storyModels.push(k);
      });
    }
  }

  // ---------------- 相机与比例尺 ----------------
  focus(x, z) {
    this.map.panTo(this.toLatLng({ x, z }), { duration: 450 });
  }

  metersPerPixel() {
    const zoom = this.map.getZoom();
    const lat = this.map.getCenter().lat;
    return (EARTH_PX * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
  }

  scaleBar() {
    const pxPerM = 1 / this.metersPerPixel();
    const nice = [25, 50, 100, 200, 250, 500, 1000, 2000];
    const m = nice.find((n) => n * pxPerM >= 70) || 2000;
    return { px: m * pxPerM, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
  }

  resize() {
    this.map.resize?.();
  }

  // ---------------- 每帧 ----------------
  render(dt) {
    this.flushRoutes();
    if (this.storyModels) this.storyModels.forEach((m) => m.update(dt, 'idle'));

    // 故事装饰定位
    if (this.ready && this.storyGroup.children.length) {
      for (const pivot of this.storyGroup.children) {
        const off = pivot.userData.offset;
        if (!off) continue;
        if (!pivot.userData.scaled) pivot.userData.scaled = this.applyScale(pivot, pivot.userData.scale || CAT_SCALE);
        const v = this.glPos(off);
        pivot.position.set(v.x, v.y, v.z || 0);
      }
    }

    // 静态标注只在视野变化时重新投影
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const c = this.map.getCenter();
    const vk = `${c.lat.toFixed(6)},${c.lng.toFixed(6)},${this.map.getZoom().toFixed(3)},${this.map.getRotation()},${this.map.getPitch()},${w}x${h}`;
    if (vk !== this.viewKey) {
      this.viewKey = vk;
      const project = (pos, el, anchor) => {
        const pt = this.map.projectToContainer(this.toLatLng(pos));
        const vis = pt.x >= -80 && pt.x <= w + 80 && pt.y >= -60 && pt.y <= h + 60;
        el.style.display = vis ? '' : 'none';
        if (vis) el.style.transform = `translate(-50%, ${anchor}) translate(${Math.round(pt.x)}px, ${Math.round(pt.y)}px)`;
      };
      for (const [id, el] of this.placeLabels) {
        const p = this.placeAnchors.get(id);
        if (!p.node) {
          el.style.display = 'none';
          continue;
        }
        project(this.graph.placePos(p), el, '-140%');
      }
      for (const d of this.decor) project(d.pos, d.el, '-50%');
    }
    for (const [, m] of this.catMarkers) {
      if (!m.visible) {
        m.el.style.display = 'none';
        continue;
      }
      const pt = this.map.projectToContainer(this.toLatLng(m.pos));
      m.el.style.display = '';
      m.el.style.transform = `translate(-50%, -100%) translate(${Math.round(pt.x)}px, ${Math.round(pt.y)}px)`;
    }
  }

  destroy() {
    this.layer?.destroy?.();
    this.polyLayer?.setMap?.(null);
    this.map?.destroy?.();
    this.labelRoot.remove();
    this.rainEl.remove();
  }
}
