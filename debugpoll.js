var fs = require('fs');
var net = require('net');
var path = require('path');
var readline = require('readline');
var childProcess = require('child_process');

// --- Load settings.json (edit in Notepad to change IP, port, and log interval) ---
var settings = {};
try {
    settings = JSON.parse(fs.readFileSync(__dirname + '/settings.json', 'utf8'));
} catch (e) {
    console.log('settings.json not found or invalid; using built-in defaults.');
}

const options = {
    ip: settings.ip || '10.100.106.125',
    port: settings.port || 23,
    logInterval: settings.logInterval || 2,
    logDirectory: settings.logDirectory || '.\\RemoteDebugStatusTool\\Logs',
    consoleTitle: settings.consoleTitle || 'Remote DebugStats',
    focusOnStop: settings.focusOnStop !== false,
    command: 'debugstatus',
    passThresholdHours: settings.passThresholdHours !== undefined ? settings.passThresholdHours : 8,
    unofficialPassThresholdHours: settings.unofficialPassThresholdHours !== undefined ? settings.unofficialPassThresholdHours : 1
};

function resolveLogDirectory(value) {
    var raw = String(value || '').trim();
    if (!raw) {
        raw = '.\\RemoteDebugStatusTool\\Logs';
    }

    if (path.isAbsolute(raw)) {
        return raw;
    }

    var normalized = raw.replace(/\//g, '\\').toLowerCase();
    if (normalized === '.\\remotedebugstatustool\\logs') {
        // Keep the user-facing default while storing logs under the tool folder.
        return path.join(__dirname, 'Logs');
    }

    return path.resolve(__dirname, raw);
}

function ensureLogDirectoryExists() {
    var dir = resolveLogDirectory(options.logDirectory);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const staticFields = [
    'DebugIt',
    'Arch',
    'Gfx',
    'FPS',
    'MMTimerMode',
    'SDIBitDepth',
    'ForceNumAudioChannel',
    'ForcePinnedMemOff',
    'TargetDesktopBitDepth',
    'ForceActive3DOff',
    'UpdateMoviesAfterRender',
    'UsingMMTimer'
];

// STATUS/STATUSEX fields captured once and written to summary block only
const statusSummaryFields = ['SERVER', 'FILE', 'FRAMERATE', 'LICENCE', 'MOVIEDRIVES', 'GRAPHICS', 'VERSION'];
var latestStatusSummary = {};
var lastSnapshot = null;  // last DEBUGSTATUS snapshot received
var latestTimelineTime = '';    // HH:MM:SS extracted from TIMELINESTATUS SMPTE
var latestTimelineFrames = '';  // FRAMES from TIMELINESTATUS
var latestTimelineMode = '';    // MODE from TIMELINESTATUS

// Logging state — starts false until STATUSEX confirms MODE = Playing
var isLogging = false;
var lastModeWasPlaying = false;

const dataHeaders = [
    'Timestamp',
    'Time',
    'FrTm(ms)',
    'GrnLine(ms)',
    'MstAvFrmTm',
    'Frames',
    'FrmDropped',
    'MovieFrmDropped',
    'AudioTracking',
    'Mode'
];

var logPath = null;
var pollTimer = null;
var telnet = null;
var rl = null;
var pausedRl = null;
var pausedRawActive = false;
var pausedRawHandler = null;
var csvHeaderWritten = false;
var recvBuffer = '';
var streamBlockType = '';
var streamBlockLines = [];
var latestStaticSummary = {};
var summaryWritten = false;
var userQuitRequested = false;
var currentStoppedEventTimestamp = '';
var stoppedEventNotes = [];
var csvDataLineCount = 0;          // counts data rows written (not header)
var playingSessionStartIndex = 0;  // 0-based data row index where current Playing segment begins
var lastStoppedRowIndex = -1;      // 0-based data row index of final Stopped row for current segment
var prePlayingNote = null;         // last note captured before the current Playing session
var isDisconnected = false;        // true if connection was lost during Playing
var testInfo = {
    include: false,
    serverType: '',
    gpuModel: '',
    numberOfGPUs: '',
    seventhSpoutRendererUsed: '',
    diskModel: '',
    numberOfInstalledMediaDrives: '',
    numberOfMovieDrivesUsed: '',
    numberOfOutputs: '',
    numberOfMovies: '',
    numberOfLayers: '',
    outputResolution: '',
    mediaResolution: '',
    framerate: '',
    mediaBitDepth: '',
    mediaSampling: '',
    mediaFileType: '',
    warpAndBlend: '',
    freeCommentField: ''
};

const testInfoPrompts = [
    { key: 'serverType',              label: 'Server Type (eg W, S, P, R)' },
    { key: 'gpuModel',                label: 'GPU Model (eg. PRO4000)' },
    { key: 'numberOfGPUs',            label: 'Number of GPUs' },
    { key: 'seventhSpoutRendererUsed', label: '7thSpoutRenderer Used (Y/N)' },
    { key: 'diskModel',               label: 'Disk Model (eg. CM7, 9100, CD8)' },
    { key: 'numberOfInstalledMediaDrives', label: 'Number of installed Media Drives' },
    { key: 'numberOfMovieDrivesUsed', label: 'Number of Movie Drives Used by Delta (indicates a single RAID0 array, multiple RAID0 arrays or individual drives)' },
    { key: 'numberOfOutputs',         label: 'Number of Outputs' },
    { key: 'numberOfMovies',          label: 'Number of Individual Movies per Layer',
      defaultFrom: 'numberOfOutputs',  hint: 'press Enter to use Number of Outputs' },
    { key: 'numberOfLayers',          label: 'Number of Layers' },
    { key: 'outputResolution',        label: 'Output Resolution (eg. 3840x2160)' },
    { key: 'mediaResolution',         label: 'Media Resolution',
      defaultFrom: 'outputResolution', hint: 'press Enter to use Output Resolution' },
    { key: 'framerate',               label: 'Framerate (eg 60,120):' },
    { key: 'mediaBitDepth',           label: 'Media BitDepth (eg. 8, 10, 12)' },
    { key: 'mediaSampling',           label: 'Media Sampling (eg. 422, 444)' },
    { key: 'mediaFileType',           label: 'Media FileType (eg. TGA, DPX, 7thNLC, NotchLC_mov)' },
    { key: 'warpAndBlend',            label: 'Warp and Blend (Y/N)' },
    { key: 'freeCommentField',        label: 'Free Comment Field', excludeFromFilename: true }
];

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatFileStamp(dt) {
    return dt.getFullYear() + '-' +
        pad2(dt.getMonth() + 1) + '-' +
        pad2(dt.getDate()) + '_' +
        pad2(dt.getHours()) + '-' +
        pad2(dt.getMinutes()) + '-' +
        pad2(dt.getSeconds());
}

function formatTimestamp(dt) {
    return dt.getFullYear() + '-' +
        pad2(dt.getMonth() + 1) + '-' +
        pad2(dt.getDate()) + ' ' +
        pad2(dt.getHours()) + ':' +
        pad2(dt.getMinutes()) + ':' +
        pad2(dt.getSeconds());
}

function cleanValue(raw) {
    return String(raw || '').replace(/^"|"$/g, '').trim();
}

function stripMs(value) {
    return cleanValue(value).replace(/ms$/i, '').trim();
}

function parseFrTm(value) {
    var cleaned = cleanValue(value);
    var match = cleaned.match(/^([0-9.]+)ms\s*\(([0-9.]+)ms\)$/i);
    if (!match) {
        return { frTmMs: '', grnLineMs: '' };
    }
    return { frTmMs: match[1], grnLineMs: match[2] };
}

function parseSnapshot(rawText) {
    var snapshot = {};
    rawText.split(/\r?\n/).forEach(function (line) {
        var m = line.match(/^([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
        if (m) {
            snapshot[m[1]] = cleanValue(m[2]);
        }
    });
    return snapshot;
}

// Parse STATUS/STATUSEX responses. Supports both:
//   KEY : VALUE
//   KEY="VALUE"
function parseStatus(rawText) {
    var result = {};
    rawText.split(/\r?\n/).forEach(function (line) {
        var mEq = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (mEq) {
            var keyEq = mEq[1].trim();
            var valEq = String(mEq[2] || '').trim();
            if (valEq.startsWith('"') && valEq.endsWith('"') && valEq.length >= 2) {
                valEq = valEq.slice(1, -1);
            }
            result[keyEq] = valEq;
            return;
        }

        var mColon = line.match(/^([A-Z0-9_]+)\s*:\s*(.*)$/);
        if (mColon) {
            result[mColon[1].trim()] = String(mColon[2] || '').trim();
        }
    });
    return result;
}

function makeCsvPath() {
    return path.join(ensureLogDirectoryExists(), 'debugpoll_' + formatFileStamp(new Date()) + '.csv');
}

function writeCsvHeaderIfNeeded() {
    if (!csvHeaderWritten) {
        fs.appendFileSync(logPath, dataHeaders.join(',') + '\r\n');
        csvHeaderWritten = true;
    }
}

function toCsvCell(value) {
    var v = String(value == null ? '' : value);
    if (v.indexOf(',') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1 || v.indexOf('\r') !== -1) {
        return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
}

function parseSummaryValue(line) {
    var inQuotes = false;
    var idx = -1;

    // Use the last comma outside quotes so legacy keys containing commas still parse.
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (ch === '"') {
            // Handle escaped quote inside quoted field ("").
            if (inQuotes && line.charAt(i + 1) === '"') {
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            idx = i;
        }
    }

    if (idx === -1) {
        return { key: '', value: '' };
    }

    var key = line.slice(0, idx).trim();
    var value = line.slice(idx + 1).trim();

    if (key.startsWith('"') && key.endsWith('"')) {
        key = key.slice(1, -1).replace(/""/g, '"');
    }

    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/""/g, '"');
    }

    return { key: key, value: value };
}

function findLatestCsvFile() {
    var logDir = ensureLogDirectoryExists();
    var files = fs.readdirSync(logDir)
        .filter(function (name) {
            return /^debugpoll_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/i.test(name);
        })
        .map(function (name) {
            var fullPath = path.join(logDir, name);
            return {
                fullPath: fullPath,
                mtimeMs: fs.statSync(fullPath).mtimeMs
            };
        })
        .sort(function (a, b) {
            return b.mtimeMs - a.mtimeMs;
        });

    if (files.length === 0) {
        return null;
    }
    return files[0].fullPath;
}

function loadPreviousTestInfoFromLatestCsv() {
    var logDir = ensureLogDirectoryExists();
    var files = fs.readdirSync(logDir)
        .filter(function (name) {
            return /^debugpoll_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/i.test(name);
        })
        .map(function (name) {
            var fullPath = path.join(logDir, name);
            return {
                fullPath: fullPath,
                mtimeMs: fs.statSync(fullPath).mtimeMs
            };
        })
        .sort(function (a, b) {
            return b.mtimeMs - a.mtimeMs;
        });

    // Search through all CSV files (newest first) until we find test info
    for (var f = 0; f < files.length; f++) {
        try {
            var content = fs.readFileSync(files[f].fullPath, 'utf8');
            var lines = content.split(/\r?\n/);
            var summaryStart = lines.lastIndexOf('SummaryField,Value');

            if (summaryStart === -1) {
                continue;
            }

            var byLabel = {};
            for (var i = summaryStart + 1; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) {
                    continue;
                }
                var parsed = parseSummaryValue(line);
                if (parsed.key) {
                    byLabel[parsed.key] = parsed.value;
                }
            }

            var restored = {};
            var foundAny = false;
            testInfoPrompts.forEach(function (field) {
                restored[field.key] = byLabel[field.label] || '';
                if (restored[field.key]) {
                    foundAny = true;
                }
            });

            if (foundAny) {
                return { data: restored, file: files[f].fullPath };
            }
        } catch (e) {
            // Continue to next file
        }
    }

        return null;
}

function appendSummaryBlock() {
    if (!logPath) {
        return;
    }

    fs.appendFileSync(logPath, '\r\nSummaryField,Value\r\n');
    staticFields.forEach(function (field) {
        fs.appendFileSync(logPath, toCsvCell(field) + ',' + toCsvCell(latestStaticSummary[field] || '') + '\r\n');
    });

    // STATUS-sourced summary fields
    statusSummaryFields.forEach(function (field) {
        fs.appendFileSync(logPath, toCsvCell(field) + ',' + toCsvCell(latestStatusSummary[field] || '') + '\r\n');
    });

    if (testInfo.include) {
        testInfoPrompts.forEach(function (field) {
            fs.appendFileSync(logPath, toCsvCell(field.label) + ',' + toCsvCell(testInfo[field.key] || '') + '\r\n');
        });
    }

    if (stoppedEventNotes.length > 0) {
        fs.appendFileSync(logPath, '\r\nStoppedEventTimestamp,Note\r\n');
        stoppedEventNotes.forEach(function (entry) {
            fs.appendFileSync(logPath, toCsvCell(entry.timestamp) + ',' + toCsvCell(entry.note) + '\r\n');
        });
    }
}

function finalizeSession() {
    if (summaryWritten) {
        return;
    }
    appendSummaryBlock();
    summaryWritten = true;
}

function closePausedPrompt() {
    if (pausedRl && typeof pausedRl.close === 'function') {
        pausedRl.close();
        pausedRl = null;
    }

    if (pausedRawActive) {
        try {
            process.stdin.setRawMode(false);
        } catch (e) {
            // ignore cleanup errors for non-tty contexts
        }

        if (pausedRawHandler) {
            process.stdin.removeListener('data', pausedRawHandler);
        }

        pausedRawActive = false;
        pausedRawHandler = null;
        pausedRl = null;
    }
}

function requestConsoleFocus() {
    if (!options.focusOnStop) {
        return;
    }

    if (process.platform !== 'win32') {
        return;
    }

    // First try parent console process (PowerShell/cmd), then fallback to window title.
    var script = [
        "$ws = New-Object -ComObject WScript.Shell",
        "$ok = $false",
        "try { $ok = $ws.AppActivate(" + process.ppid + ") } catch {}",
        "if (-not $ok) { try { $ok = $ws.AppActivate('" + String(options.consoleTitle || '').replace(/'/g, "''") + "') } catch {} }"
    ].join('; ');

    try {
        var ps = childProcess.spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
            windowsHide: true,
            stdio: 'ignore'
        });
        ps.on('error', function () {
            // swallow spawn errors to avoid terminating the polling app
        });
        ps.unref();
    } catch (e) {
        // ignore focus errors
    }
}

