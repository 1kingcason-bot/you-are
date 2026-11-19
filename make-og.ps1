# Renders public/og-image.png — the 1200x630 social share card for "you are".
Add-Type -AssemblyName System.Drawing

$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'ClearTypeGridFit'
$g.Clear([System.Drawing.Color]::FromArgb(255, 14, 15, 19))

# diagonal brand gradient wash
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.Color]::FromArgb(255, 124, 92, 255),
  [System.Drawing.Color]::FromArgb(255, 14, 15, 19), 45)
$g.FillRectangle($brush, $rect)

# teal glow bottom-right
$glow = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.Color]::FromArgb(0, 0, 212, 200),
  [System.Drawing.Color]::FromArgb(180, 14, 15, 19), -45)
$g.FillRectangle($glow, $rect)

# rounded logo tile
$tile = New-Object System.Drawing.Rectangle(90, 215, 200, 200)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 44
$path.AddArc($tile.X, $tile.Y, $r * 2, $r * 2, 180, 90)
$path.AddArc($tile.X + $tile.Width - $r * 2, $tile.Y, $r * 2, $r * 2, 270, 90)
$path.AddArc($tile.X + $tile.Width - $r * 2, $tile.Y + $tile.Height - $r * 2, $r * 2, $r * 2, 0, 90)
$path.AddArc($tile.X, $tile.Y + $tile.Height - $r * 2, $r * 2, $r * 2, 90, 90)
$path.CloseFigure()
$tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($tile,
  [System.Drawing.Color]::FromArgb(255, 124, 92, 255),
  [System.Drawing.Color]::FromArgb(255, 0, 212, 200), 45)
$g.FillPath($tileBrush, $path)

# waveform bars inside tile
$white = [System.Drawing.Brushes]::White
$bars = @(@(130, 300, 14, 30), @(154, 275, 14, 80), @(178, 250, 14, 130), @(202, 285, 14, 60), @(226, 305, 14, 20))
foreach ($b in $bars) {
  $rr = New-Object System.Drawing.Rectangle($b[0], $b[1], $b[2], $b[3])
  $p2 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $rad = 7
  $p2.AddArc($rr.X, $rr.Y, $rad * 2, $rad * 2, 180, 90)
  $p2.AddArc($rr.X + $rr.Width - $rad * 2, $rr.Y, $rad * 2, $rad * 2, 270, 90)
  $p2.AddArc($rr.X + $rr.Width - $rad * 2, $rr.Y + $rr.Height - $rad * 2, $rad * 2, $rad * 2, 0, 90)
  $p2.AddArc($rr.X, $rr.Y + $rr.Height - $rad * 2, $rad * 2, $rad * 2, 90, 90)
  $p2.CloseFigure()
  $g.FillPath($white, $p2)
}

# wordmark
$font1 = New-Object System.Drawing.Font('Bahnschrift SemiBold Condensed', 130, [System.Drawing.FontStyle]::Bold)
$g.DrawString('you are', $font1, $white, 340, 195)

# tagline
$font2 = New-Object System.Drawing.Font('Bahnschrift Light Condensed', 48)
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 210, 214, 228))
$g.DrawString('share your sound', $font2, $muted, 344, 360)

$g.Dispose()
$out = Join-Path $PSScriptRoot 'public\og-image.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $out"
