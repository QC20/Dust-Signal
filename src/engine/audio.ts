/**
 * Procedural sound: wind, a low drone, geiger clicks, gunfire and radio chirps,
 * all synthesised with WebAudio. Nothing is loaded from disk.
 */
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private droneGain!: GainNode;
  private humOsc: OscillatorNode | null = null;
  private humGain!: GainNode;
  muted = false;
  private volume = 0.7;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // wind bed
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    // low drone
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.035;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.connect(this.droneGain).connect(this.master);
    for (const f of [55, 55.35, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 80 ? 0.25 : 0.5;
      o.connect(g).connect(lp);
      o.start();
    }

    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /** Called every frame. */
  update(t: number, storm: number, geigerRate: number, dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    this.windGain.gain.setTargetAtTime(0.035 + storm * 0.22 + gust * 0.03, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(380 + gust * 420 + storm * 500, now, 0.4);
    this.droneGain.gain.setTargetAtTime(0.03 + storm * 0.02, now, 0.5);
    if (geigerRate > 0 && Math.random() < geigerRate * dt) this.click();
  }

  private noise(dur: number, vol: number, type: BiquadFilterType, freq: number, freqEnd = freq, q = 1, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, freqEnd = freq, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  click() {
    this.noise(0.012, 0.35, 'highpass', 2500, 2500, 0.5);
  }
  shot() {
    this.noise(0.22, 0.9, 'lowpass', 4000, 300, 0.8);
    this.tone(120, 0.18, 'sine', 0.7, 38);
    this.noise(0.05, 0.4, 'highpass', 3000, 2000, 0.6);
  }
  empty() {
    this.tone(900, 0.04, 'square', 0.12, 700);
  }
  swing() {
    this.noise(0.18, 0.35, 'bandpass', 600, 2200, 2.5);
  }
  hit() {
    this.noise(0.08, 0.6, 'lowpass', 1200, 200, 1);
    this.tone(180, 0.08, 'square', 0.15, 90);
  }
  kill() {
    this.noise(0.4, 0.5, 'lowpass', 900, 80, 1);
    this.tone(160, 0.35, 'sawtooth', 0.18, 40);
  }
  hurt() {
    this.tone(110, 0.25, 'square', 0.25, 55);
    this.noise(0.12, 0.4, 'lowpass', 700, 150, 1);
  }
  growl(pitch = 1) {
    this.tone(70 * pitch, 0.5, 'sawtooth', 0.14, 50 * pitch);
    this.noise(0.4, 0.15, 'bandpass', 300 * pitch, 200 * pitch, 3);
  }
  step(water: boolean) {
    if (water) this.noise(0.12, 0.12, 'bandpass', 900, 400, 2);
    else this.noise(0.05, 0.05, 'lowpass', 600, 300, 1);
  }
  pickup() {
    this.tone(660, 0.09, 'triangle', 0.2);
    this.tone(990, 0.14, 'triangle', 0.2, 990, 0.08);
  }
  radio() {
    this.noise(0.35, 0.18, 'bandpass', 1800, 900, 1.5);
    this.tone(1320, 0.05, 'square', 0.06, 1320, 0.32);
    this.tone(1760, 0.05, 'square', 0.06, 1760, 0.4);
  }
  relayOn() {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.18, f, i * 0.09));
    this.noise(0.9, 0.18, 'bandpass', 2400, 600, 1.2);
  }
  /** Rising hum while a relay or the tower is being worked on. */
  hum(progress: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (progress <= 0) {
      if (this.humOsc) {
        this.humGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        const o = this.humOsc;
        this.humOsc = null;
        o.stop(ctx.currentTime + 0.3);
      }
      return;
    }
    if (!this.humOsc) {
      this.humOsc = ctx.createOscillator();
      this.humOsc.type = 'square';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      this.humOsc.connect(f).connect(this.humGain);
      this.humOsc.start();
    }
    this.humOsc.frequency.setTargetAtTime(110 + progress * 330, ctx.currentTime, 0.05);
    this.humGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.05);
  }
  death() {
    this.tone(220, 1.6, 'sawtooth', 0.25, 30);
    this.noise(1.5, 0.3, 'lowpass', 800, 60, 1);
  }
  win() {
    [262, 330, 392, 523, 659].forEach((f, i) => this.tone(f, 2.2, 'triangle', 0.14, f, i * 0.14));
  }
  ui() {
    this.tone(1200, 0.04, 'square', 0.06);
  }
}
