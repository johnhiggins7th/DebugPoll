[CmdletBinding()]
param(
    [string]$OutputPath,
    [switch]$Pretty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RegistryValue {
    param(
        [string]$Path,
        [string]$Name
    )

    try {
        return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
    }
    catch {
        return $null
    }
}

function Join-Status {
    param([object]$Value)

    if ($null -eq $Value) {
        return ''
    }

    if ($Value -is [System.Array]) {
        return ($Value | ForEach-Object { "$($_)" }) -join ', '
    }

    return "$Value"
}

function Get-Int64OrNull {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    try {
        return [int64]$Value
    }
    catch {
        return $null
    }
}

function Convert-ToUtcIsoOrNull {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [datetime]) {
        return $Value.ToUniversalTime().ToString('o')
    }

    $asString = "$Value"

    try {
        return ([System.Management.ManagementDateTimeConverter]::ToDateTime($asString)).ToUniversalTime().ToString('o')
    }
    catch {
        try {
            return ([datetime]$asString).ToUniversalTime().ToString('o')
        }
        catch {
            return $null
        }
    }
}

$osCim = Get-CimInstance -ClassName Win32_OperatingSystem
$regPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'

$displayVersion = Get-RegistryValue -Path $regPath -Name 'DisplayVersion'
$releaseId = Get-RegistryValue -Path $regPath -Name 'ReleaseId'
$currentBuild = Get-RegistryValue -Path $regPath -Name 'CurrentBuild'
$ubr = Get-RegistryValue -Path $regPath -Name 'UBR'

$winBuild = if ($currentBuild -and $ubr -ne $null) {
    "$currentBuild.$ubr"
}
elseif ($currentBuild) {
    "$currentBuild"
}
else {
    "$($osCim.BuildNumber)"
}

$displayAdapters = @(
    Get-CimInstance -ClassName Win32_VideoController |
        Where-Object { $_.Name -match 'NVIDIA' }
)

$displayDrivers = @(
    Get-CimInstance -ClassName Win32_PnPSignedDriver |
        Where-Object {
            $_.DeviceClass -eq 'DISPLAY' -and
            ($_.Manufacturer -match 'NVIDIA' -or $_.DriverProviderName -match 'NVIDIA' -or $_.DeviceName -match 'NVIDIA')
        }
)

$storageModulePresent = [bool](Get-Command -Name Get-PhysicalDisk -ErrorAction SilentlyContinue)

$physicalDisks = @()
$virtualDisks = @()
$storagePools = @()
$raidNotes = New-Object System.Collections.Generic.List[string]
$raidDetected = $false
$raidConfidence = 'none'
$raidMethod = 'No explicit RAID metadata found.'

if ($storageModulePresent) {
    $physicalDisks = @(
        Get-PhysicalDisk | ForEach-Object {
            [pscustomobject]@{
                friendlyName = "$($_.FriendlyName)"
                serialNumber = "$($_.SerialNumber)"
                mediaType = "$($_.MediaType)"
                busType = "$($_.BusType)"
                canPool = if ($null -ne $_.CanPool) { [bool]$_.CanPool } else { $null }
                operationalStatus = Join-Status $_.OperationalStatus
                healthStatus = "$($_.HealthStatus)"
                sizeBytes = Get-Int64OrNull $_.Size
            }
        }
    )

    $virtualDisks = @(
        Get-VirtualDisk -ErrorAction SilentlyContinue | ForEach-Object {
            [pscustomobject]@{
                friendlyName = "$($_.FriendlyName)"
                resiliencySettingName = "$($_.ResiliencySettingName)"
                provisioningType = "$($_.ProvisioningType)"
                healthStatus = "$($_.HealthStatus)"
                operationalStatus = Join-Status $_.OperationalStatus
                footprintOnPoolBytes = Get-Int64OrNull $_.FootprintOnPool
                sizeBytes = Get-Int64OrNull $_.Size
            }
        }
    )

    $storagePools = @(
        Get-StoragePool -ErrorAction SilentlyContinue | ForEach-Object {
            [pscustomobject]@{
                friendlyName = "$($_.FriendlyName)"
                isPrimordial = if ($null -ne $_.IsPrimordial) { [bool]$_.IsPrimordial } else { $null }
                healthStatus = "$($_.HealthStatus)"
                operationalStatus = Join-Status $_.OperationalStatus
            }
        }
    )

    foreach ($vd in $virtualDisks) {
        if ($vd.resiliencySettingName -match '^Simple$') {
            $raidDetected = $true
            $raidConfidence = 'medium'
            $raidMethod = 'Storage Spaces virtual disk with resiliency Simple (striped) found.'
            $raidNotes.Add("Virtual disk '$($vd.friendlyName)' reports ResiliencySettingName=Simple.") | Out-Null
        }
    }

    if (-not $raidDetected) {
        $raidNotes.Add('No Storage Spaces virtual disk with ResiliencySettingName=Simple was detected.') | Out-Null
    }
}
else {
    $raidNotes.Add('Storage cmdlets are unavailable; falling back to Win32_DiskDrive and RAID cannot be inferred reliably.') | Out-Null

    $physicalDisks = @(
        Get-CimInstance -ClassName Win32_DiskDrive | ForEach-Object {
            [pscustomobject]@{
                friendlyName = "$($_.Model)"
                serialNumber = "$($_.SerialNumber)"
                mediaType = "$($_.MediaType)"
                busType = "$($_.InterfaceType)"
                canPool = $null
                operationalStatus = ''
                healthStatus = ''
                sizeBytes = Get-Int64OrNull $_.Size
            }
        }
    )
}

