# NQU 校務資訊系統（Full-Stack）

## 系統介紹

本系統是一套以「**前端 → 後端 → 資料庫**」三層架構打造的**大學校務資訊系統**，涵蓋學校教學活動的三大角色：**學生、教師、管理員**，各自擁有獨立的操作介面與權限控管。

- **學生**：從查詢課程、選課退課、檢視課表，到查看成績、GPA 與畢業學分進度、下載教材、查詢出缺勤，完成一整學期的學業管理流程。
- **教師**：管理授課清單、依日期點名、輸入並批次發布成績、上傳課程教材、匯出成績 CSV。
- **管理員**：管理帳號與角色權限、維護課程與授課教師、設定選課時間窗、發布校園公告，並透過數據分析掌握全校開課與選課狀況。

系統以**真實校務流程**為設計目標：選課具備時間窗、額滿、重複選課與上課時段衝突的完整驗證；成績採「平時 30%＋期中 30%＋期末 40%」加權，且必須由教師**發布**後學生才看得到；所有 API 皆由後端依角色（`student` / `teacher` / `admin`）嚴格控管，未授權一律回 `403`。

資料存取層使用 **Knex.js**，所有 SQL 皆由 query builder 產生，因此**不需修改任何程式碼**即可在 SQLite 與 PostgreSQL 之間切換資料庫，符合資料庫可抽換的課程要求。

```
瀏覽器（HTML / CSS / JavaScript）
        │  fetch + Bearer Token
        ▼
Express 後端（server.js）── 認證、角色權限、業務邏輯、CSV 匯出、檔案上傳
        │  Knex.js（query builder）
        ▼
SQLite（預設）⇄ PostgreSQL（DB_CLIENT 切換）
```

### 功能總覽

| 角色 | 功能 |
|------|------|
| 學生 | 選課／退選（含時間窗、額滿、重複、時段衝突檢查）、課表檢視、**課程搜尋與篩選**（關鍵字／系所／星期／節次）、成績與 GPA、畢業學分進度、**成績單 CSV 匯出**、**出缺勤查詢**、教材下載 |
| 教師 | 授課清單、**點名系統**、成績輸入與批次發布、**成績 CSV 匯出**、教材上傳／下載／刪除 |
| 管理員 | 帳號與角色管理、課程管理（授課教師、人數上限）、**選課時間窗**、**校園公告發布**（可指定對象）、數據分析（各系人數長條圖、課程滿額率） |
| 共同 | 登入驗證（Bearer Token）、角色導向、**校園公告板**（依角色過濾顯示） |

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | HTML + CSS + JavaScript（`fetch` 呼叫 API，共用 `style.css` 正式風格） |
| 後端 | Node.js + Express |
| 檔案上傳 | Multer（教材上傳） |
| 資料存取 | Knex.js（query builder，可抽換資料庫） |
| 資料庫 | SQLite（預設）／ PostgreSQL（可切換） |
| 驗證 | Bearer Token（登入後發放）＋ 角色權限（student / teacher / admin） |

## 各端功能說明

### 1. 學生端（`dashboard.html`）

- **我的課表**：週一～週五、第 1～10 節課表網格與學分統計
- **選課作業**：課程清單、餘額顯示、選課／退選；**搜尋與篩選**（關鍵字／系所／星期／節次）；課程附簡介說明
- **成績與學分**：各科成績、總成績（平時30%＋期中30%＋期末40%）、績點、**GPA**、**畢業學分進度**、**一鍵匯出成績單 CSV**
- **出缺勤查詢**：各科出勤統計（出席／遲到／缺席／請假）與逐日明細
- **課程教材**：下載授課教師上傳的檔案
- **校園公告**：觀看全體或僅限學生的公告

### 2. 教師端（`teacher.html`）

- **我的課程**：授課清單、選課人數
- **點名系統**：依日期點名（出席／遲到／缺席／請假），可重複查詢與更新
- **成績輸入**：輸入平時／期中／期末分數 → 自動計算總分 → **批次發布成績** → **匯出成績 CSV**
- **教材管理**：上傳、下載、刪除課程教材
- **校園公告**：觀看全體或僅限教師的公告

### 3. 管理端（`admin.html`）

- **帳號與權限**：建立帳號、變更角色（學生／教師／管理員）、重設密碼
- **課程管理**：新增課程、調整授課教師與人數上限、顯示滿額率
- **選課時間窗**：設定開放／關閉時間（關閉時學生無法選退課）、一鍵開放／立即關閉、畢業要求學分設定
- **校園公告**：發布／刪除公告，可指定發布對象（全體／僅學生／僅教師／僅管理員）
- **數據分析**：學生／教師／開課／選課統計、各系人數長條圖、課程滿額率

