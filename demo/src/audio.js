// Soft cues and an original local piano/plucked-string BGM loop.
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
const SETTINGS_KEY = 'hungry-meow-audio-v1';

function readSettings() {
  try {
    const p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      effects: typeof p.effects === 'boolean' ? p.effects : true,
      music: typeof p.music === 'boolean' ? p.music : true,
      volume: typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : 0.4,
    };
  } catch { return { effects: true, music: true, volume: 0.4 }; }
}

export class Sfx extends EventTarget {
  constructor() {
    super();
    const settings = readSettings();
    this.ctx = null;
    this.enabled = settings.effects;
    this.musicEnabled = settings.music;
    this.musicVolume = settings.volume;
    this.started = false;
    this.playPending = false;
    this.retryAfterPending = false;
    this.musicError = '';
    this.music = new Audio(`${import.meta.env.BASE_URL}audio/slow-corner.mp3`);
    this.music.loop = true;
    this.music.preload = 'none';
    this.musicGain = null;
    for (const name of ['playing', 'pause', 'canplay']) this.music.addEventListener(name, () => this.changed());
    this.music.addEventListener('error', () => {
      this.musicError = '音乐暂不可用，点击音乐开关可重试';
      this.changed();
    });
    this.onVisibility = () => {
      if (!document.hidden && this.started && this.ctx?.state === 'suspended') {
        this.ctx.resume().then(() => this.syncMusic()).catch(() => this.changed());
      }
      this.syncMusic();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  changed() { this.dispatchEvent(new Event('change')); }
  save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ effects: this.enabled, music: this.musicEnabled, volume: this.musicVolume }));
    } catch { /* Audio stays usable when browser storage is unavailable. */ }
    this.changed();
  }
  ensure() {
    this.started = true;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.musicGain = this.ctx.createGain();
        this.musicSource = this.ctx.createMediaElementSource(this.music);
        this.musicSource.connect(this.musicGain).connect(this.ctx.destination);
      }
    }
    this.applyVolume();
    if (this.ctx?.state === 'suspended') this.ctx.resume().then(() => this.syncMusic()).catch(() => this.changed());
    this.syncMusic();
  }
  applyVolume() {
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.08);
    else this.music.volume = this.musicVolume;
  }
  syncMusic() {
    if (!this.started || !this.musicEnabled || this.musicVolume === 0 || document.hidden) {
      this.retryAfterPending = false;
      this.music.pause();
      this.changed();
      return;
    }
    if (this.playPending) { this.retryAfterPending = true; return; }
    if (!this.music.paused) return;
    this.playPending = true;
    let interrupted = false;
    this.music.play().then(() => { this.musicError = ''; }).catch((error) => {
      interrupted = error.name === 'AbortError';
      if (!interrupted) this.musicError = error.name === 'NotAllowedError' ? '轻触页面后播放' : '音乐暂不可用，点击音乐开关可重试';
    }).finally(() => {
      this.playPending = false;
      const retry = this.retryAfterPending;
      this.retryAfterPending = false;
      // A rapid mute/unmute can abort the outstanding play() promise. Only
      // retry if a newer user request arrived; autoplay/decode failures don't loop.
      if (!this.musicEnabled || !this.musicVolume || document.hidden) this.music.pause();
      else if (interrupted && retry && this.music.paused) this.syncMusic();
      this.changed();
    });
  }
  setMusicEnabled(value) {
    this.musicEnabled = !!value;
    if (value && this.music.error) { this.musicError = ''; this.music.load(); }
    this.syncMusic();
    this.save();
  }
  setEffectsEnabled(value) { this.enabled = !!value; this.save(); }
  setMusicVolume(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.musicVolume = Math.max(0, Math.min(1, n));
    this.applyVolume();
    this.syncMusic();
    this.save();
  }
  get musicStatus() {
    if (!this.musicEnabled) return '背景音乐已关闭';
    if (!this.musicVolume) return '背景音乐音量为零';
    if (document.hidden) return '切到后台，已暂停';
    if (this.musicError) return this.musicError;
    if (!this.started) return '首次点击后播放';
    return this.music.paused ? '准备播放' : '正在播放 · 街角的慢时光';
  }
  play(kind) {
    if (!this.enabled || !this.ctx || document.hidden) return;
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
      o.onended = () => { o.disconnect(); g.disconnect(); };
    });
  }
}
