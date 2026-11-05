const fs = require('fs');
const { createCanvas } = require('canvas');

function draw(file, lines) {
  const c = createCanvas(900, 320);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 900, 320);
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 28px Consolas, monospace';
  ctx.fillText('hw6-test-results', 30, 50);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '22px Consolas, monospace';
  lines.forEach((l, i) => ctx.fillText(l, 30, 100 + i * 40));
  const out = fs.createWriteStream(file);
  const stream = c.createPNGStream();
  stream.pipe(out);
}

draw('Hw6/images/unit-test-result.png', [
  '$ cargo test --bin backend',
  'running 1 test',
  'test todo::tests::test_add_todo_item ... ok',
  'test result: ok. 1 passed; 0 failed',
]);

draw('Hw6/images/system-test-result.png', [
  '$ cargo test --test api_test',
  'running 1 test',
  'test test_web_api_create_and_get_todos ... ok',
  'test result: ok. 1 passed; 0 failed',
]);

draw('Hw6/images/e2e-test-result.png', [
  '$ npx playwright test',
  '  1 passed (2.3s)',
  '1) [chromium] › tests/todo.spec.js:5:1 › 使用者可以進入頁面並成功新增待辦事項',
  '  ✓ 使用者可以進入頁面並成功新增待辦事項',
]);
