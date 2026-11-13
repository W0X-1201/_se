# @xie00000/myshop-pos

MyShop POS 的核心邏輯，包裝成可在 Node.js 直接引用的 npm 套件。
原本是一個部署在 **Cloudflare Workers + Cloudflare D1** 的個人商店 POS 全端應用，現在把
API 處理函式、開店模板、驗證工具與登入簽章邏輯乾淨地匯出，讓其他專案也能重用。

- 線上體驗（上週已部署）：<https://myshop.w0xie-1201.workers.dev>
- 版本：`1.0.0`
- 授權：MIT
- 執行環境：Node.js 18+（需要全域 `fetch`、`Request`、`Response` 與 Web Crypto）

## 功能

| 功能 | 說明 |
|------|------|
| 開店模板 | 內建珍珠奶茶、理髮、雜貨、咖啡四種店型與預設商品 |
| 認證邏輯 | PBKDF2-SHA256 密碼雜湊、HMAC-SHA256 無狀態 Session 簽章 |
| API 路由 | `handleApi()` 處理註冊、登入、商店、商品、訂單、報表等 REST 端點 |
| 金額防竄改 | 前端只送 `productId`、`qty`，價格與總額一律由後端查 DB 計算 |
| 交易快照 | 訂單明細保存當下商品名稱與成交單價 |
| 驗證工具 | Email、日期、整數等輸入驗證函式 |
| Worker Handler | 可直接用 `worker.fetch(request, env)` 掛在任何 Fetch API 相容的執行環境 |

## 安裝

```bash
npm install @xie00000/myshop-pos
```

## Node.js 使用範例

### 1. 讀取開店模板

```js
import { listTemplates, getTemplate } from "@xie00000/myshop-pos";

console.log(listTemplates().map((template) => template.label));
// [ '珍珠奶茶', '理髮', '雜貨', '咖啡' ]

const coffee = getTemplate("coffee");
console.log(coffee.products);
// [{ name: '美式咖啡', price: 55 }, ...]
```

### 2. 使用驗證工具

```js
import {
  isValidEmail,
  isValidDate,
  parseIntStrict,
} from "@xie00000/myshop-pos";

isValidEmail("student@nqu.edu.tw"); // true
isValidDate("2024-02-29");          // true
parseIntStrict("12");               // 12
parseIntStrict("1.5");              // null
```

### 3. 密碼雜湊與 Session 簽章

```js
import {
  randomHex,
  hashPassword,
  signSession,
  verifySession,
} from "@xie00000/myshop-pos";

const secret = process.env.AUTH_SECRET; // 長度至少 16 字元
const salt = randomHex(16);

const passwordHash = await hashPassword("hunter22", salt);
console.log(passwordHash); // 64 字元十六進位

const token = await signSession(1, secret);
const session = await verifySession(token, secret);
console.log(session); // { userId: 1 }
```

### 4. 掛載完整 Worker / API

```js
import worker, { handleApi } from "@xie00000/myshop-pos";

const env = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  DB: d1Binding,                       // Cloudflare D1 binding（或相容物件）
  ASSETS: { fetch: () => new Response("static") },
};

// 方式一：使用預設 Worker handler
const response = await worker.fetch(
  new Request("https://example.com/api/templates"),
  env
);
console.log(await response.json());

// 方式二：只呼叫 API 路由器
const apiResponse = await handleApi(
  new Request("https://example.com/api/templates"),
  env
);
```

> 注意：`/api/*` 以外需要 `env.ASSETS`；註冊、商店、商品、訂單、報表等端點需要
> `env.DB`（Cloudflare D1 或提供 `prepare` / `bind` / `first` / `all` / `run` / `batch`
> 的相容物件）。只使用模板、驗證或簽章函式時不需要 D1。

## 匯出的 API

| 匯出項目 | 說明 |
|----------|------|
| `worker`（default） | Cloudflare Worker `{ fetch(request, env) }` |
| `handleApi(request, env)` | 處理所有 `/api/*` 請求 |
| `templates` / `listTemplates()` / `getTemplate(key)` | 開店模板與預設商品 |
| `json(data, status, headers)` | 建立 JSON `Response` |
| `hashPassword(password, saltHex)` | PBKDF2-SHA256 雜湊 |
| `signSession(userId, secret)` / `verifySession(token, secret)` | HMAC Session 簽章與驗證 |
| `getCookie(request, name)` / `getSession(request, env)` | Cookie 與 Session 讀取 |
| `isValidEmail` / `isValidDate` / `parseIntStrict` / `todayString` | 輸入驗證工具 |
| `toHex` / `fromHex` / `randomHex` / `timingSafeEqual` / `hmacHex` | 加解密輔助函式 |

## HTTP API 一覽

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

## 套件結構

```text
Hw9(week10)/
├── index.js          # npm 套件入口，統一匯出公開 API
├── package.json      # @xie00000/myshop-pos
├── test.js           # Node.js 測試，node test.js
├── schema.sql        # D1 資料表結構
├── wrangler.jsonc    # Cloudflare Workers 設定
├── src/
│   ├── worker.js     # API 路由、認證、D1 查詢（核心邏輯）
│   └── templates.js  # 四種開店模板與預設商品
└── public/
    ├── index.html    # SPA 外殼
    ├── app.js        # 前端邏輯
    └── style.css     # 樣式
```

## 測試

```bash
node test.js
# 或
npm test
```

測試會涵蓋模板、輸入驗證、PBKDF2 雜湊、Session 簽章、JSON Response、
API 路由與 Worker fetch handler。

## 部署到 Cloudflare Workers

套件仍保留原本的 Workers 專案結構，可直接部署：

```bash
npm install
npx wrangler login
npx wrangler d1 create myshop-db
# 將輸出的 database_id 填入 wrangler.jsonc
npx wrangler d1 execute myshop-db --remote --file=schema.sql
npx wrangler secret put AUTH_SECRET
npx wrangler deploy
```

部署後的體驗網址：<https://myshop.w0xie-1201.workers.dev>

## License

MIT
