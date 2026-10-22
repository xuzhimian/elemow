// 入口：选择地图模式（腾讯地图真实街区 / 灰盒备用），组装模拟与界面，驱动主循环
import './style.css';
import { Graph } from './graph.js';
import { World } from './world.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Sfx } from './audio.js';
import { CATS } from './data.js';
import { catAvatar } from './catModel.js';
import { anchorsReady } from './places.js';
import { areaSummary } from './geo.js';
import { hasKey, keyHint, loadTMap, cacheClear } from './tmap/sdk.js';

const mapEl = document.getElementById('map');
const attrEl = document.getElementById('attribution');

// ---------------- 加载 / 失败重试遮罩 ----------------
const boot = document.createElement('div');
boot.id = 'boot';
boot.innerHTML = `
  <div class="boot-card">
    <div class="boot-spin"></div>
    <h3 class="boot-title">正在连接腾讯地图…</h3>
    <p class="boot-msg"></p>
    <div class="boot-actions" hidden>
      <button class="btn primary" data-retry>重试</button>
      <button class="btn" data-grid>腾讯底图 + 示意路网</button>
      <button class="btn ghost" data-greybox>灰盒街区</button>
    </div>
    <p class="boot-tip"></p>
  </div>`;
document.getElementById('map-wrap').appendChild(boot);
const bootTitle = boot.querySelector('.boot-title');
const bootMsg = boot.querySelector('.boot-msg');
const bootTip = boot.querySelector('.boot-tip');
const bootActions = boot.querySelector('.boot-actions');
const bootSpin = boot.querySelector('.boot-spin');

function progress(text) {
  bootMsg.textContent = text;
}

function fail(err, tip) {
  bootSpin.hidden = true;
  boot.classList.add('error');
  bootTitle.textContent = '真实路网暂不可用';
  bootMsg.textContent = err && err.message ? err.message : String(err);
  bootTip.textContent = tip || '「腾讯底图 + 示意路网」仍使用真实腾讯底图与真实米制距离，只是街网为示意结构；配额恢复后点「重试」即可换成真实步行路网（之后会本地固化，不再消耗配额）。';
  bootActions.hidden = false;
}

function hideBoot() {
  boot.remove();
}

// ---------------- 引导 ----------------
let started = false;
let fallbackNote = '';

function beginLoading(title) {
  bootSpin.hidden = false;
  boot.classList.remove('error');
  bootActions.hidden = true;
  bootTitle.textContent = title;
  bootTip.textContent = `营业区域 ${areaSummary()}`;
}

async function tmapModules() {
  const [discover, road, tworld, grid, osm] = await Promise.all([
    import('./tmap/discover.js'),
    import('./tmap/roadGraph.js'),
    import('./tmap/tworld.js'),
    import('./tmap/gridGraph.js'),
    import('./tmap/osmRoads.js'),
  ]);
  return { ...discover, ...road, ...tworld, ...grid, ...osm };
}

function mountTmap(TMap, graph, M, note) {
  if (!anchorsReady()) throw new Error('部分地点未能锚定到路网：请重试或更换营业区域。');
  progress('正在绘制地图…');
  mapEl.innerHTML = '';
  const world = new M.TmapWorld(mapEl, graph, TMap);
  run(graph, world);
  console.info(`[饿了喵] ${note}：路网 ${graph.nodes.size} 节点 / ${graph.edges.size} 边，遮蔽路段 ${graph.coveredCount}，观鸟点 ${graph.birdNodes.size}`);
}

// 真实路网：POI 检索 + 步行路线规划（消耗 WebServiceAPI 配额，成功后本地固化）
async function startTencent({ useBaked = true } = {}) {
  beginLoading('正在连接腾讯地图…');
  progress('加载地图脚本…');
  const TMap = await loadTMap();
  const M = await tmapModules();

  if (useBaked) {
    const baked = M.loadBakedGraph();
    if (baked && baked.source === 'tencent') {
      mountTmap(TMap, baked, M, '腾讯真实路网（本地已固化，未消耗配额）');
      return;
    }
  }

  progress('正在识别街区地点…');
  const found = await M.discoverPlaces(TMap, { onProgress: progress });
  progress('正在构建步行路网…');
  const graph = await M.buildRoadGraph(TMap, { ...found, onProgress: progress });
  M.bakeGraph(graph);
  mountTmap(TMap, graph, M, `腾讯真实路网（POI ${found.poolSize} 个，路线请求 ${graph.stats.routes}，缓存 ${graph.stats.cached}，失败 ${graph.stats.failed}）`);
}

