// Cloudflare Pages Function：股票報價代理（瀏覽器擋 CORS，改由伺服器端抓）
// 端點：/api/quote?symbol=AAPL  → 回傳日K陣列 [{o,h,l,c}]
// 資料來源：Stooq CSV（免金鑰）。美股代號自動補 .us；可直接帶完整代號如 aapl.us。
// 注意：再散布第三方資料前請確認其使用條款（見 humanpending）。

const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' },
});

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const sym = (u.searchParams.get('symbol') || '').trim().toLowerCase();
  const end = u.searchParams.get('end') || '';     // 截止日(上月底/事件結束) → 整段固定、可公平排行
  const start = u.searchParams.get('start') || '';  // 起始日(歷史挑戰用)；不給=不限
  if (!sym) return json({ error: 'no symbol' }, 400);
  // 預設美股；4碼以上純數字當台股(.tw)；已帶後綴則照用；指數(^開頭)照用
  const s = sym.includes('.') || sym.startsWith('^') ? sym : (/^\d{4,}$/.test(sym) ? sym + '.tw' : sym + '.us');

  // 月快照 / 事件區間快取：同一支同一段，全世界共用一份，上游只被打一次
  const cacheKey = `q:${s}:${start}:${end}`;
  if (env.QUOTES) {
    const hit = await env.QUOTES.get(cacheKey);
    if (hit) return json(JSON.parse(hit));
  }

  let csv;
  try {
    const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`);
    csv = await r.text();
  } catch (e) { return json({ error: 'fetch failed' }, 502); }
  // CSV: Date,Open,High,Low,Close,Volume
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return json([]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (end && c[0] > end) continue;     // 只取截止日(含)以前
    if (start && c[0] < start) continue; // 只取起始日(含)以後 → 事件區間
    const o = +c[1], h = +c[2], l = +c[3], cl = +c[4];
    if (Number.isFinite(cl)) out.push({ o, h, l, c: cl });
  }
  const result = out.slice(-2000);   // 上限 ~2000 天，顧效能
  // 寫進 KV 快取（保存 ~40 天，足夠跨過當月；下個月 cacheKey 變了自然換新）
  if (env.QUOTES && result.length) {
    try { await env.QUOTES.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 40 }); } catch (e) {}
  }
  return json(result);
}
