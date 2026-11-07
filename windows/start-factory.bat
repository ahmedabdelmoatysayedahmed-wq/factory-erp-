@echo off
setlocal
title Factory ERP
rem ============================================================
rem  Factory ERP - install / update / start (Windows)
rem  Double-click this file. Run it again any time to update.
rem ============================================================
set "APP=%LOCALAPPDATA%\FactoryERP"
set "REPO=https://github.com/ahmedabdelmoatysayedahmed-wq/factory-erp-/archive/refs/heads/main.zip"
set "PORT=3000"

echo.
echo  ==========================================
echo    Factory ERP
echo  ==========================================
echo.

rem ---------- 1) Node.js ----------
echo [1/4] Checking Node.js ...
where node >nul 2>nul && goto node_ok
if exist "%ProgramFiles%\nodejs\node.exe" goto node_path
echo       Node.js not found. Installing it now (this happens only once) ...
where winget >nul 2>nul && winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" goto node_path
echo       Downloading Node.js installer ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $v=(Invoke-RestMethod https://nodejs.org/dist/index.json | Where-Object { $_.lts } | Select-Object -First 1).version; Invoke-WebRequest \"https://nodejs.org/dist/$v/node-$v-x64.msi\" -OutFile \"$env:TEMP\node-lts.msi\" -UseBasicParsing"
if errorlevel 1 goto fail_node
echo       Installing Node.js - click Yes if Windows asks for permission ...
msiexec /i "%TEMP%\node-lts.msi" /passive
if not exist "%ProgramFiles%\nodejs\node.exe" goto fail_node
:node_path
set "PATH=%ProgramFiles%\nodejs;%PATH%"
:node_ok
for /f "delims=" %%v in ('node -v') do echo       Node.js %%v OK

rem ---------- 2) Download latest version ----------
echo [2/4] Downloading the latest version of the program ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $z=Join-Path $env:TEMP 'factory-erp.zip'; $t=Join-Path $env:TEMP 'factory-erp-unzip'; Invoke-WebRequest '%REPO%' -OutFile $z -UseBasicParsing; if (Test-Path $t) { Remove-Item $t -Recurse -Force }; Expand-Archive $z $t; $src=(Get-ChildItem $t | Select-Object -First 1).FullName; New-Item -ItemType Directory -Force '%APP%' | Out-Null; Copy-Item (Join-Path $src '*') '%APP%' -Recurse -Force"
if not errorlevel 1 goto downloaded
if exist "%APP%\package.json" (
  echo       Could not download an update. Starting the version already installed.
  goto downloaded
)
goto fail_download
:downloaded
cd /d "%APP%"

rem ---------- 3) Libraries ----------
echo [3/4] Preparing the program (first time takes a few minutes) ...
call npm install --omit=dev --no-audit --no-fund --loglevel=error
if errorlevel 1 goto fail_npm

if exist "data\factory.db" goto have_db
echo.
choice /C YN /M "      Add DEMO data (sample employees, machines, production) to try the program"
if errorlevel 2 goto have_db
call npm run seed-demo --silent
:have_db

rem Desktop shortcut (to start the program next time)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Factory ERP.lnk')); $s.TargetPath='%APP%\windows\start-factory.bat'; $s.WorkingDirectory='%APP%'; $s.IconLocation='%SystemRoot%\System32\shell32.dll,12'; $s.Save()" >nul 2>nul

rem ---------- 4) Start ----------
echo [4/4] Starting ...
echo.
echo  ------------------------------------------------------------
echo   The program opens in your browser:  http://localhost:%PORT%
echo   First login:  admin  /  admin123   (change it after login)
echo.
echo   KEEP THIS WINDOW OPEN while you use the program.
echo   Closing it stops the program.
echo.
echo   If Windows Firewall asks, click "Allow" so phones on the
echo   same Wi-Fi can open the program too.
echo  ------------------------------------------------------------
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"
set "PORT=%PORT%"
node src\app.js
echo.
echo The program stopped.
pause
exit /b 0

:fail_node
echo.
echo  [!] Could not install Node.js automatically.
echo      Install it from https://nodejs.org (LTS) then run this file again.
pause
exit /b 1
:fail_download
echo.
echo  [!] Could not download the program. Check the internet connection and try again.
pause
exit /b 1
:fail_npm
echo.
echo  [!] Preparing the program failed. Check the internet connection and try again.
pause
exit /b 1