// 真实路网：优先用随项目发布的预烘焙数据，其次在线抓取。与腾讯底图对齐，不消耗 WebServiceAPI 配额。
async function startOsm({ useBaked = true } = {}) {
  beginLoading('正在加载腾讯底图…');
  progress('加载地图脚本…');
  const TMap = await loadTMap();
  const M = await tmapModules();

  if (useBaked) {
    const baked = M.loadBakedGraph();
    if (baked && baked.source === 'osm') {
      mountTmap(TMap, baked, M, '真实路网（本地已固化）');
      return;
    }
  }

  progress('正在载入真实路网…');
  const local = await M.loadLocalGraph();
  if (local) {
    mountTmap(TMap, local, M, '真实路网（随项目发布的预烘焙数据）');
    return;
  }

  const graph = await M.buildOsmRoadGraph({ onProgress: progress });
  M.bakeGraph(graph);
  mountTmap(TMap, graph, M, `真实路网（道路 ${graph.stats.ways} 段，绿地 ${graph.stats.parks}，商业体 ${graph.stats.malls}）`);
}

// 腾讯真实底图 + 示意路网：不消耗 WebServiceAPI 配额
async function startGrid() {
  beginLoading('正在加载腾讯底图…');
  progress('加载地图脚本…');
  const TMap = await loadTMap();
  const M = await tmapModules();
  progress('正在生成示意街网…');
  const graph = M.buildGridGraph();
  mountTmap(TMap, graph, M, '腾讯底图 + 示意路网');
}

function startGreybox() {
  const graph = new Graph();
  if (!graph.isConnected()) console.warn('[饿了喵] 路网存在不连通节点');
  mapEl.innerHTML = '';
  const world = new World(mapEl, graph);
  run(graph, world);
}

const guard = (fn) => () => {
  if (started) return;
  Promise.resolve()
    .then(fn)
    .catch((err) => fail(err));
};

boot.querySelector('[data-retry]').addEventListener('click',
  guard(async () => {
    cacheClear();
    try {
      await startTencent({ useBaked: false });
    } catch (err) {
      console.warn('[饿了喵] 腾讯步行路线不可用，改用 OpenStreetMap 真实路网：', (err && err.message) || err);
      await startOsm({ useBaked: false });
    }
  }),
);
boot.querySelector('[data-grid]').addEventListener('click', guard(startGrid));
boot.querySelector('[data-greybox]').addEventListener('click', guard(startGreybox));

if (hasKey()) {
  // 路网优先级：腾讯步行路线规划 → OpenStreetMap 真实道路 → 示意网格。底图始终是腾讯地图。
  startTencent()
    .catch(async (err) => {
      const msg = (err && err.message) || String(err);
      console.warn('[饿了喵] 腾讯步行路线不可用，改用 OpenStreetMap 真实路网：', msg);
      progress('腾讯步行路线不可用，正在改用真实道路数据…');
      await startOsm();
    })
    .catch((err2) => {
      const msg2 = (err2 && err2.message) || String(err2);
      console.warn('[饿了喵] 真实路网不可用，改用腾讯底图 + 示意路网：', msg2);
      fallbackNote = `当前为「腾讯底图 + 示意路网」，路线与真实道路不完全重合：${msg2}`;
      startGrid().catch((e3) => {
        fallbackNote = '';
        fail(err2, `示意路网也未能启动：${(e3 && e3.message) || e3}`);
      });
    });
} else {
  console.info(`[饿了喵] ${keyHint()} 使用灰盒街区模式。`);
  try {
    startGreybox();
  } catch (err) {
    fail(err);
  }
}

