# Git / GitHub 操作說明（作業 4）

本文件說明如何完成：**1. 建立分支　2. 合併　3. Fork　4. Pull Request**，包含需要下的指令，以及在 GitHub 網站上要做的動作。

---

## 0. 事前準備

```powershell
git --version                 # 確認已安裝 Git
git config --global user.name  "你的名字"
git config --global user.email "你的信箱"
```

---

## 1. 建立分支（branch）

分支讓你可以在不影響 `main` 的情況下開發新功能。

### 指令

```powershell
# 建立並切換到新分支（最常用）
git switch -c feature/login
# 舊寫法：git checkout -b feature/login

# 查看目前所有分支（* 為當前分支）
git branch

# 切換回 main
git switch main

# 把「本地分支」推上 GitHub，並設定追蹤
git push -u origin feature/login
```

### GitHub 網站操作
- 進入專案首頁 → 點左上角分支下拉選單（預設顯示 `main`）→ 在搜尋框輸入新分支名稱 → 點 **Create branch: xxx**。

---

## 2. 合併（merge）

把分支的修改併回主要分支。

### 指令

```powershell
# 1. 先切回要「接收」變更的分支（通常是 main）
git switch main

# 2. 確保 main 是最新的
git pull origin main

# 3. 合併目標分支
git merge feature/login

# 4. 推送結果上 GitHub
git push origin main

# 合併完成後刪除已不需要的分支
git branch -d feature/login                 # 刪本地
git push origin --delete feature/login      # 刪遠端
```

### 發生衝突（conflict）時
```powershell
git status                    # 找出衝突檔案
# 手動編輯檔案，保留要的內容並移除 <<<<<<< ======= >>>>>>> 標記
git add <衝突檔案>
git commit                    # 完成合併提交
```

### 合併方式比較

| 指令 | 說明 |
|---|---|
| `git merge <branch>` | 保留完整歷史（可能產生 merge commit） |
| `git merge --no-ff <branch>` | 強制產生 merge commit |
| `git rebase <branch>` | 把分支基底搬到最新，歷史呈線性 |
| `git merge --squash <branch>` | 把該分支所有提交壓成一個 |

### GitHub 網站操作
- 開啟 Pull Request（見第 4 節）→ 點綠色的 **Merge pull request** 按鈕即可線上合併。

---

## 3. Fork

Fork 是「把別人的專案複製一份到自己的 GitHub 帳號」，常用於參與開源專案。**Fork 沒有 git 指令，只能在 GitHub 網站操作。**

### GitHub 網站操作
1. 開啟要 Fork 的專案頁面（例如 `https://github.com/W0X-1201/_se`）。
2. 點右上角的 **Fork** 按鈕 → **Create fork**。
3. 完成後，你的帳號下會出現一份 `https://github.com/<你的帳號>/_se`。

### 把 Fork 下載到本機並與原專案同步

```powershell
# 下載自己的 fork
git clone https://github.com/<你的帳號>/_se.git
cd _se

# 加入「原專案」為 upstream（遠端）
git remote add upstream https://github.com/W0X-1201/_se.git

# 查看遠端
git remote -v

# 之後要同步原專案的最新變更
git fetch upstream
git switch main
git merge upstream/main          # 或 git rebase upstream/main
git push origin main             # 更新自己的 fork
```

---

## 4. Pull Request（PR）

Pull Request 是「請求把某個分支（或 fork）的修改合併回目標專案」。**PR 只能在 GitHub 網站建立。**

### 流程

1. 先把你本機的修改推上 GitHub：
   ```powershell
   git switch -c feature/login
   git add .
   git commit -m "Add login feature"
   git push -u origin feature/login
   ```
2. 到 GitHub 專案頁面 → 會出現黃色提示條，點 **Compare & pull request**。
   （或點 **Pull requests** 分頁 → **New pull request**，手動選擇 `base` 與 `compare` 分支。）
3. 填寫標題與說明，指定 Reviewers / Assignees / Labels。
4. 點 **Create pull request**。
5. 等待審查：審查者可留言、要求修改。你只要再 `git push` 到同一分支，PR 會自動更新。
6. 通過後點 **Merge pull request** 合併。
7. 可點 **Delete branch** 刪除已合併的分支。

### 用 GitHub CLI（可選）
```powershell
gh auth login
gh pr create --base main --head feature/login --title "Add login" --body "說明"
gh pr list
gh pr merge <PR編號> --merge
```

---

## 5. 實作範例（本專案實際操作）

以下是在本專案（`W0X-1201/_se`）實際做過的完整流程。

### 5-1 建立 `develop` 分支

```powershell
git switch -c develop
git push -u origin develop
```

### 5-2 在分支上新增檔案並提交

建立 `Hw4/example.md` 後：

```powershell
git add Hw4/example.md
git commit -m "Add develop branch example"
git push origin develop
```

### 5-3 合併回 `main`

```powershell
git switch main
git merge develop --no-ff -m "Merge develop: add example"
git push origin main
```

### 成果連結

| 項目 | 連結 |
|---|---|
| `develop` 分支 | https://github.com/W0X-1201/_se/tree/develop |
| `main` 提交紀錄 | https://github.com/W0X-1201/_se/commits/main |

---

## 快速對照表

| 目標 | 主要指令 | 網站動作 |
|---|---|---|
| 1. 建立分支 | `git switch -c <name>`、`git push -u origin <name>` | 分支下拉選單 → Create branch |
| 2. 合併 | `git switch main` → `git merge <branch>` → `git push` | PR 頁點 Merge pull request |
| 3. Fork | 無（用 `git remote add upstream` 同步） | 專案頁點 **Fork** |
| 4. Pull Request | `git push`（CLI：`gh pr create`） | 點 **Compare & pull request** → Create |
