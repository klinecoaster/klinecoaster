// main.js — 把引擎、HUD、UI、控制接起來
import { Game, Sources, CONFIG, resetConfig } from './game.js?v=14';
import { CATALOG, sourceFromSymbol, findSymbol } from './catalog.js?v=14';
import { getScores, submitScore, savedName, rememberName, lbKey, monthKey } from './leaderboard.js?v=14';
import { fetchCrypto, fetchStock, strSeed } from './fetchdata.js?v=14';
import { generateKline } from './data.js?v=14';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');

let toastTimer = null;
function showToast() {
  const r = $('reward'); r.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { r.style.display = 'none'; }, 1500);
}
function flashRed() {
  const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}

// ---- 漫畫速度線：隨機粗細＋不規則間距的手繪感；加速時持續重畫，線條會「沸騰」抖動（避免靜止呆板）----
function makeSpeedlines() {
  const sl = $('speedlines'); if (!sl) return;
  const stops = []; let a = 0;
  while (a < 360) {
    const gap = 5 + Math.random() * 13;                    // 間距大、稀疏（不規則）
    const w = 0.3 + Math.random() * Math.random() * 3.6;   // 線寬（多數細、偶爾很粗）
    const op = (0.35 + Math.random() * 0.6).toFixed(2);    // 每條墨色深淺不一
    const s = Math.min(360, a + gap), e = Math.min(360, s + w);
    stops.push(`transparent ${a.toFixed(2)}deg ${s.toFixed(2)}deg`);
    stops.push(`rgba(255,255,255,${op}) ${s.toFixed(2)}deg ${e.toFixed(2)}deg`);
    a = e;
  }
  sl.style.backgroundImage = `conic-gradient(from 0deg at 50% 50%, ${stops.join(',')})`;
}
makeSpeedlines();
// 沸騰節流：只在「有速度線且每隔幾幀」才重畫，省效能又有手繪逐格感
let _boilN = 0;
function boilSpeedlines(visible) {
  if (!visible) { _boilN = 0; return; }
  if ((_boilN++ % 4) === 0) makeSpeedlines();   // 約每 4 幀換一次線 ≈ 每秒 15 格的逐格動畫
}

// ---- 小地圖：畫收盤價折線 + 目前位置 ----
const mapcv = $('mapcv'), mctx = mapcv.getContext('2d');
let mapPath = null;
function buildMap(candles) {
  const w = mapcv.width, h = mapcv.height, pad = 4;
  const cs = candles.map((k) => k.c);
  const mn = Math.min(...cs), mx = Math.max(...cs), sp = Math.max(1e-3, mx - mn);
  mapPath = candles.map((k, i) => [
    pad + (i / (candles.length - 1)) * (w - 2 * pad),
    h - pad - ((k.c - mn) / sp) * (h - 2 * pad),
  ]);
}
function drawMap(progress) {
  if (!mapPath) return;
  const w = mapcv.width, h = mapcv.height;
  mctx.clearRect(0, 0, w, h);
  mctx.strokeStyle = '#3aa0ff'; mctx.lineWidth = 1.5; mctx.beginPath();
  mapPath.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y)));
  mctx.stroke();
  const i = Math.min(mapPath.length - 1, Math.floor(progress * (mapPath.length - 1)));
  const [x, y] = mapPath[i];
  mctx.fillStyle = '#ffcf45'; mctx.beginPath(); mctx.arc(x, y, 3, 0, 7); mctx.fill();
}

