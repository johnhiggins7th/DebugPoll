# Architecture

## Current Tech Stack
- The app is a desktop Electron application.
- The user interface is built with plain HTML, CSS, and JavaScript.
- The main process uses Node.js for network communication and app lifecycle.
- The renderer process handles the tab UI and on-screen updates.
- Renderer and main communicate through Electron contextBridge and IPC.
- Local settings are saved in localStorage (profiles, connection settings, presets).

## Current Data Sources
- Delta Media Server over TCP on port 23.
: Used for live status polling and full status snapshots.
- Delta Registry HTTP Server on port 4477.
: Used to fetch live Delta registry JSON for comparison.
- Local baseline registry file in src/assets/W_Series_default_Delta_registry.json.
: Used as the default reference in the Registry Diff tab.
- Local browser storage (localStorage).
: Used for saved user profile data and connection presets.

## How Data Currently Flows Between Tabs
- Session tab
: Starts and stops the live TCP session. Main process polls Delta and sends live updates back to the renderer. Session cards and chart update from these messages.
- Server Status tab
: Displays fields from full-status JSON received from Delta. It is fed by the same connection events coming from the main process.
- Test Profile tab
: Mostly uses local form data, but can auto-fill selected fields from server info fetched through IPC.
- Registry Diff tab
: Requests live registry JSON through IPC, loads the local baseline JSON, flattens both datasets, computes key/value differences, and renders added/removed/modified rows.
- Shared behavior
: Tabs share one renderer script and one IPC bridge. They do not have separate backend services; they use the same main process handlers.

## Known Limitations
- Only one Delta server connection is supported at a time.
- Live polling is interval-based and can show stale values between polls.
- Network error handling is basic (timeouts and simple error messages).
- Registry comparison currently depends on a single baseline file.
- No built-in export for diff results or long-term session history.
- localStorage is local to one machine/user profile and not synchronized.
- Some data flows are tightly coupled in one large renderer script, which can make future changes slower and riskier.
