# Server Under Test (SUT) Setup Guide

This guide covers how to prepare a Server Under Test so that the Performance Dashboard can connect to it, retrieve hardware telemetry, and capture configuration data.

---

## Prerequisites

Before beginning, confirm the following on the SUT:

- You have administrator rights on the SUT.
- The SUT is running Windows 10 or Windows 11.
- The Performance Dashboard monitoring machine can reach the SUT over the network.
- You know the IP address of the SUT (e.g. `100.89.16.34`).

---

## 1. LibreHardwareMonitor — Hardware Telemetry

LibreHardwareMonitor provides real-time hardware sensor data (CPU, GPU, memory, temperatures, clocks, power) via a local HTTP endpoint that the Performance Dashboard can poll remotely.

### 1.1 Copy LibreHardwareMonitor to the SUT

- Copy the LibreHardwareMonitor folder to a known location on the SUT, for example:
  `C:\Temp\LibreHardwareMonitor\`
- No installation is required. It runs as a standalone executable.

### 1.2 Launch LibreHardwareMonitor

- Run `LibreHardwareMonitor.exe` as Administrator.
- Administrator rights are required to access certain hardware sensors.

### 1.3 Enable the web server

1. In the LibreHardwareMonitor menu, go to **Options**.
2. Enable **Remote Web Server**.
3. Set the port to **8085** (or another agreed port).
4. Confirm the web server is shown as active.

### 1.4 Open the Windows Firewall for the chosen port

Run the following in PowerShell as Administrator on the SUT:

```powershell
New-NetFirewallRule -DisplayName "LibreHardwareMonitor Web Server" -Direction Inbound -Protocol TCP -LocalPort 8085 -Action Allow
```

### 1.5 Verify locally on the SUT

```powershell
Invoke-WebRequest http://localhost:8085
```

A successful response confirms LibreHardwareMonitor is serving data.

### 1.6 Verify remotely from the monitoring machine

Replace `<SUT-IP>` with the SUT's IP address:

```powershell
Test-NetConnection <SUT-IP> -Port 8085
Invoke-WebRequest http://<SUT-IP>:8085
```

---

## 2. Diagnostics Data Capture

The Performance Dashboard includes a PowerShell-based diagnostics collector that gathers OS, GPU, driver, and storage information from the SUT.

### 2.1 Copy the collector script to the SUT

From the monitoring machine, copy the following file to the SUT:

```
performance-dashboard\tools\diagnostics\collect-host-diagnostics.ps1
```

Suggested destination on the SUT:

```
C:\Temp\Diag\collect-host-diagnostics.ps1
```

### 2.2 Run the collector on the SUT

Run the following in PowerShell as Administrator on the SUT:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Temp\Diag\collect-host-diagnostics.ps1" -OutputPath "C:\Temp\Diag\host-diagnostics.json" -Pretty
```

Output is written to `C:\Temp\Diag\host-diagnostics.json`.

### 2.3 Retrieve the output from the monitoring machine

```powershell
Copy-Item "\\<SUT-IP>\C$\Temp\Diag\host-diagnostics.json" ".\tools\diagnostics\out\<SUT-NAME>.host-diagnostics.json" -Force
```

---

## 3. Delta Registry HTTP Server — Registry Snapshot

The Delta Registry HTTP Server is a Windows service that exposes the Delta section of the registry over HTTP. This allows the Performance Dashboard to retrieve a snapshot of the current Delta registry state and compare it against a known default factory baseline to identify any custom or non-standard configuration.

### 3.1 Copy the service to the SUT

Copy the `DeltaRegistryhttpServer_WindowsService.exe` file to a known location on the SUT, for example:

```
C:\Temp\DeltaRegistryHttpServer\
```

### 3.2 Open the Windows Firewall for the service port

Run the following in PowerShell as Administrator on the SUT:

```powershell
New-NetFirewallRule -DisplayName "Delta Registry HTTP Server" -Direction Inbound -Protocol TCP -LocalPort 4477 -Action Allow
```

### 3.3 Install the service

Open a terminal as Administrator in the folder containing the executable and run:

```powershell
.\DeltaRegistryhttpServer_WindowsService.exe install
```

Expected output:
```
> Installing service RegistryWebServer
> Service installed
```

### 3.4 Start the service

```powershell
.\DeltaRegistryhttpServer_WindowsService.exe start
```

Expected output:
```
> Starting service RegistryWebServer
```

### 3.5 Verify the endpoint

