# MyShop POS（Hw8 / Week 9）

個人商店（POS）全端 Web 應用，部署於 **Cloudflare Workers**，資料儲存於 **Cloudflare D1（SQLite）**，前端為純靜態 SPA。

線上示範：<https://myshop.w0xie-1201.workers.dev>

## 功能

| 功能 | 說明 |
|------|------|
| 登入 / 註冊 | email + 密碼，密碼以 Web Crypto PBKDF2 雜湊，登入狀態使用 HMAC 簽章 Cookie |
| 開店精靈 | 輸入店名並選擇 4 種模板之一（珍珠奶茶、理髮、雜貨、咖啡），自動建立初始商品 |
| 點單 POS | 點擊商品加入購物車、調整數量、完成交易 |
| 金額防竄改 | 前端只送 `productId`、`qty` 與本地日期，價格與總額一律由後端查 DB 計算 |
| 交易快照 | `order_items` 記錄當下商品名稱與成交單價，商品改價或刪除不影響歷史 |
| 訂單記錄 | 依日期（預設今日）列出當日訂單與明細 |
| 每日結算 | 交易筆數、營業總額、客單價平均、各商品銷售數量與小計 |
| 商品管理 | 新增商品；刪除採軟刪除（`is_deleted = 1`） |

## 系統架構

```text
瀏覽器 SPA (public/)
      │  fetch /api/*
      ▼
Cloudflare Worker (src/worker.js)
      │  env.DB
      ▼
Cloudflare D1 (myshop-db)
```

- 認證：Cookie 內容為 `userId.expiry.hmac`，以 `env.AUTH_SECRET` 做 HMAC-SHA256 簽章。
- 驗證為無狀態：只檢查簽章與到期時間，不查資料庫；需要顯示使用者資料時才查 `users`。
- 靜態資源由 Workers Assets（`env.ASSETS`）提供，`/api/*` 優先交給 Worker。

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | HTML / CSS / Vanilla JavaScript（SPA） |
| 後端 | Cloudflare Workers（ES Module） |
| 資料庫 | Cloudflare D1（SQLite） |
| 認證 | Web Crypto API（PBKDF2、HMAC-SHA256） |

## 專案結構

```text
Hw8(week9)/
├── package.json
├── wrangler.jsonc
├── schema.sql
├── .dev.vars.example
├── src/
│   ├── worker.js       # REST API、認證、D1 查詢
│   └── templates.js    # 四種開店模板與預設商品
└── public/
    ├── index.html      # SPA 外殼
    ├── app.js          # 前端邏輯
    └── style.css       # 樣式
```

## 資料表

- `users`：帳號、PBKDF2 密碼雜湊與 salt
- `shops`：每位使用者一間店（`user_id` UNIQUE）
- `products`：商品，`is_deleted` 作為軟刪除旗標
- `orders`：訂單主檔，含 `shop_id`、`total`、`local_date`
- `order_items`：訂單明細，保存商品名稱與成交單價快照

## API 一覽

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/auth/register` | 註冊並登入 |
| POST | `/api/auth/login` | 登入 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 取得目前使用者與商店 |
| GET | `/api/templates` | 取得開店模板 |
| GET / POST | `/api/shop` | 取得 / 建立商店 |
| GET / POST | `/api/products` | 列出 / 新增商品 |
| DELETE | `/api/products/:id` | 軟刪除商品 |
| GET / POST | `/api/orders` | 依日期查詢 / 建立訂單 |
| GET | `/api/report?date=YYYY-MM-DD` | 每日結算報表 |

## 本機開發

```bash
npm install
cp .dev.vars.example .dev.vars      # Windows: Copy-Item .dev.vars.example .dev.vars
npm run db:init:local
npm run dev
```

開啟 <http://localhost:8787>。本機 D1 會建立在 `.wrangler/` 下。

## 部署到 Cloudflare Workers

```bash
# 1. 安裝依賴
npm install

# 2. 登入 Cloudflare
npx wrangler login

# 3. 建立 D1 資料庫
npx wrangler d1 create myshop-db

# 4. 將輸出的 database_id 填入 wrangler.jsonc 的 REPLACE_WITH_YOUR_D1_DATABASE_ID

# 5. 匯入資料表結構
npx wrangler d1 execute myshop-db --remote --file=schema.sql

# 6. 設定簽章金鑰（輸入 32 字元以上隨機字串）
npx wrangler secret put AUTH_SECRET

# 7. 部署
npx wrangler deploy
```

部署完成後終端機會輸出網址，格式為：

```text
https://myshop.<你的帳號>.workers.dev
```

本專案的實際部署網址為 <https://myshop.w0xie-1201.workers.dev>，已填入根目錄 `README.md` 的 Hw8 欄位。
