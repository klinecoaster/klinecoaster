// game.js — 第一人稱 K 線雲霄飛車引擎（Three.js）
// 收盤價 = 高度(俯仰)，行情波動+隨機 = 左右轉彎，串成 3D 軌道。
// 物理：自走台車馬達 + 重力調變；油門/煞車皆有限、撐久會補給。出軌會翻車。

import * as THREE from 'three';
import { generateKline, parseCSV, normalize, loadJSON, makeRng } from './data.js?v=14';
import { Sound } from './audio.js?v=14';

// ===================================================================
//  CONFIG —— 所有可調參數集中在這，隨時好改
// ===================================================================
export const CONFIG = {
  cart: {
    riderHeight: 2.4,    // 視角離軌道高度
    railHalf: 1.7,       // 兩軌半距
    bankGain: 2.2,       // 過彎傾斜強度（軌道傾多少）
    bankMax: 0.9,        // 最大傾斜角(弧度，~51°)
    bankFollow: 0.3,     // 鏡頭跟著傾的比例(0=鏡頭不傾、軌道斜給你看；1=完全貼軌道看不出斜)
    lookAhead: 9,        // 視線看前方幾單位（小=俯仰靈敏、大=平穩）
    pitchExaggerate: 1.0,// 俯仰放大倍率（1=不放大、最平穩；>1 讓上下坡更誇張）
    railColor: 0xc0c6d0,
    spineColor: 0x3aa0ff,
  },
  track: {
    days: 700,           // 自由練習的天數（標的關卡用各自的完整歷史長度）
    seg: 9,              // 每日的前進步長（越大坡越緩、軌道越長）
    yRange: 210,         // 價格→高度的總範圍（越大起伏越誇張、俯仰越明顯）
    smooth: 0,           // 軌道平滑半徑（0=完全貼合K線收盤；1=去單根雜訊仍貼合）
    sideWall: 18,        // K 線牆側向距離
    pillarStep: 3,       // 每幾日一根支柱
    turnGain: 0.18,      // 行情動能 → 轉彎
    turnRandom: 0.12,    // 隨機轉彎強度（保證不會一直直線）
    turnWave: 0.08,      // 低頻擺動
    maxTurn: 0.26,       // 每步最大轉向（越大彎越急）
    pathSmooth: 2,       // 轉向平滑（讓急彎看得見、煞得住）
    headingClamp: 1.6,   // 總偏航上限（避免掉頭）
  },
  physics: {
    engine: 20,          // 台車馬達基礎推力（弱！坡稍陡爬不上去，要靠油門）
    gravity: 100,        // 重力沿坡（下坡加速、上坡減速）
    drag: 0.40,          // 空氣阻力
    throttleAccel: 80,   // 油門額外出力（上坡靠它）
    brakeDecel: 60,      // 煞車減速度
    boostImpulse: 14,    // 點一下的瞬間加速
    vFloor: 0, vMax: 100,// 可以慢到停 → 上坡沒油門會拋錨
    stallSpeed: 7,       // 速度低於此且在上坡 → 開始拋錨計時
    stallTime: 1.4,      // 拋錨幾秒 → GAME OVER
  },
  throttle: { drainTime: 3.2, rechargeTime: 6.5 },  // 油門能量：滿能量可用幾秒 / 回滿幾秒
  brake:    { heatTime: 2.6, coolTime: 4.5, resume: 0.35 },
  reward:   { every: 30 },   // 每撐過幾天 = 發薪日 → 補滿油門 + 冷卻煞車
  derail:   { lat: 2.0, vert: 7.0, crashDuration: 1.7, measureDs: 26 },  // 出軌門檻(lat=過彎橫向G，越低越容易甩出去) + 翻車秒數 + 曲率取樣基線(越大越只算大彎/大坡、忽略雜訊)
  skyline:  { count: 130, radiusMin: 620, radiusSpan: 260, hMin: 55, hSpan: 200 },
  audio:    { screamG: 2.6 },  // felt G 上穿此值(俯衝/急彎瞬間) → 尖叫
  billboard:{ every: 24, width: 30, height: 17, side: 24, lift: 7 },  // 軌道旁廣告看板
};

// 公平預設快照：排行模式會 resetConfig() 還原，確保同標的所有玩家賽道一致
const DEFAULTS = JSON.parse(JSON.stringify(CONFIG));
export function resetConfig() {
  for (const k of Object.keys(DEFAULTS)) Object.assign(CONFIG[k], JSON.parse(JSON.stringify(DEFAULTS[k])));
}

const UP = new THREE.Vector3(0, 1, 0);