function requestQuit() {
    userQuitRequested = true;
    finalizeSession();

    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    if (telnet && !telnet.destroyed) {
        telnet.destroy();
        return;
    }

    console.log('Exiting.');
    process.exit(0);
}

// --- Result file helpers ---

function sanitizeForFilename(value) {
    return String(value || '').replace(/[<>:"/\\|?*\s]/g, '').trim();
}

function buildResultFilename(result) {
    var now = new Date();
    var datePart = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + 
        '_' + pad2(now.getHours()) + '-' + pad2(now.getMinutes()) + '-' + pad2(now.getSeconds());
    var resultLabel = resultPart(result);
    var durationLabel = formatDurationForFilename(latestTimelineTime);
    var parts = [datePart, resultLabel, durationLabel];

    testInfoPrompts.forEach(function (field) {
        if (field.excludeFromFilename) { return; }
        if (field.showIf && !field.showIf()) { return; }
        parts.push(sanitizeForFilename(testInfo[field.key] || ''));
    });

    return parts.join('-');
}

function createResultFile(result) {
    if (!logPath) {
        console.log('Result file not created: active CSV path is not set.');
        return;
    }

    try {
        var csvContent = fs.readFileSync(logPath, 'utf8');
        var allLines = csvContent.split(/\r?\n/);

        // Separate header, data rows, and summary
        var headerLine = '';
        var dataLines = [];
        var inSummary = false;

        allLines.forEach(function (line, i) {
            if (i === 0) { headerLine = line; return; }
            if (line.trim() === 'SummaryField,Value' || inSummary) { inSummary = true; return; }
            if (line.trim() === '' && !inSummary) { return; }
            if (!inSummary) { dataLines.push(line); }
        });

        // Extract only the current Playing segment, excluding the final Stopped row.
        var startIndex = Math.max(0, playingSessionStartIndex);
        var endIndex = (lastStoppedRowIndex >= startIndex)
            ? Math.min(lastStoppedRowIndex, dataLines.length)
            : dataLines.length;
        var sessionLines = dataLines.slice(startIndex, endIndex);

        var logDir = ensureLogDirectoryExists();
        var filename = buildResultFilename(result) + '.csv';
        var resultPath = path.join(logDir, filename);

        var output = [headerLine];
        sessionLines.forEach(function (line) { output.push(line); });

        // Pre-playing note (note entered before this session's Playing start)
        if (prePlayingNote) {
            output.push('');
            output.push('NoteBeforeSession,Note');
            output.push(toCsvCell(prePlayingNote.timestamp) + ',' + toCsvCell(prePlayingNote.note));
        }

        // Summary block
        output.push('');
        output.push('SummaryField,Value');
        staticFields.forEach(function (field) {
            output.push(toCsvCell(field) + ',' + toCsvCell(latestStaticSummary[field] || ''));
        });
        statusSummaryFields.forEach(function (field) {
            output.push(toCsvCell(field) + ',' + toCsvCell(latestStatusSummary[field] || ''));
        });
        testInfoPrompts.forEach(function (field) {
            output.push(toCsvCell(field.label) + ',' + toCsvCell(testInfo[field.key] || ''));
        });

        fs.writeFileSync(resultPath, output.join('\r\n') + '\r\n');
        console.log('\n' + resultPart(result) + ' result file saved: ' + filename);
        console.log('Result file path: ' + resultPath);
    } catch (e) {
        console.log('Error creating result file: ' + e.message);
    }
}

// Returns total seconds from a "HH:MM:SS" string.
function parseTimeToSeconds(timeStr) {
    var parts = String(timeStr || '').split(':');
    if (parts.length !== 3) { return 0; }
    return (parseInt(parts[0], 10) || 0) * 3600 +
           (parseInt(parts[1], 10) || 0) * 60 +
           (parseInt(parts[2], 10) || 0);
}

// Returns "HH_MM" from a "HH:MM:SS" string (for use in filenames).
function formatDurationForFilename(timeStr) {
    var parts = String(timeStr || '').split(':');
    if (parts.length < 2) { return '00_00'; }
    return pad2(parseInt(parts[0], 10) || 0) + '_' + pad2(parseInt(parts[1], 10) || 0);
}

// Determines the result category based on the elapsed timeline time.
// Returns 'PASS', 'UPASS', or 'OK'.
function getResultCategory() {
    var secs = parseTimeToSeconds(latestTimelineTime);
    if (secs > options.passThresholdHours * 3600) { return 'PASS'; }
    if (secs > options.unofficialPassThresholdHours * 3600) { return 'UPASS'; }
    return 'OK';
}

// Maps a single keypress to a result code given the active category.
// Returns a result code string or null if the key is not a positive/fail action.
function mapKeyToResult(key, category) {
    if (key === 'f') { return 'F'; }
    if (category === 'PASS'  && key === 'p') { return 'P'; }
    if (category === 'UPASS' && key === 'u') { return 'UP'; }
    if (category === 'OK'    && key === 'o') { return 'OK'; }
    return null;
}

function resultPart(result) {
    if (result === 'P')  { return 'PASS'; }
    if (result === 'UP') { return 'UPASS'; }
    if (result === 'OK') { return 'OK'; }
    return 'FAIL';
}

function normalizeInputKey(input) {
    var raw = String(input || '').trim().toLowerCase();
    if (!raw) {
        return '';
    }

    // Find the first alpha key so values like "p\r" still map to "p".
    var alpha = raw.match(/[a-z]/);
    return alpha ? alpha[0] : raw.charAt(0);
}

function showPassFailPrompt() {
    if (pausedRl || pausedRawActive || userQuitRequested) {
        showPausedPrompt();
        return;
    }

    var category = getResultCategory();
    var durationStr = latestTimelineTime || '00:00:00';
    var promptLine;
    if (category === 'PASS') {
        promptLine = 'Test duration: ' + durationStr + '. Log result? Press P = Pass, F = Fail, or any other key to continue:';
    } else if (category === 'UPASS') {
        promptLine = 'Test duration: ' + durationStr + '. Log result? Press U = Unofficial Pass, F = Fail, or any other key to continue:';
    } else {
        promptLine = 'Test duration: ' + durationStr + '. Log result? Press O = OK, F = Fail, or any other key to continue:';
    }
    console.log(promptLine);

    if (!process.stdin.isTTY) {
        pausedRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        pausedRl.question('> ', function (answer) {
            pausedRl.close();
            pausedRl = null;
            var k = normalizeInputKey(answer);
            var res = mapKeyToResult(k, category);
            if (res) { createResultFile(res); }
            showPausedPrompt();
        });
        return;
    }

    process.stdin.resume();
    process.stdin.setRawMode(true);
    pausedRawActive = true;

    var pfKeyHandler = function (key) {
        try { process.stdin.setRawMode(false); } catch (e) {}
        process.stdin.pause();
        process.stdin.removeListener('data', pfKeyHandler);
        try { while (process.stdin.read() !== null) {} } catch (e) {}
        pausedRawActive = false;
        pausedRawHandler = null;
        pausedRl = null;

        var k = normalizeInputKey(key);
        var res = mapKeyToResult(k, category);
        if (res) { createResultFile(res); }
        showPausedPrompt();
    };

    pausedRawHandler = pfKeyHandler;
    process.stdin.once('data', pfKeyHandler);
}

// --- Paused state prompt ---

function showPausedPrompt() {
    if (pausedRl || pausedRawActive || isLogging || userQuitRequested) {
        return;
    }

    var promptMsg = isDisconnected
        ? 'Connection Lost. Press N to add a note, Q to quit, or any other key to reconnect:'
        : 'Mode is Stopped. Press N to add a note, or Q to quit:\nWaiting for Playback to resume for logging to continue...';
    console.log(promptMsg);

    if (!process.stdin.isTTY) {
        // Fallback: readline if raw mode unavailable
        pausedRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        pausedRl.question('> ', function (answer) {
            pausedRl.close();
            pausedRl = null;
            handlePausedInput(String(answer || '').trim().toLowerCase());
        });
        return;
    }

    // Raw mode for single keypress
    process.stdin.resume();
    process.stdin.setRawMode(true);
    pausedRawActive = true;

    var keyHandler = function (key) {
        try {
            process.stdin.setRawMode(false);
        } catch (e) {
            // ignore cleanup errors
        }
        process.stdin.pause();
        process.stdin.removeListener('data', keyHandler);
        try { while (process.stdin.read() !== null) {} } catch (e) {}
        pausedRawActive = false;
        pausedRawHandler = null;
        pausedRl = null;

        if (key) {
            handlePausedInput(key.toString());
        } else if (!isLogging && !userQuitRequested) {
            setTimeout(showPausedPrompt, 100);
        }
    };

    pausedRawHandler = keyHandler;
    process.stdin.once('data', keyHandler);
}

function handlePausedInput(cmd) {
    var normalized = String(cmd || '').trim().toLowerCase();
    var first = normalized.charAt(0);

    if (first === 'n') {
        promptStoppedNote();
    } else if (first === 'q') {
        requestQuit();
    } else if (isDisconnected) {
        // In disconnected state, any other key triggers reconnect
        isDisconnected = false;
        connect();
    } else {
        // Not disconnected: any other key: keep waiting
        if (!isLogging && !userQuitRequested) {
            setTimeout(showPausedPrompt, 100);
        }
    }
}

function promptStoppedNote() {
    if (pausedRl || pausedRawActive || isLogging || userQuitRequested) {
        return;
    }

    var stopTs = currentStoppedEventTimestamp || formatTimestamp(new Date());

    // Delay lets the Windows console driver settle after leaving raw mode.
    // Use terminal:false so readline does not do its own character echo/editing; the console's
    // normal cooked-mode echo remains single and avoids duplicated characters in this prompt.
    setTimeout(function () {
        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); } catch (e) {}
        }
        pausedRl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        pausedRl.question('Optional note for STOP at ' + stopTs + ' (leave blank and press Enter to skip): ', function (note) {
            pausedRl.close();
            pausedRl = null;

            var text = String(note || '').trim();
            if (text) {
                stoppedEventNotes.push({ timestamp: stopTs, note: text });
                console.log('Stop note saved.');
            }

            if (!isLogging && !userQuitRequested) {
                showPausedPrompt();
            }
        });
    }, 50);
}

