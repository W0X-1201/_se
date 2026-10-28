// ==========================================
// 3. E2E 測試 (Playwright Headless Browser)
// ==========================================
const { test, expect } = require('@playwright/test');

test('使用者可以進入頁面並成功新增待辦事項', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toHaveText('待辦清單');

  await page.fill('#todo-input', '利用 Playwright 進行 E2E 測試');
  await page.click('#add-btn');

  const newItem = page.locator('.todo-item').first();
  await expect(newItem).toBeVisible();
  await expect(newItem).toHaveText('利用 Playwright 進行 E2E 測試');
});
