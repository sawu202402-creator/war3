export type BgmMode = 'off' | 'hub' | 'combat' | 'boss';

const SFX_MUTE_KEY = 'war3_sfx_muted_v1';
const BGM_MUTE_KEY = 'war3_bgm_muted_v1';

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class SoundFXManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private bgmBus: GainNode | null = null;

  private userMuted = false;
  private musicMuted = false;
  private tabHidden = false;

  private bgmMode: BgmMode = 'off';
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private nextNoteTime = 0;

  private lastSlashAt = 0;
  private lastGoldAt = 0;
  private lastHitAt = 0;
  private lastWarnAt = 0;

  constructor() {
    try {
      this.userMuted = localStorage.getItem(SFX_MUTE_KEY) === '1';
      this.musicMuted = localStorage.getItem(BGM_MUTE_KEY) === '1';
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      const unlock = () => this.unlockAudio();
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
      document.addEventListener('visibilitychange', () => {
        this.tabHidden = document.hidden;
        this.syncBgmGain();
      });
    }
  }

  public isSfxMuted(): boolean {
    return this.userMuted;
  }

  public isBgmMuted(): boolean {
    return this.musicMuted;
  }

  public setSfxMuted(m: boolean): void {
    this.userMuted = m;
    try {
      localStorage.setItem(SFX_MUTE_KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
    this.syncBgmGain();
  }

  public setBgmMuted(m: boolean): void {
    this.musicMuted = m;
    try {
      localStorage.setItem(BGM_MUTE_KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
    this.syncBgmGain();
    if (!m) this.ensureBgmLoop();
  }

  public unlockAudio(): void {
    if (this.tabHidden) return;
    if (!this.ctx) this.initCtx();
    if (this.ctx && (this.ctx.state === 'suspended' || (this.ctx.state as string) === 'interrupted')) {
      this.ctx.resume().catch(() => {});
    }
    this.syncBgmGain();
    this.ensureBgmLoop();
  }

  private initCtx(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        try {
          this.ctx = new AudioCtor();
          const len = Math.floor(this.ctx.sampleRate * 0.3);
          const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
          this.noiseBuffer = buf;

          this.bgmBus = this.ctx.createGain();
          this.bgmBus.gain.value = this.isBgmBlocked() ? 0 : 0.075;
          this.bgmBus.connect(this.ctx.destination);
        } catch {
          this.ctx = null;
        }
      }
    }
    return this.ctx;
  }

  private ensureCtx(): AudioContext | null {
    if (this.userMuted || this.tabHidden) return null;
    const ctx = this.initCtx();
    if (!ctx) return null;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  private isBgmBlocked(): boolean {
    return this.tabHidden || this.userMuted || this.musicMuted || this.bgmMode === 'off';
  }

  private syncBgmGain(): void {
    if (!this.ctx || !this.bgmBus) return;
    this.bgmBus.gain.setTargetAtTime(this.isBgmBlocked() ? 0 : 0.075, this.ctx.currentTime, 0.08);
  }

  public setBgmMode(mode: BgmMode): void {
    if (this.bgmMode === mode) return;
    this.bgmMode = mode;
    this.bgmStep = 0;
    this.syncBgmGain();
    this.ensureBgmLoop();
  }

  private ensureBgmLoop(): void {
    if (this.isBgmBlocked()) {
      if (this.bgmTimer !== null) {
        window.clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }
      return;
    }
    const ctx = this.initCtx();
    if (!ctx) return;
    if (this.bgmTimer !== null) return;
    this.nextNoteTime = ctx.currentTime + 0.05;
    this.bgmTimer = window.setInterval(() => {
      if (!this.ctx || !this.bgmBus || this.isBgmBlocked()) return;
      const now = this.ctx.currentTime;
      while (this.nextNoteTime < now + 0.16) {
        this.scheduleBgmStep(this.nextNoteTime, this.bgmStep);
        const stepDur = this.bgmMode === 'boss' ? 0.17 : this.bgmMode === 'combat' ? 0.21 : 0.34;
        this.nextNoteTime += stepDur;
        this.bgmStep = (this.bgmStep + 1) % 32;
      }
    }, 65);
  }

  private scheduleBgmStep(t: number, step: number): void {
    if (!this.ctx || !this.bgmBus) return;
    // D Minor / Phrygian epic medieval War3 feel
    const hubBass = [38, 0, 45, 0, 41, 0, 43, 0, 38, 0, 45, 0, 46, 0, 45, 0];
    const hubLead = [62, 0, 69, 67, 65, 0, 64, 0, 62, 65, 69, 0, 70, 69, 67, 64];

    const combatBass = [38, 38, 50, 38, 41, 41, 53, 41, 43, 43, 55, 43, 45, 45, 57, 45];
    const combatLead = [62, 0, 65, 69, 70, 0, 69, 65, 67, 0, 70, 72, 69, 0, 64, 0];

    const bossBass = [38, 50, 38, 50, 39, 51, 39, 51, 41, 53, 41, 53, 43, 55, 45, 57];
    const bossLead = [62, 65, 69, 70, 69, 65, 64, 62, 63, 67, 70, 74, 72, 70, 69, 64];

    const idx = step % 16;
    const bassNote =
      this.bgmMode === 'boss' ? bossBass[idx] : this.bgmMode === 'combat' ? combatBass[idx] : hubBass[idx];
    const leadNote =
      this.bgmMode === 'boss' ? bossLead[idx] : this.bgmMode === 'combat' ? combatLead[idx] : hubLead[idx];

    if (bassNote > 0) {
      this.playTone(t, midiToFreq(bassNote), 'sawtooth', 0.2, 0.28, 320);
    }
    if (leadNote > 0 && (this.bgmMode !== 'hub' || step % 2 === 0)) {
      this.playTone(t, midiToFreq(leadNote), 'triangle', 0.16, 0.16, 1600);
    }
  }

  private playTone(
    t: number,
    freq: number,
    type: OscillatorType,
    dur: number,
    vol: number,
    filterHz = 1200
  ): void {
    if (!this.ctx || !this.bgmBus) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterHz, t);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.bgmBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private oneShotTone(
    freqStart: number,
    freqEnd: number,
    type: OscillatorType,
    dur: number,
    vol: number
  ): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private oneShotNoise(dur: number, filterFreq: number, filterType: BiquadFilterType, vol: number): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  public playSwordSlash(): void {
    const now = performance.now();
    if (now - this.lastSlashAt < 70) return;
    this.lastSlashAt = now;
    this.oneShotNoise(0.09, 1700, 'bandpass', 0.11);
    this.oneShotTone(340, 110, 'triangle', 0.08, 0.08);
  }

  public playBowShot(): void {
    const now = performance.now();
    if (now - this.lastSlashAt < 70) return;
    this.lastSlashAt = now;
    this.oneShotTone(620, 220, 'triangle', 0.09, 0.08);
    this.oneShotNoise(0.05, 2400, 'highpass', 0.06);
  }

  public playMagicCast(): void {
    this.oneShotTone(480, 960, 'sine', 0.16, 0.09);
    this.oneShotTone(260, 520, 'triangle', 0.18, 0.06);
  }

  public playFrostShatter(): void {
    this.oneShotNoise(0.16, 3200, 'highpass', 0.11);
    this.oneShotTone(980, 420, 'sine', 0.15, 0.08);
  }

  public playHolyChime(): void {
    this.oneShotTone(523.25, 783.99, 'sine', 0.25, 0.09);
    this.oneShotTone(659.25, 1046.5, 'triangle', 0.28, 0.07);
  }

  public playCritHit(): void {
    const now = performance.now();
    if (now - this.lastHitAt < 65) return;
    this.lastHitAt = now;
    this.oneShotTone(170, 55, 'sawtooth', 0.12, 0.12);
    this.oneShotNoise(0.08, 900, 'lowpass', 0.09);
  }

  public playPotion(): void {
    this.oneShotTone(380, 760, 'sine', 0.18, 0.09);
  }

  public playGold(): void {
    const now = performance.now();
    if (now - this.lastGoldAt < 90) return;
    this.lastGoldAt = now;
    this.oneShotTone(1180, 1560, 'sine', 0.09, 0.06);
  }

  public playSynthesize(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
      setTimeout(() => this.oneShotTone(f, f * 1.02, 'triangle', 0.18, 0.1), idx * 55);
    });
  }

  public playLevelUp(): void {
    [440, 554.37, 659.25, 880].forEach((f, idx) => {
      setTimeout(() => this.oneShotTone(f, f, 'triangle', 0.22, 0.09), idx * 65);
    });
  }

  public playTeleport(): void {
    this.oneShotTone(220, 880, 'sine', 0.22, 0.09);
    this.oneShotNoise(0.14, 1500, 'bandpass', 0.07);
  }

  public playBossHorn(): void {
    this.oneShotTone(110, 98, 'sawtooth', 0.55, 0.14);
    setTimeout(() => this.oneShotTone(146.8, 138, 'sawtooth', 0.65, 0.13), 160);
  }

  public playAthenaWarn(): void {
    const now = performance.now();
    if (now - this.lastWarnAt < 2800) return;
    this.lastWarnAt = now;
    this.oneShotTone(784, 523, 'triangle', 0.2, 0.09);
  }

  public playVictory(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, idx) => {
      setTimeout(() => this.oneShotTone(f, f, 'triangle', 0.35, 0.11), idx * 95);
    });
  }

  public playDefeat(): void {
    [349.23, 311.13, 277.18, 220].forEach((f, idx) => {
      setTimeout(() => this.oneShotTone(f, f * 0.92, 'sawtooth', 0.32, 0.1), idx * 140);
    });
  }
}

export const SoundFX = new SoundFXManager();