function writeSnapshotToCsv(snapshot, mode) {
    staticFields.forEach(function (field) {
        latestStaticSummary[field] = snapshot[field] || latestStaticSummary[field] || '';
    });

    var frTm = parseFrTm(snapshot.FrTm || '');
    var row = [
        formatTimestamp(new Date()),
        latestTimelineTime,
        frTm.frTmMs,
        frTm.grnLineMs,
        stripMs(snapshot.MstAvFrmTm || ''),
        latestTimelineFrames,
        snapshot.FrmDropped || '',
        snapshot.MovieFrmDropped || '',
        stripMs(snapshot.AudioTracking || ''),
        mode || ''
    ];

    writeCsvHeaderIfNeeded();
    fs.appendFileSync(logPath, row.map(toCsvCell).join(',') + '\r\n');
    csvDataLineCount++;

    var padValue = function (value, width) {
        var txt = String(value || '');
        return txt.length >= width ? txt : txt.padStart(width, ' ');
    };

    console.log('Time = ' + padValue(row[1], 9) +
        ', Frames = ' + padValue(row[5], 9) +
        ', FrmDropped = ' + padValue(row[6], 4) +
        ', MovieFrmDropped = ' + padValue(row[7], 5) +
        ', FrmTm = ' + padValue(row[2], 6) +
        ', GrnLine = ' + padValue(row[3], 5) +
        ', Mode = ' + (mode || ''));
}

