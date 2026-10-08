# rcurl

一個用 Rust 手寫 HTTP/1.1 協定的類 curl 命令列工具，作為《作業 1》。

## 專案用途

`rcurl` 是一個終端機的網路請求工具，功能與著名的 `curl` 相容（選項與退出碼對齊），可用來：

- **抓取網頁 / API 資料**：下載 HTML、JSON 等資源到終端機或檔案
- **發送各種 HTTP 請求**：GET、POST、PUT、DELETE… 送表單、送 JSON 都可以
- **除錯網路程式**：`-v` 顯示完整的請求與回應 header，`-i` 一併輸出回應狀態列
- **模擬瀏覽器行為**：自訂 User-Agent、Header、跟隨 302 導向、gzip 壓縮
- **學術用途（本作業重點）**：不依賴現成 HTTP 函式庫，從零實作 HTTP/1.1 協定的解析與組建

```powershell
# 抓網頁
.\rcurl.exe https://example.com/

# POST 送 JSON
.\rcurl.exe --json '{\"a\":1}' https://httpbin.org/post

# 跟隨導向並存成檔案
.\rcurl.exe -L -O https://example.com/

# 看請求/回應細節
.\rcurl.exe -v https://example.com/
```

## 實作特色

- **不使用** reqwest / ureq 等 HTTP 函式庫：請求組建、回應解析（`Content-Length` / `chunked` / 連線關閉）、URL 解析、CLI 參數解析、Base64 全部自行實作
- 相依套件只有兩個：`native-tls`（HTTPS，Windows 上走 SChannel）與 `flate2`（gzip/deflate 解壓）

## 建置與執行

```powershell
cargo build --release
.\target\release\rcurl.exe -s https://example.com/

cargo test          # 49 個單元測試 + 20 個整合測試（本地假 server）
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## 支援的選項

| 類別 | 選項 | 說明 |
|---|---|---|
| 方法 | `-X, --request <method>` | 任意方法；有 body 預設 `POST`，否則 `GET` |
| | `-I, --head` | 使用 `HEAD`，並輸出回應 header（等同 `-i`） |
| URL | `<url>` | `http://`、`https://`、自訂 port、query |
| Header | `-H, --header <'Name: value'>` | 可重複；同名覆寫既有 header；`-H "Name;"` 可刪除 header |
| Body | `-d, --data <data>` | 可重複，以 `&` 串接；`@file` 讀取檔案（自動去除換行）；預設 `Content-Type: application/x-www-form-urlencoded` |
| | `--data-binary <data>` | 同上但保留換行與原始位元組 |
| | `--json <data>` | 自動帶 `Content-Type`/`Accept: application/json` |
| 輸出 | `-o, --output <file>` | 輸出至檔案 |
| | `-O, --remote-name` | 以遠端 URL 的檔案名稱儲存 |
| | `-i, --include` | 一併輸出回應 header |
| 顯示 | `-v, --verbose` | 請求/回應細節輸出至 stderr（`>` `<` `*` 前綴） |
| | `-s, --silent` / `-S, --show-error` | 靜默 / 靜默下仍顯示錯誤 |
| 導向 | `-L, --location` | 追蹤 301/302/303/307/308（上限 10 次）；303 → GET、301/302 的 POST → GET 並丟棄 body；跨來源導向時移除 `Authorization` |
| 認證 | `-u, --user <user:pass>` | HTTP Basic（Base64 自行編碼） |
| | `-A, --user-agent <s>` | 預設 `rcurl/0.1.0` |
| | `-e, --referer <url>` | Referer header |
| TLS | `-k, --insecure` | 跳過憑證與主机名校驗 |
| 壓縮 | `--compressed` | 發送 `Accept-Encoding: gzip, deflate`，自動解壓 |
| 逾時 | `--connect-timeout <sec>` | 連線（含 DNS）逾時 |
| | `-m, --max-time <sec>` | 整體操作逾時（含小數） |
| 進度 | （預設）/ `--no-progress` | stderr 為終端機時顯示進度計數 |
| 其他 | `-h, --help`、`-V, --version` | |

支援 curl 風格的連寫與黏著參數：`-sLi`、`-XPOST`、`-Hvalue`。

## 退出碼（與 curl 相容的子集）

| 碼 | 意義 | 碼 | 意義 |
|---|---|---|---|
| 0 | 成功 | 28 | 逾時 |
| 2 | 參數錯誤 | 35 | SSL 錯誤 |
| 3 | URL 格式錯誤 | 47 | 重新導向超過 10 次 |
| 6 | DNS 解析失敗 | 52 | 伺服器無回應 |
| 7 | 連線失敗 | 55/56 | 送出/接收失敗 |
| 23 | 寫檔失敗 | | |

## 專案結構

```
src/
├── main.rs          # 主流程：parse → 連線 → 送請求 → 解析 → 導向/輸出 → 退出碼
├── cli.rs           # 手寫參數解析（無 clap）
├── url.rs           # 最小 URL parser + RFC 3986 相對導向解析
├── base64.rs        # Basic Auth 用
├── error.rs         # curl 相容退出碼
├── net.rs           # DNS、TCP 逾時連線、Transport（Plain/TLS）
├── tls.rs           # native-tls 握手（含 -k）
├── output.rs        # -o/-O/-i/-v/-s、進度
└── http/
    ├── request.rs   # 請求組建（header 覆寫/刪除、Content-Length）
    └── response.rs  # 回應解析（Content-Length/chunked/close）+ gzip 解壓
tests/
└── integration.rs   # 20 個端對端測試（本地 std 假 HTTP server）
```

## 已知限制

未實作（選到會明確報錯並提示）：`-F`（multipart）、`-w`、`-b/-c`（cookie）、`-r`（Range）、`--retry`、`-T`（上傳檔案）、HTTP/2、連線複用（keep-alive）、`@file` 的表單語法以外的展開。
