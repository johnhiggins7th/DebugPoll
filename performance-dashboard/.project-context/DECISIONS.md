# Architectural Decisions

## 1. Vanilla JavaScript (No Framework)
**Decision**: Use plain HTML/CSS/JS instead of React/Vue/Svelte.

**Rationale**:
- Minimal dependencies (smaller app size, fewer security concerns)
- Electron contextBridge constraint: framework state management would complicate IPC serialization
- UI is primarily static card/table layouts, not a complex interactive state machine
- Easier for operators to understand/modify if needed

**Trade-offs**:
- More manual DOM manipulation
- No built-in reactivity (must manually call `nodeById()` + `.textContent = ...`)
- Scales poorly for highly interactive UIs (acceptable for dashboard read-heavy design)

---

## 2. Persistent TCP Connection (Not Per-Request)
**Decision**: Establish single TCP socket on `session:start`, keep alive, poll on interval.

**Rationale**:
- Delta server performance impact: handshake + auth overhead per request is expensive
- Operator workflow expects continuous monitoring (not one-shot snapshots)
- Easier error recovery (reconnect same socket vs. re-establish)
- Real-time feel: metrics update continuously, not on demand

**Trade-offs**:
- Must handle mid-session disconnects gracefully
- Requires buffer management for partial JSON/XML objects
- Background task (setInterval) runs even when window minimized

**Alternative considered**: HTTP-based Delta API (if available) → rejected, TCP is standard Delta protocol

---

## 3. Separate "Fetch Server Info" from Live Polling
**Decision**: `server:fetchInfo` IPC is a one-shot request (FULLSTATUSJSON + GETRESOURCEXML), not part of live polling loop.

**Rationale**:
- FULLSTATUSJSON is large (~20KB) and expensive to parse every cycle
- Polling loop is lightweight (debugstatus ~100 bytes)
- Users want full snapshot only on demand (Auto-fetch button) or at session start
- Reduces CPU churn and network load

**Trade-offs**:
- Server Status tab may become stale if not manually refreshed
- Users must click "Auto-fetch" to update Test Profile form

---

## 4. Registry Diff: Flatten → Compare (Not Recursive Diff)
**Decision**: Convert nested registry structure to flat key-value pairs, then compare keys.

**Rationale**:
- Simpler to reason about: each key is a unique leaf (no tree structure to track)
- Can sort diff results alphabetically by key
- No false positives from re-ordered subkey arrays
- Performance: O(n log n) sort + O(n) single-pass comparison

**Trade-offs**:
- Cannot display "subtree added" summary (must list all leaves individually)
- Slightly verbose output for large config sections

**Alternative considered**: Tree-based deep diff → more complex, no benefit for user comprehension

---

## 5. Baseline Registry as JSON Asset File
**Decision**: Store W-Series default Delta registry as JSON file in `src/assets/`, not fetch from server.

**Rationale**:
- Factory defaults are immutable (released with product)
- No need for live lookup (baseline never changes)
- Easier to version control and audit
- Portable: works offline if registry server is unavailable

**Trade-offs**:
- Must manually update if default registry changes (rare)
- Users cannot compare against arbitrary baseline (only W-Series default)

**Future**: Could add UI to load alternative baseline from file/URL

---

## 6. localStorage for Test Profile & Presets
**Decision**: Persist test profiles and connection presets to browser localStorage, not file system.

**Rationale**:
- No file I/O permission complexity
- Cross-session state preservation (user expectations)
- Easy to export/import (JSON.stringify/parse)
- Built-in Electron support (same as web browsers)

**Trade-offs**:
- Data not synced across machines (operator must replicate if they move)
- Max size ~5MB (sufficient for 100s of profiles)
- Clear cache → lose history (add export button if needed)

---

## 7. HTTP GET for Registry (Not TCP)
**Decision**: Delta Registry HTTP Server provides `/registry` endpoint; use HTTP GET, not custom TCP protocol.

**Rationale**:
- Standard web protocol (simpler error handling, timeouts, retries)
- No custom parsing required
- Can be deployed on different port (4477) without affecting main Delta TCP protocol (23)
- Firewall rules straightforward (inbound 4477 HTTP)

**Trade-offs**:
- Cannot reuse existing TCP polling socket
- Requires separate HTTP client library (`require('http')`)

---

## 8. IPC for All Server Communication (No Direct TCP from Renderer)
**Decision**: All renderer-to-server I/O must go through main process IPC handlers.

**Rationale**:
- Electron security: renderer is sandboxed, cannot open arbitrary sockets
- contextBridge isolation: explicit whitelist of safe APIs
- Main process controls timeout, error handling, resource cleanup
- Easier to audit and test (centralized networking layer)

**Trade-offs**:
- Cannot stream data directly (must buffer in main, send all-at-once to renderer)
- IPC message size limits (~100MB in Electron, but practical ~10MB)

---

## 9. Polling Loop in Main Process (Not Renderer)
**Decision**: `setInterval` for TCP polling runs in main process, broadcasts updates via IPC.

**Rationale**:
- Main process never unloads (unlike renderer if user closes window)
- Main has direct access to net.Socket
- Prevents polling from blocking UI thread (renderer can repaint during poll)
- Easier to pause/resume polling state

**Trade-offs**:
- Renderer must be listening (if window closed, polling continues but broadcasts nowhere)
- Must clean up polling timer on app exit

---

## 10. Session Snapshots (Immutable Metadata)
**Decision**: Create JSON snapshot at session start, store in localStorage, append to every session record.

**Rationale**:
- Audit trail: can replay what operator was testing (config, IP, interval, profile)
- Immutable: snapshot never changes after creation (prevent data loss)
- Operator notes tied to specific snapshot (reproducible)

**Trade-offs**:
- localStorage grows with each session (must prune old snapshots periodically)
- Snapshots are local only (not synced to server)

---

## 11. Design System: Vertical Card Stacking
**Decision**: Use CSS Grid (`.tab-pane` = grid container, `.panel` / `.ss-card` as children).

**Rationale**:
- Responsive: cards reflow based on available width
- Consistent spacing and alignment
- Server Status cards use 3-column grid (4 span each = 3 per row)
- Session/Profile panels use full width (6 span)

**Trade-offs**:
- Fixed column count (12-column grid) may not suit all screen sizes
- Cards cannot be dragged/rearranged (not implemented)

---

## 12. Delta Registry HTTP Server Port 4477
**Decision**: Use port 4477 for registry HTTP endpoint.

**Rationale**:
- High ephemeral port (1024–65535, unlikely to conflict with system services)
- Easy to remember and document
- Delta Media Server uses port 23 (TCP protocol); 4477 is distinct and clear
- Firewall rule explicit: "inbound TCP 4477"

**Trade-offs**:
- Non-standard port (users must know to open firewall; documented in SUT setup guide)

---

## Future Decisions (Pending)

### Hardware Telemetry Integration
- **Open question**: How to fetch CPU/GPU/memory sensors?
  - **Current plan**: LibreHardwareMonitor service on SUT (port 8085), polled like registry
  - **Alternative**: WMI/CIM queries over WinRM (more complex, requires credentials)

### Remote Data Collection
- **Open question**: Should dashboard push/pull diagnostics from SUTs?
  - **Current plan**: Diagnostics are standalone PowerShell scripts (ran on SUT, output to JSON)
  - **Alternative**: Dashboard invokes scripts remotely via WinRM (Jira Task 7)

### Multi-Server Session
- **Open question**: Support connecting to multiple Delta servers simultaneously?
  - **Current state**: Single connection at a time
  - **Future**: Tab per server, shared performance graph?

