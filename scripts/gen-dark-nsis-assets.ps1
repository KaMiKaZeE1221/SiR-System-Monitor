Add-Type -AssemblyName System.Drawing
$root = 'i:\SiR_System_Monitor\build'
New-Item -ItemType Directory -Force -Path $root | Out-Null
function New-DarkBitmap($path, $w, $h, $title, $subtitle) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $rect = New-Object System.Drawing.Rectangle(0,0,$w,$h)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(12,12,14), [System.Drawing.Color]::FromArgb(22,24,28), 90)
  $g.FillRectangle($bg, $rect)
  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(0,220,120), 2)
  $g.DrawLine($linePen, 0, 0, $w, 0)
  $g.DrawLine($linePen, 0, $h-1, $w, $h-1)
  $fontTitle = New-Object System.Drawing.Font('Segoe UI', [float]14, [System.Drawing.FontStyle]::Bold)
  $fontSub = New-Object System.Drawing.Font('Segoe UI', [float]9, [System.Drawing.FontStyle]::Regular)
  $titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235,235,235))
  $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(165,175,185))
  $g.DrawString($title, $fontTitle, $titleBrush, 12, 14)
  if ($subtitle) { $g.DrawString($subtitle, $fontSub, $subBrush, 12, 40) }
  $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0,220,120))
  $g.FillEllipse($dotBrush, $w - 20, 12, 8, 8)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $dotBrush.Dispose(); $subBrush.Dispose(); $titleBrush.Dispose(); $fontSub.Dispose(); $fontTitle.Dispose(); $linePen.Dispose(); $bg.Dispose(); $g.Dispose(); $bmp.Dispose()
}
New-DarkBitmap -path (Join-Path $root 'installerHeader.bmp') -w 150 -h 57 -title 'SiR System Monitor' -subtitle 'Setup Wizard'
New-DarkBitmap -path (Join-Path $root 'installerSidebar.bmp') -w 164 -h 314 -title 'SiR' -subtitle 'System Monitor'
New-DarkBitmap -path (Join-Path $root 'uninstallerSidebar.bmp') -w 164 -h 314 -title 'SiR' -subtitle 'Uninstaller'
Write-Host 'ok'
