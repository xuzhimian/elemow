// 轻量音效：柔和的提示音，避免持续警报
const TONES = {
  confirm: [[660, 0], [880, 0.08]],
  pickup: [[523, 0]],
  deliver: [[784, 0], [988, 0.09], [1175, 0.18]],
  cancel: [[440, 0], [330, 0.1]],
  event: [[587, 0], [698, 0.12]],
  upgrade: [[523, 0], [659, 0.08], [784, 0.16], [1046, 0.24]],
  error: [[220, 0], [196, 0.1]],
  settle: [[523, 0], [659, 0.12], [784, 0.24]],
  click: [[880, 0]],
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  play(kind) {
    if (!this.enabled || !this.ctx) return;
    const seq = TONES[kind];
    if (!seq) return;
    const now = this.ctx.currentTime;
    seq.forEach(([f, t]) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.06, now + t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.28);
      o.connect(g).connect(this.ctx.destination);
      o.start(now + t);
      o.stop(now + t + 0.3);
    });
  }
}
