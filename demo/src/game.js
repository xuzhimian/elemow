// 玩法模拟：统一模拟时钟，暂停时订单、事件、精力计时全部停止
import { STATION, SHOPS, CUSTOMERS, PLACE_BY_ID } from './places.js';
import * as D from './data.js';
import { rand, randInt, pick } from './util.js';

const SAVE_KEY = 'hungry-meow-demo-v1';
const ACTIVE = new Set(['assigned', 'delivering']);

function defaultMeta() {
  const cats = {};
  D.CATS.forEach((c) => {
    cats[c.id] = { unlocked: c.id === 'dundun', trust: 0, fam: { w: 0, e: 0 }, equip: null, delivered: 0 };
  });
  return {
    v: 1,
    shift: 1,
    coins: 60,
    snacks: 3,
    items: { jar: 0, raincoat: 0 },
    upgrades: { bed: false, desk: false },
    furniture: { box: false, postcard: false },
    cats,
    story: { stage: 0, introDone: false },
    tutorial: { delivered: 0, skip: false, soupShown: false, boxShown: false },
    combine: false,
    customers: {},
    records: [],
    boxSeen: false,
    totalDelivered: 0,
    started: false,
  };
}

// 安全读档：仅接受 JSON，并按默认结构逐项合并
function mergeInto(base, src) {
  if (!src || typeof src !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in src)) continue;
    const bv = base[k];
    const sv = src[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) base[k] = mergeInto(bv, sv);
    else if (Array.isArray(bv)) base[k] = Array.isArray(sv) ? sv.slice(0, 200) : bv;
    else if (typeof sv === typeof bv || bv === null) base[k] = sv;
  }
  if (src.customers && typeof src.customers === 'object') {
    for (const [id, v] of Object.entries(src.customers)) {
      if (PLACE_BY_ID[id] && v && typeof v === 'object') base.customers[id] = { rel: Number(v.rel) || 0, msgs: Array.isArray(v.msgs) ? v.msgs.slice(0, 20).map(String) : [] };
    }
  }
  return base;
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultMeta();
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return defaultMeta();
    return mergeInto(defaultMeta(), data);
  } catch {
    return defaultMeta();
  }
}

export function famLevel(n) {
  return n >= 15 ? 3 : n >= 5 ? 2 : 1;
}
export const FAM_NAMES = ['', '初来乍到', '认得这条街', '街坊熟客'];

const NOTES = ['', '', '请按门铃两次。', '放在门口地垫上就好。', '到了打个招呼～', '电梯在左手边。'];
const THANKS = ['「好软！谢谢你～」', '「下次还想见到你。」', '「今天的心情变好了。」', '「辛苦啦，小配送员。」'];

export class Game {
  constructor(graph) {
    this.g = graph;
    this.meta = loadMeta();
    this.time = 0;
    this.speed = 1;
    this.userPaused = false;
    this.blockers = new Set();
    this.phase = 'title';
    this.phaseT = 0;
    this.shiftT = 0;
    this.orders = [];
    this.eventQueue = [];
    this.listeners = {};
    this.nextOrderId = 1001;
    this.nextOrderAt = 0;
    this.storyReadyAt = 0;
    this.stats = null;
    this.weather = { rainAt: Infinity, rainDur: 60, raining: false, shelter: false, rained: false };
    this.cats = {};
    D.CATS.forEach((def, i) => (this.cats[def.id] = this.makeCat(def, i)));
  }

