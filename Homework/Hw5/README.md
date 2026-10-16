# Docker 學習紀錄

實作環境：Windows 11 + Docker Desktop，全程親手操作並附上真實輸出。

## 環境資訊

```
Docker version 29.8.2, build 7fc2dff
Docker Compose version v5.6.0
Docker Desktop 4.95.0（Context: desktop-linux）
```

安裝來源：<https://docs.docker.com/desktop/setup/install/windows-install/>（WSL 2 後端）

驗證安裝：

```powershell
docker --version
docker compose version
docker info          # 確認 daemon 已連線
```

## 核心概念

| 名詞 | 說明 |
|------|------|
| Image 映像 | 只讀模板，由多層 filesystem layer 疊成，類似 class |
| Container 容器 | 映像的執行實例，類似 object，可讀寫、可刪掉重建 |
| Registry | 存放映像的服務，預設為 Docker Hub |
| Dockerfile | 建置映像的步驟腳本 |
| Volume | 容器外的持久化儲存，容器刪除後資料仍在 |
| Network | 讓多個容器互相通訊的虛擬網路 |

關係：`Dockerfile → docker build → Image → docker run → Container`

## 一、跑第一個容器

```powershell
docker run hello-world
```

實際輸出（節錄）：

```
Hello from Docker!
This message shows that your installation appears to be working correctly.
```

運作流程：client 連線 daemon → daemon 從 Docker Hub 拉取映像 → 建立容器執行 → 輸出串流回終端機。

跑一個 Alpine Linux 容器執行指令（`--rm` 表示結束後自動刪除容器）：

```powershell
docker run --rm alpine:latest sh -c "cat /etc/os-release | head -2"
```

```
NAME="Alpine Linux"
ID=alpine
```

## 二、常用指令速查

```powershell
# 映像
docker images                        # 列出本地映像
docker pull alpine:latest            # 下載映像
docker rmi my-first-app:1.0          # 刪除映像
docker image prune                   # 清理未使用的映像

# 容器
docker ps                            # 顯示執行中的容器
docker ps -a                         # 包含已停止的容器
docker run -d --name myapp -p 5000:5000 <image>   # 背景執行並對接埠
docker stop myapp                    # 停止容器
docker rm myapp                      # 刪除容器
docker logs myapp                    # 查看日誌
docker exec -it myapp sh             # 進入容器內的 shell（Linux 映像適用）
docker stats                         # 即時 CPU / 記憶體用量
docker system df                     # 磁碟佔用摘要
docker system prune                  # 清理所有未使用資源
```

`-p 宿主埠:容器埠` 把容器內的服務對外暴露；`-it` 是互動模式加 TTY。

## 三、自建映像（Dockerfile）

專案結構（範例檔案放在本資料夾的 `docker-lab/`）：

```
docker-lab/
├── Dockerfile
├── .dockerignore
├── app.py
├── requirements.txt
└── compose.yaml
```

`app.py`（Flask 範例）：

```python
from flask import Flask
import socket

app = Flask(__name__)

@app.get("/")
def index():
    return {
        "message": "Hello from Docker!",
        "hostname": socket.gethostname(),
    }

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

`Dockerfile`：

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5000

CMD ["python", "app.py"]
```

`.dockerignore`：

```
__pycache__/
*.pyc
.git/
Dockerfile
.dockerignore
```

建置並執行：

```powershell
docker build -t my-first-app:1.0 ./docker-lab
docker run -d --name myapp -p 5000:5000 my-first-app:1.0
Invoke-WebRequest -Uri http://localhost:5000/ -UseBasicParsing
```

實際回應：

```json
{"hostname":"d839d15ffc9f","message":"Hello from Docker!"}
```

`hostname` 顯示的是容器 ID，代表程式確實跑在容器裡而非本機。

其他實用操作：

```powershell
docker logs myapp                                   # 查看 Flask 啟動日誌
docker exec myapp python -c "import socket; print(socket.gethostname())"
docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" myapp
```

## 四、Dockerfile 指令說明

| 指令 | 作用 |
|------|------|
| `FROM` | 基礎映像，例如 `python:3.12-slim`、`node:22-alpine` |
| `WORKDIR` | 設定後續指令的工作目錄（不存在會自動建立） |
| `COPY` | 複製本機檔案到映像內 |
| `RUN` | 建置階段執行指令（會成為一個 layer） |
| `EXPOSE` | 文件性質宣告容器內埠號，實際對外仍需 `-p` |
| `CMD` | 容器啟動時的預設指令，可被 `docker run <指令>` 覆蓋 |
| `ENV` | 設定環境變數 |
| `ENTRYPOINT` | 與 CMD 類似，但較難被覆蓋，適合當容器的「執行入口」 |