## 目錄結構

```
Hw2/
├── public/
│   ├── index.html           # 登入頁
│   ├── dashboard.html       # 學生端
│   ├── teacher.html         # 教師端
│   ├── admin.html           # 管理端
│   └── style.css            # 共用正式風格樣式
├── migrations/              # 資料表結構（Knex migration，共 11 個）
│   ├── *_create_users.js / *_create_courses.js / *_create_enrollments.js
│   ├── *_add_role_to_users.js / *_add_teacher_id_to_courses.js
│   ├── *_create_grades.js / *_create_attendance.js
│   ├── *_create_materials.js / *_create_settings.js
│   └── *_create_announcements.js / *_add_description_to_courses.js
├── seeds/                   # 測試資料（可重複執行）
│   ├── 001_users.js / 002_courses.js / 003_settings.js / 004_announcements.js
├── server.js                # Express 後端與全部 API
├── db.js                    # 建立 Knex 連線實例
├── knexfile.js              # 各資料庫連線設定（依 DB_CLIENT 切換）
├── e2e-test.js              # 端對端 API 測試腳本（33 項檢查）
├── package.json
└── database.sqlite          # 執行 migration 後自動生成（不納入版本控制）
```

## 安裝與執行

```bash
npm install          # 安裝相依套件
npm run migrate      # 建立資料表
npm run seed         # 寫入測試資料
npm start            # 啟動伺服器
```

開啟 <http://localhost:3000>，登入後依角色自動導向：

| 角色 | 帳號 | 密碼 | 頁面 |
|------|------|------|------|
| 學生（資工系二年級 林哲宇） | `123456` | `123456` | 學生端 |
| 學生（資管系二年級 張家瑜） | `123457` | `123457` | 學生端 |
| 教師（資工系 陳鍾誠） | `111111` | `111111` | 教師端 |
| 教師（資管系 李怡君） | `111112` | `111112` | 教師端 |
| 教師（數學系 王富美） | `111113` | `111113` | 教師端 |
| 教師（外文系 張雅婷） | `111114` | `111114` | 教師端 |
| 管理員 | `admin` | `123456` | 管理端 |

授課分配：陳鍾誠（CS101、CS203、CS310）、李怡君（IM110、IM215、IM320）、王富美（MA101、PS101）、張雅婷（EN102）。

## 資料表結構

| 資料表 | 重點欄位 | 說明 |
|--------|----------|------|
| users | student_id(UNIQUE)、password、name、department、**role** | 使用者與角色 |
| courses | course_no、**department**、**description**、weekday、start/end_period、capacity、**teacher_id** | 課程（含系所與簡介）與授課教師 |
| enrollments | user_id + course_id(UNIQUE) | 選課紀錄 |
| grades | user_id + course_id(UNIQUE)、participation/midterm/final/total、**published** | 成績與發布狀態 |
| attendance | user_id + course_id + date(UNIQUE)、status | 點名紀錄 |
| materials | course_id、filename、stored_name、size | 教材檔案（實體存 `uploads/`） |
| settings | key / value | 時間窗、畢業學分等系統設定 |
| announcements | title、content、**audience**、created_by | 校園公告與發布對象 |

## API 一覽

所有請求須帶 `Authorization: Bearer <token>`（`/api/login` 取得）。