// ---- HUD 回呼 ----
const hud = {
  update(s) {
    $('v-price').textContent = s.price >= 1 ? s.price.toFixed(2) : s.price.toPrecision(3);
    $('v-dist').textContent = s.days.toLocaleString();
    $('v-time').textContent = fmtT(s.time);
    $('v-speed').innerHTML = `${s.speedKmh} <small>km/h</small>`;
    $('v-g').innerHTML = `${s.g.toFixed(1)} <small>/ ${s.maxG.toFixed(1)} G</small>`;
    $('v-g').classList.toggle('hot', s.g > 3);
    $('gbar').style.width = Math.min(100, (s.g / 6.5) * 100) + '%';
    $('vignette').style.opacity = (s.speed01 * 0.9).toFixed(2);
    const rush = s.rush || 0;
    const sl = $('speedlines'); if (sl) sl.style.opacity = (rush * 0.95).toFixed(2);
    boilSpeedlines(rush > 0.06);   // 加速時線條逐格重畫 → 沸騰抖動，不再呆板
    const hb = $('heatbar');
    hb.style.width = Math.round(s.heat * 100) + '%';
    hb.classList.toggle('hot', s.heat > 0.7 || s.overheat);
    $('btn-brake').classList.toggle('overheat', s.overheat);
    const eb = $('energybar');
    eb.style.width = Math.round(s.energy * 100) + '%';
    eb.classList.toggle('low', s.energy < 0.25);
    $('btn-boost').classList.toggle('empty', s.energy <= 0.02);
    $('warn').style.display = s.danger ? 'block' : 'none';
    if (s.reward) showToast();
    drawMap(s.progress);
  },
  crashStart() { flashRed(); },
  finish(r) {
    const titles = { finish: '🏁 撐到最後一天！', crash: '💥 出軌！GAME OVER', stall: '🛑 動力不足！GAME OVER' };
    const notes = { finish: '', crash: '彎或坡頂太快沒煞住，翻車飛出軌道。', stall: '上坡沒催油門，動力不足拋錨停擺。' };
    const o = r.outcome || 'finish';
    $('end-title').textContent = titles[o];
    $('r-dist').innerHTML = r.finished ? `${fmtT(r.time)}<small>完賽時間（越快越強）</small>` : `${r.days.toLocaleString()}<small>撐過天數</small>`;
    $('r-g').innerHTML = `${r.maxG.toFixed(1)}<small>最大尖叫 (G)</small>`;
    $('end-label').textContent = (notes[o] || '') + (r.label || '');
    lastResult = r;
    $('hint').style.display = 'none';
    $('warn').style.display = 'none';
    show('end');
    setupLeaderboard(r);
  },
};

const game = new Game(canvas, hud);
let lastResult = null;

// ---- 畫面切換 ----
function show(which) {
  $('start').classList.toggle('hidden', which !== 'start');
  $('end').classList.toggle('hidden', which !== 'end');
  $('mute').style.display = which === 'play' ? 'block' : 'none';
  $('hint').style.display = which === 'play' ? 'block' : 'none';
  $('controls').style.display = which === 'play' ? 'flex' : 'none';
  $('cfg-toggle').style.display = which === 'play' ? 'block' : 'none';
  if (which !== 'play') $('cfg-panel').style.display = 'none';
  $('reward').style.display = 'none';
}

let currentSource = null;
function launch(source) {
  currentSource = source;
  makeSpeedlines();                 // 每場重新隨機速度線紋理
  game.build(source.candles, source.meta);
  buildMap(source.candles);
  show('play');
  game.start();
}

// ---- 標的選單（排行模式：先 resetConfig 確保賽道對所有人一致）----
const fmtT = (s) => { const m = Math.floor(s / 60), x = Math.round(s % 60); return m + ':' + String(x).padStart(2, '0'); };
const scoreText = (e) => (e.finished ? '🏁 ' + fmtT(e.time) : '第 ' + e.days + ' 天');
function bestLocal(sym) {
  try { const a = JSON.parse(localStorage.getItem('kc_lb_' + lbKey(sym))) || []; return a[0] || null; } catch (e) { return null; }
}
function buildCatalog() {
  const el = $('catalog');
  el.innerHTML = CATALOG.map((s) => {
    const best = bestLocal(s.id);
    const tag = s.event ? '🔥 歷史挑戰' : (s.type === 'crypto' ? '加密貨幣' : '股票');
    const sub = s.event ? s.event : `${s.type === 'crypto' ? '加密貨幣' : '股票'} · ${s.days.toLocaleString()} 天`;
    return `<button class="sym${s.event ? ' event' : ''}" data-id="${s.id}"><span class="si">${s.icon}</span>`
      + `<span><span class="sn">${s.name}</span><br><span class="sm">${s.event ? '🔥 ' : ''}${sub}</span></span>`
      + `<span class="sb">${best ? '最佳<br>' + scoreText(best) : ''}</span></button>`;
  }).join('');
  el.querySelectorAll('.sym').forEach((b) => b.addEventListener('click', async () => {
    resetConfig();                         // 排行公平：用預設參數
    launch(await sourceFromSymbol(findSymbol(b.dataset.id)));
  }));
}

