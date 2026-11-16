# Turns off automatic mode (the data in C:\FactoryERP\data is kept).
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""; exit
}
Stop-ScheduledTask -TaskName 'FactoryERP' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'FactoryERP' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\app.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-NetFirewallRule -DisplayName 'Factory ERP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Automatic mode is off. Your data is still in C:\FactoryERP\data' -ForegroundColor Green
Read-Host 'Press Enter to close'
