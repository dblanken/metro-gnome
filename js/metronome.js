// Web Audio metronome using a lookahead scheduler so clicks stay sample-accurate
// even when the main thread is busy (see "A Tale of Two Clocks", Chris Wilson).

const LOOKAHEAD_MS = 25;      // how often the scheduler wakes up
const SCHEDULE_AHEAD = 0.12;  // seconds of audio scheduled in advance

export class Metronome {
  constructor({ onBeat } = {}) {
    this.ctx = null;
    this.master = null;
    this.bpm = 120;
    this.beatsPerBar = 4;
    this.beatUnit = 4;
    this.accent = true;
    this.volume = 0.8;
    this.playing = false;
    this.onBeat = onBeat || (() => {});
    this._timer = null;
    this._nextTime = 0;
    this._beat = 0;
    this._pending = [];
  }

  // Must be called from a user gesture the first time (iOS requirement).
  async unlock() {
    if (!this.ctx) {
      // Ask iOS to treat this as media playback so the ring/silent switch
      // doesn't mute the click (Safari 16.4+; ignored elsewhere).
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch { /* not supported */ }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // Play a silent buffer: the most reliable way to fully unlock iOS audio.
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  configure({ bpm, beatsPerBar, beatUnit }) {
    if (bpm) this.bpm = clamp(bpm, 20, 400);
    if (beatsPerBar) this.beatsPerBar = clamp(beatsPerBar, 1, 32);
    if (beatUnit) this.beatUnit = beatUnit;
  }

  async start() {
    await this.unlock();
    if (this.playing) return;
    this.playing = true;
    this._beat = 0;
    this._nextTime = this.ctx.currentTime + 0.06;
    this._timer = setInterval(() => this._schedule(), LOOKAHEAD_MS);
    this._schedule();
    this._raf();
  }

  stop() {
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
    this._pending = [];
    this.onBeat(-1);
  }

  async toggle() {
    if (this.playing) this.stop();
    else await this.start();
    return this.playing;
  }

  // Called when the page becomes visible again; iOS may have suspended audio.
  async resync() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    if (this.playing && this._nextTime < this.ctx.currentTime) {
      this._nextTime = this.ctx.currentTime + 0.06;
    }
  }

  // Seconds per click. BPM is counted in the time signature's beat unit.
  get interval() {
    return 60 / this.bpm;
  }

  _schedule() {
    const ctx = this.ctx;
    while (this._nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      this._click(this._nextTime, this._beat);
      this._pending.push({ time: this._nextTime, beat: this._beat });
      if (this._pending.length > 64) this._pending.shift(); // rAF paused while hidden
      this._nextTime += this.interval;
      this._beat = (this._beat + 1) % this.beatsPerBar;
    }
  }

  _click(time, beat) {
    const ctx = this.ctx;
    const isAccent = this.accent && beat === 0 && this.beatsPerBar > 1;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = isAccent ? 1760 : 1100;
    const peak = isAccent ? 1.0 : 0.6;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(peak, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(env).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  // Fire visual beat callbacks in sync with the audio clock.
  _raf() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    while (this._pending.length && this._pending[0].time <= now) {
      this.onBeat(this._pending.shift().beat);
    }
    requestAnimationFrame(() => this._raf());
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