// ---- 輸入代號 → 即時抓資料 → 生賽道 ----
async function searchAndPlay() {
  const q = $('q').value.trim().toUpperCase();
  const type = $('qtype').value, msg = $('qmsg');
  if (!q) { msg.textContent = '請先輸入代號'; return; }
  msg.className = ''; msg.textContent = `查詢 ${q} 中…`;
  let candles = null, kind = null, err = null;
  try {
    if (type === 'crypto') { candles = await fetchCrypto(q); kind = 'crypto'; }
    else if (type === 'stock') { candles = await fetchStock(q); kind = 'stock'; }
    else { try { candles = await fetchCrypto(q); kind = 'crypto'; } catch (e) { candles = await fetchStock(q); kind = 'stock'; } }
  } catch (e) { err = e; }

  if (candles && candles.length) {
    resetConfig();
    msg.textContent = '';
    launch({ candles, meta: { seed: strSeed(kind + ':' + q), amp: 1,
      label: (kind === 'crypto' ? '🪙 ' : '📈 ') + q, symbol: kind.toUpperCase() + ':' + q } });
    return;
  }
  // 失敗 → 提供用代號生成示意賽道（離線/被擋也能玩）
  msg.className = 'err';
  msg.innerHTML = `查不到 ${q}（${err ? err.message : '無資料'}）。`
    + `<button class="linkbtn" id="qgen">用代號生成示意賽道 →</button>`;
  $('qgen').onclick = () => {
    resetConfig();
    const seed = strSeed(q);
    launch({ candles: generateKline({ volatility: 7, seed, n: 1200 }),
      meta: { seed, amp: 1.2, label: '🎲 ' + q + '（示意）', symbol: 'GEN:' + q } });
  };
}

// ---- 排行榜畫面 ----
async function setupLeaderboard(r) {
  const box = $('lb-box'), sym = currentSource?.meta?.symbol;
  if (!sym) { box.style.display = 'none'; return; }
  const key = lbKey(sym);   // 標的 + 本月 → 每月自動重置
  box.style.display = 'block';
  $('lb-title').textContent = `🏆 本月排行（${monthKey()}，每月重置）`;
  $('lb-name').value = savedName();
  const send = $('lb-send');
  send.disabled = false; send.textContent = '送出成績';
  send.onclick = async () => {
    const name = $('lb-name').value.trim() || '匿名';
    rememberName(name); send.disabled = true; send.textContent = '送出中…';
    const score = { days: r.days, finished: r.finished, time: r.time };
    const { top, online } = await submitScore(key, name, score);
    send.textContent = online ? '已送出（全球榜）' : '已記錄（本地）';
    renderLb(top, { name, ...score });
  };
  renderLb(await getScores(key), null);
}
function renderLb(list, me) {
  $('lb-list').innerHTML = (list || []).slice(0, 20).map((e) => {
    const isMe = me && e.name === me.name && !!e.finished === !!me.finished
      && (e.finished ? Math.abs((e.time || 0) - (me.time || 0)) < 0.05 : e.days === me.days);
    return `<li class="${isMe ? 'me' : ''}"><span class="nm">${escapeHtml(e.name)}</span><span class="dy">${scoreText(e)}</span></li>`;
  }).join('') || '<li><span class="nm" style="color:var(--muted)">還沒有紀錄，當第一個！</span></li>';
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- 控制 ----
// 點畫面 = 瞬間加速一下（適合手機隨手點）
canvas.addEventListener('pointerdown', () => game.doBoost());

// 油門鈕（按住持續加速）
const thrOn = (e) => { e.preventDefault(); e.stopPropagation(); game.setThrottle(true); game.doBoost(); };
const thrOff = () => game.setThrottle(false);
const thrBtn = $('btn-boost');
thrBtn.addEventListener('pointerdown', thrOn);
thrBtn.addEventListener('pointerup', thrOff);
thrBtn.addEventListener('pointerleave', thrOff);
thrBtn.addEventListener('pointercancel', thrOff);

// 煞車鈕（按住才煞，會過熱）
const brakeOn = (e) => { e.preventDefault(); e.stopPropagation(); game.setBrake(true); };
const brakeOff = () => game.setBrake(false);
const brakeBtn = $('btn-brake');
brakeBtn.addEventListener('pointerdown', brakeOn);
brakeBtn.addEventListener('pointerup', brakeOff);
brakeBtn.addEventListener('pointerleave', brakeOff);
brakeBtn.addEventListener('pointercancel', brakeOff);

// 鍵盤：空白鍵 / ↑ = 油門（加速）；↓ / B = 煞車
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); game.setThrottle(true); }
  if (e.code === 'ArrowDown' || e.code === 'KeyB') { e.preventDefault(); game.setBrake(true); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') game.setThrottle(false);
  if (e.code === 'ArrowDown' || e.code === 'KeyB') game.setBrake(false);
});
window.addEventListener('blur', () => { thrOff(); brakeOff(); });

$('qgo').addEventListener('click', searchAndPlay);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchAndPlay(); });

$('vol').addEventListener('input', (e) => ($('volval').textContent = e.target.value));