重點：

- **Layer 快取**：Dockerfile 每一行指令是一個 layer，內容沒變就會命中快取（建置輸出會顯示 `CACHED`）。所以把不常變動的 `COPY requirements.txt` + `RUN pip install` 放在前面，常變動的程式碼放後面，可大幅加速重建。
- **`.dockerignore`**：排除不要進入 build context 的檔案（.git、暫存檔等），縮小上下傳大小並避免污染映像。

## 五、Volume 資料持久化

容器刪除後可寫層的資料會跟著消失，要留存的資料必須放在 volume。

```powershell
docker volume create mydata
docker run --rm -v mydata:/data alpine sh -c "echo 'persisted by docker' > /data/note.txt"
docker run --rm -v mydata:/data alpine cat /data/note.txt
```

輸出：

```
persisted by docker
```

第一個容器已經結束並刪除，但第二個容器仍讀得到檔案，證明資料存在 volume 而非容器內。

常用指令：

```powershell
docker volume ls
docker volume inspect mydata
docker volume rm mydata
```

另一種寫法是 **bind mount**，把本機目錄直接掛進容器（適合開發時即時修改）：

```powershell
docker run -v ${PWD}/src:/app/src my-image:latest
```

## 六、Network 網路

同一個 bridge network 內的容器可用**服務名稱**互連。

```powershell
docker network create appnet
docker network ls
docker network inspect appnet
docker network rm appnet
```

範例 `compose.yaml`（見下一節）就建立了 `appnet`，讓 `web` 容器直接以 `cache` 這個名字連到 Redis。

## 七、Docker Compose 多容器編排

以 `compose.yaml` 定義一組服務，一行指令一起啟動。以下指令請在 `docker-lab/` 目錄內執行。

`compose.yaml`：

```yaml
services:
  web:
    build: .
    ports:
      - "5001:5000"
    environment:
      - APP_ENV=production
    depends_on:
      - cache
    networks:
      - appnet

  cache:
    image: redis:7-alpine
    networks:
      - appnet

networks:
  appnet:
    driver: bridge
```

操作：

```powershell
docker compose up -d          # 背景啟動（含建置）
docker compose ps             # 查看服務狀態
docker compose logs -f web    # 追蹤日誌
docker compose exec cache redis-cli ping
docker compose down           # 停止並刪除容器與網路
```

實際輸出：

```
NAME          IMAGE            STATUS         PORTS
app-cache-1   redis:7-alpine   Up 5 seconds   6379/tcp
app-web-1     app-web          Up 5 seconds   0.0.0.0:5001->5000/tcp
```

```
PONG        # redis-cli ping 的回應
```

`docker compose down` 會連同自訂網路 `app_appnet` 一起清掉；映像與 volume 會保留，需額外加 `--rmi all` 或 `--volumes` 清除。

## 八、清理資源

```powershell
docker stop (docker ps -aq)            # 停止所有容器
docker rm (docker ps -aq)              # 刪除所有容器
docker volume prune                    # 清理未掛載的 volume
docker image prune -a                  # 清理未使用的映像
docker system prune -a --volumes       # 全部清光（謹慎使用）
```

## 九、踩過的坑與心得

1. **`docker run` 前台執行會卡住終端機**：除非是 `-it` 互動用途，否则背景執行請加 `-d`，再搭配 `docker logs` 看輸出。
2. **連不到容器內服務時的檢查順序**：確認容器在跑（`docker ps`）→ 確認程式監聽 `0.0.0.0` 而非 `127.0.0.1`（否則外部進不来）→ 確認 `-p` 宿主埠對了。
3. **Windows 路徑**：PowerShell 掛載本機目錄用 `${PWD}`；Docker Desktop 要在設定中允許該磁碟的 Drive Sharing。
4. **映像檔名規則**：`registry/名稱:tag`，省略 registry 時預設 Docker Hub，省略 tag 時預設 `latest`。正式環境應固定 tag，避免更新時意外炸掉。
5. **容器不是虛擬機**：共享宿主核心，啟動是毫秒級、幾乎無開銷，但也代表安全性隔離弱於 VM，不應把容器當長壽的伺服器來養（資料放 volume、狀態放外部資料庫）。
