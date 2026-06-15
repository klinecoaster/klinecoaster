// leaderboard.js — 排行榜（每支標的一份，依「撐過天數」排序）
// 先用瀏覽器本地儲存(localStorage)，可離線/免費運作。
// 若後端 /api/scores 有部署(Cloudflare Pages Functions + KV)，會自動改用線上全球榜，
// 失敗則無痛 fallback 回本地。

const PREFIX = 'kc_lb_';
const API = '/api/scores';
const NAME_KEY = 'kc_name';

// 本月 key（每月自動換新榜 → 排行每月重置）
export function monthKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
// 把標的 + 月份組成排行 key
export function lbKey(symbol) { return symbol + '|' + monthKey(); }

export function savedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
export function rememberName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }

// 髒話 / 不雅名稱過濾（前端先擋；伺服器 functions/api/scores.js 也要再擋一次，前端可被繞過）
const BAD = [
  // 英文常見髒字（含變體去空白後比對）
  'fuck', 'fuk', 'fck', 'shit', 'sht', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole',
  'bastard', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'sex', 'porn',
  // 中文常見髒字
  '幹你', '幹妳', '操你', '操妳', '草你', '靠北', '靠杯', '幹', '雞掰', '機掰', '雞巴', '雞雞',
  '婊子', '賤人', '賤貨', '王八', '混蛋', '白癡', '智障', '低能', '去死', '媽的', '他媽', '你媽', '妳媽',
  '幹林', '林北', '塞你', '畜生', '廢物', '垃圾人',
];
const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };

// 回傳乾淨名字；命中髒字 → 用 * 遮蔽該段。空白/全遮 → 「玩家」
export function cleanName(raw) {
  let n = [...String(raw || '')].filter((ch) => { const c = ch.codePointAt(0); return c >= 0x20 && c !== 0x7f && !(c >= 0x200b && c <= 0x206f) && c !== 0xfeff; }).join('').trim().slice(0, 12);
  if (!n) return '玩家';
  // 正規化：小寫 + 去 leet + 去非字母數字 → 用來偵測（不影響顯示原字）
  const norm = n.toLowerCase().replace(/[4@31!05$7]/g, (c) => LEET[c]).replace(/[^a-z0-9一-鿿]/g, '');
  let hit = false;
  for (const w of BAD) { if (norm.includes(w)) { hit = true; break; } }
  if (hit) {
    // 直接整個遮蔽，避免部分露出仍不雅
    return '****';
  }
  return n;
}

// 混合排序：完賽者在前(比時間，快者勝)；未完賽者在後(比天數，遠者勝)
export function cmpScore(a, b) {
  const af = !!a.finished, bf = !!b.finished;
  if (af !== bf) return af ? -1 : 1;
  if (af) return (a.time || 1e9) - (b.time || 1e9);
  return (b.days || 0) - (a.days || 0);
}

function localGet(sym) { try { return (JSON.parse(localStorage.getItem(PREFIX + sym)) || []).sort(cmpScore); } catch (e) { return []; } }
function localAdd(sym, entry) {
  const a = localGet(sym); a.push(entry);
  a.sort(cmpScore);
  const top = a.slice(0, 50);
  try { localStorage.setItem(PREFIX + sym, JSON.stringify(top)); } catch (e) {}
  return top;
}

const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

export async function getScores(sym) {
  try {
    const r = await fetch(`${API}?symbol=${encodeURIComponent(sym)}`, { signal: timeout(2500) });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) return d.sort(cmpScore); }
  } catch (e) { /* 後端未部署 → 用本地 */ }
  return localGet(sym);
}

// score = { days, finished, time }
export async function submitScore(sym, name, score) {
  const entry = { name: cleanName(name), days: score.days || 0,
    finished: !!score.finished, time: score.time || 0, ts: Date.now() };
  let online = false;
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: sym, ...entry }), signal: timeout(2500) });
    if (r.ok) online = true;
  } catch (e) { /* fallback */ }
  const localTop = localAdd(sym, entry);  // 一律也存本地備份
  return { top: online ? await getScores(sym) : localTop, online };
}
