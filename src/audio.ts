// 全部音效用 WebAudio 实时合成，无需外部音频文件

type SfxName =
  | 'shot_rifle' | 'shot_pistol' | 'shot_awp' | 'shot_empty'
  | 'headshot' | 'hitmarker' | 'kill' | 'death'
  | 'footstep' | 'jump' | 'reload' | 'buy'
  | 'plant' | 'defuse' | 'bomb_beep' | 'bomb_explode'
  | 'round_start' | 'round_win' | 'round_lose' | 'hurt'
  | 'nade_pull' | 'nade_throw' | 'nade_explode' | 'flash_pop' | 'smoke_pop' | 'fire'
  | 'footstep_bot';

class SoundFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.5;
  }

  private noiseBuffer(dur: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const buf = this.ctx.createBuffer(1, Math.max(1, this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private burst(opts: {
    dur: number; filter: number; q?: number; gain: number;
    type?: BiquadFilterType; attack?: number; delay?: number;
  }) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(opts.dur);
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.filter;
    f.Q.value = opts.q ?? 0.8;
    const g = this.ctx.createGain();
    const a = opts.attack ?? 0.001;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(opts.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  private tone(opts: {
    freq: number; endFreq?: number; dur: number; gain: number;
    type?: OscillatorType; delay?: number;
  }) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + opts.dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(opts.gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  play(name: SfxName) {
    switch (name) {
      case 'shot_rifle':
        this.burst({ dur: 0.12, filter: 1900, q: 0.5, gain: 0.5 });
        this.burst({ dur: 0.08, filter: 5200, q: 0.3, gain: 0.2 });
        this.tone({ freq: 160, endFreq: 60, dur: 0.12, gain: 0.25, type: 'sawtooth' });
        break;
      case 'shot_pistol':
        this.burst({ dur: 0.09, filter: 2400, q: 0.6, gain: 0.4 });
        this.tone({ freq: 220, endFreq: 90, dur: 0.09, gain: 0.18, type: 'square' });
        break;
      case 'shot_awp':
        this.burst({ dur: 0.5, filter: 900, q: 0.35, gain: 0.75 });
        this.burst({ dur: 0.18, filter: 3600, q: 0.4, gain: 0.3 });
        this.tone({ freq: 90, endFreq: 35, dur: 0.5, gain: 0.5, type: 'sawtooth' });
        break;
      case 'shot_empty':
        this.tone({ freq: 900, endFreq: 500, dur: 0.05, gain: 0.12, type: 'square' });
        break;
      case 'headshot':
        this.tone({ freq: 1800, endFreq: 2400, dur: 0.12, gain: 0.22, type: 'square' });
        break;
      case 'hitmarker':
        this.tone({ freq: 1200, endFreq: 900, dur: 0.05, gain: 0.1, type: 'square' });
        break;
      case 'kill':
        this.tone({ freq: 700, endFreq: 1100, dur: 0.16, gain: 0.14, type: 'triangle' });
        break;
      case 'death':
        this.tone({ freq: 500, endFreq: 120, dur: 0.4, gain: 0.25, type: 'sawtooth' });
        this.burst({ dur: 0.3, filter: 700, gain: 0.3 });
        break;
      case 'footstep':
        this.burst({ dur: 0.07, filter: 220 + Math.random() * 90, q: 0.7, gain: 0.22 });
        break;
      case 'footstep_bot':
        this.burst({ dur: 0.07, filter: 200 + Math.random() * 70, q: 0.7, gain: 0.12 });
        break;
      case 'jump':
        this.burst({ dur: 0.05, filter: 500, q: 0.5, gain: 0.08 });
        break;
      case 'reload':
        this.burst({ dur: 0.03, filter: 2600, q: 1, gain: 0.12, delay: 0.05 });
        this.burst({ dur: 0.04, filter: 1800, q: 1, gain: 0.14, delay: 0.25 });
        this.burst({ dur: 0.05, filter: 3200, q: 1, gain: 0.16, delay: 0.5 });
        break;
      case 'buy':
        this.tone({ freq: 880, dur: 0.06, gain: 0.1, type: 'triangle' });
        this.tone({ freq: 1320, dur: 0.09, gain: 0.1, type: 'triangle', delay: 0.07 });
        break;
      case 'plant':
        this.tone({ freq: 600, dur: 0.08, gain: 0.1, type: 'square' });
        this.tone({ freq: 900, dur: 0.08, gain: 0.1, type: 'square', delay: 0.14 });
        this.tone({ freq: 1200, dur: 0.1, gain: 0.1, type: 'square', delay: 0.28 });
        break;
      case 'defuse':
        this.tone({ freq: 1200, dur: 0.08, gain: 0.1, type: 'square' });
        this.tone({ freq: 900, dur: 0.08, gain: 0.1, type: 'square', delay: 0.14 });
        this.tone({ freq: 600, dur: 0.1, gain: 0.1, type: 'square', delay: 0.28 });
        break;
      case 'bomb_beep':
        this.tone({ freq: 1500, dur: 0.05, gain: 0.14, type: 'square' });
        break;
      case 'bomb_explode':
        this.burst({ dur: 1.2, filter: 400, q: 0.3, gain: 0.9 });
        this.burst({ dur: 0.6, filter: 120, q: 0.5, gain: 0.7 });
        this.tone({ freq: 60, endFreq: 20, dur: 1.0, gain: 0.7, type: 'sawtooth' });
        break;
      case 'round_start':
        this.tone({ freq: 520, dur: 0.12, gain: 0.12, type: 'triangle' });
        this.tone({ freq: 780, dur: 0.18, gain: 0.12, type: 'triangle', delay: 0.14 });
        break;
      case 'round_win':
        this.tone({ freq: 523, dur: 0.14, gain: 0.14, type: 'triangle' });
        this.tone({ freq: 659, dur: 0.14, gain: 0.14, type: 'triangle', delay: 0.13 });
        this.tone({ freq: 784, dur: 0.28, gain: 0.16, type: 'triangle', delay: 0.26 });
        break;
      case 'round_lose':
        this.tone({ freq: 330, dur: 0.2, gain: 0.12, type: 'sawtooth' });
        this.tone({ freq: 247, dur: 0.3, gain: 0.12, type: 'sawtooth', delay: 0.2 });
        break;
      case 'hurt':
        this.tone({ freq: 200, endFreq: 80, dur: 0.15, gain: 0.3, type: 'sawtooth' });
        break;
      case 'nade_pull':
        this.tone({ freq: 1400, endFreq: 900, dur: 0.1, gain: 0.12, type: 'square' });
        break;
      case 'nade_throw':
        this.burst({ dur: 0.22, filter: 900, q: 0.6, gain: 0.22 });
        break;
      case 'nade_explode':
        this.burst({ dur: 0.7, filter: 350, q: 0.3, gain: 0.8 });
        this.burst({ dur: 0.35, filter: 90, q: 0.4, gain: 0.6 });
        this.tone({ freq: 70, endFreq: 25, dur: 0.6, gain: 0.55, type: 'sawtooth' });
        break;
      case 'flash_pop':
        this.burst({ dur: 0.35, filter: 2600, q: 0.8, gain: 0.5 });
        this.tone({ freq: 900, endFreq: 2200, dur: 0.25, gain: 0.18, type: 'square' });
        break;
      case 'smoke_pop':
        this.burst({ dur: 0.9, filter: 1800, q: 0.4, gain: 0.25 });
        this.burst({ dur: 1.4, filter: 700, q: 0.5, gain: 0.18, delay: 0.1 });
        break;
      case 'fire':
        this.burst({ dur: 0.5, filter: 500, q: 0.5, gain: 0.22 });
        this.burst({ dur: 0.6, filter: 120, q: 0.6, gain: 0.18, delay: 0.2 });
        break;
    }
  }
}

export const sfx = new SoundFX();
