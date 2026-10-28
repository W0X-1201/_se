# HW6 - Todo App：單元測試、系統測試、E2E 測試

本專案實作一個簡單的待辦清單（Todo App），並示範三種測試架構：

- **單元測試（Unit Test）**：Rust 模組內部純邏輯測試（`todo.rs`）
- **系統測試（System / Web API Test）**：使用 `tower::ServiceExt` 進行 HTTP API 整合測試（`backend/tests/api_test.rs`）
- **E2E 測試（End-to-End Test）**：使用 Playwright 控制無頭瀏覽器進行真實使用者流程測試（`e2e/tests/todo.spec.js`）

## 專案結構

```text
Hw6/
├── backend/                  # Rust 後端（Axum）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs          # 伺服器啟動與靜態檔案託管
│   │   ├── todo.rs          # 業務邏輯與單元測試
│   │   └── api.rs           # API 路由與控制器
│   └── tests/
│       └── api_test.rs      # 系統測試（Web API 測試）
├── frontend/                 # 前端靜態頁面
│   └── index.html
├── e2e/                      # E2E 測試（Playwright）
│   ├── package.json
│   ├── playwright.config.js
│   └── tests/
│       └── todo.spec.js
└── README.md
```

## 架構圖

![系統架構圖](./images/architecture.png)

## 測試流程圖

![測試流程圖](./images/testing-flow.svg)

## 執行方式

### 1) 單元測試（Unit Test）

```bash
cd Hw6/backend
cargo test --bin backend
```

![單元測試結果](./images/unit-test-result.png)

### 2) 系統測試（Web API Test）

```bash
cd Hw6/backend
cargo test --test api_test
```

![系統測試結果](./images/system-test-result.png)

### 3) E2E 測試（Playwright）

先啟動後端伺服器：

```bash
cd Hw6/backend
cargo run
```

再於另一個終端機執行 Playwright 測試：

```bash
cd Hw6/e2e
npm install
npx playwright install --with-deps
npx playwright test
npx playwright show-report
```

![E2E 測試結果](./images/e2e-test-result.png)

## 三種測試比較總結

| 測試類型 | 執行層級 | 負責範圍 | 執行速度 | 依賴環境 | 備註 |
|---|---|---|---|---|---|
| **1. 單元測試（Unit Test）** | 內部邏輯（`backend/src/todo.rs`） | 驗證核心業務邏輯，如 `TodoStore::add()`、`TodoStore::list()` 等純函式與資料結構操作，確保每個最小單元正確。 | 極快（毫秒級） | 純 CPU / 記憶體，無網路、無 HTTP、無資料庫 | 最適合開發初期頻繁執行，用於快速回歸與邏輯驗證。 |
| **2. 系統測試（System / Web API Test）** | API 層（`backend/tests/api_test.rs`） | 驗證 HTTP 協定行為、路由對應、請求/回應格式、狀態碼（如 `201 Created`、`200 OK`）以及 JSON 序列化/反序列化。透過 `tower::ServiceExt` 在記憶體內模擬 HTTP 請求。 | 快（數十毫秒） | 記憶體中的 HTTP 服務堆疊（`axum` + `tower`），不需實際綁定 Port | 在不啟動真實伺服器的情況下，整合驗證路由、控制器與狀態管理層的串接是否正確。 |
| **3. E2E 測試（End-to-End Test）** | 全流程（`e2e/tests/todo.spec.js`） | 模擬真實使用者操作：開啟瀏覽器、輸入文字、點擊按鈕、新增待辦事項，並驗證前端 DOM 是否正確渲染。會打擊實際啟動的 Server（`http://localhost:3000`）的完整 API 流程。 | 較慢（秒級） | 需啟動後端 Server + 無頭瀏覽器引擎（Playwright），涵蓋前端、網路、後端、API 全鏈路 | 從使用者視角驗證整個系統整合是否正常，能偵測到單元或 API 測試不易發現的整合、UI 或事件流程錯誤。 |

## 技術棧

| 層級 | 技術 |
|---|---|
| 後端 | Rust, Axum, Tokio, Serde |
| 前端 | HTML, JavaScript (Vanilla) |
| 系統測試 | tower, http-body-util |
| E2E 測試 | Playwright |
