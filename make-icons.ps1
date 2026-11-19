# Renders public/icon-192.png and public/icon-512.png — the PWA app icons.
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$Size, [string]$OutPath) {
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  # rounded-square gradient tile (padding ~10%)
  $pad = [int]($Size * 0.06)
  $tile = New-Object System.Drawing.Rectangle($pad, $pad, ($Size - $pad * 2), ($Size - $pad * 2))
  $rad = [int]($Size * 0.22)

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($tile.X, $tile.Y, $rad * 2, $rad * 2, 180, 90)
  $path.AddArc($tile.X + $tile.Width - $rad * 2, $tile.Y, $rad * 2, $rad * 2, 270, 90)
  $path.AddArc($tile.X + $tile.Width - $rad * 2, $tile.Y + $tile.Height - $rad * 2, $rad * 2, $rad * 2, 0, 90)
  $path.AddArc($tile.X, $tile.Y + $tile.Height - $rad * 2, $rad * 2, $rad * 2, 90, 90)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($tile,
    [System.Drawing.Color]::FromArgb(255, 124, 92, 255),
    [System.Drawing.Color]::FromArgb(255, 0, 212, 200), 45)
  $g.FillPath($brush, $path)

  # waveform bars, scaled to size
  $white = [System.Drawing.Brushes]::White
  $s = $Size / 64.0
  $bars = @(@(12, 27, 6, 10), @(22, 19, 6, 26), @(32, 13, 6, 38), @(42, 23, 6, 18), @(52, 29, 6, 6))
  foreach ($b in $bars) {
    $rr = New-Object System.Drawing.Rectangle(
      [int]($b[0] * $s), [int]($b[1] * $s),
      [Math]::Max(2, [int]($b[2] * $s)), [Math]::Max(2, [int]($b[3] * $s)))
    $p2 = New-Object System.Drawing.Drawing2D.GraphicsPath
    $rad2 = [Math]::Max(2, [int](3 * $s))
    $p2.AddArc($rr.X, $rr.Y, $rad2 * 2, $rad2 * 2, 180, 90)
    $p2.AddArc($rr.X + $rr.Width - $rad2 * 2, $rr.Y, $rad2 * 2, $rad2 * 2, 270, 90)
    $p2.AddArc($rr.X + $rr.Width - $rad2 * 2, $rr.Y + $rr.Height - $rad2 * 2, $rad2 * 2, $rad2 * 2, 0, 90)
    $p2.AddArc($rr.X, $rr.Y + $rr.Height - $rad2 * 2, $rad2 * 2, $rad2 * 2, 90, 90)
    $p2.CloseFigure()
    $g.FillPath($white, $p2)
  }

  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "saved $OutPath"
}

$pub = Join-Path $PSScriptRoot 'public'
New-Icon 192 (Join-Path $pub 'icon-192.png')
New-Icon 512 (Join-Path $pub 'icon-512.png')
