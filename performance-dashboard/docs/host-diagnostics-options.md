# Host Diagnostics Collection Options

This app can gather host diagnostics outside Delta by collecting directly from the Windows host.

## Option 1: Run Local Script On Target Host

Use the script at:

- tools/diagnostics/collect-host-diagnostics.ps1

Examples:

```powershell
# Pretty JSON to console
powershell -ExecutionPolicy Bypass -File .\tools\diagnostics\collect-host-diagnostics.ps1 -Pretty

# Save JSON to file
powershell -ExecutionPolicy Bypass -File .\tools\diagnostics\collect-host-diagnostics.ps1 -OutputPath C:\Temp\host-diagnostics.json -Pretty
```

## Option 2: Invoke Remotely Over WinRM

```powershell
Invoke-Command -ComputerName SERVER01 -ScriptBlock {
  powershell -ExecutionPolicy Bypass -File "C:\Path\To\collect-host-diagnostics.ps1" -Pretty
}
```

If the script is only on your operator machine, copy it first, or run the scriptblock contents directly via `Invoke-Command`.

## Option 4: Collect From Multiple Hosts In One Run

Use the multi-host wrapper:

- tools/diagnostics/collect-host-diagnostics-multi.ps1

Examples:

```powershell
# Single host (localhost)
powershell -ExecutionPolicy Bypass -File .\tools\diagnostics\collect-host-diagnostics-multi.ps1 -ComputerName localhost -OutputDirectory .\tools\diagnostics\out

# Multiple hosts
powershell -ExecutionPolicy Bypass -File .\tools\diagnostics\collect-host-diagnostics-multi.ps1 -ComputerName SERVER01,SERVER02,SERVER03 -OutputDirectory .\tools\diagnostics\out

# Multiple hosts with alternate credentials
$cred = Get-Credential
powershell -ExecutionPolicy Bypass -File .\tools\diagnostics\collect-host-diagnostics-multi.ps1 -ComputerName SERVER01,SERVER02 -Credential $cred -OutputDirectory .\tools\diagnostics\out
```

Output files:

- One JSON per host: `<host>.host-diagnostics.json`
- Run summary: `summary.json`

## Option 3: Agent Service

Wrap the script in a local scheduled task or lightweight service that writes JSON to a known path or serves HTTP.

Good for regular polling with a stable schema.

## Fields Gathered

- Windows: product/version/build/install date
- NVIDIA: GPU model(s), GPU count, driver versions
- Storage: physical disks, storage pools, virtual disks
- RAID0 assessment: best-effort via Storage Spaces metadata

## RAID Note

Hardware RAID behind a controller may not expose definitive RAID level through generic Windows cmdlets.

For high confidence RAID level, use vendor tools when available (for example StorCLI, MegaCLI, PERCCLI) and merge those results into the same JSON contract.

## JSON Contract

See schema:

- docs/host-diagnostics.schema.json
