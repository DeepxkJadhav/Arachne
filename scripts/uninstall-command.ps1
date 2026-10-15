# ARACHNE — Global Command Uninstaller for Windows
# Removes 'arachne' command wrapper and cleans User PATH.

[CmdletBinding()]
param(
  [string]$InstallPath = (Join-Path $env:LOCALAPPDATA "Programs\Arachne\bin")
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Red
Write-Host "🕷️  ARACHNE GLOBAL COMMAND UNINSTALLER" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Red

# 1. Remove from User PATH
$UserPath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
$PathEntries = ($UserPath -split ';') | Where-Object { $_ -ne "" -and $_ -ne $InstallPath }
$NewUserPath = ($PathEntries -join ';')
[System.Environment]::SetEnvironmentVariable("Path", $NewUserPath, [System.EnvironmentVariableTarget]::User)
Write-Host "• Removed $InstallPath from User PATH." -ForegroundColor White

# Update active process PATH
$CurrentEntries = ($env:Path -split ';') | Where-Object { $_ -ne "" -and $_ -ne $InstallPath }
$env:Path = ($CurrentEntries -join ';')

# 2. Remove files and directory
if (Test-Path $InstallPath) {
  Remove-Item -Path $InstallPath -Recurse -Force
  Write-Host "• Deleted directory: $InstallPath" -ForegroundColor White
} else {
  Write-Host "• Directory $InstallPath does not exist." -ForegroundColor Gray
}

Write-Host "`n✅ ARACHNE global command uninstalled successfully." -ForegroundColor Red
