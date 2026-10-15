# ARACHNE — Global Command Installer for Windows
# Installs 'arachne' command into user PATH without requiring administrator privileges.

[CmdletBinding()]
param(
  [string]$InstallPath = (Join-Path $env:LOCALAPPDATA "Programs\Arachne\bin")
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Red
Write-Host "🕷️  ARACHNE GLOBAL COMMAND INSTALLER" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Red

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CliEntry = Join-Path $RepoRoot "bin\arachne.mjs"

if (-not (Test-Path $CliEntry)) {
  Write-Error "ARACHNE CLI entrypoint not found at: $CliEntry"
  exit 1
}

Write-Host "• Target Repository Root: $RepoRoot" -ForegroundColor Gray
Write-Host "• CLI Entrypoint:         $CliEntry" -ForegroundColor Gray
Write-Host "• Global Bin Directory:   $InstallPath" -ForegroundColor Gray

# Ensure target directory exists
if (-not (Test-Path $InstallPath)) {
  New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
  Write-Host "  Created directory: $InstallPath" -ForegroundColor Gray
}

# 1. Create arachne.cmd for Command Prompt (cmd.exe)
$CmdScript = Join-Path $InstallPath "arachne.cmd"
$CmdContent = @"
@echo off
node "$CliEntry" %*
"@
Set-Content -Path $CmdScript -Value $CmdContent -Encoding ASCII
Write-Host "  Created: $CmdScript" -ForegroundColor Gray

# 2. Create arachne.ps1 for PowerShell
$PsScript = Join-Path $InstallPath "arachne.ps1"
$PsContent = @"
& node "$CliEntry" @args
"@
Set-Content -Path $PsScript -Value $PsContent -Encoding ASCII
Write-Host "  Created: $PsScript" -ForegroundColor Gray

# 3. Create extensionless 'arachne' script for Git Bash / MSYS / WSL
$ShScript = Join-Path $InstallPath "arachne"
$CliEntryUnix = $CliEntry -replace '\\', '/'
$ShContent = @"
#!/bin/sh
exec node "$CliEntryUnix" "`$@"
"@
Set-Content -Path $ShScript -Value $ShContent -Encoding ASCII
Write-Host "  Created: $ShScript" -ForegroundColor Gray

# 4. Update User PATH in Registry (Persistent across reboots and new shell sessions)
$UserPath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
$PathEntries = ($UserPath -split ';') | Where-Object { $_ -ne "" }

if ($PathEntries -notcontains $InstallPath) {
  Write-Host "• Registering $InstallPath in User PATH..." -ForegroundColor White
  $NewUserPath = "$UserPath;$InstallPath".Trim(';')
  [System.Environment]::SetEnvironmentVariable("Path", $NewUserPath, [System.EnvironmentVariableTarget]::User)
  Write-Host "  User PATH registry successfully updated." -ForegroundColor White
} else {
  Write-Host "• $InstallPath is already in User PATH." -ForegroundColor Gray
}

# Update current process PATH so immediate verification works in active session
if ($env:Path -split ';' -notcontains $InstallPath) {
  $env:Path = "$InstallPath;$env:Path"
}

Write-Host "`n• Verifying global command execution..." -ForegroundColor White
try {
  $versionOutput = & "$CmdScript" --version
  Write-Host "  Verification successful: $versionOutput" -ForegroundColor White
} catch {
  Write-Warning "Could not execute wrapper directly: $_"
}

Write-Host "`n✅ ARACHNE installed globally!" -ForegroundColor Red
Write-Host "You can now run 'arachne' from any directory or terminal in Windows." -ForegroundColor White
Write-Host "Examples:" -ForegroundColor Gray
Write-Host "  arachne status" -ForegroundColor Gray
Write-Host "  arachne \"Investigate multi-agent systems\"" -ForegroundColor Gray
Write-Host "  arachne /help" -ForegroundColor Gray
