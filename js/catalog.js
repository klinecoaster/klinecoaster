// catalog.js — 股票 / 加密貨幣「關卡」目錄
// 每支標的 = 一個固定 seed → 軌道(轉彎/起伏/天色)對所有玩家完全相同 → 排行才公平。
// 單位是「天」(每根日K=1天)。之後把 dataUrl 指向真實歷史日K JSON 即可換成真資料。

import { generateKline, loadJSON } from './data.js?v=14';
import { fetchCrypto, fetchStock } from './fetchdata.js?v=14';

// 軌道長度 = 標的的歷史天數（每根日K=1天）。真實資料用檔案多長就多長；
// 暫代資料則依各標的「上市以來的大約天數」生成多年份 → 撐久才難、排行才有挑戰。
// MAX_DAYS 為效能上限（取最近這麼多天），避免幾十年老股太肥。
export const MAX_DAYS = 4000;

export const CATALOG = [
  { id: 'BTC',  name: 'Bitcoin',     type: 'crypto', icon: '₿',  seed: 73101, vol: 9,  days: 3800 },
  { id: 'ETH',  name: 'Ethereum',    type: 'crypto', icon: 'Ξ',  seed: 20815, vol: 8,  days: 3300 },
  { id: 'DOGE', name: 'Dogecoin',    type: 'crypto', icon: '🐕', seed: 99021, vol: 10, days: 3500 },
  { id: 'SOL',  name: 'Solana',      type: 'crypto', icon: '◎',  seed: 41777, vol: 9,  days: 1700 },
  { id: 'AAPL', name: 'Apple',       type: 'stock',  icon: '🍎', seed: 30412, vol: 5,  days: 4000 },
  { id: 'TSLA', name: 'Tesla',       type: 'stock',  icon: '🚗', seed: 51199, vol: 8,  days: 3600 },
  { id: 'NVDA', name: 'NVIDIA',      type: 'stock',  icon: '🟩', seed: 64203, vol: 7,  days: 4000 },
  { id: '2330', name: '台積電 TSMC',  type: 'stock',  icon: '🏭', seed: 23300, vol: 5,  days: 4000, q: '2330.tw' },
  { id: '0050', name: '元大台灣50',   type: 'stock',  icon: '🇹🇼', seed: 50050, vol: 3,  days: 3800, q: '0050.tw' },

  // ===== 歷史等級的暴漲暴跌挑戰：固定日期區間 → 賽道是「那段真實行情」，永不改變、對所有人相同 =====
  // 加密貨幣（Binance 直連，現在就能玩真實資料）
  { id: 'BTC2017',  name: '比特幣 2017 泡沫→崩盤', type: 'crypto', icon: '💥', seed: 17017, vol: 10, days: 500, q: 'BTC',    event: '狂熱衝頂後一路腰斬',       start: '2017-08-17', end: '2018-12-31' },
  { id: 'BTC2021',  name: '比特幣 2021 牛熊',      type: 'crypto', icon: '🎢', seed: 21021, vol: 9,  days: 820, q: 'BTC',    event: '兩度衝頂 6.9 萬鎂後墜熊市', start: '2020-10-01', end: '2022-12-31' },
  { id: 'DOGE2021', name: '狗狗幣 2021 登月',      type: 'crypto', icon: '🚀', seed: 42021, vol: 10, days: 365, q: 'DOGE',   event: '一年暴漲百倍再崩落',       start: '2021-01-01', end: '2021-12-31' },
  // 股票 / 指數（需部署後端 /api/quote；未部署會退回示意賽道）
  { id: 'COVID2020', name: '2020 新冠股災',  type: 'stock', icon: '🦠', seed: 20200, vol: 9,  days: 250, q: '^spx',  event: '一個月崩 34% 再 V 轉', start: '2020-01-02', end: '2020-12-31' },
  { id: 'GFC2008',   name: '2008 金融海嘯',  type: 'stock', icon: '🏦', seed: 20080, vol: 9,  days: 440, q: '^spx',  event: '雷曼倒閉、市場腰斬',   start: '2007-10-01', end: '2009-06-30' },
  { id: 'GME2021',   name: 'GameStop 軋空',  type: 'stock', icon: '🎮', seed: 21321, vol: 10, days: 210, q: 'gme.us', event: '散戶逼空、單週飆數倍', start: '2020-09-01', end: '2021-06-30' },
];

export function findSymbol(id) { return CATALOG.find((s) => s.id === id) || null; }

// 由標的產生一份「來源」給 Game.build。
// 優先真實資料：dataUrl > 加密(Binance直連) > 股票(自家代理)；抓不到才退回固定 seed 生成的示意走勢。
export async function sourceFromSymbol(entry) {
  let candles = null;
  const range = (entry.start || entry.end) ? { start: entry.start, end: entry.end } : null;  // 歷史挑戰=固定區間
  try {
    if (entry.dataUrl) candles = await loadJSON(entry.dataUrl);
    else if (entry.type === 'crypto') candles = await fetchCrypto(entry.q || entry.id, entry.days, range);
    else if (entry.type === 'stock') candles = await fetchStock(entry.q || entry.id, range);
  } catch (e) { candles = null; }
  if (candles && candles.length > MAX_DAYS) candles = candles.slice(-MAX_DAYS);
  const real = !!(candles && candles.length);
  if (!real) candles = generateKline({ volatility: entry.vol, seed: entry.seed, n: Math.min(entry.days, MAX_DAYS) });
  return {
    candles,
    meta: { seed: entry.seed, amp: 0.65 + entry.vol * 0.085, label: entry.icon + ' ' + entry.name, symbol: entry.id, ranked: true, real, event: entry.event || null },
  };
}