| 角色 | 方法與路徑 | 說明 |
|------|-----------|------|
| 任何人 | `POST /api/login`、`POST /api/logout`、`GET /api/me` | 登入／登出／身分 |
| 已登入 | `GET /api/announcements` | 校園公告（依角色過濾） |
| 學生 | `GET /api/courses?q=&department=&weekday=&period=` | 課程清單（搜尋與篩選、餘額、時間窗） |
| 學生 | `POST/DELETE /api/courses/:id/enroll` | 選課／退選（403 關窗、409 額滿/重複/衝突） |
| 學生 | `GET /api/schedule` | 我的課表 |
| 學生 | `GET /api/grades/summary` | 成績、GPA、畢業學分進度 |
| 學生 | `GET /api/grades/export.csv` | **匯出成績單 CSV（含 BOM，Excel 可直接開啟）** |
| 學生 | `GET /api/my/attendance` | **出缺勤統計與明細** |
| 學生 | `GET /api/my/materials`、`GET /api/materials/:id/download` | 教材下載 |
| 教師 | `GET /api/teacher/courses` | 授課清單 |
| 教師 | `GET /api/teacher/courses/:id/roster?date=` | 選課名單＋當日出勤＋成績 |
| 教師 | `POST /api/teacher/courses/:id/attendance` | 批次點名 |
| 教師 | `POST /api/teacher/courses/:id/grades` | 儲存成績（自動算總分） |
| 教師 | `POST /api/teacher/courses/:id/publish` | 批次發布成績 |
| 教師 | `GET /api/teacher/courses/:id/export.csv` | **匯出該課成績 CSV** |
| 教師 | `GET/POST /api/teacher/courses/:id/materials`、`DELETE /api/teacher/materials/:mid` | 教材管理 |
| 管理員 | `GET/POST /api/admin/users`、`PATCH /api/admin/users/:id` | 帳號與角色 |
| 管理員 | `GET/POST /api/admin/courses`、`PATCH /api/admin/courses/:id` | 課程管理 |
| 管理員 | `GET/PUT /api/admin/settings` | 選課時間窗、畢業學分 |
| 管理員 | `GET/POST /api/admin/announcements`、`DELETE /api/admin/announcements/:id` | 校園公告管理 |
| 管理員 | `GET /api/admin/stats` | 統計分析 |

## 抽換資料庫（SQLite ⇄ PostgreSQL）

所有 SQL 都由 Knex 產生，`server.js` 不需修改，只要換連線設定：

```bash
# 預設 SQLite
npm run migrate && npm run seed && npm start

# 切換 PostgreSQL
$env:DB_CLIENT="pg"
$env:PG_USER="postgres"; $env:PG_PASSWORD="你的密碼"; $env:PG_DATABASE="nqu_system"
npm run migrate && npm run seed && npm start
```

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm start` | 啟動伺服器 |
| `npm run migrate` | 套用最新的資料表結構 |
| `npm run seed` | 寫入／更新測試資料（可重複執行） |
| `npm run migrate:make <name>` | 新增一個 migration 檔案 |
| `npm run db:reset` | 回滾 → 重新 migrate → seed |
| `node e2e-test.js` | 端對端 API 測試（需先啟動伺服器） |

## 端對端測試結果

```
[學生] login          : 200 student 歡迎回來, 林哲宇!
[學生] enroll CS101   : 200 已選課：程式設計
[學生] conflict PS101 : 409 與「程式設計」時間衝突
[教師] login          : 200 teacher 歡迎回來, 陳鍾誠!
[教師] my courses     : 200 共 3 門
[教師] attendance     : 200 已儲存 1 筆點名紀錄
[教師] save grades    : 200 已儲存 1 筆成績（尚未發布）
[教師] publish        : 200 已發布 1 筆成績
[學生] grades(已發布) : 200 CS101 總分=85.7 績點=3.7 GPA=3.7 已修=3/128
[學生] admin API      : 403 沒有權限執行此操作
[管理] create user    : 200 已建立帳號 123458
[管理] close window   : 200 選課時間已結束
[學生] 關窗時選課     : 403 選課時間已結束
[管理] reopen window  : 200 選課開放中（未設定時間窗）
[學生] 搜尋「資料」    : 200 命中 3 門：CS101/CS203/CS310
[學生] 系所篩選      : 200 資管系 3 門
[學生] 時段篩選      : 200 週二第3節 1 門
[學生] 公告(學生)    : 200 可見 2 則
[教師] 公告(教師)    : 200 可見 2 則
[管理] 發布公告      : 200 公告已發布
[管理] 刪除公告      : 200 公告已刪除
[學生] 出缺勤查詢    : 200 明細 1 筆，統計 1 門課
[學生] 成績單 CSV    : 200 BOM=true，含 GPA=true
[教師] 成績 CSV      : 200 BOM=true，含狀態=true
```

## 運作流程

1. **登入**：前端 `fetch` → `/api/login` → 發放 token 與角色 → 依角色導向學生／教師／管理頁
2. **權限控管**：後端中介層 `auth` + `requireRole`，非授權角色回 `403`
3. **選課**：transaction 檢查「時間窗 → 重複 → 額滿 → 時間衝突」後才寫入
4. **成績**：教師輸入 → 自動加權總分（未發布）→ 發布後學生才看得到 → 計算 GPA 與畢業學分進度 → 雙方可匯出 CSV
5. **點名／教材**：點名依日期 upsert，學生端可查詢出缺勤統計；教材存 `uploads/`，僅授課教師與選課學生可下載
6. **公告**：管理員發布並指定對象，學生／教師登入後僅看到自己有權限的公告
