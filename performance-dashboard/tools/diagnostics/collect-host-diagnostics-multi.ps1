[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$ComputerName,

    [string]$OutputDirectory = ".\diagnostics-output",

    [pscredential]$Credential,

    [switch]$SkipCertificateChecks,

    [switch]$StopOnError
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$collectorPath = Join-Path -Path $PSScriptRoot -ChildPath 'collect-host-diagnostics.ps1'
if (-not (Test-Path -Path $collectorPath)) {
    throw "Collector script not found at: $collectorPath"
}

if (-not (Test-Path -Path $OutputDirectory)) {
    New-Item -Path $OutputDirectory -ItemType Directory | Out-Null
}

$localhostNames = @('.', 'localhost', $env:COMPUTERNAME)
$results = New-Object System.Collections.Generic.List[object]

function New-SessionOptionIfNeeded {
    param([switch]$SkipChecks)

    if (-not $SkipChecks) {
        return $null
    }

    return New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
}

$sessionOption = New-SessionOptionIfNeeded -SkipChecks:$SkipCertificateChecks

foreach ($target in $ComputerName) {
    $hostName = "$target".Trim()
    if ([string]::IsNullOrWhiteSpace($hostName)) {
        continue
    }

    Write-Host "Collecting diagnostics from $hostName..."

    try {
        $rawJson = $null

        if ($localhostNames -contains $hostName.ToLowerInvariant()) {
            $rawJson = & $collectorPath
        }
        else {
            $invokeParams = @{
                ComputerName = $hostName
                FilePath = $collectorPath
                ErrorAction = 'Stop'
            }

            if ($Credential) {
                $invokeParams.Credential = $Credential
            }

            if ($sessionOption) {
                $invokeParams.SessionOption = $sessionOption
            }

            $rawJson = Invoke-Command @invokeParams
        }

        $jsonText = ($rawJson | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($jsonText)) {
            throw "No JSON payload returned from $hostName"
        }

        $payload = $jsonText | ConvertFrom-Json -ErrorAction Stop
        $safeName = ($hostName -replace '[^A-Za-z0-9_.-]', '_')
        $outputPath = Join-Path -Path $OutputDirectory -ChildPath ("{0}.host-diagnostics.json" -f $safeName)

        ($payload | ConvertTo-Json -Depth 10) | Set-Content -Path $outputPath -Encoding UTF8

        $results.Add([pscustomobject]@{
            computerName = $hostName
            status = 'ok'
            outputPath = $outputPath
            message = ''
        }) | Out-Null

        Write-Host "  OK -> $outputPath"
    }
    catch {
        $results.Add([pscustomobject]@{
            computerName = $hostName
            status = 'error'
            outputPath = ''
            message = $_.Exception.Message
        }) | Out-Null

        Write-Warning ("  FAILED -> {0}" -f $_.Exception.Message)

        if ($StopOnError) {
            throw
        }
    }
}

$summaryPath = Join-Path -Path $OutputDirectory -ChildPath 'summary.json'
($results | ConvertTo-Json -Depth 6) | Set-Content -Path $summaryPath -Encoding UTF8

$okCount = @($results | Where-Object { $_.status -eq 'ok' }).Count
$errorCount = @($results | Where-Object { $_.status -eq 'error' }).Count

Write-Host ''
Write-Host ("Completed. Success: {0}, Failed: {1}" -f $okCount, $errorCount)
Write-Host ("Summary: {0}" -f $summaryPath)

$results
