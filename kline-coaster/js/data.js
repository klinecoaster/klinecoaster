// data.js — K 線資料來源：程序生成 + 真實資料（CSV / JSON）載入
// 一根 K 線 = { o, h, l, c }（開、高、低、收）。收盤價 c 串起來就是雲霄飛車軌道。

// 確定性亂數（mulberry32），同一個 seed 會生出同一段行情，方便分享關卡。
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 生成一段擬真 K 線：帶趨勢漂移 + 隨機波動 + 偶發暴漲暴跌（製造刺激落差）。
export function generateKline({ n = 320, volatility = 5, seed = (Math.random() * 1e9) | 0 } = {}) {
  const rng = makeRng(seed);
  const out = [];
  let price = 80 + rng() * 60;
  let drift = (rng() - 0.5) * 0.6;
  for (let i = 0; i < n; i++) {
    drift += (rng() - 0.5) * 0.28;
    drift = Math.max(-1.4, Math.min(1.4, drift));
    // 偶發事件：~3% 機率出現一根大棒，模擬利多/利空跳空
    let shock = 0;
    if (rng() < 0.03) shock = (rng() - 0.5) * volatility * 6;
    const o = price;
    const move = drift * volatility * 0.7 + (rng() - 0.5) * volatility * 1.8 + shock;
    let c = Math.max(6, o + move);
    const hi = Math.max(o, c) + rng() * volatility * 0.9;
    const lo = Math.max(1, Math.min(o, c) - rng() * volatility * 0.9);
    out.push({ o, h: hi, l: lo, c });
    price = c;
  }
  return out;
}

// 解析 CSV。容錯：自動偵測表頭，找 open/high/low/close 欄位（不分大小寫）。
// 也支援「只有收盤價」一欄的情況（其餘用收盤價補）。
export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].toLowerCase().split(delim).map((s) => s.trim());
  const hasHeader = header.some((h) => /open|high|low|close|price|收|開|高|低/.test(h));
  const find = (...keys) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  let io = find('open', '開'), ih = find('high', '高'), il = find('low', '低'),
      ic = find('close', 'price', '收');
  const rows = hasHeader ? lines.slice(1) : lines;
  if (!hasHeader) { io = 0; ih = 1; il = 2; ic = 3; } // 假設 o,h,l,c 順序
  const out = [];
  for (const line of rows) {
    const cells = line.split(delim).map((s) => parseFloat(s));
    const c = num(cells[ic]);
    if (c == null) continue;
    const o = num(cells[io]) ?? c, h = num(cells[ih]) ?? Math.max(o, c),
          l = num(cells[il]) ?? Math.min(o, c);
    out.push({ o, h, l, c });
  }
  return out;
}

function num(v) { return Number.isFinite(v) ? v : null; }

// 載入 JSON（陣列：[{o,h,l,c}] 或 [收盤價數字...]）
export async function loadJSON(url) {
  const res = await fetch(url);
  const raw = await res.json();
  return normalize(raw);
}

export function normalize(raw) {
  if (!Array.isArray(raw)) raw = raw.candles || raw.data || [];
  if (!raw.length) return [];
  if (typeof raw[0] === 'number') {
    return raw.map((c) => ({ o: c, h: c, l: c, c }));
  }
  return raw.map((d) => {
    const c = d.c ?? d.close ?? d.Close ?? d.price;
    const o = d.o ?? d.open ?? d.Open ?? c;
    const h = d.h ?? d.high ?? d.High ?? Math.max(o, c);
    const l = d.l ?? d.low ?? d.Low ?? Math.min(o, c);
    return { o: +o, h: +h, l: +l, c: +c };
  }).filter((d) => Number.isFinite(d.c));
}
