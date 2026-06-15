// fetchdata.js — 依使用者輸入的代號即時抓日K
// 加密貨幣：Binance 公開 API（瀏覽器可直連、免金鑰、CORS 開放）。
// 股票：走自家 /api/quote 代理（Cloudflare Pages Function，伺服器端抓 Stooq，避開 CORS）。
// 註：抓的是即時資料、會每天變長 → 適合探索/自由挑戰，不適合做跨時間公平排行。

// 由字串穩定產生 seed（同一代號 → 同一組轉彎，與當下資料無關）
export function strSeed(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 本月賽季的「資料截止＝上個月底」與「月份 key」。整個月固定 → 同月排行公平、跨月自動換新。
export function monthCutoff() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0);   // 本月第0天 = 上月最後一天
  const ms = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
  const pad = (n) => String(n).padStart(2, '0');
  return { ms, dateStr: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    monthKey: `${now.getFullYear()}-${pad(now.getMonth() + 1)}` };
}

// 加密貨幣（Binance 日K，分批抓多年歷史，每批上限1000）。
// range = { start:'YYYY-MM-DD', end:'YYYY-MM-DD' } → 固定歷史區間（歷史挑戰用，整段永不變）；
// 不給 range → 截止到上月底（本月賽季固定）。
export async function fetchCrypto(sym, maxDays = 1500, range = null) {
  const base = sym.toUpperCase().replace(/USDT?$/, '');
  const pair = base + 'USDT';
  const startMs = range && range.start ? Date.parse(range.start + 'T00:00:00Z') : null;
  let endTime = range && range.end ? Date.parse(range.end + 'T23:59:59Z') : monthCutoff().ms;
  const endMs = endTime;
  let all = [];
  const batches = Math.min(8, Math.ceil(maxDays / 1000));
  for (let b = 0; b < batches; b++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&endTime=${endTime}`;
    const r = await fetch(url);
    if (!r.ok) { if (all.length) break; throw new Error('找不到加密貨幣 ' + base); }
    const raw = await r.json();
    if (!Array.isArray(raw) || !raw.length) break;
    all = raw.concat(all);          // 較舊的批次接在前面
    endTime = raw[0][0] - 1;        // 下一批抓更早的
    if (startMs && endTime < startMs) break;  // 已抓到區間起點
    if (raw.length < 1000) break;   // 沒有更早的了
  }
  if (!all.length) throw new Error('找不到加密貨幣 ' + base);
  // Binance kline: [openTime, open, high, low, close, ...]；依區間裁切
  return all
    .filter((k) => (!startMs || k[0] >= startMs) && k[0] <= endMs)
    .map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4] })).filter((d) => Number.isFinite(d.c));
}

// 股票（走自家代理；未部署後端時會丟錯 → 上層 fallback）
// range = { start, end } → 固定歷史區間（歷史挑戰）；不給則 end=上月底（本月賽季固定）。
export async function fetchStock(sym, range = null) {
  const end = range && range.end ? range.end : monthCutoff().dateStr;
  const startQ = range && range.start ? `&start=${range.start}` : '';
  const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}&end=${end}${startQ}`);
  if (!r.ok) throw new Error('股票查詢需要部署後端（' + r.status + '）');
  const d = await r.json();
  if (!Array.isArray(d) || !d.length) throw new Error('找不到股票 ' + sym);
  return d;
}

// 自動：先試加密，失敗再試股票
export async function fetchAuto(sym) {
  try { return { candles: await fetchCrypto(sym), kind: 'crypto' }; }
  catch (e) { return { candles: await fetchStock(sym), kind: 'stock' }; }
}
