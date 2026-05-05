const path = require('path');
const net = require('net');
const http = require('http');
const { app, BrowserWindow, ipcMain } = require('electron');

var mainWindow = null;
var pollSocket = null;
var pollTimer = null;
var recvBuffer = '';
var lastConnectionConfig = null;
var liveState = {
    connected: false,
    mode: 'Stopped',
    duration: '00:00:00',
    fps: '60',
    frames: '0',
    frmDropped: '0',
    movieFrmDropped: '0',
    frTmMs: '0.00',
    grnLineMs: '0.00',
    mstAvFrmTm: '0.00',
    audioTracking: '0.00',
    statusMessage: 'Idle.'
};

function parseMsPair(value) {
    var cleaned = String(value || '').trim();
    var pair = cleaned.match(/^([0-9.]+)ms\s*\(([0-9.]+)ms\)$/i);
    if (pair) {
        return { frTmMs: pair[1], grnLineMs: pair[2] };
    }

    var single = cleaned.match(/^([0-9.]+)ms$/i);
    if (single) {
        return { frTmMs: single[1], grnLineMs: liveState.grnLineMs };
    }

    return null;
}

function parseMsValue(value) {
    var match = String(value || '').trim().match(/^([0-9.]+)ms$/i);
    if (match) {
        return match[1];
    }
    return String(value || '').trim();
}

function broadcastLiveUpdate(extra) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    var payload = Object.assign({}, liveState, extra || {});
    mainWindow.webContents.send('session:update', payload);
}

function broadcastFullStatus(fj) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    mainWindow.webContents.send('server:fullStatus', fj);
}

function parseIncomingChunk(chunk) {
    recvBuffer += String(chunk || '');

    // Extract any complete JSON objects (FULLSTATUSJSON responses) before line parsing.
    var jsonStart = recvBuffer.indexOf('{');
    while (jsonStart !== -1) {
        var depth = 0, inStr = false, esc = false, jsonEnd = -1;
        for (var ji = jsonStart; ji < recvBuffer.length; ji++) {
            var jc = recvBuffer[ji];
            if (esc) { esc = false; continue; }
            if (jc === '\\' && inStr) { esc = true; continue; }
            if (jc === '"') { inStr = !inStr; continue; }
            if (inStr) { continue; }
            if (jc === '{') { depth++; }
            else if (jc === '}') { depth--; if (depth === 0) { jsonEnd = ji; break; } }
        }
        if (jsonEnd === -1) { break; } // incomplete JSON, wait for more data
        var jsonStr = recvBuffer.slice(jsonStart, jsonEnd + 1);
        recvBuffer = recvBuffer.slice(0, jsonStart) + recvBuffer.slice(jsonEnd + 1);
        try { broadcastFullStatus(JSON.parse(jsonStr)); } catch (e) { /* ignore */ }
        jsonStart = recvBuffer.indexOf('{');
    }

    var lines = recvBuffer.split(/\r?\n/);
    recvBuffer = lines.pop() || '';

    lines.forEach(function (lineRaw) {
        var line = String(lineRaw || '').trim();
        if (!line) {
            return;
        }

        var mode = line.match(/^MODE\s*=\s*"?(.*?)"?$/i);
        if (mode) {
            liveState.mode = mode[1] || liveState.mode;
            return;
        }

        var smpte = line.match(/^SMPTE\s*=\s*"?(.*?)"?$/i);
        if (smpte) {
            // Only store value if it looks like a valid timecode (HH:MM:SS...).
            // Delta returns "OFF" for inactive timeline slots — ignore those.
            var smpteVal = String(smpte[1] || '').replace(/::/g, ':').trim();
            if (/^\d{2}:\d{2}:\d{2}/.test(smpteVal)) {
                liveState.duration = smpteVal;
            }
            return;
        }

        var fps = line.match(/^FPS\s*=\s*"?(.*?)"?$/i);
        if (fps) {
            liveState.fps = String(fps[1] || '').trim() || liveState.fps;
            return;
        }

        var frames = line.match(/^FRAMES\s*=\s*"?(.*?)"?$/i);
        if (frames) {
            liveState.frames = frames[1] || liveState.frames;
            return;
        }

        var dropped = line.match(/^FrmDropped\s*=\s*"?(.*?)"?$/i);
        if (dropped) {
            liveState.frmDropped = dropped[1] || liveState.frmDropped;
            return;
        }

        var movieDropped = line.match(/^MovieFrmDropped\s*=\s*"?(.*?)"?$/i);
        if (movieDropped) {
            liveState.movieFrmDropped = movieDropped[1] || liveState.movieFrmDropped;
            return;
        }

        var frTm = line.match(/^FrTm\s*=\s*"?(.*?)"?$/i);
        if (frTm) {
            var msPair = parseMsPair(frTm[1]);
            if (msPair) {
                liveState.frTmMs = msPair.frTmMs;
                liveState.grnLineMs = msPair.grnLineMs;
            }
            return;
        }

        var grnLine = line.match(/^GrnLine\s*=\s*"?(.*?)"?$/i);
        if (grnLine) {
            liveState.grnLineMs = parseMsValue(grnLine[1]) || liveState.grnLineMs;
            return;
        }

        var mstAvFrmTm = line.match(/^MstAvFrmTm\s*=\s*"?(.*?)"?$/i);
        if (mstAvFrmTm) {
            liveState.mstAvFrmTm = parseMsValue(mstAvFrmTm[1]) || liveState.mstAvFrmTm;
            return;
        }

        var audioTracking = line.match(/^AudioTracking\s*=\s*"?(.*?)"?$/i);
        if (audioTracking) {
            liveState.audioTracking = parseMsValue(audioTracking[1]) || liveState.audioTracking;
        }
    });

    broadcastLiveUpdate();
}

