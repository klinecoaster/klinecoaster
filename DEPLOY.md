# 零基礎部署教學（Cloudflare Pages）

照著做一次，就能讓全世界玩、加密搜尋生效、股票查詢生效、全球月排行榜開通、月快照快取生效。
全部免費，不需要會寫程式。

---

## 你會得到什麼
- 一個網址（像 `kline-coaster.pages.dev`），任何人點開就能玩
- **加密貨幣**：一上線就能查（BTC/ETH/任意幣）
- **股票**：`/api/quote` 代理自動生效，可查美股、台股
- **全球月排行榜**：跨玩家、每月自動重置
- **月快照快取**：上游資料源一個月只被打一次

---

## A. 開通帳號（一次性，約 3 分鐘）
1. 到 https://dash.cloudflare.com/sign-up 註冊一個免費帳號（用 email 即可）。
2. 登入後左側選單點 **Workers & Pages**。

## B. 上傳遊戲（兩種擇一）

### 方法 1：直接拖資料夾（最簡單，免 Git）
1. **Workers & Pages → Create → Pages → Upload assets**。
2. 專案命名（例 `kline-coaster`）。
3. 把整個 `kline-coaster` 資料夾的內容拖進去上傳。
4. 按 **Deploy**。完成後會給你一個 `*.pages.dev` 網址 → 已經能玩（加密搜尋立即可用）。

### 方法 2：連 GitHub（之後改版自動更新）
1. 把 `kline-coaster` 資料夾推上一個 GitHub repo。
2. **Create → Pages → Connect to Git**，選那個 repo。
3. Build command 留空、輸出目錄填 `/`（根目錄）。Deploy。

> `functions/` 資料夾會被 Cloudflare 自動變成 API（`/api/quote`、`/api/scores`），不用任何設定。

## C. 開兩個「抽屜」(KV) 給排行榜 + 快取（約 2 分鐘）
1. **Workers & Pages → KV → Create a namespace**，建兩個：
   - 一個命名 `kc-leaderboard`
   - 一個命名 `kc-quotes`
2. 回到你的 Pages 專案 → **Settings → Functions → KV namespace bindings → Add binding**，加兩條：
   | Variable name（變數名，要一字不差） | 選的 namespace |
   |---|---|
   | `LEADERBOARD` | kc-leaderboard |
   | `QUOTES` | kc-quotes |
3. 回 **Deployments**，點最新一筆 **Retry deployment / Redeploy** 讓綁定生效。

完成！現在：
- 排行榜變成**全球共用**（不再只存本機）
- 股票查詢有**月快照快取**（上游一個月只被打一次）

> 沒做 C 也能玩：排行榜會自動退回「本機版」、股票查詢每次直接抓（沒快取）。C 只是讓它變全球 + 省上游額度。

## D.（選配）綁自己的網域
Pages 專案 → **Custom domains → Set up a domain**，把你買的網域指過來即可。不綁就用 `*.pages.dev`。

---

## 上線後檢查清單
- [ ] 打開 `*.pages.dev` → 能玩
- [ ] 搜尋框輸入 `BTC` → 出現真實 BTC 賽道（加密免後端）
- [ ] 搜尋框輸入 `AAPL` → 出現真實蘋果賽道（股票代理生效）
- [ ] 玩完送出成績 → 排行榜送出顯示「已送出（全球榜）」（代表 KV 綁好了）

## 注意事項
- **Binance 在部分地區（如美國）會地理封鎖** → 當地玩家加密搜尋可能失敗（會 fallback 示意賽道）。未來可加 CoinGecko 備援。
- **快取更新**：改了遊戲程式後重新部署；若瀏覽器拿到舊檔，強制重新整理（Cmd/Ctrl+Shift+R）。正式版建議對 JS/CSS 加版本號或檔名雜湊。
- **第三方資料授權**：商用展示真實股價前，確認資料來源（Stooq 等）的再散布條款。
- **防作弊**：排行榜目前前端可送假分數，初期可接受，紅了再補伺服器端驗證。
