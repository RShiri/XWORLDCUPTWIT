<#
.SYNOPSIS
    Registers one Windows Scheduled Task per remaining WC2026 match.

    Each task fires once at the match's scrape time (kick-off + 2h, Israel local
    time) and runs the combined one-shot:

        python -m wc2026.run_match --fotmob-id <ID>

    which scrapes the finished match, renders the dashboard PNG, pushes it to
    GitHub, and posts it to X.

.DESCRIPTION
    Reads wc2026/REMAINING_SCHEDULE.json (produced by the schedule generator).
    Tasks are created in the Task Scheduler folder "\WC2026\".
    Times in the JSON are already Israel local time = this PC's local time, so
    they map directly onto Task Scheduler triggers.

.PARAMETER DaysAhead
    Only register matches whose scrape time is within this many days from now.
    Default 60 (all of them). Use e.g. -DaysAhead 3 for just the next 3 days.

.PARAMETER NoPost
    Register tasks that render + push but do NOT post to X (adds --no-post).

.PARAMETER WhatIf
    Show what would be registered without creating any tasks.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1
    powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1 -DaysAhead 3
    powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1 -WhatIf
#>

param(
    [int]    $DaysAhead = 60,
    [switch] $NoPost,
    [switch] $WhatIf
)

$ErrorActionPreference = "Stop"

# Paths
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\wc2026
$RepoRoot     = Split-Path -Parent $ScriptDir                        # ...\BCNFINAL
$ScheduleJson = Join-Path $ScriptDir "REMAINING_SCHEDULE.json"
$PythonExe    = "C:\Users\puzik\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$TaskFolder   = "\WC2026"

if (-not (Test-Path $ScheduleJson)) {
    Write-Error "Schedule file not found: $ScheduleJson. Run the schedule generator first."
    exit 1
}
if (-not (Test-Path $PythonExe)) {
    Write-Warning "Python not found at $PythonExe - falling back to 'py'. Verify it resolves under Task Scheduler."
    $PythonExe = (Get-Command py).Source
}

$games  = Get-Content $ScheduleJson -Raw -Encoding UTF8 | ConvertFrom-Json
$now    = Get-Date
$cutoff = $now.AddDays($DaysAhead)

$cutoffStr = $cutoff.ToString('yyyy-MM-dd HH:mm')
$postFlag  = -not $NoPost

Write-Host ""
Write-Host "WC2026 Task Registration" -ForegroundColor Cyan
Write-Host ("=" * 70)
Write-Host "Python      : $PythonExe"
Write-Host "Working dir : $RepoRoot"
Write-Host "Task folder : Task Scheduler $TaskFolder"
Write-Host "Post to X   : $postFlag"
Write-Host "Window      : now to $cutoffStr  [$DaysAhead days]"
Write-Host ("=" * 70)

$registered  = 0
$skippedPast = 0
$skippedFar  = 0

foreach ($g in $games) {
    # scrape_at_israel = "yyyy-MM-dd HH:mm" in this PC local time
    $scrapeAt = [datetime]::ParseExact($g.scrape_at_israel, 'yyyy-MM-dd HH:mm', $null)

    if ($scrapeAt -le $now)    { $skippedPast++; continue }
    if ($scrapeAt -gt $cutoff) { $skippedFar++;  continue }

    $hName = ($g.home -replace '[^A-Za-z0-9]', '')
    $aName = ($g.away -replace '[^A-Za-z0-9]', '')
    $fid   = $g.fotmob_id
    $taskName = "WC2026_" + $fid + "_" + $hName + "_vs_" + $aName

    $pyArgs = "-m wc2026.run_match --fotmob-id " + $fid
    if ($NoPost) { $pyArgs = $pyArgs + " --no-post" }

    $label = $fid.ToString() + "  " + $g.home + " vs " + $g.away + "  scrape " + $g.scrape_at_israel

    if ($WhatIf) {
        Write-Host ("[WHATIF] " + $label) -ForegroundColor DarkGray
        $registered++
        continue
    }

    $action  = New-ScheduledTaskAction -Execute $PythonExe -Argument $pyArgs -WorkingDirectory $RepoRoot
    $trigger = New-ScheduledTaskTrigger -Once -At $scrapeAt
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

    Register-ScheduledTask -TaskName $taskName -TaskPath $TaskFolder -Action $action -Trigger $trigger -Settings $settings -Description ("WC2026 auto scrape render post " + $g.home + " vs " + $g.away) -Force | Out-Null

    Write-Host ("[OK]     " + $label) -ForegroundColor Green
    $registered++
}

Write-Host ("=" * 70)
Write-Host "Registered : $registered" -ForegroundColor Cyan
Write-Host "Skipped (already past)      : $skippedPast"
Write-Host "Skipped (beyond -DaysAhead) : $skippedFar"
Write-Host ""
Write-Host "View tasks:   Get-ScheduledTask -TaskPath '\WC2026\*'"
Write-Host "Remove all:   powershell -ExecutionPolicy Bypass -File wc2026\unregister_tasks.ps1"
Write-Host ""