  // ---------- 事件总线 ----------
  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type, payload) {
    (this.listeners[type] || []).forEach((fn) => fn(payload));
  }
  toast(text, kind = 'info') {
    this.emit('toast', { text, kind });
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.meta));
    } catch {
      /* 存储不可用时忽略 */
    }
  }

  resetSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    location.reload();
  }

  get running() {
    return !this.userPaused && this.blockers.size === 0 && this.eventQueue.length === 0 && (this.phase === 'open' || this.phase === 'wrap');
  }

  block(reason, on) {
    if (on) this.blockers.add(reason);
    else this.blockers.delete(reason);
    this.emit('pause');
  }

  // ---------- 猫咪 ----------
  homeSlot(i) {
    return this.g.homeSlot(STATION, i, D.CATS.length);
  }

  makeCat(def, i) {
    const slot = this.homeSlot(i);
    return {
      id: def.id,
      def,
      slotIdx: i,
      pos: { ...slot },
      heading: Math.PI / 2,
      node: STATION.node,
      queue: [],
      stops: [],
      current: null,
      orders: [],
      energy: 100,
      state: 'idle',
      wait: 0,
      waitLabel: '',
      waitDone: null,
      lastEventAt: -999,
      eventPending: false,
      turnReminder: false,
      bubble: '',
      bubbleT: 0,
      routeVer: 0,
      skipTurnAt: null,
    };
  }

  catMeta(id) {
    return this.meta.cats[id];
  }

  unlockedCats() {
    return D.CATS.filter((c) => this.meta.cats[c.id].unlocked).map((c) => this.cats[c.id]);
  }

  catStatus(cat) {
    if (cat.eventPending) return '等待站长确认';
    if (cat.state === 'idle') return cat.energy < 100 ? '站内休息' : '站内待命';
    if (cat.wait > 0 && cat.waitLabel) return cat.waitLabel;
    if (cat.state === 'waiting') return cat.waitLabel || '处理中';
    const s = cat.stops[0];
    if (!s) return '移动中';
    if (s.kind === 'return') return '返站中';
    const o = this.order(s.orderId);
    const place = s.kind === 'pickup' ? PLACE_BY_ID[o.shop] : PLACE_BY_ID[o.cust];
    return s.kind === 'pickup' ? `前往取货 · ${place.name}` : `配送中 · ${place.name}`;
  }

  bubble(cat, text, t = 3.5) {
    cat.bubble = text;
    cat.bubbleT = t;
  }

  catLoad(cat) {
    let load = 0;
    cat.orders.forEach((id) => {
      const o = this.order(id);
      if (o.status === 'delivering') load += o.weight;
    });
    if (cat.current?.kind === 'pickup') load += this.order(cat.current.orderId).weight;
    return load;
  }

  catHasLate(cat) {
    return cat.orders.some((id) => {
      const o = this.order(id);
      return o && ACTIVE.has(o.status) && this.time > o.dueAt;
    });
  }

  equipOf(id) {
    return this.meta.cats[id].equip;
  }

  equipAvailable(itemId, catId) {
    if (!itemId) return true;
    const used = D.CATS.filter((c) => c.id !== catId && this.meta.cats[c.id].equip === itemId).length;
    return used < this.meta.items[itemId];
  }

  handoffTime(cat, order) {
    let base = cat.id === 'laoban' ? D.HANDOFF_LAOBAN : D.HANDOFF_BASE;
    let extra = order.tags.includes('need_patience') && cat.id !== 'mianmian' ? D.HANDOFF_PATIENCE_EXTRA : 0;
    const side = this.g.sideOf(PLACE_BY_ID[order.cust].node);
    if (famLevel(this.meta.cats[cat.id].fam[side]) >= 3) base = Math.max(5, base - 2);
    return base + extra;
  }

  speedFactor(cat, edge, equip = this.equipOf(cat.id), side = null) {
    let f = 1;
    if (this.weather.raining && !(edge && edge.covered)) f *= equip === 'raincoat' ? 0.95 : 0.8;
    if (side && famLevel(this.meta.cats[cat.id].fam[side]) >= 3) f *= 1.05;
    return f;
  }

  // ---------- 订单 ----------
  order(id) {
    return this.orders.find((o) => o.id === id);
  }

  pendingOrders() {
    return this.orders.filter((o) => o.status === 'pending');
  }

  activeOrders() {
    return this.orders.filter((o) => ACTIVE.has(o.status));
  }

  createOrder({ type, shop, cust, story = null, intro = false, tags = [], deadline = null, note = null, keep = false }) {
    const T = D.ORDER_TYPES[type];
    const sp = PLACE_BY_ID[shop];
    const cp = PLACE_BY_ID[cust];
    const dShop = this.g.distanceM(STATION.node, sp.node);
    const dDel = this.g.distanceM(sp.node, cp.node);
    const prep = type === 'bread' ? randInt(2, 6) : type === 'soup' ? randInt(4, 9) : randInt(0, 4);
    const patience = tags.includes('need_patience');
    const est = (dShop + dDel) / D.BASE_SPEED_MPS + prep * 0.5 + D.HANDOFF_BASE + (patience ? D.HANDOFF_PATIENCE_EXTRA : 0) + 2;
    const dl = deadline ?? Math.max(T.deadline, Math.ceil((est * 1.2 + 10) / 5) * 5);
    const o = {
      id: this.nextOrderId++,
      type,
      shop,
      cust,
      weight: T.weight,
      tags,
      story,
      intro,
      prep,
      deadline: dl,
      reward: T.reward + Math.round(dDel / 250) + (story != null ? 6 : 0),
      status: 'pending',
      createdAt: this.time,
      acceptBy: story != null || intro || keep ? Infinity : this.time + D.ACCEPT_WINDOW,
      dist: dDel,
      note: note ?? (patience ? `顾客备注：${cp.patienceNote}。` : pick(NOTES)),
      catId: null,
      readyAt: 0,
      dueAt: Infinity,
      fishDone: false,
    };
    this.orders.push(o);
    this.emit('orders');
    return o;
  }

  spawnRegular() {
    const pending = this.pendingOrders();
    if (pending.length >= D.MAX_PENDING) return;
    const tut = this.meta.tutorial;
    let type;
    if (!tut.skip && tut.delivered === 0) {
      if (this.orders.some((o) => o.status !== 'expired')) return;
      const shop = 'bakery';
      const cust = this.nearestCustomer(PLACE_BY_ID[shop].node, ['w']);
      this.createOrder({ type: 'bread', shop, cust: cust.id, keep: true, note: '新手单：低风险面包，顺路且时限充足。' });
      return;
    }
    if (this.meta.cats.shandian.unlocked && !tut.soupShown && !tut.skip) {
      type = 'soup';
      tut.soupShown = true;
      this.emit('hint', D.TUTORIAL_TEXT.soup);
    } else {
      const r = Math.random();
      type = r < 0.38 ? 'bread' : r < 0.7 ? 'soup' : 'grocery';
      // 至少保留一种低风险选择
      if (type === 'soup' && pending.length && pending.every((o) => o.type === 'soup')) type = Math.random() < 0.5 ? 'bread' : 'grocery';
    }
    const shops = SHOPS.filter((s) => s.goods === type);
    const shop = pick(shops);
    let custs = CUSTOMERS.filter((c) => !c.story && c.node !== shop.node);
    // 接近营业结束时，停止生成无法在收尾期完成的长距离订单
    const left = D.SHIFT.open - this.phaseT;
    if (left < 100) {
      const toShop = this.g.distanceM(STATION.node, shop.node);
      const limit = (left + D.SHIFT.wrap * 0.45) * D.BASE_SPEED_MPS * 0.9;
      const near = custs.filter((c) => toShop + this.g.distanceM(shop.node, c.node) * 2 < limit);
      if (near.length) custs = near;
    }
    const cust = pick(custs);
    const tags = [];
    if (this.meta.story.introDone && cust.patience && Math.random() < 0.65) tags.push('need_patience');
    this.createOrder({ type, shop: shop.id, cust: cust.id, tags });
  }

  nearestCustomer(node, sides) {
    let pool = CUSTOMERS.filter((c) => !c.story && sides.includes(this.g.sideOf(c.node)));
    if (!pool.length) pool = CUSTOMERS.filter((c) => !c.story);
    return pool
      .map((c) => ({ c, d: this.g.distanceM(node, c.node) }))
      .sort((a, b) => a.d - b.d)[0].c;
  }

  maybeSpawnStory() {
    if (this.phase !== 'open' || this.pendingOrders().length >= D.MAX_PENDING) return;
    const st = this.meta.story;
    const live = (pred) => this.orders.some((o) => pred(o) && (o.status === 'pending' || ACTIVE.has(o.status)));
    // 绵绵介绍单
    if (this.meta.cats.mianmian.unlocked && !st.introDone) {
      if (!live((o) => o.intro)) {
        this.createOrder({
          type: 'bread',
          shop: 'morning',
          cust: 'slope',
          intro: true,
          tags: ['need_patience'],
          deadline: Infinity,
          note: '介绍单 · 无倒计时：坂道二丁目的老奶奶需要缓慢确认。推荐让绵绵试试。',
        });
        this.toast('新订单：绵绵的介绍单（无倒计时）', 'story');
      }
      return;
    }
    if (st.stage >= 3 || live((o) => o.story != null)) return;
    if (!this.meta.tutorial.skip && this.meta.tutorial.delivered < 1) return;
    if (st.stage === 0 && this.phaseT < 40) return;
    if (this.time < this.storyReadyAt) return;
    const stage = D.STORY.stages[st.stage];
    const shop = stage.type === 'soup' ? 'fishsoup' : 'grocery';
    this.createOrder({ type: stage.type, shop, cust: 'alley', story: st.stage, note: stage.note, deadline: D.ORDER_TYPES[stage.type].deadline + 60 });
    this.toast(`熟客故事「${D.STORY.title}」：${stage.title}`, 'story');
  }

  // ---------- 派单规划 ----------
  buildStops(cat, newIds) {
    const base = cat.stops.filter((s) => s.kind !== 'return');
    const add = [];
    newIds.forEach((id) => {
      const o = this.order(id);
      add.push({ kind: 'pickup', orderId: id, node: PLACE_BY_ID[o.shop].node });
      add.push({ kind: 'dropoff', orderId: id, node: PLACE_BY_ID[o.cust].node });
    });
    return [...base, ...add];
  }

  validate(cat, stops, newIds) {
    const ids = new Set(cat.orders.filter((id) => cat.current?.kind !== 'dropoff' || cat.current.orderId !== id));
    newIds.forEach((id) => ids.add(id));
    if (ids.size > 2) return { ok: false, reason: '每只猫最多同时承担两单' };
    const picked = new Set();
    cat.orders.forEach((id) => {
      if (this.order(id).status === 'delivering') picked.add(id);
    });
    if (cat.current?.kind === 'pickup') picked.add(cat.current.orderId);
    let load = this.catLoad(cat);
    if (load > cat.def.capacity) return { ok: false, reason: '超出负重上限' };
    for (const s of stops) {
      const o = this.order(s.orderId);
      if (s.kind === 'pickup') {
        picked.add(s.orderId);
        load += o.weight;
        if (load > cat.def.capacity) return { ok: false, reason: `超出负重上限（${load}/${cat.def.capacity}）` };
      } else if (s.kind === 'dropoff') {
        if (!picked.has(s.orderId)) return { ok: false, reason: '必须先取货、后送达' };
        load -= o.weight;
      }
    }
    return { ok: true };
  }

  simulate(cat, stops, { equip = this.equipOf(cat.id), turnReminder = cat.turnReminder, newIds = [] } = {}) {
    const g = this.g;
    const v = this.validate(cat, stops, newIds);
    const speed0 = (D.BASE_SPEED_MPS / g.unitM) * cat.def.speed; // 场景单位/秒
    const shelter = this.weather.raining && this.weather.shelter;
    let t = this.time;
    let energy = cat.energy;
    const pts = [{ x: cat.pos.x, z: cat.pos.z }];
    let cur;
    let rainSlow = false;
    const res = { ok: v.ok, reason: v.reason, etas: {}, complexRisk: 0, crowd: [], passBox: 0, passBird: 0, fishRisk: false, risks: [] };

    const travel = (from, to) => {
      const path = g.path(from, to, { shelter });
      let tt = 0;
      if (!path) {
        res.ok = false;
        res.reason = '路网不连通：该地点暂时无法到达';
        return 0;
      }
      for (let i = 1; i < path.length; i++) {
        const e = g.edge(path[i - 1], path[i]);
        const f = this.speedFactor(cat, e, equip, g.sideOf(path[i]));
        if (f < 1) rainSlow = true;
        tt += e.len / (speed0 * f);
        const n = g.pos(path[i]);
        pts.push({ x: n.x, z: n.z });
        if (g.boxNodes.has(path[i])) res.passBox++;
        if (g.birdNodes.has(path[i])) res.passBird++;
        if (cat.id === 'shandian' && i < path.length - 1 && g.isComplex(path[i])) {
          const a = g.pos(path[i - 1]);
          const c = g.pos(path[i + 1]);
          const d1x = n.x - a.x, d1z = n.z - a.z, d2x = c.x - n.x, d2z = c.z - n.z;
          const cos = (d1x * d2x + d1z * d2z) / (Math.hypot(d1x, d1z) * Math.hypot(d2x, d2z));
          if (cos < 0.82) {
            if (turnReminder) tt += 1;
            else res.complexRisk++;
          }
        }
      }
      return tt;
    };

    if (cat.state === 'moving') {
      let px = cat.pos.x;
      let pz = cat.pos.z;
      const idx = cat.queue.findIndex((p) => p.node);
      const prefix = idx === -1 ? [{ ...g.pos(cat.node), node: cat.node }] : cat.queue.slice(0, idx + 1);
      let d = 0;
      prefix.forEach((p) => {
        d += Math.hypot(p.x - px, p.z - pz);
        px = p.x;
        pz = p.z;
        pts.push({ x: p.x, z: p.z });
      });
      const dt = d / (speed0 * this.speedFactor(cat, null, equip));
      t += dt + Math.max(0, cat.wait);
      energy -= dt * cat.def.drain;
      cur = prefix[prefix.length - 1].node;
    } else {
      cur = cat.node;
      const n = g.pos(cat.node);
      const d0 = Math.hypot(cat.pos.x - n.x, cat.pos.z - n.z);
      if (d0 > 0.3) {
        pts.push({ x: n.x, z: n.z });
        const dt0 = d0 / (speed0 * this.speedFactor(cat, null, equip));
        t += dt0;
        energy -= dt0 * cat.def.drain;
      }
      t += Math.max(0, cat.wait);
    }

    const legEnds = [];
    for (const s of stops) {
      const tt = travel(cur, s.node);
      t += tt;
      energy -= tt * cat.def.drain;
      const o = this.order(s.orderId);
      if (s.kind === 'pickup') {
        const ready = o.status === 'pending' ? this.time + o.prep : o.readyAt;
        const w = Math.max(0, ready - t);
        if (w > 2) (res.etas[o.id] ||= { reasons: new Set() }).reasons.add('出餐等待');
        t += w + 2;
        if (cat.id === 'laoban') {
          const crowded = Object.values(this.cats).some(
            (c) => c !== cat && (c.stops.some((x) => x.kind === 'pickup' && x.node === s.node) || (c.current?.kind === 'pickup' && c.current.node === s.node)),
          );
          if (crowded) {
            t += D.LAOBAN_CROWD_DELAY;
            res.crowd.push(PLACE_BY_ID[o.shop].name);
            (res.etas[o.id] ||= { reasons: new Set() }).reasons.add('取货点拥挤');
          }
        }
        if (cat.id === 'dundun' && o.type === 'soup' && equip !== 'jar') res.fishRisk = true;
      } else if (s.kind === 'dropoff') {
        const h = this.handoffTime(cat, o);
        t += h;
        const due = o.status === 'pending' ? (isFinite(o.deadline) ? this.time + o.deadline : Infinity) : o.dueAt;
        const e = (res.etas[o.id] ||= { reasons: new Set() });
        e.eta = t;
        e.due = due;
        e.late = t > due;
        e.handoff = h;
        if (o.tags.includes('need_patience') && cat.id !== 'mianmian') e.reasons.add('需要耐心交接 +15 秒');
        if (rainSlow) e.reasons.add('雨天减速');
        if (stops.indexOf(s) > 1) e.reasons.add('拼单绕行');
        if (o.dist > 900) e.reasons.add('距离较远');
      }
      cur = s.node;
      legEnds.push(t);
    }
    const mainLen = pts.length;
    const back = travel(cur, STATION.node);
    res.returnAt = t + back;
    res.energyEnd = energy - back * cat.def.drain;
    res.points = pts.slice(0, mainLen);
    res.backPoints = pts.slice(mainLen - 1);
    res.total = t - this.time;
    if (res.ok && res.energyEnd < 5) {
      res.ok = false;
      res.reason = `预计精力不足（返站时约 ${Math.round(res.energyEnd)}），请先在站内休息`;
    }
    return res;
  }

  recommendStops(cat, newIds, opts) {
    const stops = this.buildStops(cat, newIds);
    if (stops.length > 5) return stops;
    const existing = new Set(stops.filter((s) => !newIds.includes(s.orderId)));
    const orig = stops.slice();
    let best = null;
    let bestScore = Infinity;
    const perm = (arr, l = 0) => {
      if (l === arr.length) {
        // 在途停靠点保持原有相对顺序，只插入新订单
        let last = -1;
        for (const s of arr) {
          if (!existing.has(s)) continue;
          const i = orig.indexOf(s);
          if (i < last) return;
          last = i;
        }
        if (!this.validate(cat, arr, newIds).ok) return;
        const sim = this.simulate(cat, arr, { ...opts, newIds });
        let score = sim.total * 0.5 + sim.crowd.length * 2;
        for (const [id, e] of Object.entries(sim.etas)) {
          if (e.eta == null) continue;
          const w = newIds.includes(Number(id)) ? 1 : 1.6;
          score += (e.eta - this.time) * w + (e.late ? e.eta - e.due + 60 : 0);
        }
        if (score < bestScore) {
          bestScore = score;
          best = arr.slice();
        }
        return;
      }
      for (let i = l; i < arr.length; i++) {
        [arr[l], arr[i]] = [arr[i], arr[l]];
        perm(arr, l + 1);
        [arr[l], arr[i]] = [arr[i], arr[l]];
      }
    };
    perm(stops.slice());
    return best || stops;
  }

  catAvailability(cat, newIds) {
    if (!this.meta.cats[cat.id].unlocked) return { ok: false, reason: '未解锁' };
    if (cat.eventPending) return { ok: false, reason: '正在处理事件' };
    const activeCount = cat.orders.length;
    if (activeCount + newIds.length > 2) return { ok: false, reason: '已满两单' };
    return { ok: true };
  }

  dispatch(catId, newIds, stops, { equip, turnReminder }) {
    const cat = this.cats[catId];
    if (equip === undefined) equip = this.equipOf(catId);
    const sim = this.simulate(cat, stops, { equip, turnReminder, newIds });
    if (!sim.ok) return { ok: false, reason: sim.reason };
    if (cat.state === 'idle' && equip !== this.equipOf(catId)) {
      if (!this.equipAvailable(equip, catId)) return { ok: false, reason: '装备数量不足' };
      this.meta.cats[catId].equip = equip || null;
    }
    newIds.forEach((id) => {
      const o = this.order(id);
      if (!o || o.status !== 'pending') return;
      o.status = 'assigned';
      o.catId = catId;
      o.acceptedAt = this.time;
      o.readyAt = this.time + o.prep;
      o.dueAt = isFinite(o.deadline) ? this.time + o.deadline : Infinity;
      cat.orders.push(id);
    });
    cat.stops = stops.slice();
    cat.turnReminder = !!turnReminder;
    this.replan(cat);
    this.save();
    this.emit('orders');
    this.emit('sfx', 'confirm');
    return { ok: true };
  }

  cancelOrder(id) {
    const o = this.order(id);
    if (!o || !ACTIVE.has(o.status)) return;
    const cat = this.cats[o.catId];
    o.status = 'cancelled';
    this.stats && this.stats.cancelled++;
    cat.orders = cat.orders.filter((x) => x !== id);
    cat.stops = cat.stops.filter((s) => s.orderId !== id);
    if (cat.current?.orderId === id) {
      cat.current = null;
      cat.wait = 0;
      cat.waitDone = null;
      cat.waitLabel = '';
      this.nextLeg(cat);
    } else this.replan(cat);
    this.toast(`订单 #${id} 已取消：无配送收入，不追加扣款。`);
    this.emit('orders');
    this.emit('sfx', 'cancel');
  }

  // ---------- 行进 ----------
  pathQueue(from, to) {
    const path = this.g.path(from, to, { shelter: this.weather.raining && this.weather.shelter }) || this.g.path(from, to) || [from];
    return path.slice(1).map((id) => ({ ...this.g.pos(id), node: id }));
  }

  nextLeg(cat) {
    cat.current = null;
    if (!cat.stops.length) {
      const slot = this.homeSlot(cat.slotIdx);
      if (cat.node === STATION.node && Math.hypot(cat.pos.x - slot.x, cat.pos.z - slot.z) < 0.5) return this.setIdle(cat);
      cat.stops = [{ kind: 'return', node: STATION.node }];
    }
    const s = cat.stops[0];
    const q = [];
    const np = this.g.pos(cat.node);
    if (Math.hypot(cat.pos.x - np.x, cat.pos.z - np.z) > 0.3) q.push({ x: np.x, z: np.z, node: cat.node, noEvent: true });
    q.push(...this.pathQueue(cat.node, s.node));
    if (s.kind === 'return') q.push({ ...this.homeSlot(cat.slotIdx) });
    cat.queue = q;
    cat.state = 'moving';
    cat.routeVer++;
    if (!q.length) this.arriveStop(cat);
  }

  replan(cat) {
    if (cat.state === 'idle') return this.nextLeg(cat);
    if (cat.state !== 'moving') {
      cat.routeVer++;
      return;
    }
    if (!cat.stops.length) cat.stops = [{ kind: 'return', node: STATION.node }];
    const idx = cat.queue.findIndex((p) => p.node);
    const prefix = idx === -1 ? [{ ...this.g.pos(cat.node), node: cat.node, noEvent: true }] : cat.queue.slice(0, idx + 1);
    const from = prefix[prefix.length - 1].node;
    const s = cat.stops[0];
    cat.queue = prefix.concat(this.pathQueue(from, s.node));
    if (s.kind === 'return') cat.queue.push({ ...this.homeSlot(cat.slotIdx) });
    cat.routeVer++;
  }

  setIdle(cat) {
    cat.state = 'idle';
    cat.current = null;
    cat.stops = [];
    cat.queue = [];
    cat.node = STATION.node;
    cat.turnReminder = false;
    cat.routeVer++;
    this.emit('orders');
  }

  updateCat(cat, dt) {
    if (cat.bubbleT > 0) cat.bubbleT -= dt;
    if (cat.state === 'idle') {
      const rate = 2.2 * (this.meta.upgrades.bed ? 1.6 : 1) * (this.meta.furniture.box ? 1.1 : 1);
      cat.energy = Math.min(100, cat.energy + rate * dt);
      return;
    }
    if (cat.eventPending) return;
    if (cat.wait > 0) {
      cat.wait -= dt;
      if (cat.wait <= 0) {
        cat.wait = 0;
        cat.waitLabel = '';
        const fn = cat.waitDone;
        cat.waitDone = null;
        if (fn) fn();
      }
      return;
    }
    if (cat.state !== 'moving') return;
    const g = this.g;
    let remain = 0;
    {
      const tgt = cat.queue[0];
      const e = tgt && tgt.node && cat.node ? g.edge(cat.node, tgt.node) : null;
      const side = tgt?.node ? g.sideOf(tgt.node) : null;
      remain = (D.BASE_SPEED_MPS / g.unitM) * cat.def.speed * this.speedFactor(cat, e, undefined, side) * dt;
    }
    cat.energy = Math.max(0, cat.energy - cat.def.drain * dt);
    while (remain > 0 && cat.queue.length && cat.wait <= 0 && !cat.eventPending) {
      const tgt = cat.queue[0];
      const dx = tgt.x - cat.pos.x;
      const dz = tgt.z - cat.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) cat.heading = Math.atan2(dz, dx);
      if (d <= remain) {
        cat.pos.x = tgt.x;
        cat.pos.z = tgt.z;
        remain -= d;
        cat.queue.shift();
        if (tgt.node) this.onNode(cat, tgt, d > 0.001 ? { x: dx / d, z: dz / d } : null);
      } else {
        cat.pos.x += (dx / d) * remain;
        cat.pos.z += (dz / d) * remain;
        remain = 0;
      }
    }
    if (!cat.queue.length && cat.wait <= 0 && !cat.eventPending && cat.state === 'moving') this.arriveStop(cat);
  }

  onNode(cat, pt, dirIn) {
    const g = this.g;
    const nodeId = pt.node;
    cat.node = nodeId;
    cat.routeVer++;
    if (pt.noEvent) return;
    const next = cat.queue[0];
    if (cat.id === 'shandian' && dirIn && next && g.isComplex(nodeId) && cat.skipTurnAt !== nodeId) {
      const n = g.pos(nodeId);
      const ox = next.x - n.x;
      const oz = next.z - n.z;
      const ol = Math.hypot(ox, oz) || 1;
      const cos = (dirIn.x * ox + dirIn.z * oz) / ol;
      if (cos < 0.82) {
        if (cat.turnReminder) {
          cat.wait = 1;
          cat.waitLabel = '转弯提醒：放慢确认路口';
        } else if (Math.random() < 0.45) {
          const ov = g.overshootM / g.unitM;
          const ahead = { x: n.x + dirIn.x * ov, z: n.z + dirIn.z * ov };
          cat.queue.unshift(ahead, { x: n.x, z: n.z, node: nodeId });
          cat.skipTurnAt = nodeId;
          this.bubble(cat, '跑过头了……正在掉头');
          this.toast('路线异常：闪电在复杂路口跑过头了。下次可在出发前开启「转弯提醒」。', 'warn');
          if (this.stats) this.stats.overshoot++;
          return;
        }
      }
    }
    if (cat.skipTurnAt === nodeId && !(cat.queue[0] && cat.queue[0].node === nodeId)) cat.skipTurnAt = null;
    this.checkEvents(cat, nodeId);
  }

  arriveStop(cat) {
    const s = cat.stops[0];
    if (!s) return this.nextLeg(cat);
    if (cat.node !== s.node) return this.nextLeg(cat);
    if (s.kind === 'return') {
      cat.stops.shift();
      if (cat.stops.length) return this.nextLeg(cat);
      return this.setIdle(cat);
    }
    cat.stops.shift();
    cat.current = s;
    cat.state = 'waiting';
    const o = this.order(s.orderId);
    if (s.kind === 'pickup') {
      let w = Math.max(0, o.readyAt - this.time);
      cat.waitLabel = w > 0.5 ? `等待出餐 · ${PLACE_BY_ID[o.shop].name}` : '取货中';
      if (cat.id === 'laoban') {
        const crowded = Object.values(this.cats).some(
          (c) => c !== cat && c.state !== 'idle' && ((c.current?.kind === 'pickup' && c.current.node === s.node) || (c.stops[0]?.kind === 'pickup' && c.stops[0].node === s.node && Math.hypot(c.pos.x - cat.pos.x, c.pos.z - cat.pos.z) < 18)),
        );
        if (crowded) {
          w += D.LAOBAN_CROWD_DELAY;
          cat.waitLabel = '取货点拥挤，老板在门外等';
          this.bubble(cat, '这里太挤了。');
        }
      }
      cat.wait = w + 2;
      cat.waitDone = () => {
        o.status = 'delivering';
        o.pickedAt = this.time;
        this.emit('sfx', 'pickup');
        this.nextLeg(cat);
        this.emit('orders');
      };
    } else {
      const h = this.handoffTime(cat, o);
      const patience = o.tags.includes('need_patience');
      cat.wait = h;
      cat.waitLabel = patience ? (cat.id === 'mianmian' ? '安静交接中（额外等待已免除）' : '耐心交接中') : '交接中';
      cat.waitDone = () => {
        this.deliver(cat, o);
        if (cat.id === 'mianmian') this.maybeCompanion(cat, o);
        if (!cat.eventPending) this.nextLeg(cat);
      };
      if (cat.id !== 'mianmian' && !o.story && !o.intro && this.time <= o.dueAt && this.time - cat.lastEventAt >= D.EVENT_COOLDOWN && Math.random() < 0.28) {
        this.pushTouchEvent(cat, o);
      }
    }
  }

  deliver(cat, o) {
    const m = this.meta;
    o.status = 'done';
    o.deliveredAt = this.time;
    const onTime = this.time <= o.dueAt;
    const bonus = onTime ? Math.round(o.reward * 0.2) : 0;
    const pay = o.reward + bonus;
    m.coins += pay;
    cat.orders = cat.orders.filter((x) => x !== o.id);
    const cm = m.cats[cat.id];
    cm.trust += 2;
    cm.delivered++;
    const side = this.g.sideOf(PLACE_BY_ID[o.cust].node);
    const before = famLevel(cm.fam[side]);
    cm.fam[side]++;
    const after = famLevel(cm.fam[side]);
    m.totalDelivered++;
    const st = this.stats;
    if (st) {
      st.delivered++;
      if (onTime) st.onTime++;
      else st.late++;
      st.income += o.reward;
      st.bonus += bonus;
      st.trust[cat.id] = (st.trust[cat.id] || 0) + 2;
      st.reviews.push({
        catId: cat.id,
        cust: PLACE_BY_ID[o.cust].name,
        customer: pick(onTime ? D.CUSTOMER_REVIEWS.ontime : D.CUSTOMER_REVIEWS.late),
        cat: pick(D.CAT_REVIEWS[cat.id]),
        onTime,
        type: o.type,
      });
    }
    this.toast(onTime ? `#${o.id} 已送达 · +${pay} 鱼干币（含准时奖励 ${bonus}）` : `#${o.id} 超时送达 · 保留基础收入 +${pay}`, onTime ? 'ok' : 'warn');
    this.emit('sfx', 'deliver');
    this.emit('delivered', { cat, order: o, onTime });
    if (after > before) this.toast(`${cat.def.name} 对${this.g.sideName(side)}更熟悉了：${FAM_NAMES[after]}`, 'ok');

    // 新手引导逐步开放
    const tut = m.tutorial;
    tut.delivered++;
    if (!m.cats.shandian.unlocked && tut.delivered >= 1) {
      m.cats.shandian.unlocked = true;
      this.emit('hint', D.TUTORIAL_TEXT.shandian);
      this.emit('unlock', 'shandian');
    }
    if (!m.cats.laoban.unlocked && tut.delivered >= 3) {
      m.cats.laoban.unlocked = true;
      m.combine = true;
      this.emit('hint', D.TUTORIAL_TEXT.laoban);
      this.emit('unlock', 'laoban');
    }

    if (o.story != null && o.story === m.story.stage) {
      m.story.stage++;
      m.coins += 15;
      this.storyReadyAt = this.time + 25;
      const stage = D.STORY.stages[o.story];
      if (m.story.stage === 3) m.furniture.postcard = true;
      this.emit('story', { stage: o.story, data: stage, cat });
      if (m.story.stage === 2 && !m.cats.mianmian.unlocked) {
        m.cats.mianmian.unlocked = true;
        this.emit('mianmian');
      }
    }
    if (o.intro) {
      m.story.introDone = true;
      this.storyReadyAt = this.time + 20;
      this.emit('hint', '介绍单完成！之后会逐步出现「需要耐心」的顾客：绵绵能免除这 15 秒额外等待。');
    }
    this.save();
    this.emit('orders');
  }

  // ---------- 事件 ----------
  pushEvent(ev) {
    ev.id = Math.random().toString(36).slice(2);
    if (ev.catId) {
      const cat = this.cats[ev.catId];
      cat.eventPending = true;
      cat.lastEventAt = this.time;
    }
    this.eventQueue.push(ev);
    this.emit('sfx', 'event');
    this.emit('event');
  }

  resolveEvent(idx) {
    const ev = this.eventQueue[0];
    if (!ev) return;
    const opt = ev.options[idx];
    if (!opt || opt.disabled) return;
    this.eventQueue.shift();
    if (ev.catId) this.cats[ev.catId].eventPending = false;
    if (this.stats) this.stats.events++;
    opt.run();
    this.save();
    this.emit('event');
    this.emit('orders');
  }

  etaPreview(cat) {
    const sim = this.simulate(cat, cat.stops.filter((s) => s.kind !== 'return'));
    const lines = [];
    for (const [id, e] of Object.entries(sim.etas)) {
      if (e.eta == null) continue;
      lines.push({ id: Number(id), eta: e.eta - this.time, left: e.due - this.time });
    }
    return { lines, back: sim.returnAt - this.time };
  }

  checkEvents(cat, nodeId) {
    if (cat.eventPending || this.time - cat.lastEventAt < D.EVENT_COOLDOWN) return;
    if (this.catHasLate(cat)) return;
    const m = this.meta;
    const soup = cat.orders.map((id) => this.order(id)).find((o) => o.status === 'delivering' && o.type === 'soup' && !o.fishDone);
    if (cat.id === 'dundun' && soup && this.equipOf('dundun') !== 'jar' && nodeId !== PLACE_BY_ID[soup.shop].node && Math.random() < 0.45) {
      soup.fishDone = true;
      this.pushEvent({
        kind: 'fish',
        catId: cat.id,
        title: '闻到鱼香',
        lines: ['配送员停止移动。', '原因：包里的鱼汤很香。', '性格风险：已在派单时提示。'],
        options: [
          { label: '安抚', sub: '免费 · 延迟约 8 秒', delay: 8, run: () => this.catWait(cat, 8, '正在被安抚……') },
          { label: '使用零食', sub: `零食 −1（剩 ${m.snacks}）· 立即继续`, delay: 0, disabled: m.snacks <= 0, run: () => this.useSnack(cat) },
        ],
        tip: '装备「密封罐」可阻止该事件。',
      });
      return;
    }
    if (this.g.boxNodes.has(nodeId) && Math.random() < (m.boxSeen ? 0.32 : 1)) {
      this.pushEvent({
        kind: 'box',
        catId: cat.id,
        title: '发现纸箱',
        lines: ['配送员暂时停留。', '原因：发现纸箱。', '适配情况：非常合适。'],
        options: [
          {
            label: '等待片刻',
            sub: `免费 · 约 12 秒 · 恢复 8 精力${!m.furniture.box ? ' · 首次获得纸箱窝' : ''}`,
            delay: 12,
            run: () => {
              this.catWait(cat, 12, '在纸箱里坐着', () => (cat.energy = Math.min(100, cat.energy + 8)));
              if (!m.furniture.box) {
                m.furniture.box = true;
                this.toast('获得：纸箱窝（已放入配送站，休息恢复 +10%）', 'ok');
              }
            },
          },
          { label: '使用零食', sub: `零食 −1（剩 ${m.snacks}）· 立即继续`, delay: 0, disabled: m.snacks <= 0, run: () => this.useSnack(cat) },
        ],
        tip: !m.tutorial.boxShown ? D.TUTORIAL_TEXT.box : null,
      });
      m.boxSeen = true;
      m.tutorial.boxShown = true;
      return;
    }
    if (this.g.birdNodes.has(nodeId) && Math.random() < 0.22) {
      this.pushEvent({
        kind: 'bird',
        catId: cat.id,
        title: '开始观鸟',
        lines: ['延迟原因：配送员正在观察一只鸟。', '观察进展：鸟尚未发现配送员。'],
        options: [
          { label: '轻声提醒', sub: '免费 · 短暂停留约 3 秒', delay: 3, run: () => this.catWait(cat, 3, '回过神来') },
          {
            label: '允许观察',
            sub: '免费 · 停留约 10 秒 · 获得观察记录',
            delay: 10,
            run: () => {
              const note = pick(D.BIRD_NOTES);
              this.catWait(cat, 10, '专心观鸟中');
              this.stats?.notes.push(`${cat.def.name}：${note}`);
              m.records.unshift(`${cat.def.name}：${note}`);
              m.records = m.records.slice(0, 30);
              this.toast(note, 'story');
            },
          },
        ],
      });
    }
  }

  pushTouchEvent(cat, o) {
    const cust = PLACE_BY_ID[o.cust];
    this.pushEvent({
      kind: 'touch',
      catId: cat.id,
      title: '顾客想摸猫',
      lines: [`到达交接点：${cust.name}。`, '顾客蹲了下来，伸出了手。', '配送员表示：可以考虑。'],
      options: [
        { label: '礼貌结束', sub: '免费 · 正常交接', delay: 0, run: () => {} },
        {
          label: '允许互动',
          sub: '多等约 10 秒 · 获得额外感谢与信任',
          delay: 10,
          run: () => {
            cat.wait += 10;
            cat.waitLabel = '被顾客摸摸中';
            this.meta.cats[cat.id].trust += 2;
            if (this.stats) this.stats.trust[cat.id] = (this.stats.trust[cat.id] || 0) + 2;
            const c = (this.meta.customers[o.cust] ||= { rel: 0, msgs: [] });
            c.rel++;
            const t = pick(THANKS);
            this.stats?.notes.push(`${cust.name}：${t}`);
            this.toast(`顾客额外感谢：${t}`, 'ok');
          },
        },
      ],
    });
  }

  maybeCompanion(cat, o) {
    if (o.intro) {
      // 介绍单固定展示陪伴选择，教学轻声召回
    } else {
      if (this.time > o.dueAt) return;
      if (this.time - cat.lastEventAt < D.EVENT_COOLDOWN) return;
      if (this.stats?.companion.has(o.cust)) return;
      if (Math.random() > 0.5) return;
    }
    const cust = PLACE_BY_ID[o.cust];
    cat.state = 'waiting';
    cat.waitLabel = '在门口坐着';
    this.pushEvent({
      kind: 'stay',
      catId: cat.id,
      title: '再陪一会儿',
      lines: ['配送已完成，配送员尚未离开。', '原因：顾客今天似乎有些难过。', '当前状态：等待站长确认是否继续陪伴。'],
      options: [
        { label: '轻声召回', sub: '免费 · 不额外等待 · 无关系惩罚', delay: 0, run: () => this.nextLeg(cat) },
        {
          label: '再陪一会儿',
          sub: '增加约 10 秒 · 不消耗零食',
          delay: 10,
          run: () => {
            const c = (this.meta.customers[o.cust] ||= { rel: 0, msgs: [] });
            const msg = pick(D.MIANMIAN_MESSAGES);
            if (!this.stats?.companion.has(o.cust)) {
              c.rel++;
              c.msgs.unshift(msg);
              c.msgs = c.msgs.slice(0, 10);
              this.meta.cats.mianmian.trust += 2;
              this.stats?.companion.add(o.cust);
              this.stats?.notes.push(`${cust.name}：${msg}`);
            }
            this.toast(`${cust.name}：${msg}`, 'story');
            cat.wait = 10;
            cat.waitLabel = '陪伴顾客中';
            cat.waitDone = () => this.nextLeg(cat);
          },
        },
      ],
      note: '本单已完成结算并保存，陪伴不影响本单准时评价。',
    });
  }

  catWait(cat, sec, label, then) {
    cat.wait = sec;
    cat.waitLabel = label;
    const prev = cat.waitDone;
    cat.waitDone = () => {
      then && then();
      if (prev) prev();
    };
  }

  useSnack(cat) {
    if (this.meta.snacks <= 0) return;
    this.meta.snacks--;
    this.bubble(cat, '嚼嚼。继续出发。', 2.5);
  }

  // ---------- 天气 ----------
  startRain() {
    this.weather.raining = true;
    this.weather.rained = true;
    this.emit('rain', true);
    const hasMoving = Object.values(this.cats).some((c) => c.state !== 'idle');
    this.pushEvent({
      kind: 'rain',
      catId: null,
      title: '下雨了',
      lines: ['全局状态：阵雨开始。', '影响：非遮蔽路段湿滑，移动减速 20%（防雨披：5%）。', this.g.shelterNote],
      options: [
        { label: '沿原路', sub: '路线不变 · 承受湿滑减速', delay: 0, run: () => this.setShelter(false) },
        { label: '改走遮蔽路线', sub: this.g.shelterRouteNote, delay: 0, run: () => this.setShelter(true) },
      ],
      note: hasMoving ? '在途猫咪会从当前路段继续重新计算路线。' : '之后派出的猫咪也会按此方式规划路线。',
    });
  }

  setShelter(on) {
    this.weather.shelter = on;
    Object.values(this.cats).forEach((c) => c.state === 'moving' && this.replan(c));
  }

  // ---------- 班次 ----------
  toPrep() {
    const m = this.meta;
    const first = m.shift === 1 && !m.tutorial.skip;
    this.forecast = { rainAt: Math.round(first ? rand(170, 200) : rand(80, 160)), rainDur: Math.round(rand(55, 75)) };
    this.phase = 'prep';
    this.emit('phase');
  }

  startShift() {
    const m = this.meta;
    m.started = true;
    this.phase = 'open';
    this.phaseT = 0;
    this.shiftT = 0;
    this.orders = [];
    this.eventQueue = [];
    this.nextOrderAt = 2;
    this.storyReadyAt = 0;
    const first = m.shift === 1 && !m.tutorial.skip;
    if (!this.forecast) this.toPrep();
    this.weather = { rainAt: this.forecast.rainAt, rainDur: this.forecast.rainDur, raining: false, shelter: false, rained: false };
    this.emit('rain', false);
    this.stats = { shift: m.shift, delivered: 0, onTime: 0, late: 0, income: 0, bonus: 0, cancelled: 0, unfinished: 0, events: 0, overshoot: 0, notes: [], reviews: [], trust: {}, companion: new Set(), coinsStart: m.coins };
    Object.values(this.cats).forEach((c, i) => {
      Object.assign(c, this.makeCat(c.def, i));
    });
    if (first) this.emit('hint', D.TUTORIAL_TEXT.start);
    this.save();
    this.emit('phase');
    this.emit('orders');
  }

  endShift() {
    const st = this.stats;
    this.activeOrders().forEach((o) => {
      o.status = 'cancelled';
      st.unfinished++;
    });
    this.eventQueue = [];
    this.weather.raining = false;
    this.emit('rain', false);
    Object.values(this.cats).forEach((c, i) => Object.assign(c, this.makeCat(c.def, i)));
    this.phase = 'settle';
    st.coinsEnd = this.meta.coins;
    this.meta.shift++;
    this.save();
    this.emit('phase');
    this.emit('settle', st);
    this.emit('orders');
  }

  buy(itemId) {
    const item = D.SHOP_ITEMS.find((i) => i.id === itemId);
    const m = this.meta;
    if (!item) return false;
    if (item.once && m.upgrades[itemId]) return false;
    if (m.coins < item.price) return false;
    m.coins -= item.price;
    if (itemId === 'snacks') m.snacks += 3;
    else if (item.equip) m.items[itemId]++;
    else m.upgrades[itemId] = true;
    this.save();
    this.emit('sfx', 'upgrade');
    this.emit('orders');
    return true;
  }

  setEquip(catId, itemId) {
    const cat = this.cats[catId];
    if (cat.state !== 'idle') return false;
    if (itemId && !this.equipAvailable(itemId, catId)) return false;
    this.meta.cats[catId].equip = itemId || null;
    this.save();
    return true;
  }

  // ---------- 主循环 ----------
  update(rawDt) {
    if (!this.running) return;
    const dt = Math.min(rawDt, 0.1) * this.speed;
    this.time += dt;
    this.phaseT += dt;
    this.shiftT += dt;

    const w = this.weather;
    if (!w.rained && this.shiftT >= w.rainAt) this.startRain();
    else if (w.raining && this.shiftT >= w.rainAt + w.rainDur) {
      w.raining = false;
      const wasShelter = w.shelter;
      w.shelter = false;
      this.emit('rain', false);
      this.toast('雨停了。路面渐干，移动速度恢复。', 'ok');
      if (wasShelter) Object.values(this.cats).forEach((c) => c.state === 'moving' && this.replan(c));
    }

    for (const o of this.orders) {
      if (o.status === 'pending' && this.time > o.acceptBy) {
        o.status = 'expired';
        this.toast(`订单 #${o.id} 已由其他站点承接（未接订单不扣分）`);
        this.emit('orders');
      }
    }

    if (this.phase === 'open') {
      if (this.time >= this.nextOrderAt) {
        this.spawnRegular();
        const fast = this.meta.upgrades.desk;
        this.nextOrderAt = this.time + (fast ? rand(10, 15) : rand(13, 19));
      }
      this.maybeSpawnStory();
    }

    for (const cat of Object.values(this.cats)) {
      if (!this.meta.cats[cat.id].unlocked) continue;
      this.updateCat(cat, dt);
      if (!this.running) break;
    }

    if (this.phase === 'open' && this.phaseT >= D.SHIFT.open) {
      this.phase = 'wrap';
      this.phaseT = 0;
      this.pendingOrders().forEach((o) => (o.status = 'expired'));
      this.toast('接单阶段结束：停止刷新订单，完成在途任务。', 'info');
      this.emit('phase');
      this.emit('orders');
    } else if (this.phase === 'wrap') {
      if (!this.activeOrders().length || this.phaseT >= D.SHIFT.wrap) this.endShift();
    }
  }
}
