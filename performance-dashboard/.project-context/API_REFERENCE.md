# API Reference

## IPC Channels (Renderer ↔ Main)

All APIs are exposed via `window.performanceDashboard` contextBridge object.

### Session Management

#### `startSession(snapshot)`
Establishes TCP polling connection to Delta Media Server.

**Parameters:**
```javascript
snapshot: {
  sessionId: string,        // "sess-20260505-161234"
  startedAtIso: string,     // ISO 8601 timestamp
  connection: {
    ip: string,             // "100.94.47.25"
    port: string,           // "23"
    logInterval: number     // 2 (seconds)
  },
  testProfile: {
    serverType: string,     // "W", "S", "P", "R"
    gpuModel: string,       // "PRO4000"
    // ... (17 profile fields total)
  },
  resultMode: string        // "pending", "pass", "fail", "unofficial"
}
```

**Returns:**
```javascript
{ ok: true }  // or
{ ok: false, message: "error description" }
```

**Behavior:**
- Creates TCP socket to `ip:port`
- Sends `FULLSTATUSJSON\r\n` immediately
- Polls `debugstatus`, `statusex`, `timelinestatus` every `logInterval` seconds
- Broadcasts `session:update` events on each poll (see below)
- Broadcasts `server:fullStatus` on FULLSTATUSJSON response

**Error cases:**
- No IP configured → `{ ok: false, message: "No IP address configured." }`
- Connection refused → status message "Connection error: ..."
- TCP socket closes → broadcasts "Connection closed."

---

#### `resumeSession()`
Reconnects using last successful connection settings.

**Parameters:** None

**Returns:**
```javascript
{ ok: true }  // or
{ ok: false, message: "No previous connection to resume." }
```

**Behavior:**
- Reuses `lastConnectionConfig` from main process memory
- Same as `startSession()` but without requiring snapshot parameter
- Useful for operator workflow: pause metrics, then resume without reconfiguring

---

#### `stopSession()`
Closes TCP polling connection.

**Parameters:** None

**Returns:**
```javascript
{ ok: true }
```

**Behavior:**
- Destroys TCP socket immediately
- Clears polling timer
- Broadcasts final `session:update` with `connected: false`
- Operator notes can still be entered and saved post-session

---

### Server Information

#### `fetchServerInfo(connection)`
One-shot fetch of FULLSTATUSJSON + GETRESOURCEXML (no ongoing polling).

**Parameters:**
```javascript
connection: {
  ip: string,       // "100.94.47.25"
  port: string,     // "23"
}
```

**Returns:**
```javascript
{
  ok: true,
  derived: {
    gpuModel: string,              // "PRO4000"
    numberOfGPUs: number,
    numberOfInstalledMediaDrives: number,
    numberOfMovieDrivesUsed: string,  // "2x RAID0"
    numberOfOutputs: number,
    outputResolution: string,      // "3840x2160"
    framerate: number,
    // ... (other auto-derivable fields)
  }
}
```

or

```javascript
{
  ok: false,
  message: "Timed out waiting for server response.",
  derived: {}
}
```

**Behavior:**
- Opens temp TCP connection (8s timeout)
- Sends `FULLSTATUSJSON\r\n` + `GETRESOURCEXML\r\n`
- Waits for complete JSON + XML response
- Parses JSON to extract common fields (GPU model, output count, etc.)
- Returns derived values (used to auto-populate Test Profile form)
- Does not keep connection open (one-shot request)

**Error cases:**
- No IP → `{ ok: false, message: "No IP address configured.", derived: {} }`
- Timeout (8s) → returns timeout message
- JSON parse error → returns parse error message
- Connection refused → returns "Connection error: ..."

---

### Registry Diagnostics

#### `fetchRegistry(connection)`
Fetch live Delta registry from HTTP server and return as JSON.

**Parameters:**
```javascript
connection: {
  ip: string,                  // "192.168.1.167"
  registryPort: number | string // 4477 (default)
}
```

