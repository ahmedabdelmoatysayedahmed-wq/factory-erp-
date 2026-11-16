# ============================================================
#  Factory ERP - automatic mode (one-time setup, Windows 10/11)
#  - Runs the program in the background when the PC starts (no window, no login needed)
#  - Restarts it automatically if it stops
#  - Updates it from GitHub every time the PC starts
#  - Lets phones on the same Wi-Fi open it (firewall rule)
#  - Stops the PC from going to sleep
#  - Copies the daily backup to OneDrive (if OneDrive is set up)
#  Run again any time: it is safe to repeat.
# ============================================================
# Continue: npm/winget write warnings to stderr, which Windows PowerShell 5.1 would treat as fatal under 'Stop'.
# Steps that must succeed use -ErrorAction Stop inside try/catch.
$ErrorActionPreference = 'Continue'
$App  = 'C:\FactoryERP'
$Repo = 'https://github.com/ahmedabdelmoatysayedahmed-wq/factory-erp-/archive/refs/heads/main.zip'
$Port = 3000
$Task = 'FactoryERP'

# --- run as administrator (Windows asks once: click Yes)
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
function Step($n, $text) { Write-Host ""; Write-Host "[$n/7] $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "[!] $text" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$npm  = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'

# --- 1) Node.js 22.13+ (has built-in SQLite)
Step 1 'Checking Node.js ...'
function NodeOk {
  if (-not (Test-Path $node)) { return $false }
  cmd /c "`"$node`" -e `"require('node:sqlite')`" >nul 2>nul"
  return $LASTEXITCODE -eq 0
}
if (-not (NodeOk)) {
  Write-Host '      Installing Node.js (only once) ...'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Null
  }
  if (-not (NodeOk)) {
    try {
      $v = (Invoke-RestMethod https://nodejs.org/dist/index.json -ErrorAction Stop | Where-Object { $_.lts } | Select-Object -First 1).version
      $msi = Join-Path $env:TEMP 'node-lts.msi'
      Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-x64.msi" -OutFile $msi -UseBasicParsing -ErrorAction Stop
      Start-Process msiexec -ArgumentList "/i `"$msi`" /passive" -Wait
    } catch { Write-Host "      $($_.Exception.Message)" }
  }
  if (-not (NodeOk)) { Fail 'Could not install Node.js. Install it from https://nodejs.org (LTS) and run this again.' }
}
Write-Host "      Node.js $(& $node -v) OK"

# --- 2) stop the program if it is running (old black window or old background task)
Step 2 'Stopping the program if it is running ...'
if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\app.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*FactoryERP\windows\service.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# --- 3) download the latest version into C:\FactoryERP (your data folder is never touched)
Step 3 "Downloading the program into $App ..."
$zip = Join-Path $env:TEMP 'factory-erp.zip'; $tmp = Join-Path $env:TEMP 'factory-erp-unzip'
try {
  Invoke-WebRequest $Repo -OutFile $zip -UseBasicParsing -ErrorAction Stop
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip $tmp -ErrorAction Stop
  $src = (Get-ChildItem $tmp | Select-Object -First 1).FullName
  New-Item -ItemType Directory -Force $App | Out-Null
  Copy-Item (Join-Path $src '*') $App -Recurse -Force -ErrorAction Stop
} catch { if (-not (Test-Path "$App\package.json")) { Fail "Download failed: $($_.Exception.Message)" } }

# move the data from the old place (the black-window version) the first time
$oldData = Join-Path $env:LOCALAPPDATA 'FactoryERP\data'
if (-not (Test-Path "$App\data\factory.db") -and (Test-Path "$oldData\factory.db")) {
  Write-Host '      Moving your existing data to the new place ...'
  New-Item -ItemType Directory -Force "$App\data" | Out-Null
  Copy-Item (Join-Path $oldData '*') "$App\data" -Recurse -Force
}

# --- 4) libraries
Step 4 'Preparing the program (first time takes a few minutes) ...'
Push-Location $App
& $npm install --omit=dev --no-audit --no-fund --loglevel=error
$ok = $LASTEXITCODE -eq 0
Pop-Location
if (-not $ok) { Fail 'Preparing the program failed. Check the internet connection and run this again.' }

# settings file: secret for logins + where to copy backups
New-Item -ItemType Directory -Force "$App\data" | Out-Null
$cfgFile = "$App\data\config.json"
$cfg = @{}
if (Test-Path $cfgFile) { $j = Get-Content $cfgFile -Raw | ConvertFrom-Json; $j.PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value } }
if (-not $cfg.sessionSecret) { $cfg.sessionSecret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
if (-not $cfg.backupCopyDir -and $env:OneDrive) { $cfg.backupCopyDir = Join-Path $env:OneDrive 'FactoryERP-Backups' }
$cfg | ConvertTo-Json | Set-Content $cfgFile -Encoding UTF8

# --- 5) phones on the same Wi-Fi + never sleep
Step 5 'Allowing phones on the Wi-Fi and turning off sleep ...'
Get-NetFirewallRule -DisplayName 'Factory ERP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Factory ERP' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

# --- 6) start automatically with Windows (before anyone logs in), restart if it stops
Step 6 'Setting the program to start automatically with Windows ...'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$App\windows\service.ps1`"" -WorkingDirectory $App
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $Task

# desktop icon just opens the program in the browser
$desk = [Environment]::GetFolderPath('Desktop')
Remove-Item (Join-Path $desk 'Factory ERP.lnk') -ErrorAction SilentlyContinue
Set-Content (Join-Path $desk 'Factory ERP.url') "[InternetShortcut]`r`nURL=http://localhost:$Port/`r`nIconFile=%SystemRoot%\System32\shell32.dll`r`nIconIndex=12" -Encoding ASCII

# --- 7) wait until it answers
Step 7 'Starting ...'
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) {
  Start-Sleep -Seconds 2
  try { $up = (Invoke-WebRequest "http://localhost:$Port/healthz" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop).Content -eq 'ok' } catch {}
}
if (-not $up) { Fail "The program did not start. Send a photo of this window and of the file $App\data\service.log" }

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ""
Write-Host "  Done. The program now runs by itself whenever this PC is on." -ForegroundColor Green
Write-Host "  On this PC : http://localhost:$Port   (desktop icon: Factory ERP)"
foreach ($ip in $ips) { Write-Host "  From phones: http://${ip}:$Port" }
if ($cfg.backupCopyDir) { Write-Host "  Backups are also copied to: $($cfg.backupCopyDir)" } else { Write-Host '  OneDrive is not set up on this PC: backups stay on this PC only.' -ForegroundColor Yellow }
Write-Host "  You can close this window."
Start-Process "http://localhost:$Port/"
Read-Host 'Press Enter to close'
