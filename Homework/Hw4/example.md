# 分支範例（develop）

這個檔案是在 `develop` 分支上新增的，用來示範「建立分支 → 提交 → 合併」的流程。

## 步驟

1. 建立並切換分支：`git switch -c develop`
2. 新增/修改檔案：這個檔案就是成果
3. 提交：`git add .` → `git commit -m "..."`
4. 推送：`git push -u origin develop`
5. 合併回 main：
   ```powershell
   git switch main
   git merge develop
   git push origin main
   ```
