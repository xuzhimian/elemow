// Generated watercolor keyframes, independent of the paused delivery clock.
const BASE = `${import.meta.env.BASE_URL}art/events/`;
export const EVENT_ROWS = Object.freeze({ bird: 0, box: 1, fish: 2, touch: 3, stay: 4, rain: 5 });
export const EVENT_CAST = Object.freeze({
  dundun: { name: '吨吨', seconds: 4.4, tint: '#D99A63' },
  shandian: { name: '闪电', seconds: 3.6, tint: '#C9962E' },
  laoban: { name: '老板', seconds: 4.8, tint: '#87977A' },
  mianmian: { name: '绵绵', seconds: 5.2, tint: '#8FA8BD' },
});
const LINES = {
  bird: ['先看看，鸟会不会自己过来。', '耳朵先发现了树上的小邻居。', '保持距离，是一位观察员的礼貌。', '慢慢眨眼，和小鸟打个招呼。'],
  box: ['大小刚好。工作可以等十二秒。', '检查完毕：这是一条通往纸箱的近路。', '坐进去之前，先把方巾理整齐。', '软乎乎的尾巴，也找到了位置。'],
  fish: ['汤还封着。只是再闻一下下。', '记住这阵香味，然后继续出发。', '封签完整，先向站长报个平安。', '把热汤留给等它的人。'],
  touch: ['摸摸头，就当今天的加班奖励。', '难得停一小会儿，尾巴也慢下来。', '只摸一下。好吧，再一下。', '轻轻靠近，把安心交给你。'],
  stay: ['不说话，也可以陪你坐一会儿。', '今天不赶这几步路。', '安静坐好，等你把心事说完。', '慢眨一下眼，再轻轻说再见。'],
  rain: ['檐下没有鱼香，但很暖和。', '跑得再快，也要找个地方躲雨。', '把方巾收好，听雨慢慢落。', '抖掉一点雨水，等天放晴。'],
};
const imageCache = new Map();
function loadAtlas(id) {
  if (!imageCache.has(id)) {
    const image = new Image();
    image.src = `${BASE}${id}-atlas.webp`;
    const ready = image.decode().then(() => {
      if (image.naturalWidth !== 1024 || image.naturalHeight !== 1536) throw new Error('Unexpected animation atlas size');
      return image;
    }).catch((error) => { imageCache.delete(id); throw error; });
    imageCache.set(id, ready);
  }
  return imageCache.get(id);
}

export class EventAnimation {
  constructor(host, { kind, catIds }) {
    this.host = host;
    this.kind = Object.hasOwn(EVENT_ROWS, kind) ? kind : 'stay';
    this.ids = [...new Set(catIds)].filter((id) => EVENT_CAST[id]).slice(0, 4);
    if (!this.ids.length) this.ids = ['dundun'];
    this.elapsed = 0;
    this.ready = false;
    this.disposed = false;
    this.raf = 0;
    this.last = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.playing = !this.reduced.matches;
    this.duration = Math.max(...this.ids.map((id) => EVENT_CAST[id].seconds));
    const single = this.ids.length === 1;
    const id = this.ids[0];
    const castIndex = Object.keys(EVENT_CAST).indexOf(id);
    host.innerHTML = `
      <div class="event-film" data-kind="${this.kind}" data-state="loading">
        <div class="film-toolbar"><span>街区小片刻</span><div>
          <button type="button" class="film-control" data-film-toggle disabled aria-label="暂停事件动画">暂停动画</button>
          <button type="button" class="film-control" data-film-replay disabled aria-label="重播事件动画">重播</button>
        </div></div>
        <canvas class="film-canvas" width="640" height="240" role="img" aria-label="${this.ids.map((key) => EVENT_CAST[key].name).join('、')}的温馨事件动画"></canvas>
        <p class="film-caption">${single ? LINES[this.kind][castIndex] : '各自找到一小片屋檐，一起等雨慢下来。'}</p>
        <small class="film-status" role="status">正在准备画面…</small>
      </div>`;
    this.panel = host.querySelector('.event-film');
    this.canvas = host.querySelector('canvas');
    this.context = this.canvas.getContext('2d');
    this.toggle = host.querySelector('[data-film-toggle]');
    this.replay = host.querySelector('[data-film-replay]');
    this.status = host.querySelector('.film-status');
    this.toggle.addEventListener('click', () => this.playing ? this.pause() : this.play());
    this.replay.addEventListener('click', () => this.play(true));
    this.visibility = () => {
      if (document.hidden) {
        this.resumeAfterHidden = this.playing;
        this.pause();
      } else if (this.resumeAfterHidden) {
        this.resumeAfterHidden = false;
        if (this.ready) this.play();
        else this.playing = true;
      }
    };
    this.motionChange = () => { if (this.reduced.matches) { this.resumeAfterHidden = false; this.pause(); } };
    document.addEventListener('visibilitychange', this.visibility);
    this.reduced.addEventListener('change', this.motionChange);
    Promise.all(this.ids.map(loadAtlas)).then((images) => {
      if (this.disposed) return;
      this.images = images;
      this.ready = true;
      this.toggle.disabled = this.replay.disabled = false;
      this.draw();
      // Do not begin motion while the tab is hidden or after disposal.
      if (document.hidden) { this.resumeAfterHidden = this.resumeAfterHidden || this.playing; this.playing = false; }
      this.syncControls();
      if (this.playing) { this.last = performance.now(); this.schedule(); }
    }).catch(() => {
      if (this.disposed) return;
      this.playing = false;
      this.panel.dataset.state = 'unavailable';
      this.status.textContent = '画面暂不可用，仍可直接选择处理方式。';
    });
  }

