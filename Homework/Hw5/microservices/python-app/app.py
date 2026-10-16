import os
import socket
import time
from contextlib import asynccontextmanager, contextmanager

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://appuser:apppass@db:5432/appdb"
)
SERVICE_NAME = os.environ.get("SERVICE_NAME", "python-app")


@contextmanager
def db():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def wait_for_db(max_tries: int = 30, delay: float = 2.0) -> None:
    for attempt in range(1, max_tries + 1):
        try:
            with db() as conn, conn.cursor() as cur:
                cur.execute("SELECT 1;")
            print(f"[{SERVICE_NAME}] database ready (attempt {attempt})", flush=True)
            return
        except Exception as exc:  # noqa: BLE001
            print(
                f"[{SERVICE_NAME}] waiting for db ({attempt}/{max_tries}): {exc}",
                flush=True,
            )
            time.sleep(delay)
    raise RuntimeError("database is not reachable")


def init_db() -> None:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS system_events (
                id         SERIAL PRIMARY KEY,
                service    TEXT        NOT NULL,
                message    TEXT        NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_db()
    init_db()
    yield


app = FastAPI(title="Docker Microservices Demo", lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"status": "ok", "service": SERVICE_NAME}


@app.get("/api/python/hello")
def hello():
    db_time = None
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute("SELECT now();")
            db_time = cur.fetchone()[0].isoformat()
    except Exception as exc:  # noqa: BLE001
        db_time = f"error: {exc}"
    return {
        "service": SERVICE_NAME,
        "language": "Python",
        "message": "Hello from Python! \U0001f40d",
        "hostname": socket.gethostname(),
        "db_time": db_time,
    }


@app.get("/api/events")
def list_events(limit: int = 10):
    with db() as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(
            """
            SELECT id, service, message, created_at
            FROM system_events
            ORDER BY id DESC
            LIMIT %s;
            """,
            (limit,),
        )
        rows = cur.fetchall()
    for row in rows:
        row["created_at"] = row["created_at"].isoformat()
    return {"count": len(rows), "events": rows}


@app.post("/api/events")
async def create_event(request: Request):
    data = await request.json()
    service = str(data.get("service") or "web-ui")
    message = str(data.get("message") or "visit")
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO system_events (service, message)
            VALUES (%s, %s)
            RETURNING id, created_at;
            """,
            (service, message),
        )
        new_id, created_at = cur.fetchone()
    return {"id": new_id, "created_at": created_at.isoformat()}


@app.get("/", response_class=HTMLResponse)
def index():
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO system_events (service, message)
            VALUES (%s, %s);
            """,
            ("nginx -> python-app", "Web 頁面瀏覽"),
        )
    return HTML_PAGE


HTML_PAGE = """<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docker 微服務系統 Demo</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --line:#334155; --fg:#e2e8f0; --accent:#38bdf8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:32px 24px; text-align:center; border-bottom:1px solid var(--line); }
  header h1 { margin:0 0 8px; font-size:1.6rem; }
  header p { margin:0; color:#94a3b8; }
  main { max-width:1000px; margin:0 auto; padding:24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card h2 { margin:0 0 4px; font-size:1.05rem; }
  .card .tag { font-size:.75rem; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; }
  button { margin-top:10px; background:var(--accent); color:#0b1220; border:0; border-radius:8px;
           padding:8px 14px; font-weight:600; cursor:pointer; }
  button:hover { filter:brightness(1.1); }
  pre { background:#0b1220; border:1px solid var(--line); border-radius:8px; padding:10px;
        overflow:auto; font-size:.8rem; max-height:180px; }
  table { width:100%; border-collapse:collapse; margin-top:12px; font-size:.85rem; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); }
  form { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  input { flex:1; min-width:140px; background:#0b1220; color:var(--fg);
          border:1px solid var(--line); border-radius:8px; padding:8px; }
</style>
</head>
<body>
<header>
  <h1>Docker 微服務系統 Demo</h1>
  <p>Nginx 反向代理 &middot; Python(FastAPI) &middot; Node.js &middot; Rust &middot; PostgreSQL</p>
</header>
<main>
  <div class="grid">
    <div class="card">
      <div class="tag">Python / FastAPI</div>
      <h2>Python 服務（主要）</h2>
      <p>提供這個網頁與 API，並將事件寫入 PostgreSQL。</p>
      <button onclick="call('/api/python/hello','out-python')">測試 Python</button>
      <pre id="out-python">尚未測試</pre>
    </div>
    <div class="card">
      <div class="tag">Node.js / Express</div>
      <h2>Node.js 服務</h2>
      <p>由 Nginx 以 <code>/node/</code> 路徑轉發。</p>
      <button onclick="call('/node/','out-node')">測試 Node.js</button>
      <pre id="out-node">尚未測試</pre>
    </div>
    <div class="card">
      <div class="tag">Rust / std</div>
      <h2>Rust 服務</h2>
      <p>由 Nginx 以 <code>/rust/</code> 路徑轉發。</p>
      <button onclick="call('/rust/','out-rust')">測試 Rust</button>
      <pre id="out-rust">尚未測試</pre>
    </div>
  </div>

  <div class="card" style="margin-top:16px;">
    <div class="tag">PostgreSQL</div>
    <h2>資料庫事件紀錄</h2>
    <p>每次瀏覽本頁或按下方按鈕，都會寫入一筆資料。</p>
    <form onsubmit="addEvent(event)">
      <input id="svc" placeholder="service" value="web-ui">
      <input id="msg" placeholder="message" value="手動新增測試">
      <button type="submit">新增事件</button>
      <button type="button" onclick="loadEvents()">重新整理</button>
    </form>
    <table id="events">
      <thead><tr><th>ID</th><th>Service</th><th>Message</th><th>Created</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
</main>
<script>
async function call(url, target) {
  const out = document.getElementById(target);
  out.textContent = '載入中...';
  try {
    const res = await fetch(url);
    const text = await res.text();
    try { out.textContent = JSON.stringify(JSON.parse(text), null, 2); }
    catch { out.textContent = text; }
  } catch (e) { out.textContent = '錯誤: ' + e; }
}
async function loadEvents() {
  const res = await fetch('/api/events');
  const data = await res.json();
  const tbody = document.querySelector('#events tbody');
  tbody.innerHTML = '';
  for (const ev of data.events) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + ev.id + '</td><td>' + ev.service + '</td><td>' +
                   ev.message + '</td><td>' + ev.created_at + '</td>';
    tbody.appendChild(tr);
  }
}
async function addEvent(ev) {
  ev.preventDefault();
  const service = document.getElementById('svc').value;
  const message = document.getElementById('msg').value;
  await fetch('/api/events', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({service: service, message: message}),
  });
  loadEvents();
}
window.addEventListener('DOMContentLoaded', loadEvents);
</script>
</body>
</html>
"""
