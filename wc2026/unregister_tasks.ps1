<#
.SYNOPSIS
    Removes all WC2026 scheduled tasks created by register_tasks.ps1.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File wc2026\unregister_tasks.ps1
#>

$ErrorActionPreference = "SilentlyContinue"

$tasks = Get-ScheduledTask -TaskPath "\WC2026\*"
if (-not $tasks) {
    Write-Host "No WC2026 tasks found." -ForegroundColor Yellow
    return
}

$count = 0
foreach ($t in $tasks) {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false
    Write-Host "[REMOVED] $($t.TaskName)" -ForegroundColor Green
    $count++
}
Write-Host ("-" * 50)
Write-Host "Removed $count WC2026 task(s)." -ForegroundColor Cyan