**Returns:**
```javascript
{
  ok: true,
  data: {
    Delta_PESILENTPC: {
      values: { /* key-value pairs */ },
      subkeys: {
        Anaglyph: { /* ... */ },
        Codec: { /* ... */ },
        // ... (nested structure as returned from registry endpoint)
      }
    }
  }
}
```

or

```javascript
{
  ok: false,
  message: "Connection error: connect ECONNREFUSED"
}
```

**Behavior:**
- Makes HTTP GET to `http://ip:registryPort/registry`
- 8s timeout per request
- Returns parsed JSON (not raw string)
- If registry server returns invalid JSON, error message includes parse reason

**Error cases:**
- No IP → `{ ok: false, message: "No IP address configured." }`
- Connection refused → "Connection error: ECONNREFUSED"
- Timeout → "Connection timed out after 8s."
- Invalid JSON → "Invalid JSON from registry server: ..."

---

### Event Listeners (Broadcast from Main)

#### `onSessionUpdate(callback)`
Listen for live polling updates (debugstatus/statusex/timelinestatus).

**Callback signature:**
```javascript
callback(payload: {
  connected: boolean,
  mode: string,              // "Stopped", "Playing", etc.
  duration: string,          // "HH:MM:SS"
  fps: string,               // "60"
  frames: number,
  frmDropped: number,
  movieFrmDropped: number,
  frTmMs: string,            // "16.234"
  grnLineMs: string,         // "8.123"
  mstAvFrmTm: string,        // "16.156"
  audioTracking: string,     // "0.234"
  statusMessage: string      // "Connected. Polling every 2 second(s)."
})
```

**Event frequency:** Every `logInterval` seconds (default 2s) during active polling

**Broadcast source:** `broadcastLiveUpdate()` in main.js after parsing each TCP response

**Example:**
```javascript
window.performanceDashboard.onSessionUpdate(payload => {
  console.log(`Frames: ${payload.frames}, Dropped: ${payload.frmDropped}`);
});
```

---

#### `onFullStatusUpdate(callback)`
Listen for complete server status snapshots (FULLSTATUSJSON).

**Callback signature:**
```javascript
callback(fullStatus: {
  ServerName: string,
  DeltaVersion: string,
  Arch: string,              // "x86" or "ARM"
  Master: boolean,
  Group: number,
  FPS: number,
  Fullscreen: boolean,
  LicenseStatus: string,
  GraphicSettings: string,
  ScalingMode: { mode: string },
  
  Debug: {
    frameTime: number,       // milliseconds
    masterAverageFrameTime: number,
    timingMode: string,
    framesDropped: number,
    movieFramesDropped: number,
    debugIt: boolean
  },
  
  TimelineInformation: {
    Timelines: [{
      PlayState: string,     // "Playing", "Stopped"
      SMPTE: string,         // "01:02:03:04"
      CurrentFrame: number,
      Enabled: boolean
    }]
  },
  
  AudioConfig: {
    deviceType: string,
    forcedChannels: number   // 0 = auto
  },
  AudioLevel: number,        // percentage
  VideoLevel: number,
  
  SDI: {
    enabled: boolean,
    bitDepth: number,        // 8, 10, 12
    mode: string
  },
  
  LEDStatus: {
    audio: number,           // 0–255 brightness
    movies: number,
    video: number
  },
  
  ChannelConfig: {
    canvasWidth: number,
    canvasHeight: number,
    displayModeName: string,
    enabledChannels: number,
    channels: [{
      name: string,
      channelIndex: number,
      enabled: boolean,
      left: number,
      right: number,
      top: number,
      bottom: number,
      rotate: number         // degrees: 0, 90, 180, 270
    }]
  }
})
```

**Event frequency:** On session start (immediate FULLSTATUSJSON sent), then depends on server config (usually sparse after initial fetch)

**Broadcast source:** `broadcastFullStatus()` in main.js when FULLSTATUSJSON JSON object detected in TCP buffer

---

## Delta Media Server TCP Protocol

### Commands Sent

**FULLSTATUSJSON**
- Request: `FULLSTATUSJSON\r\n`
- Response: Single JSON object (typically 15–25 KB)
- Frequency: Once per session (on connect)
- Purpose: Comprehensive server snapshot (config, state, LED status, channels)