function connect() {
    csvHeaderWritten = false;
    recvBuffer = '';
    streamBlockType = '';
    streamBlockLines = [];
    latestStaticSummary = {};
    latestStatusSummary = {};
    lastSnapshot = null;
    latestTimelineTime = '';
    latestTimelineFrames = '';
    latestTimelineMode = '';
    summaryWritten = false;
    userQuitRequested = false;
    currentStoppedEventTimestamp = '';
    stoppedEventNotes = [];
    csvDataLineCount = 0;
    playingSessionStartIndex = 0;
    lastStoppedRowIndex = -1;
    prePlayingNote = null;
    isDisconnected = false;
    isLogging = false;
    lastModeWasPlaying = false;
    logPath = makeCsvPath();
    closePausedPrompt();

    console.log('\nConnecting to ' + options.ip + ':' + options.port + ' ...');
    console.log('Log folder: ' + ensureLogDirectoryExists());
    console.log('Writing CSV to: ' + logPath + '\n');

    telnet = net.connect(options.port, options.ip);

    telnet.on('connect', function () {
        console.log('Connected. Polling every ' + options.logInterval + ' second(s).');
    });

    telnet.on('data', onRecv);

    telnet.on('error', function () {
        // close handler below manages reconnect prompt and summary write
    });

    telnet.on('close', function () {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        closePausedPrompt();

        // If we were logging when the connection dropped, write a final row and offer Pass/Fail
        if (isLogging) {
            isLogging = false;
            lastModeWasPlaying = false;
            isDisconnected = true;

            writeCsvHeaderIfNeeded();
            var src = lastSnapshot || {};
            var frTmDisconnect = parseFrTm(src.FrTm || '');
            currentStoppedEventTimestamp = formatTimestamp(new Date());
            var disconnectRow = [
                currentStoppedEventTimestamp,
                latestTimelineTime,
                frTmDisconnect.frTmMs,
                frTmDisconnect.grnLineMs,
                stripMs(src.MstAvFrmTm || ''),
                latestTimelineFrames,
                src.FrmDropped || '',
                src.MovieFrmDropped || '',
                stripMs(src.AudioTracking || ''),
                'Disconnected'
            ];
            fs.appendFileSync(logPath, disconnectRow.map(toCsvCell).join(',') + '\r\n');
            csvDataLineCount++;
            lastStoppedRowIndex = csvDataLineCount - 1;
            console.log('\n--- CONNECTION LOST --- ' + new Date().toLocaleString() + ' ---');
            requestConsoleFocus();
            if (testInfo.include) {
                showPassFailPrompt();
            } else {
                showPausedPrompt();
            }
            return;
        }

        finalizeSession();

        if (userQuitRequested) {
            console.log('CSV saved to: ' + logPath);
            console.log('Exiting.');
            process.exit(0);
            return;
        }

        console.log('\n--- CONNECTION LOST --- ' + new Date().toLocaleString() + ' ---');
        console.log('CSV saved to: ' + logPath);
        promptReconnect();
    });

    pollTimer = setInterval(function () {
        if (telnet && !telnet.destroyed) {
            telnet.write('realtimecmd ' + options.command + '\n\r');
            telnet.write('realtimecmd statusex' + '\n\r');
            telnet.write('realtimecmd timelinestatus' + '\n\r');
        }
    }, options.logInterval * 1000);
}