function stopPolling(statusMessage) {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    if (pollSocket && !pollSocket.destroyed) {
        pollSocket.destroy();
    }

    pollSocket = null;
    recvBuffer = '';
    liveState.connected = false;
    liveState.statusMessage = statusMessage || 'Session stopped.';
    broadcastLiveUpdate();
}

function startPolling(connection) {
    var config = connection || {};
    var ip = String(config.ip || '').trim();
    var port = parseInt(config.port, 10);
    var intervalSec = parseInt(config.logInterval || 2, 10);

    if (!ip || !port) {
        return { ok: false, message: 'Missing IP or port.' };
    }

    if (pollSocket || pollTimer) {
        stopPolling('Restarting session...');
    }

    lastConnectionConfig = {
        ip: ip,
        port: port,
        logInterval: intervalSec > 0 ? intervalSec : 2
    };

    liveState.connected = false;
    liveState.statusMessage = 'Connecting to ' + ip + ':' + port + ' ...';
    broadcastLiveUpdate();

    pollSocket = net.connect(lastConnectionConfig.port, lastConnectionConfig.ip);

    pollSocket.on('connect', function () {
        liveState.connected = true;
        liveState.statusMessage = 'Connected. Polling every ' + lastConnectionConfig.logInterval + ' second(s).';
        broadcastLiveUpdate();

        // Request an immediate FULLSTATUSJSON snapshot on connect.
        pollSocket.write('FULLSTATUSJSON\r\n');

        pollTimer = setInterval(function () {
            if (!pollSocket || pollSocket.destroyed) {
                return;
            }
            pollSocket.write('debugstatus\n\r');
            pollSocket.write('statusex\n\r');
            pollSocket.write('timelinestatus\n\r');
        }, lastConnectionConfig.logInterval * 1000);
    });

    pollSocket.on('data', function (data) {
        parseIncomingChunk(data.toString());
    });

    pollSocket.on('error', function (err) {
        liveState.statusMessage = 'Connection error: ' + err.message;
        broadcastLiveUpdate();
    });

    pollSocket.on('close', function () {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        pollSocket = null;
        liveState.connected = false;
        liveState.statusMessage = 'Connection closed.';
        broadcastLiveUpdate();
    });

    return { ok: true };
}

