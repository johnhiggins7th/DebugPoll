# Constraints & Limitations

## Technical Constraints

### Electron Version
- **Version**: 31.7.7 (latest stable as of project creation)
- **Chromium**: 127 (H.264 support via FFmpeg bundle)
- **Node.js**: 20.x
- **Windows target**: Windows 10+, build 19041+

**Implication**: Features depend on Electron/Chromium capabilities. Major version upgrades may break preload API or IPC behavior.

---

### TCP Protocol (Delta Server)
- **Connection**: Single persistent socket per session (no multiplexing)
- **Port**: 23 (fixed by Delta spec, non-standard; may conflict with SSH)
- **Line endings**: Mixed `\r\n` and `\n\r` (non-standard; main.js has quirky split logic)
- **Buffer size**: Unlimited (risk of OOM if server sends massive response)
- **JSON response**: Can be 15–25 KB; dashboard waits for complete object before parsing

**Implication**: 
- Cannot open multiple Delta connections simultaneously (TCP port conflict)
- TCP parsing logic is fragile (depends on precise line-ending detection)
- No compression or batching protocol (raw text over TCP)

---

### HTTP Constraints (Registry / Hardware Sensors)
- **Port 4477**: Non-standard; requires explicit firewall rule
- **Port 8085**: LibreHardwareMonitor default; may conflict with other services
- **Timeout**: 8 seconds hard-coded (not user-configurable)
- **No TLS**: Registry HTTP endpoint not encrypted (assumed trusted LAN)

**Implication**:
- SUT setup guide must explicitly document firewall rules
- Cannot use HTTPS (Delta does not provide certs)
- Timeout too short if network is congested → no retry logic

---

### localStorage Limitations
- **Max size**: ~5 MB per origin (browser limit)
- **No sync**: Profiles do not sync across machines (operator must export/import)
- **No expiration**: Old sessions accumulate indefinitely (must manually clear)
- **No encryption**: Sensitive data (IP addresses, connection strings) stored in plaintext

**Implication**:
- Cannot store huge session logs (data exceeds 5 MB quickly)
- Operator must manage profile library manually
- No multi-device workflow support (yet)

---

### IPC Message Size
- **Soft limit**: ~100 MB per message (Electron default)
- **Practical limit**: ~10 MB before renderer becomes unresponsive
- **No streaming**: All data buffered in main before sending to renderer

**Implication**:
- Cannot stream large GETRESOURCEXML responses (all-or-nothing approach)
- Large FULLSTATUSJSON (20 KB) is safe; large registry diffs (100+ entries) still safe

---

### UI Rendering
- **No responsive design**: Hardcoded 12-column grid; assumes 1440x980 minimum
- **Minimum window**: 1180x820 pixels enforced in BrowserWindow config
- **Font rendering**: System-default sans-serif (no custom fonts to reduce app size)
- **Canvas chart**: Throttled to 120ms min redraw (prevents 60fps thrashing)

**Implication**:
- Mobile / tablet support not possible (Electron is desktop only)
- Very small screens (<1180px) may have UI cutoff
- Chart performance capped at ~8 FPS even on high-refresh monitors

---

### JavaScript Runtime
- **No async/await in old parts**: Main process uses callbacks for TCP sockets (pre-ES2017)
- **No TypeScript**: Vanilla JS (no type checking)
- **No tree-shaking**: All code bundled into monolithic main.js/renderer.js (no module splitting)

**Implication**:
- Callback hell possible in complex socket handling
- Runtime errors not caught until execution
- Performance not optimized (all code loads on startup)

---

## Functional Limitations

### Session Management
- **Single connection**: Cannot monitor multiple Delta servers in parallel
- **No session history**: Sessions not persisted to disk (only snapshot in localStorage)
- **No session export**: Cannot download full session log (CSV, JSON, etc.)
- **No playback**: Cannot replay session metrics after fact (no time-travel UI)

**Implication**:
- Multi-server testing requires manual tab switching or multiple app instances
- Operator must manually take screenshots to document results
- No post-mortem analysis (must be done during live session)

---

### Registry Diff
- **Fixed baseline**: Can only compare against W-Series default (cannot load custom baseline)
- **No drill-down**: Diff results are flat; cannot expand/collapse registry subtrees
- **No export**: Cannot save diff report as PDF/HTML
- **No filtering**: Cannot filter diff results by key name or change type (all shown)

**Implication**:
- Non-W-Series servers (S, P, R variants) require manual baseline update
- Large diff lists (100+ entries) may scroll off-screen
- Cannot generate compliance report for audits

---

### Test Profile
- **No validation**: Fields are freeform text (no constraints, no auto-completion)
- **No versioning**: Cannot compare old vs new profiles (no history)
- **No sharing**: Cannot export/import profiles via QR code or network
- **Limited auto-fetch**: Only derives common fields (GPU model, output count); many fields remain manual

**Implication**:
- Data entry errors not caught (garbage in = garbage out)
- Profile library grows unbounded (cleanup required periodically)
- New operator must manually re-enter all profile fields

---

### Performance Charting
- **30-second window**: Chart shows only last 30s of data (not configurable)
- **Full session mode**: Can show all data from start, but redraws are expensive (slows UI)
- **Three metrics only**: Frame Time, GPU Time, Audio Tracking (cannot add custom metrics)
- **No export**: Cannot save chart as PNG/SVG

**Implication**:
- Operators cannot see long-term trends beyond 30s
- Session replay requires manual re-connect
- Custom analysis requires external tool (Jupyter, Excel, etc.)

---

