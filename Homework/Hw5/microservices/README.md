# 多語言微服務系統（作業 5）

用 Docker 建置的一個小型微服務系統，包含 **Nginx 反向代理**、**PostgreSQL 資料庫**，
以及 **Python（主要）、Node.js、Rust** 三個應用服務，並提供一個簡易 Web 介面來展示整個系統。

> 繳交內容：`Dockerfile`（每個服務各一份）與 `docker-compose.yml`（系統總管）。

![系統架構圖](images/architecture.svg)

## 系統架構

```
                     ┌──────────────────────────┐
   瀏覽器  ───────▶  │  Nginx (反向代理, :80)    │
   http://localhost  └────────────┬─────────────┘
                                  │ 依路徑分派
          ┌───────────────────────┼───────────────────────┐
          │ /  /api/              │ /node/                │ /rust/
          ▼                       ▼                       ▼
  ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
  │ python-app    │      │ node-app      │      │ rust-app      │
  │ FastAPI :8000 │      │ Express :3000 │      │ std HTTP :8080│
  └───────┬───────┘      └───────────────┘      └───────────────┘
          │ 讀寫
          ▼
  ┌───────────────┐
  │ db            │
  │ PostgreSQL    │   (資料存在 volume，容器重啟不消失)
  │ :5432         │
  └───────────────┘

  全部服務位於同一個 Docker bridge 網路 backend，彼此以「服務名稱」互相連線。
```

## 服務一覽

| 服務 | 映像 | 語言 / 技術 | 對外埠 | 角色 |
|------|------|-------------|--------|------|
| `nginx` | nginx:alpine | Nginx | **80** | 反向代理，系統唯一入口 |
| `python-app` | python:3.12-slim | Python / FastAPI | 8000（僅內網） | 主要服務：提供 Web 介面與 API，寫入資料庫 |
| `node-app` | node:20-alpine | Node.js / Express | 3000（僅內網） | 次要服務，展示多語言 |
| `rust-app` | rust:1.83-slim → debian | Rust（標準函式庫） | 8080（僅內網） | 次要服務，展示多語言 |
| `db` | postgres:16-alpine | PostgreSQL | 5432（僅內網） | 資料庫 |

只有 `nginx` 對外開放，其餘服務都只在 `backend` 網路內，外部無法直接連線。

## 專案結構

```
microservices/
├── docker-compose.yml          # 系統定義（服務、網路、volume）
├── nginx/
│   ├── Dockerfile
│   └── default.conf            # 反向代理規則
├── python-app/                 # 主要服務
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py                  # FastAPI + psycopg2，含 HTML 介面
├── node-app/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── rust-app/
    ├── Dockerfile              # 多階段建置
    ├── Cargo.toml              # 無外部依賴
    └── src/main.rs             # 以 std 實作極簡 HTTP 伺服器
```

## 關鍵設計

### Nginx 反向代理（`nginx/default.conf`）

依路徑把請求分派到不同服務，並在轉發 `/node/`、`/rust/` 時去掉前綴：

```nginx
location /       { proxy_pass http://python-app:8000; }   # Web 介面
location /api/   { proxy_pass http://python-app:8000; }   # Python API
location /node/  { proxy_pass http://node-app:3000/; }    # 尾端斜線 -> 去掉 /node/
location /rust/  { proxy_pass http://rust-app:8080/; }
```

### 服務相依與健康檢查（`docker-compose.yml`）

`db` 加上 `healthcheck`，`python-app` 用 `depends_on: condition: service_healthy`
等資料庫真的能連線後才啟動，避免啟動時連不到資料庫：

```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
python-app:
  depends_on:
    db:
      condition: service_healthy
```

### 資料持久化

PostgreSQL 資料掛在具名 volume `postgres_data`，`docker compose down` 再 `up` 資料仍在。

### 多階段建置（`rust-app/Dockerfile`）

先用 `rust:1.83-slim` 編譯，再把執行檔複製到乾淨的 `debian:bookworm-slim`，
讓最終映像只含執行檔（本例 rust-app 映像約 127MB）。

## 如何執行

在 `microservices/` 目錄下：

```bash
docker compose up -d --build
```

完成後開啟瀏覽器：<http://localhost>

![Web 介面](images/web-ui.png)

### 實際測試結果

五個服務都正常啟動（`docker compose ps`）：

```
NAME                         IMAGE                      STATUS                    PORTS
microservices-db-1           postgres:16-alpine         Up (healthy)              5432/tcp
microservices-nginx-1        microservices-nginx        Up                        0.0.0.0:80->80/tcp
microservices-node-app-1     microservices-node-app     Up                        3000/tcp
microservices-python-app-1   microservices-python-app   Up                        8000/tcp
microservices-rust-app-1     microservices-rust-app     Up                        8080/tcp
```

透過 Nginx（port 80）測試各服務：

```powershell
Invoke-WebRequest http://localhost/api/python/hello     # Python
Invoke-WebRequest http://localhost/node/                # Node.js
Invoke-WebRequest http://localhost/rust/                # Rust
```

回應：

```json
{"service":"python-app","language":"Python","message":"Hello from Python! 🐍","hostname":"d1cfd0fe54fe","db_time":"2026-10-16T03:34:16.629740+00:00"}
{"service":"node-app","language":"Node.js","message":"Hello from Node.js! 🟢","hostname":"606bcdd5186b","node":"v20.20.2","time":"2026-10-16T03:34:16.651Z"}
{"service":"rust-app","language":"Rust","message":"Hello from Rust! 🦀","hostname":"rust-app"}
```

Web 介面（`http://localhost/`）由 Python 提供，回傳 HTTP 200（約 4.5 KB 的 HTML），
可測試各服務並顯示資料庫中的事件紀錄。

資料庫寫入驗證（透過 `psql` 直接查詢）：

```
 id |       service       |          message
----+---------------------+----------------------------
  1 | nginx -> python-app | Web 頁面瀏覽
  2 | node-app            | ??????
  3 | 驗證腳本            | 來自 PowerShell 的中文測試
(3 rows)
```

每次瀏覽網頁都會寫入一筆事件（id=1），POST 也能正確新增（id=3，中文正確往返 UTF-8）。

映像大小：

```
microservices-rust-app     latest      127MB
microservices-python-app   latest      256MB
microservices-node-app     latest      209MB
microservices-nginx        latest      102MB
postgres                   16-alpine   420MB
```

## 停止與清理

```bash
docker compose down             # 停止並移除容器、網路（保留 volume 與映像）
docker compose down -v          # 連同 postgres_data volume 一併刪除
docker compose down --rmi all   # 連同映像一併刪除
```

## 備註

- 本機 port 80 若被占用，可在根目錄建立 `.env` 設定 `WEB_PORT=8080`，
  再以 <http://localhost:8080> 存取。
- `rust-app` 刻意只用 Rust 標準函式庫實作（`Cargo.toml` 無依賴），
  目的是讓建置快速、映像精簡，同時展示多語言共存。