function handleModeChange(mode) {
    var playing = (mode.toLowerCase() === 'playing');

    if (playing && !isLogging) {
        isLogging = true;
        lastModeWasPlaying = true;
        playingSessionStartIndex = csvDataLineCount;
        lastStoppedRowIndex = -1;
        currentStoppedEventTimestamp = '';
        prePlayingNote = stoppedEventNotes.length > 0
            ? stoppedEventNotes[stoppedEventNotes.length - 1]
            : null;
        closePausedPrompt();
        var startMsg = (csvDataLineCount === 0)
            ? '\n--- MODE = Playing --- logging started ---'
            : '\n--- MODE = Playing --- logging resumed ---';
        console.log(startMsg);
    } else if (!playing && isLogging) {
        isLogging = false;
        lastModeWasPlaying = false;

        writeCsvHeaderIfNeeded();
        var src = lastSnapshot || {};
        var frTmStopped = parseFrTm(src.FrTm || '');
        currentStoppedEventTimestamp = formatTimestamp(new Date());
        var stoppedRow = [
            currentStoppedEventTimestamp,
            latestTimelineTime,
            frTmStopped.frTmMs,
            frTmStopped.grnLineMs,
            stripMs(src.MstAvFrmTm || ''),
            latestTimelineFrames,
            src.FrmDropped || '',
            src.MovieFrmDropped || '',
            stripMs(src.AudioTracking || ''),
            mode
        ];
        fs.appendFileSync(logPath, stoppedRow.map(toCsvCell).join(',') + '\r\n');
        csvDataLineCount++;
        lastStoppedRowIndex = csvDataLineCount - 1;
        console.log('\n--- MODE = ' + mode + ' --- logging paused ---');
        requestConsoleFocus();
        if (testInfo.include) {
            showPassFailPrompt();
        } else {
            showPausedPrompt();
        }
    }
}

