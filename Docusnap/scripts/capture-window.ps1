# capture.ps1 — OS-level screenshot of a ScanFinder window (CDP capture hangs on this build).
# Usage: powershell -File capture.ps1 -TitleMatch "ScanFinder" -Out shot.png
# Captures the FIRST visible top-level window whose title matches. PrintWindow works even if
# partially occluded. -List prints candidate window titles instead.
param(
  [string]$TitleMatch = "ScanFinder",
  [string]$Out = "shot.png",
  [int]$OwnerPid = 0,      # restrict to windows of this process id (two ScanFinder instances)
  [switch]$List
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][W]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing
$found = New-Object System.Collections.ArrayList
$cb = {
  param($h, $l)
  if (-not [W]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][W]::GetWindowText($h, $sb, 512)
  $t = $sb.ToString()
  $procId = [uint32]0
  [void][W]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($t.Length -gt 0) { [void]$found.Add(@{ H = $h; T = $t; P = [int]$procId }) }
  return $true
}
[void][W]::EnumWindows($cb, [IntPtr]::Zero)
if ($List) { $found | ForEach-Object { Write-Output ("{0}  [pid {1}]" -f $_.T, $_.P) }; exit 0 }
$win = $found | Where-Object { $_.T -match $TitleMatch -and ($OwnerPid -eq 0 -or $_.P -eq $OwnerPid) } | Select-Object -First 1
if (-not $win) { Write-Error "no visible window matching '$TitleMatch'"; exit 1 }
$r = New-Object W+RECT
[void][W]::GetWindowRect($win.H, [ref]$r)
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Error "degenerate window rect"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [W]::PrintWindow($win.H, $hdc, 2)   # 2 = PW_RENDERFULLCONTENT (needed for Chromium surfaces)
$g.ReleaseHdc($hdc)
if (-not $ok) {   # fallback: copy from screen (window must be frontmost/unoccluded)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
}
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved {0} ({1}x{2}) from '{3}'" -f $Out, $w, $h, $win.T)