From the SUT or from the monitoring machine (replace `<SUT-IP>` with the SUT's IP address):

```powershell
Invoke-WebRequest http://<SUT-IP>:4477/registry
```

A successful response returns the Delta registry data in JSON format.

### 3.6 Usage

The registry snapshot is accessed at:

```
http://<SUT-IP>:4477/registry
```

This endpoint is used by the Performance Dashboard to:
1. Capture the current Delta registry state of the SUT.
2. Compare it against a stored default factory baseline.
3. Surface any added, removed, or modified Delta registry keys as part of the SUT configuration profile.

### 3.7 Removal after testing

Stop and uninstall the service when testing is complete:

```powershell
.\DeltaRegistryhttpServer_WindowsService.exe stop
.\DeltaRegistryhttpServer_WindowsService.exe uninstall
```

Remove the firewall rule:

```powershell
Remove-NetFirewallRule -DisplayName "Delta Registry HTTP Server"
```

Then delete the folder:

```powershell
Remove-Item -Path "C:\Temp\DeltaRegistryHttpServer" -Recurse -Force
```

---

## 4. PowerShell Remoting (WinRM) — Optional

If you want to run diagnostics collection remotely from the monitoring machine without logging into the SUT, PowerShell Remoting must be enabled on the SUT.

### 3.1 Enable remoting on the SUT

Run in PowerShell as Administrator on the SUT:

```powershell
Enable-PSRemoting -Force
```

### 3.2 Add the SUT to TrustedHosts on the monitoring machine

Run in PowerShell as Administrator on the monitoring machine:

```powershell
Set-Item -Path WSMan:\localhost\Client\TrustedHosts -Value "<SUT-IP>" -Force
```

### 3.3 Verify connectivity from the monitoring machine

```powershell
Test-WSMan <SUT-IP>
```

---

## 4. Removal and Cleanup After Testing

All tooling placed on the SUT should be removed after testing is complete. The following steps restore the SUT to its pre-test state.

### 4.1 Remove LibreHardwareMonitor

- Close LibreHardwareMonitor.
- Delete the LibreHardwareMonitor folder from the SUT.

### 4.2 Remove the firewall rule

```powershell
Remove-NetFirewallRule -DisplayName "LibreHardwareMonitor Web Server"
```

### 4.3 Remove diagnostics collector files

```powershell
Remove-Item -Path "C:\Temp\Diag" -Recurse -Force
```

### 4.4 Disable PowerShell Remoting (if enabled for this test)

```powershell
Disable-PSRemoting -Force
```

---

## 5. Quick Reference

| Task | Command / Location |
|---|---|
| Enable firewall for Libre | `New-NetFirewallRule -DisplayName "LibreHardwareMonitor Web Server" -Direction Inbound -Protocol TCP -LocalPort 8085 -Action Allow` |
| Verify Libre locally | `Invoke-WebRequest http://localhost:8085` |
| Verify Libre remotely | `Invoke-WebRequest http://<SUT-IP>:8085` |
| Run diagnostics collector | `powershell -ExecutionPolicy Bypass -File "C:\Temp\Diag\collect-host-diagnostics.ps1" -OutputPath "C:\Temp\Diag\host-diagnostics.json" -Pretty` |
| Remove firewall rule | `Remove-NetFirewallRule -DisplayName "LibreHardwareMonitor Web Server"` |
| Remove collector files | `Remove-Item -Path "C:\Temp\Diag" -Recurse -Force` |
| Open firewall for Delta Registry | `New-NetFirewallRule -DisplayName "Delta Registry HTTP Server" -Direction Inbound -Protocol TCP -LocalPort 4477 -Action Allow` |
| Install Delta Registry service | `.\DeltaRegistryhttpServer_WindowsService.exe install` |
| Start Delta Registry service | `.\DeltaRegistryhttpServer_WindowsService.exe start` |
| Access Delta registry snapshot | `http://<SUT-IP>:4477/registry` |
| Stop Delta Registry service | `.\DeltaRegistryhttpServer_WindowsService.exe stop` |
| Uninstall Delta Registry service | `.\DeltaRegistryhttpServer_WindowsService.exe uninstall` |
| Remove Delta Registry firewall rule | `Remove-NetFirewallRule -DisplayName "Delta Registry HTTP Server"` |
| Remove Delta Registry service files | `Remove-Item -Path "C:\Temp\DeltaRegistryHttpServer" -Recurse -Force` |

---

*This document is a living guide and will be updated as the project develops.*