**debugstatus**
- Request: `debugstatus\n\r` (sic: unusual line ending)
- Response: Line-based text format
- Frequency: Every `logInterval` seconds
- Purpose: Lightweight debug info (FPS, frame time, dropped frames)

**statusex**
- Request: `statusex\n\r`
- Response: Line-based text format
- Frequency: Every `logInterval` seconds
- Purpose: Extended status (timeline, audio level, video level)

**timelinestatus**
- Request: `timelinestatus\n\r`
- Response: Line-based text format
- Frequency: Every `logInterval` seconds
- Purpose: Timeline state (SMPTE timecode, current frame, play state)

### Response Parsing

Responses are mixed: partial JSON objects + line-based text. Main process:

1. Receives data in chunks (TCP may split across packet boundaries)
2. Appends to `recvBuffer`
3. Extracts complete JSON objects (`{...}`) via brace-matching
4. Splits remainder by `\r?\n` and parses line-by-line (key=value format)
5. Updates `liveState` object with parsed values
6. Broadcasts updates immediately

---

## Delta Registry HTTP Server Protocol

### Endpoint: GET /registry

**Request:**
```
GET /registry HTTP/1.1
Host: 192.168.1.167:4477
Connection: close
```

**Response (200 OK):**
```json
{
  "Delta_PESILENTPC": {
    "values": {
      "DebugIt": { "type": 1, "data": "Yes" },
      "DefaultFile": { "type": 1, "data": "c:\\shows\\test.xml" },
      "RTDataDriveLetter": { "type": 1, "data": "G" }
    },
    "subkeys": {
      "Graphics": {
        "values": {
          "DesktopTargetBitDepth": { "type": 1, "data": "10" },
          "UseGLSyncForGPUTime": { "type": 1, "data": "1" }
        },
        "subkeys": { /* ... */ }
      },
      "System": {
        "values": { /* ... */ },
        "subkeys": { /* ... */ }
      }
    }
  }
}
```

**Structure:**
- Nested hierarchy (Delta_PESILENTPC root)
- Each node has optional `values` dict (leaf registry entries) and optional `subkeys` dict (subtree)
- Each value: `{ "type": <1 for string>, "data": "<value>" }`

**Error response (connection refused):**
- HTTP 0 / connection error (main process catches and returns error message)

---

## Test Profile Data Structure

Stored in localStorage under key `performance-dashboard.testProfile`.

```javascript
{
  serverType: "W" | "S" | "P" | "R",
  gpuModel: string,                       // "PRO4000 Blackwell"
  numberOfGPUs: number,                   // 4
  numberOfInstalledMediaDrives: number,   // 8
  numberOfMovieDrivesUsed: string,        // "2x RAID0 arrays"
  numberOfOutputs: number,                // 4, 8, 16
  numberOfMovies: number,                 // defaults to numberOfOutputs
  numberOfLayers: number,                 // 1
  outputResolution: string,               // "3840x2160"
  mediaResolution: string,                // defaults to outputResolution
  framerate: number,                      // 60, 120, 24, 30
  mediaBitDepth: number,                  // 8, 10, 12
  mediaSampling: string,                  // "422" or "444"
  mediaFileType: string,                  // "TGA", "DPX", "7thNLC", "NotchLC_mov"
  warpAndBlend: "" | "Y" | "N",
  freeCommentField: string                // optional notes
}
```

---

## Connection Settings Structure

Stored in localStorage under key `performance-dashboard.connectionSettings`.

```javascript
{
  ip: string,           // "100.94.47.25"
  port: string,         // "23" (note: stored as string in form input)
  logInterval: number   // 2
}
```

Connection presets stored under `performance-dashboard.connectionPresets`:
```javascript
[
  {
    name: "Default",
    ip: "100.94.47.25",
    port: "23",
    logInterval: 2
  },
  {
    name: "Stage A",
    ip: "10.100.106.125",
    port: "23",
    logInterval: 2
  }
]
```

