// 界面层：顶栏、订单与猫咪面板、派单面板、事件卡、各类弹窗
import { CATS, CAT_BY_ID, ORDER_TYPES, SHOP_ITEMS, EQUIP_NAMES, STORY, SHIFT, ENERGY_LOW, MAX_PENDING } from './data.js';
import { PLACE_BY_ID, STATION } from './places.js';
import { catAvatar } from './catModel.js';
import { catArt, stationArt } from './catArt.js';
import { ICONS, GOODS_ICON, EVENT_ICON } from './icons.js';
import { esc, fmtSec, fmtClock, fmtMeters } from './util.js';
import { famLevel, FAM_NAMES } from './game.js';

const $ = (sel, root = document) => root.querySelector(sel);
const av = (id) => catAvatar(CAT_BY_ID[id]);
const TAG_TEXT = { need_patience: '需要耐心' };

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export class UI {
  constructor(game, world, sfx) {
    this.game = game;
    this.world = world;
    this.sfx = sfx;
    this.selectedCat = null;
    this.dp = null;
    this.modalQ = [];
    this.modalOpen = false;
    this.acc = 0;
    this.orderKeys = '';
    this.catKeys = '';
    this.shownEventId = null;
    this.recCache = new Map();
    this.recT = 0;

    this.top = {
      phase: $('#chip-phase'),
      weather: $('#chip-weather'),
      coins: $('#chip-coins'),
      snacks: $('#chip-snacks'),
      pause: $('#btn-pause'),
      speed: $('#btn-speed'),
    };
    this.orderList = $('#order-list');
    this.catList = $('#cat-list');
    this.dpEl = $('#dispatch');
    this.sideMain = $('#side-main');
    this.modalEl = $('#modal');
    this.eventEl = $('#event-card');
    this.toastsEl = $('#toasts');
    this.hintEl = $('#hint');
    this.scaleEl = $('#scalebar');

    this.bind();
    this.listen();
  }

  bind() {
    const g = this.game;
    this.top.pause.addEventListener('click', () => this.togglePause());
    this.top.speed.addEventListener('click', () => {
      g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 3 : 1;
      this.top.speed.textContent = `×${g.speed}`;
    });
    $('#btn-station').addEventListener('click', () => this.showStation());
    $('#btn-help').addEventListener('click', () => this.showHelp());
    $('#btn-sound').addEventListener('click', (e) => {
      this.sfx.enabled = !this.sfx.enabled;
      e.currentTarget.classList.toggle('off', !this.sfx.enabled);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.modalOpen && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.togglePause();
      }
      if (e.code === 'Escape' && this.dp) this.closeDispatch();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (g.phase === 'open' || g.phase === 'wrap')) {
        g.userPaused = true;
        this.renderTop();
      }
    });
    document.addEventListener('pointerdown', () => this.sfx.ensure(), { once: false });
    $('#hint-close').addEventListener('click', () => (this.hintEl.hidden = true));
    this.world.labelRoot.addEventListener('click', (e) => {
      const pl = e.target.closest('.place-label');
      if (pl) {
        const p = PLACE_BY_ID[pl.dataset.place];
        this.toast(`${p.name}${p.kind === 'shop' ? ' · 取货点' : p.kind === 'station' ? ' · 配送站' : ' · 送达点'}`);
      }
    });
  }

  listen() {
    const g = this.game;
    g.on('toast', ({ text, kind }) => this.toast(text, kind));
    g.on('hint', (t) => this.hint(t));
    g.on('event', () => this.renderEvent());
    g.on('settle', (st) => this.showSettle(st));
    g.on('phase', () => this.onPhase());
    g.on('story', (p) => this.showStory(p));
    g.on('mianmian', () => this.showMianmian());
    g.on('unlock', (id) => this.toast(`${CAT_BY_ID[id].breed}「${CAT_BY_ID[id].name}」加入配送站`, 'ok'));
    g.on('orders', () => (this.dirty = true));
    g.on('sfx', (k) => this.sfx.play(k));
    g.on('rain', (on) => {
      this.world.setRain(on);
      $('#map-wrap').classList.toggle('raining', on);
    });
  }

  togglePause() {
    const g = this.game;
    if (g.phase !== 'open' && g.phase !== 'wrap') return;
    g.userPaused = !g.userPaused;
    this.renderTop();
  }

  // ---------------- 提示 ----------------
  toast(text, kind = 'info') {
    const t = el(`<div class="toast ${kind}"></div>`);
    t.textContent = text;
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 5) this.toastsEl.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 4800);
    setTimeout(() => t.remove(), 5400);
  }

  hint(text) {
    $('#hint-text').textContent = text;
    this.hintEl.hidden = false;
    this.hintEl.classList.remove('pop');
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('pop');
  }

  // ---------------- 每帧 ----------------
  tick(dt) {
    const sb = this.world.scaleBar();
    this.scaleEl.querySelector('.bar').style.width = `${sb.px}px`;
    this.scaleEl.querySelector('span').textContent = sb.label;
    this.acc += dt;
    if (this.acc < 0.2 && !this.dirty) return;
    this.acc = 0;
    this.dirty = false;
    this.renderTop();
    this.renderOrders();
    this.renderCats();
    $('#pause-veil').hidden = !(this.game.userPaused && (this.game.phase === 'open' || this.game.phase === 'wrap'));
  }

  renderTop() {
    const g = this.game;
    const m = g.meta;
    const phaseName = { title: '未营业', prep: '营业准备', open: '接单阶段', wrap: '收尾阶段', settle: '班次结算' }[g.phase];
    let timer = '';
    if (g.phase === 'open') timer = fmtClock(SHIFT.open - g.phaseT);
    if (g.phase === 'wrap') timer = fmtClock(SHIFT.wrap - g.phaseT);
    this.top.phase.innerHTML = `<b>第 ${g.phase === 'settle' ? m.shift - 1 : m.shift} 班</b><span>${phaseName}</span>${timer ? `<em>${timer}</em>` : ''}`;
    const w = g.weather;
    let wt;
    if (g.phase === 'open' || g.phase === 'wrap') {
      if (w.raining) wt = `${ICONS.rain}<span>下雨 · 约 ${Math.ceil(w.rainAt + w.rainDur - g.shiftT)} 秒后停${w.shelter ? ' · 遮蔽路线' : ''}</span>`;
      else if (!w.rained) wt = `${ICONS.sun}<span>晴 · 约 ${Math.ceil(w.rainAt - g.shiftT)} 秒后有雨</span>`;
      else wt = `${ICONS.sun}<span>雨后放晴</span>`;
    } else wt = `${ICONS.sun}<span>晴</span>`;
    this.top.weather.innerHTML = wt;
    this.top.weather.classList.toggle('rain', !!w.raining);
    this.top.coins.innerHTML = `${ICONS.coin}<b>${m.coins}</b><span>鱼干币</span>`;
    this.top.snacks.innerHTML = `${ICONS.snack}<b>${m.snacks}</b><span>零食</span>`;
    const paused = g.userPaused;
    this.top.pause.innerHTML = paused ? `${ICONS.play}<span>继续</span>` : `${ICONS.pause}<span>暂停</span>`;
    this.top.pause.classList.toggle('active', paused);
  }

  // ---------------- 订单列表 ----------------
  orderTags(o) {
    let s = '';
    if (o.story != null) s += `<span class="tag story">${ICONS.paw}熟客故事</span>`;
    if (o.intro) s += `<span class="tag story">介绍单</span>`;
    o.tags.forEach((t) => (s += `<span class="tag patience">${ICONS.heart}${TAG_TEXT[t]}</span>`));
    if (o.type === 'soup') s += `<span class="tag fishy">${ICONS.fish}鱼香</span>`;
    return s;
  }

  renderOrders() {
    const g = this.game;
    const list = g.pendingOrders();
    $('#pending-count').textContent = `${list.length}/${MAX_PENDING}`;
    const keys = list.map((o) => o.id).join(',') + g.phase;
    if (keys !== this.orderKeys) {
      this.orderKeys = keys;
      this.orderList.innerHTML = '';
      if (!list.length) {
        const msg = g.phase === 'wrap' ? '收尾阶段：停止刷新订单，请完成在途任务。' : g.phase === 'open' ? '订单正在路上……' : '营业开始后，订单会持续出现。';
        this.orderList.innerHTML = `<div class="empty">${ICONS.note}<span>${msg}</span></div>`;
      }
      list.forEach((o) => {
        const T = ORDER_TYPES[o.type];
        const shop = PLACE_BY_ID[o.shop];
        const cust = PLACE_BY_ID[o.cust];
        const card = el(`
          <button class="order-card type-${o.type}" data-id="${o.id}">
            <div class="oc-icon">${GOODS_ICON[o.type]}</div>
            <div class="oc-body">
              <div class="oc-title"><b>#${o.id} ${esc(T.name)}</b><span class="oc-w">重量 ${o.weight}</span>${this.orderTags(o)}</div>
              <div class="oc-route">${esc(shop.name)} <i>→</i> ${esc(cust.name)}</div>
              <div class="oc-meta"><span>${ICONS.target}${fmtMeters(o.dist)}</span><span>${ICONS.clock}期限 ${fmtSec(o.deadline)}</span><span>出餐 ${o.prep} 秒</span></div>
              ${o.note ? `<div class="oc-note">${esc(o.note)}</div>` : ''}
              <div class="oc-rec"></div>
            </div>
            <div class="oc-side">
              <div class="oc-reward"><b>${o.reward}</b><small>+${Math.round(o.reward * 0.2)} 准时</small></div>
              <div class="oc-timer"><i></i></div>
            </div>
          </button>`);
        card.addEventListener('click', () => this.openDispatch(o.id));
        card.addEventListener('mouseenter', () => this.previewOrder(o));
        card.addEventListener('mouseleave', () => this.previewOrder(null));
        this.orderList.appendChild(card);
      });
    }
    this.recT -= 0.2;
    const doRec = g.meta.upgrades.desk && this.recT <= 0;
    if (doRec) this.recT = 1;
    list.forEach((o) => {
      const card = this.orderList.querySelector(`[data-id="${o.id}"]`);
      if (!card) return;
      const bar = card.querySelector('.oc-timer i');
      if (isFinite(o.acceptBy)) {
        const left = Math.max(0, o.acceptBy - g.time);
        bar.style.width = `${(left / (o.acceptBy - o.createdAt)) * 100}%`;
        card.querySelector('.oc-timer').title = `接单剩余 ${Math.ceil(left)} 秒`;
      } else bar.style.width = '100%';
      if (doRec) {
        const rec = this.recommendCat([o.id]);
        card.querySelector('.oc-rec').innerHTML = rec ? `${ICONS.check}订单台推荐：<b>${esc(rec.def.name)}</b>` : '';
      }
    });
  }

  recommendCat(newIds) {
    const g = this.game;
    let best = null;
    let bestScore = Infinity;
    g.unlockedCats().forEach((c) => {
      if (!g.catAvailability(c, newIds).ok) return;
      const stops = g.recommendStops(c, newIds, {});
      const sim = g.simulate(c, stops, { newIds });
      if (!sim.ok) return;
      const late = Object.values(sim.etas).some((e) => e.late);
      const score = sim.total + (late ? 500 : 0) + (sim.fishRisk ? 25 : 0) + sim.complexRisk * 6 + sim.crowd.length * 6;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    });
    return best;
  }

  previewOrder(o) {
    this.hoverOrder = o;
    if (this.dp) return;
    if (!o) {
      this.world.clearRoute('hover');
      this.world.highlightPlaces([]);
      return;
    }
    const g = this.game.g;
    const path = g.path(PLACE_BY_ID[o.shop].node, PLACE_BY_ID[o.cust].node);
    this.world.setRoute('hover', path.map((id) => g.pos(id)), { color: '#8C7F72', dashed: true, width: 0.9, opacity: 0.8 });
    this.world.highlightPlaces([o.shop, o.cust]);
  }

  // ---------------- 猫咪列表 ----------------
  renderCats() {
    const g = this.game;
    const sig = CATS.map((c) => {
      const cat = g.cats[c.id];
      return `${c.id}:${g.meta.cats[c.id].unlocked}:${cat.orders.join('.')}:${cat.orders.map((id) => g.order(id)?.status).join('.')}:${g.meta.cats[c.id].equip}`;
    }).join('|') + (this.selectedCat || '');
    if (sig !== this.catKeys) {
      this.catKeys = sig;
      this.catList.innerHTML = '';
      CATS.forEach((def) => {
        const unlocked = g.meta.cats[def.id].unlocked;
        const cat = g.cats[def.id];
        if (!unlocked) {
          const lockTip = def.id === 'mianmian' ? '熟客故事「还是放在门口就好」第二阶段完成后加入' : def.id === 'shandian' ? '完成第一单后加入' : '累计完成 3 单后加入，并开放拼送';
          this.catList.appendChild(
            el(`<div class="cat-card locked"><img class="avatar" src="${catAvatar(def, { gray: true })}" alt=""><div class="cc-body"><div class="cc-head"><b>${esc(def.breed)}「${esc(def.name)}」</b></div><div class="cc-status">${esc(lockTip)}</div></div></div>`),
          );
          return;
        }
        const equip = g.meta.cats[def.id].equip;
        const card = el(`
          <div class="cat-card ${this.selectedCat === def.id ? 'selected' : ''}" data-id="${def.id}" style="--cat:${def.route}">
            <img class="avatar" src="${av(def.id)}" alt="">
            <div class="cc-body">
              <div class="cc-head"><b>${esc(def.name)}</b><small>${esc(def.breed)} · 速度 ${def.speed.toFixed(2)} · 负重 <span class="cc-load"></span>/${def.capacity}</small>${equip ? `<span class="equip">${ICONS[equip]}${EQUIP_NAMES[equip]}</span>` : ''}</div>
              <div class="cc-status"></div>
              <div class="energy"><i></i><span></span></div>
              <div class="cc-orders">${cat.orders
                .map((id) => {
                  const o = g.order(id);
                  return `<div class="cc-order" data-oid="${id}"><span class="cco-icon">${GOODS_ICON[o.type]}</span><span class="cco-text">#${id} ${o.status === 'delivering' ? '配送中' : '待取货'} → ${esc(PLACE_BY_ID[o.cust].name)}</span><span class="cco-time"></span><button class="mini" data-cancel="${id}" title="取消订单（无收入，不扣款）">${ICONS.close}</button></div>`;
                })
                .join('')}</div>
            </div>
            <div class="cc-actions">
              <button class="mini" data-act="locate" title="定位">${ICONS.target}</button>
              <button class="mini" data-act="profile" title="档案">${ICONS.note}</button>
            </div>
          </div>`);
        card.addEventListener('click', (e) => {
          const cancel = e.target.closest('[data-cancel]');
          if (cancel) {
            e.stopPropagation();
            this.confirmCancel(Number(cancel.dataset.cancel));
            return;
          }
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'profile') return this.showProfile(def.id);
          this.selectCat(def.id, true);
        });
        this.catList.appendChild(card);
      });
    }
    CATS.forEach((def) => {
      const card = this.catList.querySelector(`.cat-card[data-id="${def.id}"]`);
      if (!card) return;
      const cat = g.cats[def.id];
      card.querySelector('.cc-status').textContent = g.catStatus(cat) + (cat.wait > 0.5 && cat.state !== 'idle' ? ` · ${Math.ceil(cat.wait)} 秒` : '');
      const e = Math.round(cat.energy);
      const bar = card.querySelector('.energy i');
      bar.style.width = `${e}%`;
      bar.classList.toggle('low', e < ENERGY_LOW);
      card.querySelector('.energy span').textContent = `精力 ${e}${e < ENERGY_LOW ? ' · 建议优先休息' : ''}`;
      card.querySelector('.cc-load').textContent = g.catLoad(cat);
      card.querySelectorAll('.cc-order').forEach((row) => {
        const o = g.order(Number(row.dataset.oid));
        if (!o) return;
        const left = o.dueAt - g.time;
        const t = row.querySelector('.cco-time');
        t.textContent = !isFinite(left) ? '不限时' : left >= 0 ? `剩 ${Math.ceil(left)} 秒` : '已超时';
        t.classList.toggle('late', left < 0);
      });
    });
  }

  selectCat(id, focus = false) {
    this.selectedCat = this.selectedCat === id && !focus ? null : id;
    this.dirty = true;
    const cat = this.game.cats[id];
    if (focus && cat) this.world.focus(cat.pos.x, cat.pos.z);
  }

  confirmCancel(id) {
    this.showModal(
      `<div class="modal-card small">
        <h2>取消订单 #${id}？</h2>
        <p>已接订单允许取消：无配送收入，不追加债务，也不降低关系。</p>
        <div class="row-end"><button class="btn ghost" data-close>再想想</button><button class="btn danger" data-ok>确认取消</button></div>
      </div>`,
      (root, close) => {
        root.querySelector('[data-ok]').addEventListener('click', () => {
          this.game.cancelOrder(id);
          close();
        });
      },
    );
  }

  // ---------------- 派单面板 ----------------
  openDispatch(orderId) {
    const g = this.game;
    if (g.phase !== 'open' || this.dp) return;
    if (g.eventQueue.length) {
      this.toast('请先处理当前事件。', 'warn');
      return;
    }
    const o = g.order(orderId);
    if (!o || o.status !== 'pending') return;
    this.previewOrder(null);
    this.dp = { newIds: [orderId], catId: null, stops: [], equip: null, turnReminder: false, msg: '' };
    const rec = this.recommendCat([orderId]);
    const first = rec || g.unlockedCats().find((c) => g.catAvailability(c, [orderId]).ok) || g.unlockedCats()[0];
    this.dpSelectCat(first.id);
    g.block('dispatch', true);
    this.sideMain.hidden = true;
    this.dpEl.hidden = false;
    this.sfx.play('click');
    this.dpRender();
  }

  closeDispatch() {
    this.dp = null;
    this.dpEl.hidden = true;
    this.sideMain.hidden = false;
    this.world.clearRoute('preview');
    this.world.clearRoute('preview-back');
    this.world.highlightPlaces([]);
    this.game.block('dispatch', false);
    this.dirty = true;
  }

  dpSelectCat(id) {
    const g = this.game;
    const cat = g.cats[id];
    const dp = this.dp;
    dp.catId = id;
    dp.equip = g.equipOf(id);
    dp.turnReminder = id === 'shandian' ? cat.turnReminder : false;
    dp.stops = g.recommendStops(cat, dp.newIds, { equip: dp.equip, turnReminder: dp.turnReminder });
  }

  dpOpts() {
    return { equip: this.dp.equip, turnReminder: this.dp.turnReminder, newIds: this.dp.newIds };
  }

  dpRender() {
    const g = this.game;
    const dp = this.dp;
    const cat = g.cats[dp.catId];
    const def = cat.def;
    const avail = g.catAvailability(cat, dp.newIds);
    const sim = g.simulate(cat, dp.stops, this.dpOpts());
    const ok = avail.ok && sim.ok;
    const atStation = cat.state === 'idle';

    // 订单
    const orderCard = (o, removable) => {
      const T = ORDER_TYPES[o.type];
      return `<div class="dp-order type-${o.type}"><div class="oc-icon">${GOODS_ICON[o.type]}</div><div><b>#${o.id} ${T.name}</b> <span class="muted">重量 ${o.weight} · ${o.reward} 鱼干币 · 期限 ${fmtSec(o.deadline)}</span>${this.orderTags(o)}<div class="oc-route">${esc(PLACE_BY_ID[o.shop].name)} → ${esc(PLACE_BY_ID[o.cust].name)} · ${fmtMeters(o.dist)}</div>${o.note ? `<div class="oc-note">${esc(o.note)}</div>` : ''}</div>${removable ? `<button class="mini" data-unc="${o.id}" title="移出拼送">${ICONS.close}</button>` : ''}</div>`;
    };
    const ordersHtml = dp.newIds.map((id, i) => orderCard(g.order(id), i > 0)).join('');
    let combineHtml = '';
    if (g.meta.combine) {
      const others = g.pendingOrders().filter((o) => !dp.newIds.includes(o.id));
      const room = 2 - cat.orders.length - dp.newIds.length;
      combineHtml = `<div class="dp-combine"><div class="dp-sub">拼送：一只猫最多同时承担两单${room <= 0 ? '（当前已满）' : ''}</div>${others
        .map((o) => `<button class="combine-opt" data-comb="${o.id}" ${room <= 0 ? 'disabled' : ''}>${GOODS_ICON[o.type]}<span>#${o.id} ${ORDER_TYPES[o.type].name} · ${esc(PLACE_BY_ID[o.shop].name)} → ${esc(PLACE_BY_ID[o.cust].name)}</span><em>+ 拼送</em></button>`)
        .join('') || '<div class="muted small">暂无其他待接订单</div>'}</div>`;
    } else {
      combineHtml = `<div class="muted small">${ICONS.info} 累计完成 3 单后开放拼送。</div>`;
    }

    // 猫咪选项
    const catOpts = g
      .unlockedCats()
      .map((c) => {
        const a = g.catAvailability(c, dp.newIds);
        let info = '';
        let cls = '';
        if (!a.ok) {
          info = a.reason;
          cls = 'disabled';
        } else {
          const st = c.id === dp.catId ? dp.stops : g.recommendStops(c, dp.newIds, {});
          const s = g.simulate(c, st, { newIds: dp.newIds, equip: c.id === dp.catId ? dp.equip : undefined, turnReminder: c.id === dp.catId ? dp.turnReminder : c.turnReminder });
          if (!s.ok) {
            info = s.reason;
            cls = 'warn';
          } else {
            const late = Object.values(s.etas).filter((e) => e.eta != null && e.late).length;
            info = `全程 ${fmtSec(s.total)} · ${late ? `${late} 单预计超时` : '预计准时'}`;
            cls = late ? 'warn' : 'good';
          }
        }
        const busy = c.state === 'idle' ? '站内' : `在途 ${c.orders.length} 单`;
        return `<button class="dp-cat ${c.id === dp.catId ? 'active' : ''} ${cls}" data-cat="${c.id}" ${!a.ok ? 'disabled' : ''} style="--cat:${c.def.route}">
          <img src="${av(c.id)}" alt=""><div><b>${c.def.name}</b><small>${busy} · 精力 ${Math.round(c.energy)} · 负重 ${g.catLoad(c)}/${c.def.capacity}</small><em>${esc(info)}</em></div></button>`;
      })
      .join('');

    // 装备
    const m = g.meta;
    const equipBtn = (id, label) => {
      const owned = id ? m.items[id] : 0;
      const can = !id || g.equipAvailable(id, cat.id);
      const dis = !atStation || (!can && dp.equip !== id);
      return `<button class="seg ${dp.equip === id ? 'active' : ''}" data-equip="${id || ''}" ${dis ? 'disabled' : ''}>${id ? ICONS[id] : ''}${label}${id ? ` <small>持有 ${owned}</small>` : ''}</button>`;
    };
    const equipHtml = `<div class="segs">${equipBtn(null, '基础包')}${equipBtn('jar', '密封罐')}${equipBtn('raincoat', '防雨披')}</div>
      ${!atStation ? '<div class="muted small">在途猫咪无法更换装备（需在站内出发前更换）。</div>' : m.items.jar + m.items.raincoat === 0 ? '<div class="muted small">可在配送站「装备架」购买密封罐、防雨披。</div>' : ''}
      ${cat.id === 'shandian' ? `<label class="check"><input type="checkbox" data-turn ${dp.turnReminder ? 'checked' : ''}> ${ICONS.turn} 出发前开启转弯提醒 <small>（复杂路口各 +1 秒，不会跑过头）</small></label>` : ''}`;

    // 停靠顺序
    const tryMove = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= dp.stops.length) return false;
      const arr = dp.stops.slice();
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return g.validate(cat, arr, dp.newIds).ok;
    };
    const stopsHtml = dp.stops
      .map((s, i) => {
        const o = g.order(s.orderId);
        const place = s.kind === 'pickup' ? PLACE_BY_ID[o.shop] : PLACE_BY_ID[o.cust];
        const existing = !dp.newIds.includes(o.id);
        const e = sim.etas[o.id];
        const eta = s.kind === 'dropoff' && e?.eta != null ? `<span class="${e.late ? 'late' : 'ok'}">${fmtSec(e.eta - g.time)}</span>` : '';
        return `<div class="stop ${s.kind}"><span class="stop-n">${i + 1}</span><span class="stop-k">${s.kind === 'pickup' ? '取货' : '送达'}</span><span class="stop-p">${esc(place.name)} <small>#${o.id}${existing ? ' · 在途' : ''}</small></span>${eta}
          <button class="mini" data-mv="${i}:-1" ${tryMove(i, -1) ? '' : 'disabled'}>${ICONS.up}</button><button class="mini" data-mv="${i}:1" ${tryMove(i, 1) ? '' : 'disabled'}>${ICONS.down}</button></div>`;
      })
      .join('');

    // 预计结果
    const allIds = [...new Set([...cat.orders, ...dp.newIds])].filter((id) => sim.etas[id]?.eta != null);
    const resultHtml = allIds
      .map((id) => {
        const o = g.order(id);
        const e = sim.etas[id];
        const reasons = [...(e.reasons || [])];
        const left = e.due - g.time;
        const status = !isFinite(e.due) ? '<b class="ok">不限时</b>' : e.late ? `<b class="late">预计超时 ${Math.ceil(e.eta - e.due)} 秒</b>` : `<b class="ok">预计准时 · 余 ${Math.floor(e.due - e.eta)} 秒</b>`;
        return `<div class="res-row"><span>#${id} → ${esc(PLACE_BY_ID[o.cust].name)}</span><span>预计 ${fmtSec(e.eta - g.time)} / 期限 ${fmtSec(left)}（交接 ${e.handoff} 秒）</span>${status}${e.late && reasons.length ? `<div class="muted small">原因：${reasons.map(esc).join('、')}。仍可确认出发，超时保留基础收入。</div>` : ''}</div>`;
      })
      .join('');
    const eNow = Math.round(cat.energy);
    const eEnd = Math.round(sim.energyEnd);
    const energyHtml = `<div class="res-row"><span>精力</span><span>${eNow} → ${eEnd}（返站时）</span>${eEnd < ENERGY_LOW ? '<b class="late">偏低</b>' : '<b class="ok">充足</b>'}</div><div class="res-row"><span>返站</span><span>约 ${fmtSec(sim.returnAt - g.time)} 后</span></div>`;

    // 风险与对策
    const risks = [];
    if (sim.fishRisk) risks.push(['warn', ICONS.fish, `吨吨运送鱼汤：途中可能闻到鱼香而分心。对策：换猫，或装备密封罐（持有 ${m.items.jar}）。`]);
    if (cat.id === 'dundun' && dp.equip === 'jar' && dp.newIds.concat(cat.orders).some((id) => g.order(id).type === 'soup')) risks.push(['good', ICONS.jar, '密封罐已装备：本次不会触发鱼香诱惑。']);
    if (cat.id === 'shandian') {
      if (sim.complexRisk > 0) risks.push(['warn', ICONS.turn, `途经 ${sim.complexRisk} 个复杂转弯路口：闪电可能跑过头。对策：开启转弯提醒。`]);
      else if (dp.turnReminder) risks.push(['good', ICONS.turn, '转弯提醒已开启：复杂路口会先放慢确认。']);
    }
    if (sim.crowd.length) risks.push(['warn', ICONS.store, `老板不喜欢拥挤取货点：${sim.crowd.map(esc).join('、')} 已有其他猫咪前往（+6 秒）。对策：调整到店顺序或换猫。`]);
    const patienceOrders = dp.newIds.concat(cat.orders).map((id) => g.order(id)).filter((o) => o && o.tags.includes('need_patience'));
    if (patienceOrders.length) {
      if (cat.id === 'mianmian') risks.push(['good', ICONS.heart, '需要耐心：额外等待已免除（绵绵交接 10 秒）。']);
      else if (cat.id === 'laoban') risks.push(['info', ICONS.heart, '需要耐心的顾客：老板基础交接 7 秒 + 额外 15 秒 = 22 秒。']);
      else risks.push(['info', ICONS.heart, `需要耐心的顾客：交接 ${10 + 15} 秒（基础 10 + 额外 15）。${m.cats.mianmian.unlocked ? '绵绵可免除额外等待。' : ''}`]);
    }
    if (cat.id === 'mianmian') risks.push(['info', ICONS.heart, '绵绵送达后可能想多陪顾客一会儿：由站长选择，不会自动扣时。']);
    if (g.weather.raining) risks.push(['warn', ICONS.rain, `雨天：非遮蔽路段减速 ${dp.equip === 'raincoat' ? '5' : '20'}%${g.weather.shelter ? '，已优先遮蔽路线' : ''}。`]);
    const famSides = new Set(dp.stops.map((s) => g.g.sideOf(s.node)));
    const famOk = [...famSides].every((sd) => famLevel(m.cats[cat.id].fam[sd]) >= 2);
    if (famOk) risks.push(['info', ICONS.paw, `${def.name}认得这条街：途经纸箱点 ${sim.passBox} 处、绿地路口 ${sim.passBird} 处（可能触发停留事件）。`]);
    else risks.push(['muted', ICONS.paw, '街区熟悉度提升到「认得这条街」后，可预知途中纸箱与绿地。']);
    if (!risks.filter((r) => r[0] === 'warn').length) risks.unshift(['good', ICONS.check, '暂无明显性格风险。']);
    const risksHtml = risks.map(([k, ic, t]) => `<div class="risk ${k}">${ic}<span>${t}</span></div>`).join('');

    this.dpEl.innerHTML = `
      <div class="dp-head"><h3>${ICONS.paw} 派单</h3><span class="muted small">已自动暂停 · 游戏模拟时间</span><button class="mini" data-close>${ICONS.close}</button></div>
      <div class="dp-scroll">
        <section><h4>订单</h4>${ordersHtml}${combineHtml}</section>
        <section><h4>选择猫咪</h4><div class="dp-cats">${catOpts}</div></section>
        <section><h4>装备与提醒 <small class="muted">（每只猫一个功能装备栏）</small></h4>${equipHtml}</section>
        <section><h4>停靠顺序 <button class="link" data-rec>推荐顺序</button></h4><div class="stops">${stopsHtml}</div><div class="muted small">取货必须在送达之前；非法排序会被阻止。</div></section>
        <section><h4>预计结果</h4>${resultHtml}${energyHtml}<div class="muted small">预计时间不包含随机事件；事件风险单独列出。</div></section>
        <section><h4>性格风险与对策</h4>${risksHtml}</section>
      </div>
      <div class="dp-foot">
        ${!ok ? `<div class="dp-err">${ICONS.warn}${esc(avail.reason || sim.reason || '')}</div>` : ''}
        <button class="btn ghost" data-close>关闭</button>
        <button class="btn primary" data-confirm ${ok ? '' : 'disabled'}>确认派送 · ${esc(def.name)}</button>
      </div>`;

    // 地图预览
    this.world.setRoute('preview', sim.points, { color: def.route, dashed: true, width: 1.4, opacity: 0.95 });
    this.world.setRoute('preview-back', sim.backPoints, { color: '#8C7F72', dashed: true, width: 0.7, opacity: 0.45 });
    const hl = [];
    dp.stops.forEach((s) => {
      const o = g.order(s.orderId);
      hl.push(s.kind === 'pickup' ? o.shop : o.cust);
    });
    this.world.highlightPlaces(hl);

    // 交互
    const root = this.dpEl;
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeDispatch()));
    root.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        this.dpSelectCat(b.dataset.cat);
        this.dpRender();
      }),
    );
    root.querySelectorAll('[data-comb]').forEach((b) =>
      b.addEventListener('click', () => {
        dp.newIds.push(Number(b.dataset.comb));
        dp.stops = g.recommendStops(cat, dp.newIds, this.dpOpts());
        this.dpRender();
      }),
    );
    root.querySelectorAll('[data-unc]').forEach((b) =>
      b.addEventListener('click', () => {
        dp.newIds = dp.newIds.filter((x) => x !== Number(b.dataset.unc));
        dp.stops = g.recommendStops(cat, dp.newIds, this.dpOpts());
        this.dpRender();
      }),
    );
    root.querySelectorAll('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        dp.equip = b.dataset.equip || null;
        this.dpRender();
      }),
    );
    const turn = root.querySelector('[data-turn]');
    if (turn)
      turn.addEventListener('change', () => {
        dp.turnReminder = turn.checked;
        this.dpRender();
      });
    root.querySelectorAll('[data-mv]').forEach((b) =>
      b.addEventListener('click', () => {
        const [i, d] = b.dataset.mv.split(':').map(Number);
        const arr = dp.stops.slice();
        [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
        if (g.validate(cat, arr, dp.newIds).ok) dp.stops = arr;
        this.dpRender();
      }),
    );
    root.querySelector('[data-rec]').addEventListener('click', () => {
      dp.stops = g.recommendStops(cat, dp.newIds, this.dpOpts());
      this.dpRender();
    });
    root.querySelector('[data-confirm]').addEventListener('click', () => {
      const r = g.dispatch(dp.catId, dp.newIds, dp.stops, { equip: dp.equip, turnReminder: dp.turnReminder });
      if (!r.ok) {
        this.toast(r.reason, 'warn');
        this.sfx.play('error');
        return;
      }
      const id = dp.catId;
      this.closeDispatch();
      this.selectedCat = id;
      this.toast(`${CAT_BY_ID[id].name} 已出发。`, 'ok');
    });
  }

  // ---------------- 事件卡 ----------------
  renderEvent() {
    const g = this.game;
    const ev = g.eventQueue[0];
    if (!ev) {
      this.eventEl.hidden = true;
      this.shownEventId = null;
      return;
    }
    if (this.shownEventId === ev.id) return;
    this.shownEventId = ev.id;
    const cat = ev.catId ? g.cats[ev.catId] : null;
    if (cat) this.world.focus(cat.pos.x, cat.pos.z);
    let etaHtml = '';
    let pv = null;
    if (cat) {
      pv = g.etaPreview(cat);
      etaHtml = pv.lines.length
        ? pv.lines.map((l) => `<div class="ev-eta">${ICONS.clock}#${l.id} 预计 ${fmtSec(l.eta)} 后送达 · 剩余期限 ${fmtSec(l.left)}</div>`).join('')
        : `<div class="ev-eta">${ICONS.home}无在途订单 · 预计 ${fmtSec(pv.back)} 后返站</div>`;
    }
    const impact = (delay) => {
      if (!pv) return '';
      if (!pv.lines.length) return delay ? `返站 +${delay} 秒` : '返站时间不变';
      const l = pv.lines[0];
      const ne = l.eta + delay;
      if (!isFinite(l.left)) return delay ? `下一单 +${delay} 秒（不限时）` : '不影响下一单';
      return ne <= l.left ? `下一单仍可准时（余 ${Math.floor(l.left - ne)} 秒）` : `<span class="late">下一单可能超时 ${Math.ceil(ne - l.left)} 秒</span>`;
    };
    this.eventEl.innerHTML = `
      <div class="ev-inner kind-${ev.kind}">
        <div class="ev-head">
          <div class="ev-icon">${EVENT_ICON[ev.kind]}</div>
          <div><div class="ev-title">${esc(ev.title)}</div>${cat ? `<div class="ev-who"><img src="${av(cat.id)}" alt="">${esc(cat.def.name)} · ${esc(cat.def.breed)}</div>` : '<div class="ev-who">全局状态 · 不为每只猫单独弹窗</div>'}</div>
          <span class="ev-paused">${ICONS.pause}已暂停</span>
        </div>
        <div class="ev-lines">${ev.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
        ${etaHtml}
        ${ev.note ? `<div class="ev-note">${esc(ev.note)}</div>` : ''}
        <div class="ev-opts">${ev.options
          .map((o, i) => `<button class="ev-opt" data-i="${i}" ${o.disabled ? 'disabled' : ''}><b>${esc(o.label)}</b><small>${esc(o.sub)}</small>${cat ? `<em>${impact(o.delay)}</em>` : ''}</button>`)
          .join('')}</div>
        ${ev.tip ? `<div class="ev-tip">${ICONS.info}${esc(ev.tip)}</div>` : ''}
      </div>`;
    this.eventEl.hidden = false;
    this.eventEl.querySelectorAll('.ev-opt').forEach((b) =>
      b.addEventListener('click', () => {
        this.sfx.play('click');
        g.resolveEvent(Number(b.dataset.i));
      }),
    );
  }

  // ---------------- 弹窗 ----------------
  showModal(html, mount, { block = true } = {}) {
    this.modalQ.push({ html, mount, block });
    if (!this.modalOpen) this.nextModal();
  }

  nextModal() {
    const item = this.modalQ.shift();
    if (!item) {
      this.modalOpen = false;
      this.modalEl.hidden = true;
      this.game.block('modal', false);
      return;
    }
    this.modalOpen = true;
    this.game.block('modal', true);
    this.modalEl.innerHTML = item.html;
    this.modalEl.hidden = false;
    const close = () => this.nextModal();
    this.modalEl.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    item.mount && item.mount(this.modalEl, close);
  }

  onPhase() {
    const g = this.game;
    if (g.phase === 'prep') this.showPrep();
    if (g.phase === 'open' || g.phase === 'wrap') this.dirty = true;
    if (this.dp && g.phase !== 'open') this.closeDispatch();
  }

  showTitle() {
    const m = this.game.meta;
    const cont = m.started;
    this.showModal(
      `<div class="modal-card title-card">
        <div class="tc-cats">${['dundun', 'shandian', 'laoban', 'mianmian'].map((id) => `<img src="${catAvatar(CAT_BY_ID[id], { gray: !m.cats[id].unlocked && id === 'mianmian' })}" alt="">`).join('')}</div>
        <h1>饿了喵 <small>Hungry Meow</small></h1>
        <p class="tagline">在一张认真严肃的街区地图上，经营一家由小猫负责配送的外卖站。<br>玩家认真规划路线，小猫认真制造意外。</p>
        <div class="tc-points">
          <span>${ICONS.target}路网寻路 · ${esc(this.game.g.bottleneckNote)}</span>
          <span>${ICONS.paw}四只性格各异的配送员</span>
          <span>${ICONS.box}纸箱 · 观鸟 · 鱼香 · 摸猫 · 下雨</span>
          <span>${ICONS.heart}熟客故事与绵绵加入</span>
        </div>
        <div class="tc-btns">
          ${cont ? `<button class="btn primary" data-go="continue">继续营业 · 第 ${m.shift} 班</button>` : `<button class="btn primary" data-go="new">开始营业（含新手引导）</button>`}
          ${cont ? '' : '<button class="btn" data-go="skip">跳过教学：直接解锁三只初始猫与拼送</button>'}
          ${cont ? '<button class="btn ghost" data-go="reset">重置存档</button>' : ''}
        </div>
        <p class="muted small">Demo 基于 PRD v0.3 P0 范围制作 · ${esc(this.game.g.mapNote)} · 进度保存在本地浏览器</p>
      </div>`,
      (root, close) => {
        root.querySelectorAll('[data-go]').forEach((b) =>
          b.addEventListener('click', () => {
            this.sfx.ensure();
            this.sfx.play('confirm');
            const go = b.dataset.go;
            if (go === 'reset') {
              this.game.resetSave();
              return;
            }
            if (go === 'skip') {
              const mm = this.game.meta;
              mm.tutorial.skip = true;
              mm.cats.shandian.unlocked = true;
              mm.cats.laoban.unlocked = true;
              mm.combine = true;
              mm.tutorial.soupShown = true;
            }
            close();
            this.game.toPrep();
          }),
        );
      },
    );
  }

  showPrep() {
    const g = this.game;
    const m = g.meta;
    const fc = g.forecast;
    const cats = g.unlockedCats();
    const storyLine = m.story.stage >= 3 ? '熟客故事已完成 · 明信片已收藏' : `熟客故事「${STORY.title}」：第 ${m.story.stage + 1}/3 阶段待推进`;
    const render = () => `
      <div class="modal-card prep-card">
        <div class="mc-kicker">营业准备 · 约 30 秒</div>
        <h2>第 ${m.shift} 班</h2>
        <div class="prep-grid">
          <div class="prep-box">${ICONS.rain}<div><b>天气预报</b><p>营业约 ${fc.rainAt} 秒后有阵雨，持续约 ${fc.rainDur} 秒。非遮蔽路段会湿滑减速。</p></div></div>
          <div class="prep-box">${ICONS.clock}<div><b>班次节奏</b><p>接单 ${SHIFT.open / 60} 分钟 → 收尾最多 ${SHIFT.wrap / 60} 分钟 → 结算。打开派单、事件时自动暂停。</p></div></div>
          <div class="prep-box">${ICONS.paw}<div><b>故事进度</b><p>${storyLine}</p></div></div>
        </div>
        <h4>配送员状态与装备</h4>
        <div class="prep-cats">${cats
          .map((c) => {
            const eq = m.cats[c.id].equip;
            const opt = (id, label) => {
              const can = !id || g.equipAvailable(id, c.id) || eq === id;
              return `<button class="seg ${eq === id ? 'active' : ''}" data-cat="${c.id}" data-eq="${id || ''}" ${can ? '' : 'disabled'}>${label}</button>`;
            };
            return `<div class="prep-cat"><img src="${av(c.id)}" alt=""><div><b>${c.def.name}</b><small>${c.def.personality} · 精力 100</small><div class="segs">${opt(null, '基础包')}${opt('jar', `密封罐(${m.items.jar})`)}${opt('raincoat', `防雨披(${m.items.raincoat})`)}</div></div></div>`;
          })
          .join('')}</div>
        <div class="row-end"><button class="btn ghost" data-station>${ICONS.store}配送站</button><button class="btn primary" data-start>开始营业</button></div>
      </div>`;
    this.showModal(render(), (root, close) => {
      const mount = () => {
        root.querySelectorAll('[data-eq]').forEach((b) =>
          b.addEventListener('click', () => {
            g.setEquip(b.dataset.cat, b.dataset.eq || null);
            root.innerHTML = render();
            mount();
          }),
        );
        root.querySelector('[data-start]').addEventListener('click', () => {
          close();
          g.startShift();
          this.sfx.play('confirm');
        });
        root.querySelector('[data-station]').addEventListener('click', () => {
          close();
          this.showStation(() => this.showPrep());
        });
      };
      mount();
    });
  }

  showSettle(st) {
    const g = this.game;
    this.sfx.play('settle');
    const net = st.coinsEnd - st.coinsStart;
    const rate = st.delivered ? Math.round((st.onTime / st.delivered) * 100) : 0;
    const reviews = st.reviews.slice(-4).reverse();
    const trust = Object.entries(st.trust);
    this.showModal(
      `<div class="modal-card settle-card">
        <div class="mc-kicker">班次结算</div>
        <h2>第 ${st.shift} 班 · 辛苦了</h2>
        <div class="stats">
          <div><b>${st.delivered}</b><span>完成订单</span></div>
          <div><b>${rate}%</b><span>准时率</span></div>
          <div><b>${st.income}</b><span>基础收入</span></div>
          <div><b>${st.bonus}</b><span>准时奖励</span></div>
          <div class="hl"><b>${net >= 0 ? '+' : ''}${net}</b><span>本班净收入</span></div>
          <div><b>${st.events}</b><span>处理事件</span></div>
        </div>
        ${st.unfinished || st.cancelled ? `<p class="muted small">未完成 ${st.unfinished} 单、取消 ${st.cancelled} 单：无收入，不扣款。</p>` : ''}
        ${reviews.length ? `<h4>双向评价</h4><div class="reviews">${reviews
          .map((r) => `<div class="review"><div class="rv-c">${ICONS.door}<span><b>${esc(r.cust)}</b>顾客评价：${esc(r.customer)}</span></div><div class="rv-m"><img src="${av(r.catId)}" alt=""><span><b>${esc(CAT_BY_ID[r.catId].name)}</b>猫咪评价：${esc(r.cat)}</span></div></div>`)
          .join('')}</div>` : '<p class="muted">本班没有完成的订单。没关系，下一班再来。</p>'}
        ${st.notes.length ? `<h4>工作记录</h4><ul class="notes">${st.notes.slice(-5).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${trust.length ? `<h4>成长</h4><div class="growth">${trust.map(([id, v]) => `<span><img src="${av(id)}" alt="">${esc(CAT_BY_ID[id].name)} 信任 +${v}</span>`).join('')}</div>` : ''}
        ${st.overshoot ? `<p class="muted small">闪电本班跑过头 ${st.overshoot} 次。它说那是在探索。</p>` : ''}
        <div class="row-end"><button class="btn primary" data-go>前往配送站</button></div>
      </div>`,
      (root, close) => {
        root.querySelector('[data-go]').addEventListener('click', () => {
          close();
          if (st.shift === 1 && !g.meta.tutorial.skip) this.hint('班次结束！在配送站购买第一件装备吧：密封罐能让吨吨安心送鱼汤。');
          this.showStation(() => g.toPrep());
        });
      },
    );
  }

  showStation(after) {
    const g = this.game;
    if (g.phase === 'title') return;
    const m = g.meta;
    const render = () => {
      const item = (id) => {
        const it = SHOP_ITEMS.find((x) => x.id === id);
        const owned = it.once ? m.upgrades[id] : it.equip ? m.items[id] : m.snacks;
        const dis = (it.once && m.upgrades[id]) || m.coins < it.price;
        return `<div class="shop-item"><div class="si-icon">${ICONS[id === 'snacks' ? 'snack' : id]}</div><div class="si-body"><b>${it.name}</b><p>${it.desc}</p><small>${it.once ? (owned ? '已升级' : '未升级') : `持有 ${owned}`}</small></div><button class="btn ${dis ? '' : 'primary'}" data-buy="${id}" ${dis ? 'disabled' : ''}>${it.once && m.upgrades[id] ? '已拥有' : `${ICONS.coin}${it.price}`}</button></div>`;
      };
      const cats = g.unlockedCats();
      return `
      <div class="modal-card station-card">
        <div class="mc-kicker">配送站 · 固定布局 · 三个升级点</div>
        <h2>${ICONS.home} 喵喵配送站 <span class="coins">${ICONS.coin}${m.coins} 鱼干币</span></h2>
        <div class="station-scene">
          <img class="station-backdrop" src="${stationArt}" alt="晨光中的配送站，木质柜台、装备架与休息角" fetchpriority="high">
          <div class="st-caption"><b>街角的小小配送站</b><span>休息一下，再出发。</span></div>
          <div class="st-equipment" aria-label="配送站装备">${m.items.jar ? '<span>密封罐 ×' + m.items.jar + '</span>' : ''}${m.items.raincoat ? '<span>雨披 ×' + m.items.raincoat + '</span>' : ''}${m.upgrades.bed ? '<span>软垫窝已升级</span>' : ''}</div>
          ${m.furniture.postcard ? '<div class="st-postcard" title="猫妈妈的明信片">猫妈妈的明信片</div>' : ''}
          <div class="st-cats">${cats.map((c) => `<div class="st-cat" style="--cat:${c.def.route}"><img src="${catArt(c.id).sprite}" alt="${esc(c.def.name)}" decoding="async"><span>${esc(c.def.name)} · ${c.state === 'idle' ? '站内休息' : '配送中'}</span></div>`).join('')}</div>
          ${m.furniture.box ? '<div class="st-box" title="纸箱窝加成已生效">纸箱窝已安置</div>' : ''}
        </div>
        <div class="station-areas">
          <div class="area"><h4>${ICONS.bed}休息窝</h4>${item('bed')}<p class="muted small">站内休息：每秒恢复 ${(2.2 * (m.upgrades.bed ? 1.6 : 1) * (m.furniture.box ? 1.1 : 1)).toFixed(1)} 精力${m.furniture.box ? '（含纸箱窝加成）' : ''}。班次结束全员恢复。</p></div>
          <div class="area"><h4>${ICONS.raincoat}装备架</h4>${item('jar')}${item('raincoat')}</div>
          <div class="area"><h4>${ICONS.desk}订单台</h4>${item('snacks')}${item('desk')}</div>
        </div>
        <div class="row-end">${after ? '<button class="btn primary" data-done>继续</button>' : '<button class="btn primary" data-done>返回地图</button>'}</div>
      </div>`;
    };
    this.showModal(render(), (root) => {
      const mount = () => {
        root.querySelectorAll('[data-buy]').forEach((b) =>
          b.addEventListener('click', () => {
            if (g.buy(b.dataset.buy)) this.toast(`已购买：${SHOP_ITEMS.find((x) => x.id === b.dataset.buy).name}`, 'ok');
            root.innerHTML = render();
            mount();
          }),
        );
        root.querySelector('[data-done]').addEventListener('click', () => {
          this.nextModal();
          after && after();
        });
      };
      mount();
    });
  }

  showStory({ stage, data, cat }) {
    this.world.setStoryDecor(this.game.meta.story.stage);
    this.showModal(
      `<div class="modal-card story-card stage-${stage}">
        <div class="mc-kicker">${ICONS.paw} 熟客故事 · ${esc(STORY.title)}</div>
        <h2>${esc(data.title)}</h2>
        <div class="story-door">${stage >= 3 ? `<div class="story-family"><img src="${catArt('mom').sprite}" alt="猫妈妈"><img src="${catArt('kitten-gray').sprite}" alt="灰色幼猫"><img src="${catArt('kitten-orange').sprite}" alt="橘色幼猫"></div>` : ''}<div class="door"></div><div class="mat">${stage >= 1 ? '<i></i><i></i><i></i>' : ''}</div>${stage >= 2 ? '<div class="note">谢谢</div>' : ''}</div>
        <p class="story-text">${esc(data.reveal)}</p>
        <p class="muted small">配送员：${esc(cat.def.name)} · 故事首通奖励 +15 鱼干币${stage === 2 ? ' · 获得「猫妈妈的明信片」' : ''}</p>
        <div class="row-end"><button class="btn primary" data-close>继续</button></div>
      </div>`,
    );
  }

  showMianmian() {
    const def = CAT_BY_ID.mianmian;
    this.showModal(
      `<div class="modal-card mm-card">
        <img class="mm-av character-portrait" src="${catArt('mianmian').sprite}" alt="布偶猫绵绵，背着雾蓝色配送包">
        <div class="mc-kicker">新同事加入</div>
        <h2>布偶猫「绵绵」<small>${esc(def.title)}</small></h2>
        <blockquote>送来的不只是晚饭，还有一小会儿陪伴。<br><small>工作记录：配送准时。返站稍晚。顾客心情有所好转。</small></blockquote>
        <div class="mm-grid">
          <div><b>速度</b>${def.speed.toFixed(2)}</div><div><b>负重</b>${def.capacity}</div>
          <div class="wide"><b>优势</b>需要耐心的顾客：免除 15 秒额外交接等待</div>
          <div class="wide"><b>习惯</b>送达后容易想多陪顾客一会儿（由站长选择）</div>
        </div>
        <p class="muted small">接下来会出现一笔无倒计时的介绍单；之后逐步投放「需要耐心」顾客标签。</p>
        <div class="row-end"><button class="btn primary" data-close>欢迎绵绵</button></div>
      </div>`,
      () => {
        this.toast('布偶猫「绵绵」加入配送站', 'story');
        this.sfx.play('upgrade');
      },
    );
  }

  showProfile(id) {
    const g = this.game;
    const def = CAT_BY_ID[id];
    const cm = g.meta.cats[id];
    const fam = (sd) => `${FAM_NAMES[famLevel(cm.fam[sd])]}（${cm.fam[sd]} 单）`;
    this.showModal(
      `<div class="modal-card profile-card" style="--cat:${def.route}">
        <div class="pf-head"><img src="${av(id)}" alt="${esc(def.name)}头像"><div><div class="mc-kicker">${esc(def.breed)} · ${esc(def.title)}</div><h2>${esc(def.name)}</h2><p>${esc(def.personality)}</p></div></div>
        <div class="profile-art"><img src="${catArt(id).sprite}" alt="${esc(def.name)}完整角色形象"></div>
        <div class="mm-grid">
          <div><b>速度系数</b>${def.speed.toFixed(2)}</div><div><b>负重上限</b>${def.capacity}</div>
          <div><b>信任</b>${cm.trust}</div><div><b>累计配送</b>${cm.delivered} 单</div>
          <div class="wide"><b>优势</b>${esc(def.strength)}</div>
          <div class="wide"><b>需要照顾的习惯</b>${esc(def.habit)}</div>
          <div class="wide"><b>街区熟悉度</b>${esc(g.g.sideName('w'))}：${fam('w')} · ${esc(g.g.sideName('e'))}：${fam('e')}</div>
        </div>
        <h4>性格记录</h4>
        <ul class="notes">${def.stories.map(([need, t]) => (cm.trust >= need ? `<li>${esc(t)}</li>` : `<li class="locked">信任达到 ${need} 后解锁</li>`)).join('')}</ul>
        <div class="row-end"><button class="btn primary" data-close>关闭</button></div>
      </div>`,
    );
  }

  showHelp() {
    this.showModal(
      `<div class="modal-card help-card">
        <h2>站长手册</h2>
        <ul class="help">
          <li><b>核心循环</b>查看订单 → 选择猫咪与装备 → 预览路线和风险 → 确认派送 → 应对事件 → 完成订单 → 升级配送站。</li>
          <li><b>地图</b>拖动平移、滚轮缩放。猫咪只能沿路网行走，跨河必须走北桥或南桥。橙色圆环是复杂路口；路边纸箱、公园绿地可能让猫咪停留。</li>
          <li><b>订单</b>未接订单可忽略不扣分；超时送达保留基础收入，失去 20% 准时奖励；已接订单可取消（无收入、不扣款）。</li>
          <li><b>猫咪</b>吨吨负重 4、怕鱼香；闪电快但复杂路口易跑过头；老板交接快但讨厌拥挤取货点；绵绵擅长需要耐心的顾客。</li>
          <li><b>精力</b>行进消耗、站内恢复。派单前预计精力不足会阻止出发。</li>
          <li><b>下雨</b>非遮蔽路段减速 20%；商店街与拱廊有雨棚。可选择改走遮蔽路线；防雨披可降低影响。</li>
          <li><b>快捷键</b>空格：暂停/继续；Esc：关闭派单面板。右上角可切换 ×1/×2/×3 速度。</li>
        </ul>
        <div class="row-end"><button class="btn ghost" data-reset>重置存档</button><button class="btn primary" data-close>知道了</button></div>
      </div>`,
      (root) => {
        root.querySelector('[data-reset]').addEventListener('click', () => this.game.resetSave());
      },
    );
  }
}

export { STATION };
