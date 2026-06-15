// Cloudflare Pages Function：全球排行榜 API（GET 查詢 / POST 送出）
// 部署步驟（見 README / humanpending）：
//   1. 此檔放在 functions/api/scores.js（Cloudflare Pages 會自動變成 /api/scores 端點）
//   2. 在 Pages 專案建一個 KV namespace，綁定變數名 LEADERBOARD
//   3. 部署後前端 leaderboard.js 會自動改用線上榜
// 注意：這是最小可動版本，未做防作弊（前端可送假分數）。要嚴謹需伺服器端驗證/回放，見 humanpending。

const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
});

// 髒話過濾（伺服器端最終把關，前端可被繞過）。與 leaderboard.js 的清單同步。
const BAD = ['fuck', 'fuk', 'fck', 'shit', 'sht', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole',
  'bastard', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'sex', 'porn',
  '幹你', '幹妳', '操你', '操妳', '草你', '靠北', '靠杯', '幹', '雞掰', '機掰', '雞巴', '雞雞',
  '婊子', '賤人', '賤貨', '王八', '混蛋', '白癡', '智障', '低能', '去死', '媽的', '他媽', '你媽', '妳媽',
  '幹林', '林北', '塞你', '畜生', '廢物', '垃圾人'];
const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };
function cleanName(raw) {
  const n = [...String(raw || '')].filter((ch) => { const c = ch.codePointAt(0); return c >= 0x20 && c !== 0x7f && !(c >= 0x200b && c <= 0x206f) && c !== 0xfeff; }).join('').trim().slice(0, 12);
  if (!n) return '玩家';
  const norm = n.toLowerCase().replace(/[4@31!05$7]/g, (c) => LEET[c]).replace(/[^a-z0-9一-鿿]/g, '');
  for (const w of BAD) { if (norm.includes(w)) return '****'; }
  return n;
}

export async function onRequestGet({ request, env }) {
  const sym = new URL(request.url).searchParams.get('symbol');
  if (!sym || !env.LEADERBOARD) return json([]);
  const data = await env.LEADERBOARD.get('lb:' + sym);
  return json(data ? JSON.parse(data) : []);
}

// 混合排序：完賽者在前(比時間，快者勝)；未完賽者在後(比天數，遠者勝)
function cmp(a, c) {
  const af = !!a.finished, cf = !!c.finished;
  if (af !== cf) return af ? -1 : 1;
  if (af) return (a.time || 1e9) - (c.time || 1e9);
  return (c.days || 0) - (a.days || 0);
}

export async function onRequestPost({ request, env }) {
  if (!env.LEADERBOARD) return json({ error: 'no KV bound' }, 500);
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const sym = String(b.symbol || '').slice(0, 24);
  const name = String(b.name || '匿名').slice(0, 12);
  const days = Math.max(0, Math.min(100000, parseInt(b.days, 10) || 0));
  const finished = !!b.finished;
  const time = Math.max(0, Math.min(360000, +b.time || 0));
  if (!sym) return json({ error: 'no symbol' }, 400);
  const key = 'lb:' + sym;
  const cur = JSON.parse((await env.LEADERBOARD.get(key)) || '[]');
  cur.push({ name, days, finished, time, ts: Date.now() });
  cur.sort(cmp);
  const top = cur.slice(0, 100);
  await env.LEADERBOARD.put(key, JSON.stringify(top));
  return json(top);
}