### Diagnostics Tools
- **PowerShell only**: Diagnostics collectors are Windows-specific (no Linux/Mac support)
- **WinRM not automated**: Multi-host collection requires manual credential entry
- **Storage RAID detection**: Cannot determine RAID level from NVMe direct-attached drives (inference only)
- **No GPU utilization**: NVIDIA driver reports do not include real-time GPU load (static info only)

**Implication**:
- Cannot deploy dashboard on macOS or Linux
- Cross-lab testing requires operator to open firewalls manually
- RAID configuration must be manually validated by operator
- Performance profiling of GPU cannot be done from dashboard

---

## Data & Privacy Constraints

### No Persistence
- **No database**: All data lost on app restart (except localStorage + profiles)
- **No network sync**: Data not backed up to central server
- **No encryption**: All state stored in plaintext (localStorage)

**Implication**:
- Operator must manually export data if audit trail required
- No protection against disk theft (credentials visible if stolen)
- Cannot have shared repository of sessions across test lab

### Session Snapshot Immutability
- **Once created, cannot be modified**: Snapshot frozen at session start (good for audit)
- **Cannot add tags/categories**: No metadata beyond operator notes
- **No collaborative notes**: Only single operator per session

**Implication**:
- Cannot retroactively correct profile info
- Cannot share findings with team (notes are local-only)

---

## Performance Constraints

### Polling & Responsiveness
- **Min poll interval**: 1 second (hardcoded in code as check `interval < 1`)
- **Max poll interval**: User can set arbitrarily high (no hardcoded max)
- **Polling happens on main thread**: No worker thread for I/O
- **UI thread blocking**: Large JSON parse (20 KB FULLSTATUSJSON) can freeze UI for 50–100ms

**Implication**:
- Cannot monitor faster than 1 Hz (1-second granularity minimum)
- Very long polling intervals (e.g., 60s) may accumulate stale data
- Dashboard UI may appear to freeze during server status fetch
- No prioritization: debugstatus and FULLSTATUSJSON parse compete for CPU

### Memory Usage
- **No GC control**: JavaScript garbage collection is automatic (unpredictable pauses)
- **Chart data retention**: `performanceChart.frTmSeries` array grows indefinitely during session
- **Recv buffer**: TCP recvBuffer can grow if response is fragmented across many packets

**Implication**:
- Long sessions (>1 hour) may consume 100+ MB RAM
- GC pauses may cause 10–50ms hiccups in chart rendering
- Fragmented TCP responses may cause buffer allocation spike

---

## Deployment & Operations

### Installer
- **Manual distribution**: No auto-updater configured (operator must download new .exe)
- **No code signing**: Executable not signed (Windows Defender may warn on first run)
- **No installer wizard**: Direct Electron app launch (unfamiliar for non-technical users)

**Implication**:
- Cannot push updates to operator machines remotely
- IT departments may block installation (security policy)
- No rollback mechanism if update breaks functionality

### Logging
- **No application logs**: No file output (only browser console)
- **Debug mode not accessible**: No dev tools in production build (can enable, but non-default)
- **Error tracking not implemented**: Crashes not reported to server

**Implication**:
- Cannot diagnose production issues without accessing operator's machine
- Bug reports require manual console log copy-paste
- No usage analytics (cannot see which features are used most)

---

## Network Constraints

### Firewall & NAT
- **Port 23 (Delta TCP)**: Must be open on operator's network to target server
- **Port 4477 (Registry HTTP)**: Must be open on SUT firewall (both inbound and outbound if bidirectional)
- **Port 8085 (Hardware sensors)**: Must be open on SUT firewall
- **No proxy support**: Dashboard does not support HTTP proxies (direct connection only)

**Implication**:
- Cannot operate from corporate VPN if ports blocked
- Cannot test servers across different VLANs without firewall rule coordination
- Cannot use SSH tunneling or port forwarding (not implemented)

### Network Latency
- **No latency compensation**: UI shows data age implicitly only
- **No retry logic**: Failed network request fails immediately (no exponential backoff)
- **No request queuing**: If operator changes IP while polling, old connection persists

**Implication**:
- High-latency networks (>500ms RTT) may cause timeout errors
- Transient network blips cause full session disconnect
- Flaky networks require manual reconnect

---

## Known Issues & Workarounds

| Issue | Impact | Workaround |
|-------|--------|-----------|
| TCP line-ending quirk (`\n\r`) | debugstatus/statusex may not parse | Use Electron v31.7.7+ only |
| localStorage grows unbounded | App slows down after 100+ sessions | Manually clear via DevTools > Storage |
| No multi-server support | Cannot A/B test two servers | Open two app instances |
| HTTP 8s timeout hardcoded | Slow networks timeout | Upgrade network or reduce registry data size |
| Chart data not exported | Cannot analyze offline | Implement export feature (future) |
| No HTTPS for registry | Plaintext over network | Assume trusted LAN; limit to internal testing |

---

## Future Lifting of Constraints

**Would require significant refactor:**
1. **Multi-server sessions**: Redesign IPC to handle multiple TCP connections; rewrite polling loop
2. **Session persistence**: Add SQLite database or PostgreSQL backend
3. **TypeScript migration**: Would improve type safety but require build toolchain
4. **Auto-updater**: Electron squirrel.windows + GitHub releases
5. **Custom baseline registry**: UI to import/manage multiple baselines
6. **Network resilience**: Implement exponential backoff + retry queue

**Out of scope (not planned):**
- Mobile app (Electron is desktop-only; would need React Native)
- macOS/Linux support (delta registry + diagnostics are Windows-specific)
- Collaborative multi-user sessions (would need real-time sync backend)