function createMainWindow() {
    const window = new BrowserWindow({
        width: 1440,
        height: 980,
        minWidth: 1180,
        minHeight: 820,
        backgroundColor: '#101418',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    window.loadFile(path.join(__dirname, 'src', 'index.html'));
    mainWindow = window;

    window.on('closed', function () {
        mainWindow = null;
    });
}

ipcMain.handle('server:fetchInfo', function (_event, connection) {
    var config = connection || {};
    var ip = String(config.ip || '').trim();
    var port = parseInt(config.port, 10) || 23;

    if (!ip) {
        return { ok: false, message: 'No IP address configured.', derived: {} };
    }

    return new Promise(function (resolve) {
        var tempConn = net.connect(port, ip);
        var buffer = '';
        var fullStatusJson = null;
        var resourceXml = null;
        var done = false;
        var timeout = null;

        function extractXmlAttr(attrStr, attrName) {
            var m = attrStr.match(new RegExp('\\b' + attrName + '="([^"]*)"', 'i'));
            return m ? m[1] : '';
        }

        function finish() {
            if (done) { return; }
            done = true;
            clearTimeout(timeout);
            if (!tempConn.destroyed) { tempConn.destroy(); }

            var derived = {};

            if (fullStatusJson) {
                try {
                    var fj = JSON.parse(fullStatusJson);
                    if (fj.ServerName && fj.ServerName.length > 0) {
                        derived.serverType = fj.ServerName.charAt(0);
                    }
                    if (fj.ChannelConfig && fj.ChannelConfig.enabledChannels !== undefined) {
                        derived.numberOfOutputs = String(fj.ChannelConfig.enabledChannels);
                    }
                    if (fj.ChannelConfig && Array.isArray(fj.ChannelConfig.channels)) {
                        for (var ci = 0; ci < fj.ChannelConfig.channels.length; ci++) {
                            var ch = fj.ChannelConfig.channels[ci];
                            if (ch.enabled) {
                                derived.outputResolution = (ch.right - ch.left) + 'x' + (ch.bottom - ch.top);
                                break;
                            }
                        }
                    }
                    if (fj.FPS !== undefined) {
                        derived.framerate = String(fj.FPS);
                    }
                } catch (e) { /* ignore JSON parse errors */ }
            }

            if (resourceXml) {
                try {
                    var resourceTagRegex = /<RESOURCE([^>]*)>/gi;
                    var resourceMatch;
                    var enabledMovieLayers = [];
                    var hasEnabledGeom = false;
                    var hasEnabledBlend = false;

                    while ((resourceMatch = resourceTagRegex.exec(resourceXml)) !== null) {
                        var attrs = resourceMatch[1];
                        var rType = extractXmlAttr(attrs, 'Type');
                        var rEnabled = extractXmlAttr(attrs, 'Enabled');
                        var rLayer = extractXmlAttr(attrs, 'Layer');
                        if (rEnabled !== 'Y') { continue; }
                        if (rType === 'Movie' && rLayer !== '') {
                            enabledMovieLayers.push(parseInt(rLayer, 10));
                        } else if (rType === 'Geometry') {
                            hasEnabledGeom = true;
                        } else if (rType === 'Blends') {
                            hasEnabledBlend = true;
                        }
                    }

                    if (enabledMovieLayers.length > 0) {
                        var uniqueLayers = enabledMovieLayers.filter(function (v, i, a) { return a.indexOf(v) === i; });
                        derived.numberOfLayers = String(uniqueLayers.length);
                        var layerCounts = {};
                        enabledMovieLayers.forEach(function (layer) {
                            layerCounts[layer] = (layerCounts[layer] || 0) + 1;
                        });
                        var counts = Object.keys(layerCounts).map(function (k) { return layerCounts[k]; });
                        derived.numberOfMovies = String(Math.max.apply(null, counts));
                    }
                    derived.warpAndBlend = (hasEnabledGeom || hasEnabledBlend) ? 'Y' : 'N';
                } catch (e) { /* ignore XML parse errors */ }
            }

            resolve({ ok: true, derived: derived });
        }

        timeout = setTimeout(function () {
            if (!done) {
                done = true;
                if (!tempConn.destroyed) { tempConn.destroy(); }
                resolve({ ok: false, message: 'Timed out waiting for server response.', derived: {} });
            }
        }, 8000);

        tempConn.on('connect', function () {
            tempConn.write('FULLSTATUSJSON\r\n');
            tempConn.write('GETRESOURCEXML\r\n');
        });

        tempConn.on('data', function (data) {
            buffer += data.toString();

            if (!fullStatusJson) {
                var jsonStart = buffer.indexOf('{');
                if (jsonStart !== -1) {
                    var depth = 0;
                    var inStr = false;
                    var esc = false;
                    for (var i = jsonStart; i < buffer.length; i++) {
                        var c = buffer[i];
                        if (esc) { esc = false; continue; }
                        if (c === '\\' && inStr) { esc = true; continue; }
                        if (c === '"') { inStr = !inStr; continue; }
                        if (inStr) { continue; }
                        if (c === '{') { depth++; }
                        else if (c === '}') {
                            depth--;
                            if (depth === 0) { fullStatusJson = buffer.slice(jsonStart, i + 1); break; }
                        }
                    }
                }
            }

            if (!resourceXml) {
                var xmlEnd = buffer.indexOf('</TIMELINE>');
                if (xmlEnd !== -1) {
                    var xmlStart = buffer.indexOf('<TIMELINE');
                    if (xmlStart !== -1 && xmlStart < xmlEnd) {
                        resourceXml = buffer.slice(xmlStart, xmlEnd + '</TIMELINE>'.length);
                    }
                }
            }

            if (fullStatusJson && resourceXml) { finish(); }
        });

        tempConn.on('error', function (err) {
            if (!done) {
                done = true;
                clearTimeout(timeout);
                resolve({ ok: false, message: err.message, derived: {} });
            }
        });

        tempConn.on('close', function () {
            if (!done) { finish(); }
        });
    });
});

ipcMain.handle('registry:fetch', function (_event, connection) {
    var config = connection || {};
    var ip = String(config.ip || '').trim();
    var port = parseInt(config.registryPort, 10) || 4477;

    if (!ip) {
        return { ok: false, message: 'No IP address configured.' };
    }

    return new Promise(function (resolve) {
        var options = {
            hostname: ip,
            port: port,
            path: '/registry',
            method: 'GET'
        };

        var req = http.request(options, function (res) {
            var body = '';
            res.on('data', function (chunk) { body += chunk; });
            res.on('end', function () {
                try {
                    var parsed = JSON.parse(body);
                    resolve({ ok: true, data: parsed });
                } catch (e) {
                    resolve({ ok: false, message: 'Invalid JSON from registry server: ' + e.message });
                }
            });
        });

        req.setTimeout(8000, function () {
            req.destroy();
            resolve({ ok: false, message: 'Connection timed out after 8s.' });
        });

        req.on('error', function (err) {
            resolve({ ok: false, message: 'Connection error: ' + err.message });
        });

        req.end();
    });
});

ipcMain.handle('session:start', function (_event, payload) {
    return startPolling((payload && payload.connection) || {});
});

ipcMain.handle('session:resume', function () {
    if (!lastConnectionConfig) {
        return { ok: false, message: 'No previous connection to resume.' };
    }
    return startPolling(lastConnectionConfig);
});

ipcMain.handle('session:stop', function () {
    stopPolling('Session stopped from UI.');
    return { ok: true };
});

app.whenReady().then(function () {
    createMainWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', function () {
    stopPolling('Application closed.');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
