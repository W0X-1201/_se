# MinimalFocus（Hw8 / Week 9）

以純 HTML / CSS / Vanilla JavaScript 打造的單頁專注儀表板，部署於 **Cloudflare Pages**。

## 功能

| 功能 | 說明 |
|------|------|
| 即時時鐘 | 每秒更新，依時段顯示問候語 |
| 番茄鐘 | 25 分鐘倒數，支援開始／暫停／重設 |
| 待辦清單 | 新增、勾選完成、刪除，狀態存於 LocalStorage |
| 深色毛玻璃介面 | 響應式設計，手機與桌機皆適用 |

## 專案結構

```
Hw8(week9)/
└── index.html    # 單一檔案，含樣式與邏輯
```

## 本機預覽

直接用瀏覽器開啟 `index.html` 即可，或啟動簡易伺服器：

```bash
npx serve .
```

## 部署到 Cloudflare Pages

### 方式 A：GitHub 自動部署

1. 將本資料夾 push 到 GitHub repository。
2. 登入 Cloudflare → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**。
3. 選擇 repository。
4. Framework preset 選 **None**，Build command 與 Output directory 留空。
5. 點擊 **Save and Deploy**，完成後取得 `https://<專案名稱>.pages.dev`。

### 方式 B：直接上傳

1. Cloudflare → **Workers & Pages** → **Create application** → **Pages** → **Upload assets**。
2. 輸入專案名稱，將本資料夾拖曳進去。
3. 點擊 **Deploy site**。

部署完成後，將取得的 `https://<專案名稱>.pages.dev` 網址填入根目錄 `README.md` 的 Hw8 欄位。