function processBlock(text) {
    var trimmed = text.trim();
    if (!trimmed) { return; }

    if (/(^|\n)\s*DebugIt\s*=/.test(trimmed)) {
        // DEBUGSTATUS block
        var snapshot = parseSnapshot(trimmed);
        lastSnapshot = snapshot;
        if (isLogging) {
            writeSnapshotToCsv(snapshot, latestTimelineMode);
        }

    } else if (/(^|\n)\s*TL\s*=/.test(trimmed)) {
        // TIMELINESTATUS block — source of MODE, Time, and Frames
        var tlData = parseSnapshot(trimmed);
        if (tlData['SMPTE']) {
            // SMPTE="HH:MM:SS::frames" — keep only HH:MM:SS
            latestTimelineTime = tlData['SMPTE'].replace(/::.*$/, '');
        }
        if (tlData['FRAMES'] !== undefined) {
            latestTimelineFrames = tlData['FRAMES'];
        }
        if (tlData['MODE'] !== undefined) {
            var tlMode = tlData['MODE'].trim();
            latestTimelineMode = tlMode;
            handleModeChange(tlMode);
        }

    } else if (/(^|\n)\s*SERVER\s*[:=]/.test(trimmed)) {
        // STATUSEX block — capture summary fields only
        var statusData = parseStatus(trimmed);
        statusSummaryFields.forEach(function (f) {
            if (statusData[f] !== undefined) {
                latestStatusSummary[f] = statusData[f];
            }
        });
    }
}