$('btn-random').addEventListener('click', () => {
  launch(Sources.random(+$('vol').value));
});

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  let src;
  try {
    src = f.name.endsWith('.json')
      ? Sources.fromJSONArray(JSON.parse(text), f.name)
      : Sources.fromCSV(text, f.name);
  } catch (err) { alert('檔案解析失敗：' + err.message); return; }
  if (!src.candles.length) { alert('找不到有效的 K 線資料'); return; }
  launch(src);
});

$('btn-again').addEventListener('click', async () => {
  const sym = currentSource?.meta?.symbol;
  const cat = sym ? findSymbol(sym) : null;
  if (cat) { resetConfig(); launch(await sourceFromSymbol(cat)); }    // 精選關卡：重建同賽道
  else if (currentSource) { resetConfig(); launch(currentSource); }   // 查詢/示意/自訂：重玩同資料
  else launch(Sources.random(+$('vol').value));
});
$('btn-menu').addEventListener('click', () => { buildCatalog(); show('start'); });

$('btn-share').addEventListener('click', async () => {
  if (!lastResult) return;
  const url = new URL(location.href); url.search = '';
  const symRaw = currentSource?.meta?.symbol;
  const cat = symRaw ? findSymbol(symRaw) : null;
  if (cat) url.searchParams.set('symbol', cat.id);            // 精選關卡可分享重現
  else if (lastResult.seed != null) url.searchParams.set('seed', lastResult.seed);
  const o = lastResult.outcome || 'finish';
  const verb = o === 'finish' ? `以 ${fmtT(lastResult.time)} 完賽（${lastResult.days} 天全破）`
    : `撐了 ${lastResult.days} 天就${o === 'stall' ? '拋錨' : '出軌'}`;
  const text = `我在《K 線雲霄飛車》${verb}，最大尖叫 ${lastResult.maxG.toFixed(1)}G！來挑戰同一段行情 👉`;
  try {
    if (navigator.share) await navigator.share({ title: 'K 線雲霄飛車', text, url: url.toString() });
    else { await navigator.clipboard.writeText(`${text} ${url}`); alert('成績連結已複製到剪貼簿！'); }
  } catch (_) { /* 使用者取消分享 */ }
});

let muted = false;
$('mute').addEventListener('click', () => {
  muted = !muted; game.setMuted(muted);
  $('mute').textContent = muted ? '🔇 靜音' : '🔊 音效';
});

