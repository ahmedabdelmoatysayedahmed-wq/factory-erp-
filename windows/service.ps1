# Factory ERP background service - started by Windows (task "FactoryERP") when the PC starts.
# 1) updates the program from GitHub (if the internet is available), 2) runs it, and restarts it if it stops.
$App  = Split-Path $PSScriptRoot -Parent
$Repo = 'https://github.com/ahmedabdelmoatysayedahmed-wq/factory-erp-/archive/refs/heads/main.zip'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$npm  = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
$log  = Join-Path $App 'data\service.log'
New-Item -ItemType Directory -Force (Join-Path $App 'data') | Out-Null
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.old" -Force }
function Log($m) { Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
Set-Location $App

# --- update (wait up to ~2 minutes for the network after boot; on failure keep the current version)
$tmp = Join-Path $env:TEMP 'factory-erp-update'
for ($i = 0; $i -lt 12; $i++) {
  try {
    $zip = "$tmp.zip"
    Invoke-WebRequest $Repo -OutFile $zip -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip $tmp -ErrorAction Stop
    $src = (Get-ChildItem $tmp | Select-Object -First 1).FullName
    $before = if (Test-Path "$App\package-lock.json") { (Get-FileHash "$App\package-lock.json").Hash } else { '' }
    Copy-Item (Join-Path $src '*') $App -Recurse -Force -ErrorAction Stop
    if ($before -ne (Get-FileHash "$App\package-lock.json").Hash -or -not (Test-Path "$App\node_modules")) {
      & $npm install --omit=dev --no-audit --no-fund --loglevel=error *>> $log
    }
    Log 'Updated to the latest version'
    break
  } catch { Log "Update attempt failed: $($_.Exception.Message)"; Start-Sleep -Seconds 10 }
}

# --- run, and restart if it stops
while ($true) {
  Log 'Starting Factory ERP'
  $env:PORT = '3000'
  & $node 'src\app.js' *>> $log
  Log "Factory ERP stopped (exit code $LASTEXITCODE). Restarting in 5 seconds"
  Start-Sleep -Seconds 5
}