function detectBlockStart(line) {
    if (/^DebugIt\s*=/i.test(line)) {
        return 'debugstatus';
    }
    if (/^TL\s*=/i.test(line)) {
        return 'timelinestatus';
    }
    if (/^SERVER\s*[:=]/i.test(line)) {
        return 'statusex';
    }
    return '';
}

function onRecv(data) {
    recvBuffer += data.toString();

    // Parse by lines and split blocks by start keys, not by fixed end markers.
    var lines = recvBuffer.split(/\r?\n/);
    recvBuffer = lines.pop(); // keep partial line for next packet

    lines.forEach(function (rawLine) {
        var line = rawLine.trim();
        if (!line) {
            return;
        }

        var startType = detectBlockStart(line);
        if (startType) {
            if (streamBlockType && streamBlockLines.length > 0) {
                processBlock(streamBlockLines.join('\n'));
            }
            streamBlockType = startType;
            streamBlockLines = [line];
            return;
        }

        if (streamBlockType) {
            streamBlockLines.push(line);
        }
    });

}

function promptReconnect() {
    if (rl) {
        rl.close();
    }

    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nPress R + Enter to reconnect, or Q + Enter to quit: ', function (answer) {
        rl.close();
        rl = null;

        if (answer.trim().toLowerCase() === 'r') {
            connect();
            return;
        }

        finalizeSession();
        console.log('Exiting.');
        process.exit(0);
    });
}

function displayTestInfoSummary(data) {
    console.log('\n--- Test Information from Previous Run ---');
    testInfoPrompts.forEach(function (field) {
        var val = data[field.key] || '(empty)';
        console.log('  ' + field.label + ': ' + val);
    });
    console.log('---\n');
}

function displayTestInfoWithNumbers(data) {
    console.log('\n--- Current Test Information ---');
    testInfoPrompts.forEach(function (field, idx) {
        var val = data[field.key] || '(empty)';
        console.log('  [' + (idx + 1) + '] ' + field.label + ': ' + val);
    });
    console.log('---\n');
}

