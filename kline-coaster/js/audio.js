// audio.js — 純 WebAudio 程序音效，零外部素材（CSP 友善、部署不依賴檔案）。
// 風聲（噪音→低通，音量隨速度）+ 俯衝尖叫（暴跌時觸發的音掃）。

export class Sound {
  constructor() {
    this.ready = false;
    this.muted = false;
  }

  // 必須在使用者手勢（按開始）後呼叫，否則瀏覽器擋自動播放。
  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    this.ac = ac;

    // 風聲：白噪音緩衝 → 低通 → 音量
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600;
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0;
    noise.connect(lp).connect(this.windGain).connect(ac.destination);
    noise.start();
    this.lp = lp;

    this.ready = true;
  }

  // 每幀更新風聲：speed01 = 0..1
  setSpeed(speed01) {
    if (!this.ready || this.muted) return;
    const g = Math.min(0.35, speed01 * 0.4);
    this.windGain.gain.setTargetAtTime(g, this.ac.currentTime, 0.1);
    this.lp.frequency.setTargetAtTime(400 + speed01 * 2200, this.ac.currentTime, 0.1);
  }

  // 俯衝/暴跌觸發的尖叫音掃，intensity 0..1
  whoosh(intensity) {
    if (!this.ready || this.muted) return;
    const ac = this.ac, t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220 + intensity * 200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * intensity + 0.02, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(ac.destination);
    osc.start(t); osc.stop(t + 0.65);
  }

  // 尖叫：兩顆失諧波過帶通 + 顫音；每次隨機化音色/音高/長短 → 像不同人在叫，不會都同一聲
  scream(intensity = 0.7) {
    if (!this.ready || this.muted) return;
    const ac = this.ac, t = ac.currentTime;
    const R = (a, b) => a + Math.random() * (b - a);
    // 隨機參數 → 每次叫聲不同
    const base = R(540, 1020) + intensity * 360;          // 起始音高（有人高有人低）
    const rise = R(1.25, 1.7);                            // 上揚幅度
    const peakAt = R(0.10, 0.22);                         // 多快飆到最高
    const dur = R(0.45, 0.82);                            // 長短
    const vibRate = R(7, 17);                             // 顫音快慢
    const vibDepth = base * R(0.025, 0.09);               // 顫音深淺（抖得兇不兇）
    const detune = R(6, 28);                              // 兩波失諧 → 粗糙度
    const wave = Math.random() < 0.35 ? 'square' : 'sawtooth';  // 偶爾較卡通的叫
    const bpFreq = R(1000, 1850), bpQ = R(4, 9);          // 共振峰 → 不同嗓音

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = bpFreq; bp.Q.value = bpQ;
    const g = ac.createGain(); g.gain.value = 0.0001;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = wave; o2.type = wave; o2.detune.value = detune;
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * rise, t + peakAt);
      o.frequency.linearRampToValueAtTime(base * (0.95 + Math.random() * 0.2), t + dur * 0.9);
    }
    // 顫音
    const lfo = ac.createOscillator(), lfoG = ac.createGain();
    lfo.frequency.value = vibRate; lfoG.gain.value = vibDepth;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
    g.gain.exponentialRampToValueAtTime(0.34 * intensity + 0.12, t + 0.06);   // 夠大聲，蓋過風聲
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 尖叫時短暫壓低風聲(ducking) → 叫聲更突出；之後 setSpeed 會自然回復
    if (this.windGain) { this.windGain.gain.cancelScheduledValues(t); this.windGain.gain.setTargetAtTime(0.04, t, 0.04); }
    o1.connect(bp); o2.connect(bp); bp.connect(g); g.connect(ac.destination);
    o1.start(t); o2.start(t); lfo.start(t);
    o1.stop(t + dur + 0.04); o2.stop(t + dur + 0.04); lfo.stop(t + dur + 0.04);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready && m) this.windGain.gain.value = 0;
  }
}