  syncControls() {
    const ended = this.elapsed >= this.duration;
    this.panel.dataset.state = this.playing ? 'playing' : ended ? 'ended' : 'paused';
    this.toggle.textContent = this.playing ? '暂停动画' : ended ? '再看一次' : '播放动画';
    this.toggle.setAttribute('aria-label', this.toggle.textContent);
    this.toggle.setAttribute('aria-pressed', String(this.playing));
    this.status.textContent = this.playing ? '不影响订单计时，可随时选择处理方式。' : ended ? '小片刻结束了，继续出发吧。' : '画面已暂停，可以手动播放。';
  }
  play(restart = false) {
    if (!this.ready || this.disposed) return;
    if (restart || this.elapsed >= this.duration) this.elapsed = 0;
    if (document.hidden) { this.resumeAfterHidden = true; return; }
    this.playing = true;
    this.last = performance.now();
    this.syncControls();
    this.draw();
    this.schedule();
  }
  pause() {
    this.playing = false;
    this.last = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.ready && !this.disposed) { this.draw(); this.syncControls(); }
  }
  schedule() {
    if (this.raf || !this.playing || this.disposed) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      if (this.disposed || !this.playing || document.hidden) return;
      if (this.last !== null) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.draw();
      if (this.elapsed >= this.duration) { this.playing = false; this.syncControls(); }
      else this.schedule();
    });
  }
  draw() {
    if (!this.ready || this.disposed) return;
    const ctx = this.context;
    ctx.clearRect(0, 0, 640, 240);
    const size = this.ids.length === 1 ? 232 : Math.min(220, 620 / this.ids.length);
    const total = this.ids.length * size;
    const left = (640 - total) / 2;
    const frames = [];
    this.ids.forEach((id, index) => {
      const spec = EVENT_CAST[id];
      const local = Math.min(this.elapsed / spec.seconds, 1);
      const frame = Math.min(3, Math.floor(local * 4));
      frames.push(frame);
      const x = left + index * size;
      const y = 240 - size;
      ctx.fillStyle = '#8E77641C';
      ctx.beginPath();
      ctx.ellipse(x + size / 2, 226, size * 0.32, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      const phase = this.elapsed / spec.seconds;
      const settle = Math.sin(Math.min(1, phase) * Math.PI);
      const quickness = id === 'shandian' ? 1.3 : id === 'mianmian' ? 0.65 : 0.9;
      const sway = Math.sin(this.elapsed * quickness * 2) * settle;
      ctx.save();
      ctx.translate(x + size / 2, y + size);
      ctx.rotate(sway * (this.kind === 'bird' ? 0.018 : 0.009));
      ctx.scale(1, 1 + sway * 0.007);
      const paint = (keyframe, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.images[index], keyframe * 256, EVENT_ROWS[this.kind] * 256, 256, 256, -size / 2, -size, size, size);
      };
      const frameAge = (phase * 4 - frame) * spec.seconds / 4;
      const blend = this.playing && frame > 0 ? Math.min(1, frameAge / 0.10) : 1;
      if (blend < 1) paint(frame - 1, 1 - blend);
      paint(frame, blend);
      ctx.restore();
      if (this.ids.length > 1) {
        ctx.fillStyle = '#625549';
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(spec.name, x + size / 2, 237);
      }
    });
    this.panel.dataset.frames = frames.join(',');
  }
  destroy() {
    this.disposed = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener('visibilitychange', this.visibility);
    this.reduced.removeEventListener('change', this.motionChange);
  }
}