$logicalDisks = @(
    Get-Disk -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{
            diskNumber      = $_.Number
            friendlyName    = "$($_.FriendlyName)"
            serialNumber    = "$($_.SerialNumber)"
            sizeBytes       = Get-Int64OrNull $_.Size
            partitionStyle  = "$($_.PartitionStyle)"
            operationalStatus = Join-Status $_.OperationalStatus
            healthStatus    = "$($_.HealthStatus)"
        }
    }
)

$partitions = @(
    Get-Partition -ErrorAction SilentlyContinue |
        Where-Object { $_.DriveLetter } |
        ForEach-Object {
            [pscustomobject]@{
                diskNumber      = $_.DiskNumber
                partitionNumber = $_.PartitionNumber
                driveLetter     = "$($_.DriveLetter)"
                sizeBytes       = Get-Int64OrNull $_.Size
                type            = "$($_.Type)"
            }
        }
)

$volumes = @(
    Get-Volume -ErrorAction SilentlyContinue |
        Where-Object { $_.DriveLetter } |
        ForEach-Object {
            [pscustomobject]@{
                driveLetter     = "$($_.DriveLetter)"
                fileSystem      = "$($_.FileSystem)"
                fileSystemLabel = "$($_.FileSystemLabel)"
                sizeBytes       = Get-Int64OrNull $_.Size
                sizeRemainingBytes = Get-Int64OrNull $_.SizeRemaining
                healthStatus    = "$($_.HealthStatus)"
                driveType       = "$($_.DriveType)"
            }
        }
)

$result = [pscustomobject]@{
    collectedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    computerName = $env:COMPUTERNAME
    os = [pscustomobject]@{
        caption = "$($osCim.Caption)"
        version = "$($osCim.Version)"
        build = "$winBuild"
        displayVersion = if ($displayVersion) { "$displayVersion" } else { '' }
        releaseId = if ($releaseId) { "$releaseId" } else { '' }
        installDateUtc = Convert-ToUtcIsoOrNull $osCim.InstallDate
    }
    nvidia = [pscustomobject]@{
        gpuCount = $displayAdapters.Count
        gpus = @(
            $displayAdapters | ForEach-Object {
                [pscustomobject]@{
                    name = "$($_.Name)"
                    driverVersion = "$($_.DriverVersion)"
                    pnpDeviceId = "$($_.PNPDeviceID)"
                    adapterRamBytes = Get-Int64OrNull $_.AdapterRAM
                }
            }
        )
        displayDrivers = @(
            $displayDrivers | ForEach-Object {
                [pscustomobject]@{
                    deviceName = "$($_.DeviceName)"
                    driverVersion = "$($_.DriverVersion)"
                    driverDate = if ($_.DriverDate) { ([datetime]$_.DriverDate).ToUniversalTime().ToString('o') } else { $null }
                    providerName = if ($_.DriverProviderName) { "$($_.DriverProviderName)" } else { "$($_.Manufacturer)" }
                }
            }
        )
    }
    storage = [pscustomobject]@{
        physicalDisks = $physicalDisks
        logicalDisks = $logicalDisks
        partitions = $partitions
        volumes = $volumes
        virtualDisks = $virtualDisks
        storagePools = $storagePools
        raid0Assessment = [pscustomobject]@{
            isRaid0Detected = $raidDetected
            confidence = $raidConfidence
            method = $raidMethod
            notes = @($raidNotes)
        }
    }
}

$jsonDepth = 8
if ($Pretty) {
    $json = $result | ConvertTo-Json -Depth $jsonDepth
}
else {
    $json = $result | ConvertTo-Json -Depth $jsonDepth -Compress
}

if ($OutputPath) {
    $json | Set-Content -Path $OutputPath -Encoding UTF8
    Write-Output "Wrote diagnostics JSON to $OutputPath"
}
else {
    Write-Output $json
}
