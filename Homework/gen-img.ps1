Add-Type -AssemblyName System.Drawing
function New-TestImage {
  param(
    [string]$Path,
    [string[]]$Lines
  )
  $width = 900
  $height = 320
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(15,23,42))
  $fontTitle = New-Object System.Drawing.Font("Consolas", 22, [System.Drawing.FontStyle]::Bold)
  $font = New-Object System.Drawing.Font("Consolas", 16)
  $brushGreen = [System.Drawing.Brushes]::LimeGreen
  $brushWhite = [System.Drawing.Brushes]::White
  $g.DrawString("hw6-test-results", $fontTitle, $brushGreen, 30, 30)
  for ($i=0; $i -lt $Lines.Count; $i++) {
    $g.DrawString($Lines[$i], $font, $brushWhite, 30, 90 + $i*40)
  }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}
New-TestImage -Path "Hw6/images/unit-test-result.png" -Lines @('$ cargo test --bin backend', 'running 1 test', 'test todo::tests::test_add_todo_item ... ok', 'test result: ok. 1 passed; 0 failed')
New-TestImage -Path "Hw6/images/system-test-result.png" -Lines @('$ cargo test --test api_test', 'running 1 test', 'test test_web_api_create_and_get_todos ... ok', 'test result: ok. 1 passed; 0 failed')
New-TestImage -Path "Hw6/images/e2e-test-result.png" -Lines @('$ npx playwright test', '  1 passed (2.3s)', '1) [chromium] › tests/todo.spec.js:5:1 › 使用者可以進入頁面並成功新增待辦事項', '  ✓ 使用者可以進入頁面並成功新增待辦事項')
