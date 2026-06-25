========================================
  DEBUGPOLL v0.1.4 - USER GUIDE
========================================

OVERVIEW
--------
DebugPoll connects to your Delta server and polls:
  - DEBUGSTATUS REALTIMECMD
  - STATUSEX REALTIMECMD
  - TIMELINESTATUS REALTIMECMD

The REALTIMECMD suffix prevents these commands from being recorded
in the Delta external control log.

It shows live stats in the console window and writes CSV files for later review.

MODE behavior:
  - MODE = Playing: logging continues
  - MODE = Stopped: logging pauses


REQUIREMENTS
------------
Node.js must be installed.

To check:
  node --version

If needed, install from:
  https://nodejs.org (LTS)


QUICK START
-----------
1. Double-click DebugPoll desktop shortcut (or debugpoll.bat)
2. Follow startup prompts
3. Watch live lines in the console
4. Close window or press Ctrl+C when done


SETTINGS (settings.json)
------------------------
Edit settings.json in Notepad.

Fields:
  "ip"           - target server IP
  "port"         - target port (default 23)
  "logInterval"  - poll rate in seconds (default 2)
  "logDirectory" - folder for CSV files

Default:
  "logDirectory": ".\\RemoteDebugStatusTool\\Logs"

Notes:
  - Relative paths are resolved from the tool folder
  - The log folder is created automatically if missing


STARTUP TEST INFORMATION
------------------------
At startup, DebugPoll checks the latest CSV for saved test info.

If previous test info exists:
  - It shows the latest CSV path
  - It shows previous test fields/values
  - Prompt: Reuse this test data? (Y/n)
    - Y or Enter = reuse and start
    - N = enter new values

If previous test info does not exist:
  - Prompt: Enter test information? (y/N)
    - Y = enter new values
    - N or Enter = skip test info and start

Fields when entering new values:
  - Server Type (eg W, S, P, R)
  - GPU Model (eg. PRO4000)
  - Number of GPUs
  - 7thSpoutRenderer Used (Y/N)
  - Number of Outputs
  - Framerate (eg 60, 120)
  - Media BitDepth (eg. 8, 10, 12)
  - Media Sampling (eg. 422, 444)
  - Media FileType (eg. TGA, DPX, 7thNLC, NotchLC_mov)
  - Warp and Blend (Y/N)
  - Free Comment Field


LIVE CONSOLE OUTPUT
-------------------
Each poll row is shown in aligned format, for example:

  Time = 00:00:02, Frames = 123456789, FrmDropped = 1234, MovieFrmDropped = 12345,
  FrmTm = 123456, GrnLine = 12345, Mode = Playing

Time and Frames come from TIMELINESTATUS. Mode value is taken from STATUSEX.


WHEN MODE CHANGES TO STOPPED
----------------------------
When MODE becomes Stopped:
  - A final Stopped row is written (using last known data values)
  - Logging pauses

If test info is enabled, this prompt appears first:
  Test duration: HH:MM:SS. Log result? Press Y = COMPLETED, or any other key to continue:

  - Y = create COMPLETED result file
  - any other key = continue to paused prompt

Paused prompt:
  Mode is Stopped. Press N to add a note, or Q to quit:

  - N = add optional note for this STOP event
    Prompt:
    Optional note for STOP at <timestamp> (leave blank and press Enter to skip)
  - Q = finalize current CSV and exit

If MODE returns to Playing, logging resumes automatically.


IF CONNECTION IS LOST
---------------------
You will see:

  --- CONNECTION LOST --- <timestamp> ---
  CSV saved to: <path>\debugpoll_YYYY-MM-DD_HH-MM-SS.csv
  Press R + Enter to reconnect, or Q + Enter to quit:

  - R + Enter = reconnect (new CSV starts)
  - Q + Enter = quit


CSV OUTPUT
----------
Each connection creates a timestamped CSV in logDirectory.

Main data columns:
  Timestamp
  Time           (HH:MM:SS from TIMELINESTATUS SMPTE field)
  FrTm(ms)
  GrnLine(ms)
  MstAvFrmTm
  Frames         (from TIMELINESTATUS)
  FrmDropped
  MovieFrmDropped
  AudioTracking
  Mode

FrTm parsing:
  - First value -> FrTm(ms)
  - Bracket value -> GrnLine(ms)
  - "ms" suffix removed for graphing

Summary section at end includes:
  - DEBUGSTATUS static fields
  - STATUSEX fields (SERVER, FILE, FRAMERATE, LICENCE, MOVIEDRIVES, GRAPHICS, VERSION)
  - Optional test information fields
  - Optional STOP notes section (StoppedEventTimestamp, Note)


RESULT FILES
------------
When Y is pressed at the end of a Playing session, a result file is saved in logDirectory.

Naming format:
  YYYY-MM-DD_HH-MM-SS-COMPLETED-<FreeComment>-HH_MM-<ServerType>-<GPUModel>-<NumGPUs>-<7thSpoutRenderer>-<NumOutputs>-<Framerate>.csv

Content:
  - Rows from the latest Playing session (plus preceding Stopped row)
  - NoteBeforeSession (if available)
  - Full summary block


SETTING UP DESKTOP SHORTCUT
---------------------------
1. Open File Explorer in this folder
2. Right-click debugpoll.bat
3. Click Show more options (Windows 11)
4. Send to -> Desktop (create shortcut)
5. Rename shortcut to DebugPoll (optional)


FILES
-----
  debugpoll.js   - main script
  debugpoll.bat  - launcher
  settings.json  - configuration
  README.txt     - this guide


TROUBLESHOOTING
---------------
"node is not recognized..."
  Node.js is not installed.

Window opens and closes immediately
  settings.json may have invalid JSON format.

Cannot connect / no stats
  - Check IP and port
  - Check server is running
  - Check network access

Logging pauses unexpectedly
  - Confirm STATUSEX MODE (Stopped pauses by design)

No CSV file appears
  - Check logDirectory
  - Check write permissions

========================================