// 隨機背景主題（天空漸層 / 霧 / 光 / 太陽月亮 / 星星 / 雲）
const THEMES = [
  { name: '大晴天', top: 0x2a78d0, mid: 0x6fb2ec, bot: 0xbfe2fa, bg: 0x8ec5f0, fog: 0xc2dcf2, hemiSky: 0xcfe8ff, hemiGround: 0x84946f, hemiInt: 1.4, dir: 0xfff6dc, dirInt: 1.6, stars: 0.0, body: 'sun', bodyColor: 0xfffae6, cloud: 0xffffff, cloudOp: 0.65, ground: 0x556b4a, grid: 0x495c40 },
  { name: '日出', top: 0x18224c, mid: 0xf0a35e, bot: 0x6a4a58, bg: 0x2a2440, fog: 0xcf9070, hemiSky: 0xf0b888, hemiGround: 0x2a2028, hemiInt: 1.15, dir: 0xffd6a0, dirInt: 1.15, stars: 0.2, body: 'sun', bodyColor: 0xffe2a8, cloud: 0xf2c4a4, cloudOp: 0.55, ground: 0x4a3f3a, grid: 0x5c4d44 },
  { name: '陰天', top: 0x8e99a6, mid: 0xaab4be, bot: 0xc3ccd4, bg: 0xafb9c2, fog: 0xb4bdc6, hemiSky: 0xc8d2db, hemiGround: 0x6b6f70, hemiInt: 1.05, dir: 0xc8d0d8, dirInt: 0.45, stars: 0.0, cloud: 0xd7dee4, cloudOp: 0.92, ground: 0x7a828c, grid: 0x69727c },
  { name: '雨天', top: 0x55606c, mid: 0x76818d, bot: 0x8d98a3, bg: 0x6f7a85, fog: 0x76818d, hemiSky: 0x95a0ac, hemiGround: 0x44484c, hemiInt: 1.05, dir: 0xb0bac4, dirInt: 0.55, stars: 0.0, cloud: 0x828c97, cloudOp: 0.9, weather: 'rain', ground: 0x434b54, grid: 0x566069 },
  { name: '下雪天', top: 0x9aabbd, mid: 0xc0cedb, bot: 0xdbe6ef, bg: 0xc6d3de, fog: 0xd2dce4, hemiSky: 0xdfeaf2, hemiGround: 0x96a0a8, hemiInt: 1.2, dir: 0xeef5ff, dirInt: 0.75, stars: 0.0, cloud: 0xeef4f9, cloudOp: 0.82, weather: 'snow', ground: 0xe0e8ef, grid: 0xc4cfd9 },
  { name: '黃昏', top: 0x221a42, mid: 0xe5663c, bot: 0x582d42, bg: 0x3a2440, fog: 0xb05c48, hemiSky: 0xe07e52, hemiGround: 0x281820, hemiInt: 1.0, dir: 0xff9a62, dirInt: 1.05, stars: 0.3, body: 'sun', bodyColor: 0xff8a4a, cloud: 0xd47e5c, cloudOp: 0.5, ground: 0x2a1e2e, grid: 0x46303e },
  { name: '夜晚', top: 0x05070f, mid: 0x16243f, bot: 0x0a1424, bg: 0x070b14, fog: 0x0e1a30, hemiSky: 0x2a3a5e, hemiGround: 0x101018, hemiInt: 1.0, dir: 0x9fb4e0, dirInt: 0.7, stars: 1.0, body: 'moon', bodyColor: 0xeaf0ff, cloud: 0x223049, cloudOp: 0.30, ground: 0x0b1322, grid: 0x243358 },
];

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.sound = new Sound();
    this.state = 'idle';
    this._initThree();
    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this._look = new THREE.Vector3();
    requestAnimationFrame(this._loop);
  }

  _initThree() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.Fog(0x1a2c47, 130, 1150);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);

    this.hemi = new THREE.HemisphereLight(0x9fd0ff, 0x202030, 1.1);
    scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.2);
    this.dir.position.set(40, 120, 30);
    scene.add(this.dir);

    // 漸層天空圓頂（地平線發亮→上方變暗），完全跟隨鏡頭 = 無限遠
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x060912) }, mid: { value: new THREE.Color(0x2a4a6e) }, bot: { value: new THREE.Color(0x0c1626) } },
      vertexShader: 'varying vec3 vp; void main(){ vp=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vp; uniform vec3 top,mid,bot; void main(){ float h=normalize(vp).y; vec3 c=h>0.0?mix(mid,top,clamp(pow(h,0.55),0.0,1.0)):mix(mid,bot,clamp(-h*4.0,0.0,1.0)); gl_FragColor=vec4(c,1.0); }',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // 星空
    const sN = 1200, sg = new THREE.BufferGeometry(), sp = new Float32Array(sN * 3);
    for (let i = 0; i < sN; i++) { sp[i*3]=(Math.random()-0.5)*2400; sp[i*3+1]=Math.random()*900; sp[i*3+2]=(Math.random()-0.5)*2400; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8aa0c0, size: 1.7, sizeAttenuation: true, transparent: true, opacity: 1, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // 太陽/月亮（跟鏡頭全跟隨=無限遠）與雲層（跟水平、會飄、爬升有視差）
    this.skyBodyGroup = new THREE.Group(); this.skyBodyGroup.frustumCulled = false; scene.add(this.skyBodyGroup);
    this.cloudGroup = new THREE.Group(); this.cloudGroup.frustumCulled = false; scene.add(this.cloudGroup);
    this._cloudTex = this._cloudTexture();

    this.trackGroup = new THREE.Group();
    scene.add(this.trackGroup);
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _smooth(arr, r) {
    if (r <= 0) return arr.slice();
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      let s = 0, n = 0;
      for (let j = -r; j <= r; j++) { const k = i + j; if (k >= 0 && k < arr.length) { s += arr[k]; n++; } }
      out.push(s / n);
    }
    return out;
  }

  // 路徑：高度 = 收盤價（俯仰），x/z = 由行情動能 + 隨機 驅動的轉彎
  _buildPath(closes) {
    const Tr = CONFIG.track, rng = this.pathRng;
    let avgMove = 0;
    for (let i = 1; i < closes.length; i++) avgMove += Math.abs(closes[i] - closes[i - 1]);
    avgMove = Math.max(1e-3, avgMove / (closes.length - 1));

    const turns = closes.map((c, i) => {
      const mom = i > 0 ? (closes[i] - closes[i - 1]) / avgMove : 0;
      const t = mom * Tr.turnGain + Math.sin(i * 0.09) * Tr.turnWave + (rng() - 0.5) * 2 * Tr.turnRandom;
      return THREE.MathUtils.clamp(t, -Tr.maxTurn, Tr.maxTurn);
    });
    const sturns = this._smooth(turns, Tr.pathSmooth);

    const pts = [];
    let heading = 0, x = 0, z = 0;
    for (let i = 0; i < closes.length; i++) {
      pts.push(new THREE.Vector3(x, this.priceY(closes[i], i), z));
      heading = THREE.MathUtils.clamp(heading + sturns[i], -Tr.headingClamp, Tr.headingClamp);
      x += Math.sin(heading) * Tr.seg;
      z += -Math.cos(heading) * Tr.seg;
    }
    return pts;
  }

  _frameAt(u) {
    const p = this.curve.getPointAt(u);
    const T = this.curve.getTangentAt(u);
    const B = new THREE.Vector3().crossVectors(T, UP).normalize();
    const N = new THREE.Vector3().crossVectors(B, T).normalize();
    return { p, T, B, N };
  }

  // 傾斜角(banking)：依前方一小段的轉向量決定，過彎越急傾越多（真雲霄飛車的超高設計）
  _rollAt(u) {
    const ds = 16;
    const T = this.curve.getTangentAt(u);
    const Ta = this.curve.getTangentAt(Math.min(u + ds / this.totalLen, 1));
    let dy = Math.atan2(Ta.x, -Ta.z) - Math.atan2(T.x, -T.z);
    if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
    return THREE.MathUtils.clamp(dy * CONFIG.cart.bankGain, -CONFIG.cart.bankMax, CONFIG.cart.bankMax);   // 向右轉(dy>0)→向右斜，傾進彎道
  }

  // 傾斜後的座標基（軌道幾何沿前進軸 T 滾轉 roll）
  _bankedFrame(u) {
    const { p, T, B, N } = this._frameAt(u);
    const roll = this._rollAt(u);
    return { p, T, roll, B: B.applyAxisAngle(T, roll), N: N.applyAxisAngle(T, roll) };
  }

  // ---- 建立一條行情的整個 3D 世界 ----
  build(candles, meta = {}) {
    this.meta = meta;
    this.candles = candles;
    this.pathRng = makeRng((meta.seed ?? 12345) >>> 0);
    this.pathRng();  // 固定消耗一次種子 → 後續軌道序列不受天氣選擇影響(換天氣不會動到賽道)
    // 天氣每次玩隨機(純視覺、不影響物理/排行)；軌道(轉彎/起伏)仍由 seed 固定 → 同標的賽道對所有人一致
    this._pickedTheme = meta.theme || THEMES[Math.floor(Math.random() * THEMES.length)];
    this.trackGroup.clear();

    const Tr = CONFIG.track;
    const n = candles.length;
    const sc = this._smooth(candles.map((k) => k.c), Tr.smooth);
    // 去趨勢：移除整體漲跌，軌道只保留波動起伏（避免一直上坡龜速/陡坡狂飛）
    const slope = (sc[n - 1] - sc[0]) / Math.max(1, n - 1);
    const trend = (i) => sc[0] + slope * i;
    const dHi = [], dLo = [];
    for (let i = 0; i < n; i++) { const t = trend(i); dHi.push(candles[i].h - t); dLo.push(candles[i].l - t); }
    const min = Math.min(...dLo), max = Math.max(...dHi);
    const mid = (min + max) / 2, span = Math.max(1e-3, max - min);
    const amp = meta.amp ?? 1;
    this.yScale = (Tr.yRange * amp) / span;
    this.priceY = (p, i) => (p - trend(i) - mid) * this.yScale;  // 軌道與 K 線牆共用 → 對得齊

    this.smoothClose = sc;
    this.points = this._buildPath(sc);
    this.curve = new THREE.CatmullRomCurve3(this.points, false, 'catmullrom', 0.5);
    this.curve.arcLengthDivisions = Math.min(8000, Math.max(200, n * 2));  // 長軌道需更多取樣才準
    this.totalLen = this.curve.getLength();
    this.n = n;
    this.groundY = -(Tr.yRange * amp) / 2 - 55;

    this._buildRails();
    this._buildTies();
    this._buildPillars();
    this._buildCandles(candles);
    this._buildGround();
    this._buildSkyline();
    this._buildBillboards();
    this._buildFinishSign();
    this._applyTheme(this._pickedTheme);

    // 運動 + 資源狀態
    this.d = 0; this.v = 24; this.maxG = 0;
    this.throttle = false; this.energy = 1;
    this.braking = false; this.heat = 0; this.overheat = false;
    this.nextReward = CONFIG.reward.every;
    this.prevG = 1; this.lastScream = 0; this.stallT = 0; this.rideTime = 0; this.prevV = this.v;
  }

  _buildRails() {
    const M = Math.min(this.n * 3, 6000), RH = CONFIG.cart.railHalf;  // 長軌道封頂管段數，顧效能
    const left = [], right = [];
    for (let k = 0; k <= M; k++) {
      const { p, B } = this._bankedFrame(k / M);   // 傾斜後的側向 → 鋼軌跟著傾
      left.push(p.clone().addScaledVector(B, -RH));
      right.push(p.clone().addScaledVector(B, RH));
    }
    const tube = (arr, color, rad) => {
      const c = new THREE.CatmullRomCurve3(arr, false, 'catmullrom', 0.5);
      const geo = new THREE.TubeGeometry(c, M, rad, 6, false);
      const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35, emissive: new THREE.Color(color).multiplyScalar(0.12) });
      this.trackGroup.add(new THREE.Mesh(geo, mat));
    };
    tube(left, CONFIG.cart.railColor, 0.22);
    tube(right, CONFIG.cart.railColor, 0.22);
    const geo = new THREE.TubeGeometry(this.curve, M, 0.16, 6, false);  // 中央藍脊 = 收盤價線
    this.trackGroup.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: CONFIG.cart.spineColor, emissive: 0x123a66, metalness: 0.4, roughness: 0.4 })));
  }

  _buildTies() {
    const count = Math.floor(this.totalLen / 5), RH = CONFIG.cart.railHalf;
    const geo = new THREE.BoxGeometry(RH * 2 + 0.6, 0.28, 0.7);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.8 }), count);
    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), zAxis = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const { p, B, N } = this._bankedFrame(i / count);   // 枕木跟著傾
      zAxis.crossVectors(B, N);
      const rot = new THREE.Matrix4().makeBasis(B, N, zAxis);
      pos.copy(p).addScaledVector(N, -0.32);
      m.compose(pos, new THREE.Quaternion().setFromRotationMatrix(rot), scl);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.trackGroup.add(inst);
  }

  _buildPillars() {
    const count = Math.floor(this.n / CONFIG.track.pillarStep);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshStandardMaterial({ color: 0x33405e, roughness: 0.9 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const p = this.points[Math.min(this.n - 1, i * CONFIG.track.pillarStep)];
      const h = Math.max(2, p.y - this.groundY);
      pos.set(p.x, (p.y + this.groundY) / 2, p.z); scl.set(1, h, 1);
      m.compose(pos, q, scl); inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.trackGroup.add(inst);
  }

  _buildCandles(candles) {
    const up = [], dn = [];
    candles.forEach((k, i) => (k.c >= k.o ? up : dn).push({ k, i }));
    this._candleSet(up, 0x1fae6a);
    this._candleSet(dn, 0xe3473f);
  }

  _candleSet(list, color) {
    if (!list.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const bodies = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.4, roughness: 0.5 }), list.length);
    const wicks = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.25, roughness: 0.6 }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const bw = CONFIG.track.seg * 0.6, SIDE = CONFIG.track.sideWall;
    list.forEach((x, idx) => {
      const { k, i } = x, p = this.points[i];
      const ip1 = this.points[Math.min(this.n - 1, i + 1)], im1 = this.points[Math.max(0, i - 1)];
      const T = new THREE.Vector3().subVectors(ip1, im1).normalize();
      const B = new THREE.Vector3().crossVectors(T, UP).normalize();
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(B, UP, new THREE.Vector3().crossVectors(B, UP)));
      const yo = this.priceY(k.o, i), yc = this.priceY(k.c, i), yh = this.priceY(k.h, i), yl = this.priceY(k.l, i);
      const base = new THREE.Vector3(p.x, 0, p.z).addScaledVector(B, SIDE);
      const bh = Math.max(0.4, Math.abs(yc - yo));
      pos.set(base.x, (yo + yc) / 2, base.z); scl.set(bw, bh, bw);
      m.compose(pos, q, scl); bodies.setMatrixAt(idx, m);
      const wh = Math.max(0.4, yh - yl);
      pos.set(base.x, (yh + yl) / 2, base.z); scl.set(bw * 0.18, wh, bw * 0.18);
      m.compose(pos, q, scl); wicks.setMatrixAt(idx, m);
    });
    bodies.instanceMatrix.needsUpdate = true; wicks.instanceMatrix.needsUpdate = true;
    this.trackGroup.add(bodies, wicks);
  }

  _buildGround() {
    const cz = -this.n * CONFIG.track.seg / 2;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x0b1322, roughness: 1 }));
    plane.rotation.x = -Math.PI / 2; plane.position.set(0, this.groundY - 0.5, cz);
    this.trackGroup.add(plane);
    const grid = new THREE.GridHelper(5000, 140, 0x243358, 0x172238);
    grid.material.vertexColors = false;   // 改用單一 material.color，方便依主題換色
    grid.material.transparent = true;
    grid.position.set(0, this.groundY, cz);
    this.trackGroup.add(grid);
    this.groundPlane = plane; this.groundGrid = grid;
  }

  _discTexture(hex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const col = new THREE.Color(hex);
    const cs = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const g = x.createRadialGradient(64, 64, 1, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.28, `rgba(${cs},1)`);
    g.addColorStop(0.55, `rgba(${cs},0.5)`); g.addColorStop(1, `rgba(${cs},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  _cloudTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const px = 40 + Math.random() * 176, py = 55 + Math.random() * 45, r = 22 + Math.random() * 34;
      const g = x.createRadialGradient(px, py, 1, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // 雨絲貼圖：細長垂直亮條（寬畫布 + 細線 → 縮放後很細；橫向羽化邊更柔）
  _rainTex() {
    if (this._rainTexCache) return this._rainTexCache;
    const c = document.createElement('canvas'); c.width = 64; c.height = 80;
    const x = c.getContext('2d');
    const vg = x.createLinearGradient(0, 0, 0, 80);   // 上下淡出 → 像一截雨絲
    vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(0.5, 'rgba(214,230,242,0.9)'); vg.addColorStop(1, 'rgba(255,255,255,0)');
    const hg = x.createLinearGradient(30, 0, 34, 0);  // 左右羽化 → 邊緣不硬
    hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, 'rgba(255,255,255,1)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = vg; x.fillRect(30, 0, 4, 80);
    x.globalCompositeOperation = 'destination-in'; x.fillStyle = hg; x.fillRect(28, 0, 8, 80);
    return (this._rainTexCache = new THREE.CanvasTexture(c));
  }
  // 雪花貼圖：柔邊圓點
  _snowTex() {
    if (this._snowTexCache) return this._snowTexCache;
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(16, 16, 16, 0, 7); x.fill();
    return (this._snowTexCache = new THREE.CanvasTexture(c));
  }

  // 雨/雪粒子：環繞鏡頭的盒子裡持續落下並回收
  _buildWeather(type) {
    if (this.weather) { this.scene.remove(this.weather); this.weather.geometry.dispose(); this.weather = null; }
    this.weatherType = type || null;
    if (!type) return;
    const N = type === 'rain' ? 1500 : 1300;
    const BX = 360, BY = 300, BZ = 360; this._wbox = { BX, BY, BZ };
    const pos = new Float32Array(N * 3);
    this._wv = new Float32Array(N);  // 落下速度
    this._wp = new Float32Array(N);  // 飄移相位
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (this.pathRng() - 0.5) * BX;
      pos[i * 3 + 1] = (this.pathRng() - 0.5) * BY;
      pos[i * 3 + 2] = (this.pathRng() - 0.5) * BZ;
      this._wv[i] = type === 'rain' ? 230 + this.pathRng() * 130 : 26 + this.pathRng() * 24;
      this._wp[i] = this.pathRng() * 6.28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: type === 'rain' ? this._rainTex() : this._snowTex(),
      transparent: true, depthWrite: false, fog: false, sizeAttenuation: true,
      size: type === 'rain' ? 24 : 5,
      color: type === 'rain' ? 0xbcd0e0 : 0xffffff,
      opacity: type === 'rain' ? 0.42 : 0.92,
    });
    this.weather = new THREE.Points(geo, mat);
    this.weather.frustumCulled = false;
    this.scene.add(this.weather);
  }
  _updateWeather(dt) {
    if (!this.weather) return;
    const cp = this.camera.position; this.weather.position.set(cp.x, cp.y, cp.z);
    const a = this.weather.geometry.attributes.position.array, { BX, BY } = this._wbox;
    const snow = this.weatherType === 'snow';
    for (let i = 0; i < this._wv.length; i++) {
      a[i * 3 + 1] -= this._wv[i] * dt;
      if (snow) a[i * 3] += Math.sin(a[i * 3 + 1] * 0.04 + this._wp[i]) * 9 * dt;   // 雪花左右飄
      else a[i * 3] -= 36 * dt;                                                      // 雨絲略斜
      if (a[i * 3 + 1] < -BY / 2) { a[i * 3 + 1] += BY; a[i * 3] = (this.pathRng() - 0.5) * BX; }
      if (a[i * 3] < -BX / 2) a[i * 3] += BX; else if (a[i * 3] > BX / 2) a[i * 3] -= BX;
    }
    this.weather.geometry.attributes.position.needsUpdate = true;
  }

  // 套用隨機背景主題
  _applyTheme(t) {
    this.theme = t;
    this.sky.material.uniforms.top.value.setHex(t.top);
    this.sky.material.uniforms.mid.value.setHex(t.mid);
    this.sky.material.uniforms.bot.value.setHex(t.bot);
    this.scene.background.setHex(t.bg);
    if (this.groundPlane) this.groundPlane.material.color.setHex(t.ground ?? 0x0b1322);
    if (this.groundGrid) { this.groundGrid.material.color.setHex(t.grid ?? 0x243358); this.groundGrid.material.opacity = t.grid >= 0xaaaaaa ? 0.35 : 0.8; }
    this.scene.fog.color.setHex(t.fog);
    this.hemi.color.setHex(t.hemiSky); this.hemi.groundColor.setHex(t.hemiGround); this.hemi.intensity = t.hemiInt;
    this.dir.color.setHex(t.dir); this.dir.intensity = t.dirInt;
    this.stars.material.opacity = t.stars; this.stars.visible = t.stars > 0.01;
    // 太陽 / 月亮
    this.skyBodyGroup.clear();
    if (t.body) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._discTexture(t.bodyColor),
        transparent: true, depthWrite: false, fog: false,
        blending: t.body === 'sun' ? THREE.AdditiveBlending : THREE.NormalBlending }));
      sp.position.copy(new THREE.Vector3(0.45, 0.5, -1).normalize()).multiplyScalar(1300);
      const size = t.body === 'sun' ? 280 : 180; sp.scale.set(size, size, 1);
      this.skyBodyGroup.add(sp);
    }
    // 雲
    this.cloudGroup.clear();
    const n = t.cloudOp > 0.05 ? 9 : 0;
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._cloudTex,
        transparent: true, depthWrite: false, fog: true, opacity: t.cloudOp, color: new THREE.Color(t.cloud) }));
      sp.position.set((this.pathRng() - 0.5) * 1500, 190 + this.pathRng() * 230, (this.pathRng() - 0.5) * 1500);
      const s = 200 + this.pathRng() * 240; sp.scale.set(s, s * 0.5, 1);
      sp.userData.vx = 7 + this.pathRng() * 10;
      this.cloudGroup.add(sp);
    }
    // 天氣粒子（雨 / 雪）
    this._buildWeather(t.weather);
  }

  // 天際線（剪影建築）。seed 決定外型 → 未來可由 IP/城市驅動（見 humanpending）。
  _buildSkyline() {
    if (!this.skylineGroup) { this.skylineGroup = new THREE.Group(); this.scene.add(this.skylineGroup); }
    this.skylineGroup.clear();
    const S = CONFIG.skyline, rng = this.pathRng;
    const mat = new THREE.MeshStandardMaterial({ color: 0x0e1830, roughness: 1, emissive: 0x0a1428, emissiveIntensity: 0.45 });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, S.count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let i = 0; i < S.count; i++) {
      const ang = (i / S.count) * Math.PI * 2 + (rng() - 0.5) * 0.04;
      const rad = S.radiusMin + rng() * S.radiusSpan;
      const h = S.hMin + rng() * S.hSpan, w = 28 + rng() * 48;
      pos.set(Math.cos(ang) * rad, this.groundY + h / 2, Math.sin(ang) * rad); scl.set(w, h, w);
      q.setFromAxisAngle(UP, ang); m.compose(pos, q, scl); inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.skylineGroup.add(inst);
  }

  _billboardTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 290;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f6fa'; x.fillRect(0, 0, 512, 290);
    x.strokeStyle = '#c5ccd8'; x.lineWidth = 12; x.strokeRect(10, 10, 492, 270);
    x.fillStyle = '#aab4c4'; x.textAlign = 'center';
    x.font = 'bold 56px sans-serif'; x.fillText('廣告版位', 256, 135);
    x.font = '30px sans-serif'; x.fillText('AD SPACE', 256, 195);
    return new THREE.CanvasTexture(c);
  }

  // 軌道旁白色大型看板（之後 setBillboardImage 可貼廣告圖）
  _buildBillboards() {
    const B = CONFIG.billboard;
    if (!this._bbTex) this._bbTex = this._billboardTex();
    this.billboards = [];
    const boardMat = new THREE.MeshStandardMaterial({ map: this._bbTex, emissive: 0x20262f, emissiveIntensity: 0.3, roughness: 0.9, side: THREE.DoubleSide });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x444c5c, roughness: 0.9 });
    const step = Math.max(B.every, Math.floor(this.n / 55));  // 限制看板總數(~55塊)顧效能
    for (let i = step; i < this.n; i += step) {
      const p = this.points[i];
      const ip1 = this.points[Math.min(this.n - 1, i + 1)], im1 = this.points[Math.max(0, i - 1)];
      const T = new THREE.Vector3().subVectors(ip1, im1).normalize();
      const Bv = new THREE.Vector3().crossVectors(T, UP).normalize();
      const base = new THREE.Vector3(p.x, 0, p.z).addScaledVector(Bv, -B.side);  // 放左側(K線牆在右側)
      const boardY = p.y + B.lift + B.height / 2;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(B.width, B.height), boardMat);
      board.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, UP, Bv));  // 面朝軌道
      board.position.set(base.x, boardY, base.z);
      this.trackGroup.add(board); this.billboards.push(board);
      const postH = boardY - B.height / 2 - this.groundY;
      for (const dx of [-B.width * 0.35, B.width * 0.35]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1.3, postH, 1.3), postMat);
        const pp = base.clone().addScaledVector(T, dx);
        post.position.set(pp.x, this.groundY + postH / 2, pp.z);
        this.trackGroup.add(post);
      }
    }
  }

  _finishSignTex() {
    const c = document.createElement('canvas'); c.width = 640; c.height = 220;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f6fa'; x.fillRect(0, 0, 640, 220);
    // 上方黑白格旗紋
    const sq = 20;
    for (let r = 0; r < 2; r++) for (let i = 0; i < 640 / sq; i++) { x.fillStyle = ((i + r) % 2) ? '#1b2330' : '#e7ebf2'; x.fillRect(i * sq, r * sq, sq, sq); }
    x.fillStyle = '#1b2330'; x.textAlign = 'center';
    x.font = 'bold 60px sans-serif'; x.fillText('終點 FINISH', 320, 130);
    x.fillStyle = '#8a94a6'; x.font = '26px sans-serif'; x.fillText('（這裡之後放標語）', 320, 185);
    return new THREE.CanvasTexture(c);
  }

  // 終點牌：跨在最後一段軌道上方、面向來車。之後 setFinishImage(url) 可換圖。
  _buildFinishSign() {
    const i = this.n - 1, p = this.points[i], im1 = this.points[Math.max(0, i - 2)];
    const T = new THREE.Vector3().subVectors(p, im1).normalize();
    const Bv = new THREE.Vector3().crossVectors(T, UP).normalize();
    const tex = this._finishTex || (this._finishTex = this._finishSignTex());
    const w = 44, h = 15;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0x223044, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    board.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Bv, UP, T.clone().negate()));  // 面向來車
    board.position.set(p.x, p.y + 9 + h / 2, p.z);
    this.trackGroup.add(board); this.finishSign = board;
    const postH = board.position.y - h / 2 - this.groundY;
    for (const dx of [-w * 0.42, w * 0.42]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, postH, 1.4), new THREE.MeshStandardMaterial({ color: 0x444c5c, roughness: 0.9 }));
      const pp = p.clone().addScaledVector(Bv, dx);
      post.position.set(pp.x, this.groundY + postH / 2, pp.z);
      this.trackGroup.add(post);
    }
  }
  setFinishImage(url) {
    new THREE.TextureLoader().load(url, (t) => { if (this.finishSign) { this.finishSign.material = this.finishSign.material.clone(); this.finishSign.material.map = t; this.finishSign.material.needsUpdate = true; } });
  }

  // 未來貼廣告：把所有看板換成同一張圖（或之後做成各別）
  setBillboardImage(url) {
    new THREE.TextureLoader().load(url, (t) => {
      this.billboards.forEach((b) => { b.material = b.material.clone(); b.material.map = t; b.material.emissiveIntensity = 0; b.material.needsUpdate = true; });
    });
  }

  // ---- 控制 ----
  start() { this.sound.init(); this.state = 'running'; this.clock.start(); }
  doBoost() { if (this.state === 'running' && this.energy > 0.05) this.v = Math.min(CONFIG.physics.vMax, this.v + CONFIG.physics.boostImpulse); }
  setThrottle(b) { this.throttle = b; }
  setBrake(b) { this.braking = b; }
  setMuted(m) { this.sound.setMuted(m); }

  // ---- 主迴圈 ----
  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state === 'running' && this.curve) this._step(dt);
    else if (this.state === 'crashing') this._crashStep(dt);
    const cp = this.camera.position;
    if (this.sky) this.sky.position.copy(cp);
    if (this.stars) this.stars.position.copy(cp);
    if (this.skyBodyGroup) this.skyBodyGroup.position.copy(cp);
    if (this.skylineGroup) this.skylineGroup.position.set(cp.x, 0, cp.z);
    if (this.cloudGroup) {
      this.cloudGroup.position.set(cp.x, 0, cp.z);
      for (const c of this.cloudGroup.children) { c.position.x += c.userData.vx * dt; if (c.position.x > 850) c.position.x = -850; }
    }
    this._updateWeather(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _step(dt) {
    const P = CONFIG.physics, Th = CONFIG.throttle, Br = CONFIG.brake;
    const u = THREE.MathUtils.clamp(this.d / this.totalLen, 0, 1);
    const { p, T, B } = this._frameAt(u);

    // 油門能量（有限；放開回充）
    const useThrottle = this.throttle && this.energy > 0.001;
    this.energy = useThrottle
      ? Math.max(0, this.energy - dt / Th.drainTime)
      : Math.min(1, this.energy + dt / Th.rechargeTime);

    // 煞車熱度（有限；過熱鎖死到冷卻過半）
    const canBrake = this.braking && !this.overheat;
    if (canBrake) { this.heat = Math.min(1, this.heat + dt / Br.heatTime); if (this.heat >= 1) this.overheat = true; }
    else { this.heat = Math.max(0, this.heat - dt / Br.coolTime); if (this.overheat && this.heat <= Br.resume) this.overheat = false; }

    // 物理：馬達 + 重力沿坡 − 阻力 (+油門 −煞車)
    let a = P.engine - P.gravity * T.y - P.drag * this.v;
    if (useThrottle) a += P.throttleAccel;
    if (canBrake) a -= P.brakeDecel;
    this.v = THREE.MathUtils.clamp(this.v + a * dt, P.vFloor, P.vMax);
    this.d += this.v * dt;
    this.rideTime += dt;

    // 曲率：短基線(手感/G/尖叫，靈敏) + 長基線(出軌，只算大彎大坡)
    const curv = (dsv) => {
      const Ta = this.curve.getTangentAt(Math.min(u + dsv / this.totalLen, 1));
      let dy = Math.atan2(Ta.x, -Ta.z) - Math.atan2(T.x, -T.z);
      if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
      return { kV: (Ta.y - T.y) / dsv, kH: dy / dsv };
    };
    const c = curv(CONFIG.derail.measureDs);
    const speed01 = THREE.MathUtils.clamp((this.v - P.vFloor) / (P.vMax - P.vFloor), 0, 1);

    // 相機：坐在傾斜的軌道上（up 跟著 banking 滾），沿坡度俯仰
    const rh = CONFIG.cart.riderHeight;
    const upB = UP.clone().applyAxisAngle(T, this._rollAt(u) * CONFIG.cart.bankFollow);   // 鏡頭只跟一部分傾 → 軌道斜給你看
    const aheadPt = this.curve.getPointAt(Math.min(u + CONFIG.cart.lookAhead / this.totalLen, 1));
    this.camera.position.copy(p).addScaledVector(upB, rh);
    // 視線目標同高度偏移 → 俯仰直接跟著坡度；再放大上下落差讓陡坡更有感
    const look = this._look.copy(aheadPt).addScaledVector(UP, rh);
    look.y = this.camera.position.y + (look.y - this.camera.position.y) * CONFIG.cart.pitchExaggerate;

    // G 力與出軌判定（長基線，穩定）
    const v2 = this.v * this.v;
    const latGd = Math.abs(c.kH) * v2 * 0.03;
    const crestGd = c.kV < 0 ? Math.abs(c.kV) * v2 * 0.025 : 0;
    const g = Math.min(6.5, 1 + Math.abs(c.kV) * v2 * 0.025 + Math.abs(c.kH) * v2 * 0.03);
    if (g > this.maxG) this.maxG = g;
    const danger = latGd > CONFIG.derail.lat * 0.72 || crestGd > CONFIG.derail.vert * 0.72;

    if (g > 2.2) { const s = (g - 2.2) * 0.06; this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s; }
    this.camera.up.copy(upB);
    this.camera.lookAt(look);
    this.camera.fov = 70 + speed01 * 22; this.camera.updateProjectionMatrix();

    if (T.y < -0.16 && this.v > 70 && performance.now() - (this.lastWhoosh || 0) > 700) { this.sound.whoosh(Math.min(1, speed01 + 0.3)); this.lastWhoosh = performance.now(); }
    this.sound.setSpeed(speed01);

    // 尖叫：felt G 上穿門檻的瞬間（俯衝、急彎、被甩）→ 嚇到叫；含冷卻避免連叫
    if (g > CONFIG.audio.screamG && this.prevG <= CONFIG.audio.screamG && performance.now() - this.lastScream > 650) {
      this.sound.scream(Math.min(1, (g - CONFIG.audio.screamG) / 2 + 0.45));
      this.lastScream = performance.now();
    }
    this.prevG = g;

    // 速度線：加速(速度增加，不管來源是重力俯衝還是油門)時明顯爆出，中高速也持續保底
    const accel = Math.max(0, (this.v - this.prevV) / dt);
    this.prevV = this.v;
    const rush = THREE.MathUtils.clamp(accel * 0.06 + Math.max(0, speed01 - 0.28) * 1.15, 0, 1);

    const idx = Math.min(this.n - 1, Math.floor(u * (this.n - 1)));
    const days = idx + 1;

    // 撐久補給：每 N 天補滿油門 + 冷卻煞車
    let reward = false;
    if (days >= this.nextReward) { this.nextReward += CONFIG.reward.every; this.energy = 1; this.heat = 0; this.overheat = false; reward = true; }

    this.hud.update({
      price: this.candles[idx].c, idx, days, time: this.rideTime,
      speedKmh: Math.round(this.v * 1.9),
      rush,
      g, maxG: this.maxG, progress: u, speed01,
      energy: this.energy, throttling: useThrottle,
      heat: this.heat, overheat: this.overheat, braking: canBrake,
      danger, reward,
    });

    // 拋錨：上坡速度掉到停擺 → 逼你上坡催油門
    if (this.v < P.stallSpeed && T.y > 0.05) this.stallT += dt; else this.stallT = Math.max(0, this.stallT - dt * 2);

    // 結束判定
    if (latGd > CONFIG.derail.lat || crestGd > CONFIG.derail.vert) this._startCrash(days, T, B);  // 出軌翻車
    else if (this.stallT > P.stallTime) this._end('stall', days);                                  // 拋錨
    else if (u >= 0.999) this._end('finish', days);                                                // 撐到最後
  }

  // 出軌翻車：相機脫離軌道、被甩飛 + 翻滾，落地或時間到 → GAME OVER
  _startCrash(days, T, B) {
    this.state = 'crashing';
    this.crashDays = days; this.crashT = 0;
    this.crashVel = new THREE.Vector3().copy(T).multiplyScalar(this.v * 0.35);
    this.crashVel.y += 18;
    this.crashVel.addScaledVector(B, (this.pathRng() < 0.5 ? -1 : 1) * (16 + Math.random() * 14));
    this.crashAng = new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 7);
    this.sound.setSpeed(0); this.sound.whoosh(1);
    if (this.hud.crashStart) this.hud.crashStart();
  }

  _crashStep(dt) {
    this.crashT += dt;
    this.crashVel.y -= 62 * dt;             // 重力把車往下拉
    this.camera.position.addScaledVector(this.crashVel, dt);
    this.camera.rotateX(this.crashAng.x * dt);   // 翻滾
    this.camera.rotateY(this.crashAng.y * dt);
    this.camera.rotateZ(this.crashAng.z * dt);
    if (this.crashT >= CONFIG.derail.crashDuration || this.camera.position.y <= this.groundY + 1.5) this._end('crash', this.crashDays);
  }

  _end(outcome, days) {   // 'finish' | 'crash' | 'stall'
    this.state = outcome === 'crash' ? 'crashed' : 'finished';
    this.sound.setSpeed(0);
    this.hud.finish({ days, maxG: this.maxG, seed: this.meta.seed, label: this.meta.label,
      outcome, finished: outcome === 'finish', time: this.rideTime });
  }
}

// ---- 工廠：從不同來源取得 candles ----
export const Sources = {
  random(volatility = 5, seed) {
    const s = seed ?? ((Math.random() * 1e9) | 0);
    const amp = 0.65 + volatility * 0.085;
    return { candles: generateKline({ volatility, seed: s, n: CONFIG.track.days }), meta: { seed: s, amp, label: '隨機行情 #' + s } };
  },
  fromCSV(text, label = '自訂 CSV') { return { candles: parseCSV(text), meta: { label } }; },
  fromJSONArray(arr, label = '自訂資料') { return { candles: normalize(arr), meta: { label } }; },
  async sample() { return { candles: await loadJSON('./data/sample.json'), meta: { label: '範例行情（DEMO）' } }; },
};
