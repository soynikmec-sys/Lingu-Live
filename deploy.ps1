# Deploy local Lingo Live: build frontend + reinicio de frontend y backend.
# Uso: powershell -NoProfile -File deploy.ps1
# Pensado para lanzarse oculto en segundo plano. Progreso en el log.

$log = Join-Path $env:TEMP "opencode\livecast-deploy.log"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

"BUILD_START $(Get-Date)" >> $log

Set-Location (Join-Path $root "frontend")
npm run build >> $log 2>&1
if ($LASTEXITCODE -ne 0) {
  "BUILD_FAIL $(Get-Date)" >> $log
  exit 1
}

$feOld = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 3000 }).OwningProcess | Select-Object -Unique
if ($feOld) { Stop-Process -Id $feOld -Force -ErrorAction SilentlyContinue }

$beOld = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 3003 }).OwningProcess | Select-Object -Unique
if ($beOld) { Stop-Process -Id $beOld -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

$nextBin = Join-Path $root "frontend\node_modules\next\dist\bin\next"
Start-Process "C:\Program Files\nodejs\node.exe" `
  -ArgumentList @($nextBin, "start", "-p", "3000") `
  -WorkingDirectory (Join-Path $root "frontend") `
  -WindowStyle Hidden

Start-Process "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "src/index.js" `
  -WorkingDirectory (Join-Path $root "backend") `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $env:TEMP "opencode\livecast-be.log") `
  -RedirectStandardError (Join-Path $env:TEMP "opencode\livecast-be-err.log")

"DEPLOY_OK $(Get-Date)" >> $log
