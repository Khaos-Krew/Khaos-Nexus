$ErrorActionPreference = 'Stop'

$json = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($json)) { throw 'Routine payload was empty.' }
$routine = $json | ConvertFrom-Json

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NexusIdleonInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
'@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$VK_F12 = 0x7B
$shell = New-Object -ComObject WScript.Shell

function Assert-NotStopped {
  $state = [NexusIdleonInput]::GetAsyncKeyState($VK_F12)
  if (($state -band 0x8000) -ne 0) { throw 'Emergency stop requested with F12.' }
}

function Invoke-Click([int]$x, [int]$y, [bool]$doubleClick = $false) {
  [NexusIdleonInput]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 35
  [NexusIdleonInput]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  [NexusIdleonInput]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  if ($doubleClick) {
    Start-Sleep -Milliseconds 80
    [NexusIdleonInput]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    [NexusIdleonInput]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  }
}

foreach ($step in $routine.steps) {
  Assert-NotStopped
  switch ($step.type) {
    'focus-window' {
      if (-not $shell.AppActivate([string]$step.title)) { throw "Could not focus window: $($step.title)" }
      Start-Sleep -Milliseconds 250
    }
    'click' { Invoke-Click ([int]$step.x) ([int]$step.y) $false }
    'double-click' { Invoke-Click ([int]$step.x) ([int]$step.y) $true }
    'key' { [System.Windows.Forms.SendKeys]::SendWait([string]$step.keys) }
    'text' {
      $escaped = ([string]$step.text).Replace('{', '{{}').Replace('}', '{}}').Replace('+', '{+}').Replace('^', '{^}').Replace('%', '{%}').Replace('~', '{~}')
      [System.Windows.Forms.SendKeys]::SendWait($escaped)
    }
    'wait' { Start-Sleep -Milliseconds ([int]$step.ms) }
    default { throw "Unsupported step type at runtime: $($step.type)" }
  }
  if ($step.delayAfterMs) { Start-Sleep -Milliseconds ([int]$step.delayAfterMs) }
}

Write-Output "Completed $($routine.id) with $($routine.steps.Count) steps."
