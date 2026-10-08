# Hw2 - NQU 登入系統（Full-Stack）

一個完整的「前端 → 後端 → 資料庫」登入系統，並透過 **Knex.js** 讓資料庫可抽換（預設 SQLite，之後可切換 PostgreSQL）。

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML + CSS + JavaScript（`fetch` 呼叫 API） |
| 後端 | Node.js + Express |
| 資料存取 | Knex.js（query builder，可抽換資料庫） |
| 資料庫 | SQLite（預設）／ PostgreSQL（可切換） |

## 目錄結構

```
Hw2/
├── public/
│   └── index.html          # 前端登入頁面
├── migrations/             # 資料表結構（Knex migration）
│   └── 20261008000001_create_users.js
├── seeds/                  # 測試資料
│   └── 001_users.js
├── server.js               # Express 後端與登入 API
├── db.js                   # 建立 Knex 連線實例
├── knexfile.js             # 各資料庫的連線設定（依 DB_CLIENT 切換）
├── package.json
└── database.sqlite         # 執行 migration 後自動生成（不納入版本控制）
```

## 安裝與執行

```bash
npm install          # 安裝相依套件
npm run migrate      # 建立 users 資料表
npm run seed         # 寫入測試帳號
npm start            # 啟動伺服器
```

開啟瀏覽器前往 <http://localhost:3000>，使用測試帳號登入：

- 學號：`112001`
- 密碼：`123456`

成功後會顯示「歡迎回來, 王小明!」。

## 資料表結構（users）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | INTEGER（主鍵、自動編號） | 唯一識別碼 |
| student_id | TEXT（UNIQUE） | 學號，用於登入 |
| password | TEXT | 密碼 |
| name | TEXT | 學生姓名 |
| department | TEXT | 系所 |

## API

### `POST /api/login`

Request：

```json
{ "studentId": "112001", "password": "123456" }
```

Response（成功，200）：

```json
{
  "success": true,
  "message": "歡迎回來, 王小明!",
  "user": { "name": "王小明", "dept": "資管系" }
}
```

Response（失敗，401）：

```json
{ "success": false, "message": "學號或密碼錯誤" }
```

## 抽換資料庫（SQLite ⇄ PostgreSQL）

所有 SQL 都由 Knex 產生，業務邏輯（`server.js`）完全不需修改，只要換連線設定：

### 預設：SQLite

```bash
npm run migrate && npm run seed
npm start
```

### 切換到 PostgreSQL

1. 安裝並啟動 PostgreSQL，建立資料庫 `nqu_system`
2. 執行：

```bash
# Windows (PowerShell)
$env:DB_CLIENT="pg"
$env:PG_USER="postgres"
$env:PG_PASSWORD="你的密碼"
$env:PG_DATABASE="nqu_system"
# 可選: $env:PG_HOST / $env:PG_PORT

npm run migrate
npm run seed
npm start
```

也可以用單一連線字串：`$env:DATABASE_URL="postgres://user:pass@localhost:5432/nqu_system"`

`knexfile.js` 會依 `DB_CLIENT`（`sqlite3` 或 `pg`）選擇對應的驅動，其餘程式碼不變。

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm start` | 啟動伺服器 |
| `npm run migrate` | 套用最新的資料表結構 |
| `npm run seed` | 寫入／重置測試資料 |
| `npm run migrate:make <name>` | 新增一個 migration 檔案 |
| `npm run db:reset` | 回滾 → 重新 migrate → seed（重建資料庫） |

## 運作流程

1. **前端**：使用者輸入學號密碼 → `fetch` 送出 JSON 到 `/api/login`
2. **後端**：Express 接收請求 → Knex 組出 SQL 查詢
3. **資料庫**：在 `users` 表尋找相符資料 → 回傳結果
4. **回傳**：依查詢結果回應 `success: true/false` → 前端更新畫面