// ---------------- 主循环 ----------------
function run(graph, world) {
  if (started) return;
  started = true;
  hideBoot();
  attrEl.textContent = graph.attribution;

  const game = new Game(graph);
  const sfx = new Sfx();
  const ui = new UI(game, world, sfx);
  world.setStoryDecor(game.meta.story.stage);

  const views = {};
  CATS.forEach((def) => {
    const v = world.addCat(def, (id) => ui.selectCat(id, false));
    views[def.id] = { ...v, ver: -1, rt: 0, yaw: -Math.PI / 2, sel: null };
    v.el.querySelector('img').src = catAvatar(def);
  });

  const routePoints = (cat) => {
    const pts = [{ x: cat.pos.x, z: cat.pos.z }];
    cat.queue.forEach((p) => pts.push({ x: p.x, z: p.z }));
    let cur = cat.node;
    for (let i = cat.queue.length - 1; i >= 0; i--) {
      if (cat.queue[i].node) {
        cur = cat.queue[i].node;
        break;
      }
    }
    const rest = cat.state === 'moving' ? cat.stops.slice(1) : cat.stops;
    const shelter = game.weather.raining && game.weather.shelter;
    rest.forEach((s) => {
      const path = graph.path(cur, s.node, { shelter }) || graph.path(cur, s.node);
      if (path) path.slice(1).forEach((id) => pts.push(graph.pos(id)));
      cur = s.node;
    });
    return pts;
  };

  let hlKey = '';
  function syncCats(dt) {
    const running = game.running;
    const simDt = running ? dt * game.speed : 0;
    const sel = ui.selectedCat;
    for (const def of CATS) {
      const cat = game.cats[def.id];
      const v = views[def.id];
      const unlocked = game.meta.cats[def.id].unlocked;
      if (!unlocked) {
        world.placeCat(def.id, cat.pos, v.yaw, false);
        world.clearRoute(`cat-${def.id}`);
        continue;
      }
      const targetYaw = cat.state === 'idle' && !cat.queue.length ? -Math.PI / 2 : -cat.heading;
      let d = targetYaw - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 10);
      world.placeCat(def.id, cat.pos, v.yaw, true);

      let mode = 'idle';
      if (cat.state === 'idle') mode = cat.energy < 90 ? 'sleep' : 'idle';
      else if (cat.state === 'moving' && cat.wait <= 0 && !cat.eventPending) mode = 'walk';
      else mode = 'wait';
      v.model.update(simDt, mode, def.speed);
      const eq = game.meta.cats[def.id].equip;
      v.model.setGear({ raincoat: eq === 'raincoat' && game.weather.raining, jar: eq === 'jar' });

      const elx = v.el;
      elx.classList.toggle('idle', cat.state === 'idle');
      elx.classList.toggle('selected', sel === def.id);
      elx.classList.toggle('dim', !!sel && sel !== def.id);
      elx.classList.toggle('event', cat.eventPending);
      let bubble = '';
      if (cat.eventPending) bubble = '！等待确认';
      else if (cat.bubbleT > 0) bubble = cat.bubble;
      else if (cat.wait > 0.5 && cat.waitLabel) bubble = `${cat.waitLabel} ${Math.ceil(cat.wait)}s`;
      const b = elx.querySelector('.cm-bubble');
      if (b.textContent !== bubble) b.textContent = bubble;
      b.style.display = bubble ? '' : 'none';

      // 路线：选中加粗，其余弱化
      v.rt -= dt;
      const selChanged = v.sel !== sel;
      if (cat.state === 'idle') {
        if (v.ver !== -2) world.clearRoute(`cat-${def.id}`);
        v.ver = -2;
      } else if (cat.routeVer !== v.ver || v.rt <= 0 || selChanged) {
        v.ver = cat.routeVer;
        v.rt = 0.25;
        const returnOnly = cat.stops.every((s) => s.kind === 'return');
        const isSel = sel === def.id;
        world.setRoute(`cat-${def.id}`, routePoints(cat), {
          color: def.route,
          width: isSel ? 1.6 : 1.0,
          opacity: returnOnly ? 0.45 : sel && !isSel ? 0.4 : 0.9,
          dashed: returnOnly,
          y: isSel ? 0.22 : 0.18,
        });
      }
      v.sel = sel;
    }

    if (!ui.dp && !ui.hoverOrder) {
      const cat = sel ? game.cats[sel] : null;
      const ids = [];
      if (cat) {
        if (cat.current) {
          const o = game.order(cat.current.orderId);
          if (o) ids.push(cat.current.kind === 'pickup' ? o.shop : o.cust);
        }
        cat.stops.forEach((s) => {
          const o = game.order(s.orderId);
          if (o) ids.push(s.kind === 'pickup' ? o.shop : o.cust);
        });
      }
      const k = ids.join(',');
      if (k !== hlKey) {
        hlKey = k;
        world.highlightPlaces(ids);
      }
    } else hlKey = '#';
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.update(dt);
    syncCats(dt);
    ui.tick(dt);
    world.render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  ui.showTitle();
  if (fallbackNote) ui.hint(fallbackNote);

  if (import.meta.env.DEV) window.__meow = { game, world, ui, graph };
}
