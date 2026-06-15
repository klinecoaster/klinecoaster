# Human-Pending — 需要你本人決定 / 提供的項目

遊戲本體已可玩、可部署。以下是「只有你能拍板」的事，不影響其餘功能運作，
標 ⛔ 為對應功能上線前的硬性前置。

## 1. ⛔ 廣告變現（AdSense / 其他聯播網）
- 需要：Google AdSense **發布商 ID（ca-pub-XXXX）**＋網站**審核通過**。
- 審核前提：網站必須**已上線於正式網域**且有足夠原創內容/流量；新站常被退件，可能要先養一陣子。
- 動作：拿到 ID 後，把 `index.html` 兩個廣告版位的 placeholder 換成 `<ins class="adsbygoogle">` 代碼，並在 `<head>` 加聯播網載入 script。
- 替代/補充變現：itch.io 付費、Patreon、遊戲類廣告網（如 Playwire / AdinPlay，對遊戲流量條件較友善）。

## 2. ⛔ 正式網域 + 主機
- 需要：選一個網域名稱 + 部署平台（建議 Cloudflare Pages，免費、快、好接網域）。
- 這同時是第 1 項（廣告審核）的前置。

## 3. 真實股價資料來源（選配，目前用生成器 + 上傳 + 範例頂著）
- 即時/指定股票需要資料 API，多半要**金鑰**，且有 **CORS** 與**再散布授權**限制：
  - 免費額度：Alpha Vantage、Finnhub、Twelve Data（額度小、延遲資料）
  - 台股：FinMind、TWSE/TPEX 公開資料（注意 CORS，可能需自架 proxy）
- 若要「即時」或繞 CORS，需要一個極簡後端 / serverless proxy —— 這會打破「純前端」假設，要你決定是否值得。
- 授權注意：部分付費資料源**禁止公開展示/再散布**，商用前需確認條款。

## 4. 法務 / 合規
- 已加「非投資建議」免責聲明。若放真實個股名稱 + 廣告營利，建議確認：
  - 是否需要更完整的免責 / 使用條款 / 隱私政策（廣告會放 cookie，多數地區需 cookie 同意）。
  - 商標：用真實券商/指數名稱（如 0050、台積電）行銷時的標示分寸。

## 5. 美術 / 品牌（提升留存與分享率，非阻擋項）
- 遊戲名稱、Logo、社群分享縮圖（OG image）、音效是否要換成真實素材。

## 7. ⛔ 線上全球排行榜（跨玩家）
- 目前排行榜是**本地版**（localStorage，每台裝置各自記）。程式已寫好線上版、會自動切換：
  - 後端：`functions/api/scores.js`（Cloudflare Pages Function，已附）。
  - 動作：部署到 Cloudflare Pages 後，建一個 **KV namespace** 綁定變數名 `LEADERBOARD`。前端 `leaderboard.js` 偵測到 `/api/scores` 可用就自動改用全球榜，失敗 fallback 回本地。
- **防作弊**：目前前端可送假分數（最小可動版）。要嚴謹需伺服器端驗證（例如把玩家操作記錄回傳由伺服器重算、或限制提交頻率、加簽章）。上線初期可接受，紅起來再補。

> 部署步驟見 `DEPLOY.md`（零基礎照做）。KV 綁定變數名：排行榜 `LEADERBOARD`、股票快取 `QUOTES`。

## 8. 真實日K資料 + 標的清單
- **加密貨幣已用真實資料**（Binance 直連，BTC/ETH/DOGE/SOL 顯示真實走勢，免後端）。
- **股票**：部署後端後 `/api/quote` 代理自動生效（Stooq，美股/台股）；未部署時退回固定 seed 生成的示意走勢。
- 換真資料：把 `catalog.js` 該標的加 `dataUrl: './data/symbols/BTC.json'`（日K陣列 `[{o,h,l,c}]`，約 320 天）即可，其餘不用改。
- 資料來源（多半要金鑰或注意授權再散布）：股票 Alpha Vantage / Stooq；加密 Binance/CoinGecko 公開 API；台股 FinMind / TWSE。**商用展示前確認各來源的再散布條款。**
- 單位是「天」：每根 = 一個交易日，務必用**日K**。

## 6. 用使用者 IP 生成天際線外型（未來功能）
- 目前天際線已可由 seed 決定外型（`CONFIG.skyline` + `pathRng`），技術上很容易換成「依城市生成」。
- 要做「依使用者所在地」需要：IP 地理定位 API（如 ipapi.co / ipinfo，多半要金鑰、有免費額度）→ 取得城市 → 用城市名當 seed（或接真實城市天際線資料）。
- 注意：抓 IP / 定位屬個資，多數地區需**隱私同意（consent）**與隱私政策；也要處理 API 失敗的 fallback（用隨機 seed）。
- 建議實作：前端打 geolocation API 拿城市字串 → hash 成 seed 傳進 `Game.build` 的 meta → 天際線即依城市變化。純前端可行，但金鑰與同意流程需你定。

---
建議順序：先把遊戲部署上正式網域（第 2 項）→ 同步申請廣告審核（第 1 項）→
期間用生成器/上傳資料營運、衝分享流量 → 通過後填入廣告 ID → 再評估是否投入真實資料 API（第 3 項）。