// ---- 即時調整面板 ----
// 每列：[參數路徑, 標籤, 最小, 最大, 步進, 說明(調大會怎樣)]
const CFG_SCHEMA = [
  ['物理（即時）', [
    ['physics.gravity', '重力', 0, 150, 1, '坡度對速度的影響。調大→下坡衝更快、上坡更難爬'],
    ['physics.engine', '馬達推力', 0, 60, 1, '不踩油門的基礎自走力。調大→平路自己跑更快、較不會拋錨'],
    ['physics.throttleAccel', '油門出力', 0, 80, 1, '踩油門的加速力。調大→加速更猛、上坡更有力'],
    ['physics.drag', '阻力', 0.1, 1, 0.02, '空氣阻力。調大→更快慢下來、極速更難達到'],
    ['physics.brakeDecel', '煞車力', 0, 140, 1, '踩煞車的減速度。調大→煞得更急'],
    ['physics.vMax', '極速', 60, 220, 5, '速度上限。調大→可跑更快(也更容易超速翻車)'],
  ]],
  ['油門 / 煞車 / 獎勵（即時）', [
    ['throttle.drainTime', '油門可用秒數', 0.5, 10, 0.1, '滿能量能連續催多久。調大→油門更耐用'],
    ['throttle.rechargeTime', '油門回充秒數', 1, 15, 0.5, '放開後回滿要多久。調大→回血更慢'],
    ['brake.heatTime', '煞車過熱秒數', 0.5, 8, 0.1, '連續煞多久會過熱。調大→煞車更耐用'],
    ['brake.coolTime', '煞車冷卻秒數', 1, 10, 0.5, '過熱後冷卻要多久。調大→恢復更慢'],
    ['reward.every', '幾天發薪(補給)', 10, 120, 5, '每幾天補滿油門+煞車。調大→補給更稀少、更難'],
  ]],
  ['相機 / 手感（即時）', [
    ['cart.riderHeight', '視角高度', 1, 6, 0.1, '鏡頭離軌道多高。調大→坐更高、視野更廣'],
    ['cart.pitchExaggerate', '俯仰放大', 0.5, 3, 0.1, '上下坡的俯仰誇張度。調大→俯衝/爬升更暈更刺激(也更抖)'],
    ['cart.lookAhead', '視線前瞻', 4, 40, 1, '鏡頭看前方多遠。調大→更平穩;調小→俯仰更靈敏'],
    ['cart.bankGain', '過彎內傾', 0, 6, 0.1, '過彎時軌道傾斜程度。調大→傾得更兇'],
  ]],
  ['出軌難度 / 音效（即時）', [
    ['derail.lat', '過彎出軌門檻', 2, 12, 0.1, '過彎被甩出去的容忍度。調小→更容易過彎翻車'],
    ['derail.vert', '坡頂出軌門檻', 2, 14, 0.1, '衝過坡頂噴飛的容忍度。調小→更容易坡頂噴飛'],
    ['derail.measureDs', '曲率取樣基線', 6, 50, 1, '判定彎/坡的取樣長度。調大→只算大彎大坡、忽略小抖動'],
    ['audio.screamG', '尖叫門檻(G)', 1.5, 6, 0.1, '幾G開始尖叫。調小→更常聽到尖叫'],
  ]],
  ['賽道 / 天際線（需按重建）', [
    ['track.yRange', '起伏高度', 40, 260, 5, '整條軌道的上下範圍。調大→坡更陡、起伏更誇張'],
    ['track.seg', '每日步長', 4, 16, 1, '每根K線拉多長。調大→軌道更長、坡更緩'],
    ['track.smooth', '貼合K線(0=完全)', 0, 5, 1, '軌道平滑度。0=完全照K線(較顛簸);調大→更平順但較不貼行情'],
    ['track.turnGain', '轉彎(行情)', 0, 0.3, 0.01, '行情波動轉成轉彎的量。調大→彎更多更急'],
    ['track.turnRandom', '轉彎(隨機)', 0, 0.2, 0.01, '隨機轉彎強度。調大→更蜿蜒、不單調'],
    ['track.days', '練習天數', 100, 4000, 50, '隨機練習的軌道長度。調大→賽道更長'],
    ['skyline.count', '建築數', 0, 300, 10, '背景天際線的建築數量。調大→城市更密'],
    ['skyline.hSpan', '建築高度', 50, 500, 10, '背景建築的高度範圍。調大→高樓更高'],
  ]],
];
const getP = (o, p) => p.split('.').reduce((a, k) => a[k], o);
const setP = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const fmt = (v) => (Number.isInteger(v) ? v : +v.toFixed(2));
let cfgBuilt = false;
function buildCfg() {
  if (cfgBuilt) return; cfgBuilt = true;
  let html = '';
  for (const [title, rows] of CFG_SCHEMA) {
    html += `<h4>${title}</h4>`;
    for (const [path, label, min, max, step, desc] of rows) {
      const val = getP(CONFIG, path);
      html += `<div class="cfg-row"><label>${label}</label><span class="v" id="cv_${path}">${fmt(val)}</span>`
        + `<input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-path="${path}">`
        + (desc ? `<div class="cfg-desc">${desc}</div>` : '') + `</div>`;
    }
  }
  html += `<p class="note">「需按重建」的項目改完按下面套用</p><button id="cfg-rebuild">套用並重建賽道 ↻</button>`;
  $('cfg-panel').innerHTML = html;
  $('cfg-panel').querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => { const p = inp.dataset.path; const v = parseFloat(inp.value); setP(CONFIG, p, v); $('cv_' + p).textContent = fmt(v); });
  });
  $('cfg-rebuild').addEventListener('click', () => {
    if (!currentSource) return;
    if (currentSource.meta && currentSource.meta.seed != null) launch(Sources.random(+$('vol').value, currentSource.meta.seed));
    else launch(currentSource);
  });
}
$('cfg-toggle').addEventListener('click', () => { buildCfg(); const p = $('cfg-panel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; });

// ---- 啟動：建立標的選單 ----
buildCatalog();

// ---- 分享連結帶 symbol / seed 進來：直接準備好同一段行情 ----
const params = new URL(location.href).searchParams;
const symParam = params.get('symbol');
const seedParam = params.get('seed');
if (symParam && findSymbol(symParam)) {
  resetConfig();
  sourceFromSymbol(findSymbol(symParam)).then(launch);   // 朋友分享的標的，直接挑戰排行
} else if (seedParam != null && /^\d+$/.test(seedParam)) {
  $('btn-random').textContent = '🎲 挑戰好友的行情 · 出發';
  $('btn-random').onclick = () => launch(Sources.random(+$('vol').value, +seedParam));
}