function askSelectiveEdits(data, hasChanges) {
    if (hasChanges === undefined) {
        hasChanges = false;
    }

    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    displayTestInfoWithNumbers(data);
    rl.question("Enter field numbers to change (comma-separated), 'a' for full re-entry, or press Enter to continue: ", function (answer) {
        var input = answer.trim().toLowerCase();

        if (input === '') {
            // Apply data and continue
            testInfo.include = true;
            testInfoPrompts.forEach(function (field) {
                testInfo[field.key] = data[field.key] || '';
            });
            console.log(hasChanges ? 'Using updated test data.' : 'Using imported test data.');
            rl.close();
            rl = null;
            connect();
            return;
        }

        if (input === 'a') {
            // Full re-entry
            testInfo.include = true;
            rl.close();
            rl = null;
            rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            console.log('Enter new test information:');
            askForTestInfoField(0);
            return;
        }

        // Parse comma-separated field numbers
        var indices = input.split(',').map(function (s) { return parseInt(s.trim(), 10) - 1; }).filter(function (i) { return !isNaN(i) && i >= 0 && i < testInfoPrompts.length; });

        if (indices.length === 0) {
            console.log('No valid field numbers entered. Please try again.');
            rl.close();
            rl = null;
            askSelectiveEdits(data, hasChanges);
            return;
        }

        // Edit each selected field in sequence
        editSelectedFields(data, indices, 0, hasChanges);
    });
}

function editSelectedFields(data, indices, idx, hasChanges) {
    if (idx >= indices.length) {
        // Done editing, ask if more changes or continue
        askSelectiveEdits(data, true);
        return;
    }

    var fieldIndex = indices[idx];
    var field = testInfoPrompts[fieldIndex];
    var currentValue = data[field.key] || '';
    var prompt = 'Edit [' + (fieldIndex + 1) + '] ' + field.label + ' (current: "' + currentValue + '"): ';

    rl.question(prompt, function (answer) {
        data[field.key] = answer.trim();
        editSelectedFields(data, indices, idx + 1, true);
    });
}

function askTestInfoAndStart() {
    // First: ask if user wants to log test data
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Log test data for future analysis? (Y/n): ', function (answer) {
        var yes = (answer.trim().toLowerCase() === '' || answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');

        if (!yes) {
            // Skip test info entirely, connect directly
            testInfo.include = false;
            rl.close();
            rl = null;
            connect();
            return;
        }

        // User wants to log test data — proceed with finding/editing
        rl.close();
        rl = null;
        askTestInfoAndStart_WithLogging();
    });
}

function askTestInfoAndStart_WithLogging() {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    var result = null;
    var latestFile = null;

    try {
        result = loadPreviousTestInfoFromLatestCsv();
        if (result) {
            latestFile = result.file;
            restored = result.data;
        }
    } catch (e) {
        result = null;
        latestFile = null;
    }

    if (result && latestFile) {
        // Previous data found — show it and ask to reuse
        console.log('\nLatest CSV file: ' + latestFile);
        displayTestInfoSummary(result.data);

        rl.question('Reuse this test data? (Y/n/s for selective edit): ', function (answer) {
            var useIt = (answer.trim().toLowerCase() === '' || answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
            var selective = (answer.trim().toLowerCase() === 's');

            if (useIt) {
                // Reuse previous data
                testInfo.include = true;
                testInfoPrompts.forEach(function (field) {
                    testInfo[field.key] = result.data[field.key] || '';
                });
                console.log('Using imported test data.');
                rl.close();
                rl = null;
                connect();
                return;
            }

            if (selective) {
                // Selective edit mode
                rl.close();
                rl = null;
                askSelectiveEdits(result.data, false);
                return;
            }

            // User wants new data — step through entry
            testInfo.include = true;
            rl.close();
            rl = null;
            rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            console.log('Enter new test information:');
            askForTestInfoField(0);
        });
    } else {
        // No previous data — ask if user wants to enter any
        rl.question('Enter test information? (y/N): ', function (answer) {
            var yes = answer.trim().toLowerCase();

            if (yes !== 'y' && yes !== 'yes') {
                // Skip test info entirely
                rl.close();
                rl = null;
                connect();
                return;
            }

            // User wants to enter test info
            testInfo.include = true;
            rl.close();
            rl = null;
            rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            console.log('Enter test information:');
            askForTestInfoField(0);
        });
    }
}

function askForTestInfoField(index) {
    if (index >= testInfoPrompts.length) {
        rl.close();
        rl = null;
        connect();
        return;
    }

    var field = testInfoPrompts[index];

    // Skip conditional fields that don't apply
    if (field.showIf && !field.showIf()) {
        testInfo[field.key] = '';
        askForTestInfoField(index + 1);
        return;
    }

    var promptLabel = field.label;
    if (field.hint) {
        promptLabel += ' (' + field.hint + ')';
    }

    rl.question('  ' + promptLabel + ': ', function (value) {
        var trimmed = value.trim();
        if (!trimmed && field.defaultFrom) {
            testInfo[field.key] = testInfo[field.defaultFrom] || '';
        } else {
            testInfo[field.key] = trimmed;
        }
        askForTestInfoField(index + 1);
    });
}

askTestInfoAndStart();



