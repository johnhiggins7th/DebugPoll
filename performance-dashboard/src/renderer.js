var versionNode = document.getElementById('app-version');

if (versionNode && window.performanceDashboard) {
    versionNode.textContent = window.performanceDashboard.appVersion;
}

var PROFILE_STORAGE_KEY = 'performance-dashboard.testProfile';
var LAST_SESSION_STORAGE_KEY = 'performance-dashboard.lastSessionSnapshot';
var CONNECTION_STORAGE_KEY = 'performance-dashboard.connectionSettings';
var CONNECTION_PRESETS_STORAGE_KEY = 'performance-dashboard.connectionPresets';
var CONNECTION_PRESET_SELECTED_KEY = 'performance-dashboard.connectionPresetSelected';
var profileFields = [
    'serverType',
    'gpuModel',
    'numberOfGPUs',
    'numberOfInstalledMediaDrives',
    'numberOfMovieDrivesUsed',
    'numberOfOutputs',
    'numberOfMovies',
    'numberOfLayers',
    'outputResolution',
    'mediaResolution',
    'framerate',
    'mediaBitDepth',
    'mediaSampling',
    'mediaFileType',
    'warpAndBlend',
    'freeCommentField'
];

function profileNode(field) {
    return document.getElementById('profile-' + field);
}

function statusNode() {
    return document.getElementById('profile-status');
}

function setStatus(text) {
    var node = statusNode();
    if (node) {
        node.textContent = text;
    }
}

function getDefaultProfile() {
    return {
        serverType: 'W',
        gpuModel: '',
        numberOfGPUs: '',
        numberOfInstalledMediaDrives: '',
        numberOfMovieDrivesUsed: '',
        numberOfOutputs: '4',
        numberOfMovies: '4',
        numberOfLayers: '1',
        outputResolution: '',
        mediaResolution: '',
        framerate: '60',
        mediaBitDepth: '10',
        mediaSampling: '422',
        mediaFileType: 'TGA',
        warpAndBlend: '',
        freeCommentField: ''
    };
}

function readProfileFromForm() {
    var data = {};
    profileFields.forEach(function (field) {
        var node = profileNode(field);
        data[field] = node ? String(node.value || '').trim() : '';
    });
    return data;
}

function writeProfileToForm(data) {
    profileFields.forEach(function (field) {
        var node = profileNode(field);
        if (node) {
            node.value = data[field] || '';
        }
    });
}

function loadStoredProfile() {
    var defaults = getDefaultProfile();
    try {
        var raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (!raw) {
            return defaults;
        }
        var parsed = JSON.parse(raw);
        return Object.assign({}, defaults, parsed || {});
    } catch (e) {
        return defaults;
    }
}

function saveProfile(data) {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data));
}

function applyFieldDefaults(sourceField) {
    var outputs = profileNode('numberOfOutputs');
    var movies = profileNode('numberOfMovies');
    var outputResolution = profileNode('outputResolution');
    var mediaResolution = profileNode('mediaResolution');

    if (sourceField === 'numberOfOutputs' && outputs && movies && !movies.value.trim()) {
        movies.value = outputs.value;
    }

    if (sourceField === 'outputResolution' && outputResolution && mediaResolution && !mediaResolution.value.trim()) {
        mediaResolution.value = outputResolution.value;
    }
}

function initializeProfileForm() {
    var saveBtn = document.getElementById('profile-save');
    var resetBtn = document.getElementById('profile-reset');
    var autoFetchBtn = document.getElementById('profile-autofetch');
    var outputs = profileNode('numberOfOutputs');
    var outputResolution = profileNode('outputResolution');

    if (!saveBtn || !resetBtn) {
        return;
    }

    var initial = loadStoredProfile();
    writeProfileToForm(initial);
    setStatus('Loaded saved profile.');

    if (outputs) {
        outputs.addEventListener('change', function () {
            applyFieldDefaults('numberOfOutputs');
        });
    }

    if (outputResolution) {
        outputResolution.addEventListener('blur', function () {
            applyFieldDefaults('outputResolution');
        });
    }

    saveBtn.addEventListener('click', function () {
        var data = readProfileFromForm();
        saveProfile(data);
        setStatus('Test profile saved locally.');
    });

    resetBtn.addEventListener('click', function () {
        var defaults = getDefaultProfile();
        writeProfileToForm(defaults);
        saveProfile(defaults);
        setStatus('Test profile reset to defaults.');
    });

    if (autoFetchBtn) {
        autoFetchBtn.addEventListener('click', async function () {
        if (!window.performanceDashboard || typeof window.performanceDashboard.fetchServerInfo !== 'function') {
            setStatus('Auto-fetch unavailable: backend bridge is not ready.');
            return;
        }
        autoFetchBtn.disabled = true;
        setStatus('Fetching from server...');
        var connection = getConnectionSettings();
        var result = await window.performanceDashboard.fetchServerInfo(connection);
            autoFetchBtn.disabled = false;
            if (!result || !result.ok) {
                setStatus('Auto-fetch failed: ' + ((result && result.message) || 'Could not reach server.'));
                return;
            }
            var derived = result.derived || {};
            var fieldsSet = [];
            profileFields.forEach(function (field) {
                if (derived[field] !== undefined && derived[field] !== '') {
                    var node = profileNode(field);
                    if (node) {
                        node.value = derived[field];
                        fieldsSet.push(field);
                    }
                }
            });
            // Apply cross-field defaults for derived values
            if (derived.outputResolution) { applyFieldDefaults('outputResolution'); }
            if (derived.numberOfOutputs)  { applyFieldDefaults('numberOfOutputs'); }
            if (fieldsSet.length > 0) {
                setStatus('Auto-fetched: ' + fieldsSet.join(', ') + '. Review and save.');
            } else {
                setStatus('Connected but no fields could be derived. Enter manually.');
            }
        });
    }
}

function nodeById(id) {
    return document.getElementById(id);
}

function setSessionState(text) {
    var node = nodeById('session-state');
    if (node) {
        node.textContent = text;
    }
}

function setSessionStatus(text) {
    var node = nodeById('session-status');
    if (node) {
        node.textContent = text;
    }
}

function setSessionPayload(value) {
    var node = nodeById('session-payload');
    if (node) {
        node.textContent = value;
    }
}

function setMetric(id, value) {
    var node = nodeById(id);
    if (node) {
        node.textContent = String(value == null ? '' : value);
    }
}

function parseMsNumber(value) {
    var n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
}

var performanceChart = {
    canvas: null,
    wrap: null,
    scaleNode: null,
    frTmSeries: [],
    grnSeries: [],
    audioSeries: [],
    fps: 60,
    mode: 'live30s',
    windowMs: 30000,
    retentionMs: 45000,
    maxHistoryMs: 8 * 60 * 60 * 1000,
    sessionStartMs: 0,
    pendingDraw: false,
    pendingDrawTimer: null,
    lastDrawAt: 0,
    minDrawIntervalMs: 120,
    lastScaleText: '',
    renderWidth: 0,
    renderHeight: 0,
    renderDpr: 0
};

function schedulePerformanceChartDraw() {
    if (performanceChart.pendingDraw) {
        return;
    }

    var now = (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();
    var waitMs = Math.max(0, performanceChart.minDrawIntervalMs - (now - performanceChart.lastDrawAt));

    performanceChart.pendingDraw = true;
    if (waitMs > 0) {
        performanceChart.pendingDrawTimer = window.setTimeout(function () {
            performanceChart.pendingDrawTimer = null;
            window.requestAnimationFrame(function () {
                performanceChart.pendingDraw = false;
                performanceChart.lastDrawAt = (window.performance && typeof window.performance.now === 'function')
                    ? window.performance.now()
                    : Date.now();
                drawPerformanceChart();
            });
        }, waitMs);
        return;
    }

    window.requestAnimationFrame(function () {
        performanceChart.pendingDraw = false;
        performanceChart.lastDrawAt = (window.performance && typeof window.performance.now === 'function')
            ? window.performance.now()
            : Date.now();
        drawPerformanceChart();
    });
}

function setPerformanceChartMode(mode) {
    var requested = String(mode || '').trim();
    if (requested !== 'live30s' && requested !== 'fullSession') {
        return;
    }
    performanceChart.mode = requested;
    schedulePerformanceChartDraw();
}

function getPerformanceChartWindowMs(nowMs) {
    if (performanceChart.mode === 'fullSession') {
        if (!performanceChart.sessionStartMs) {
            return performanceChart.windowMs;
        }
        return Math.max(performanceChart.windowMs, nowMs - performanceChart.sessionStartMs);
    }
    return performanceChart.windowMs;
}

function getLiveFps() {
    var value = parseFloat(performanceChart.fps);
    if (!Number.isFinite(value) || value <= 0) {
        value = 60;
    }
    return value;
}

function getChartMaxMs() {
    var framerate = getLiveFps();
    // Allow headroom for momentary double-frame events without changing panel size.
    return 2 * ((1000 / framerate) * 1.1);
}

function drawPerformanceChart() {
    var canvas = performanceChart.canvas;
    var wrap = performanceChart.wrap;
    if (!canvas || !wrap) {
        return;
    }

    var width = Math.max(300, Math.floor(wrap.clientWidth - 20));
    var height = Math.max(140, Math.floor(wrap.clientHeight - 20));
    var dpr = window.devicePixelRatio || 1;

    var nextPixelWidth = Math.floor(width * dpr);
    var nextPixelHeight = Math.floor(height * dpr);
    var sizeChanged =
        nextPixelWidth !== performanceChart.renderWidth ||
        nextPixelHeight !== performanceChart.renderHeight ||
        dpr !== performanceChart.renderDpr;

    if (sizeChanged) {
        canvas.width = nextPixelWidth;
        canvas.height = nextPixelHeight;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        performanceChart.renderWidth = nextPixelWidth;
        performanceChart.renderHeight = nextPixelHeight;
        performanceChart.renderDpr = dpr;
    }

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var maxMs = getChartMaxMs();
    if (performanceChart.scaleNode) {
        var modeLabel = performanceChart.mode === 'fullSession' ? 'full' : '30s';
        var scaleText = 'FPS: ' + getLiveFps().toFixed(2) + ' (' + modeLabel + ')';
        if (scaleText !== performanceChart.lastScaleText) {
            performanceChart.scaleNode.textContent = scaleText;
            performanceChart.lastScaleText = scaleText;
        }
    }

    var pad = { left: 8, top: 8, right: 8, bottom: 8 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    function getSeriesLastTime(series) {
        if (!series.length) {
            return 0;
        }
        return series[series.length - 1].t || 0;
    }

    var latestPointTime = Math.max(
        getSeriesLastTime(performanceChart.frTmSeries),
        getSeriesLastTime(performanceChart.grnSeries),
        getSeriesLastTime(performanceChart.audioSeries)
    );
    if (!latestPointTime) {
        latestPointTime = Date.now();
    }
    var chartWindowMs = getPerformanceChartWindowMs(latestPointTime);
    var endTime = latestPointTime;
    var startTime = endTime - chartWindowMs;

    ctx.strokeStyle = 'rgba(173, 206, 214, 0.18)';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 8; i++) {
        var y = pad.top + (plotH * i) / 8;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
    }

    for (var gx = 0; gx <= 24; gx++) {
        var x = pad.left + (plotW * gx) / 24;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, height - pad.bottom);
        ctx.stroke();
    }

    function drawSeries(series, strokeStyle) {
        if (!series.length) {
            return null;
        }

        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        var startIndex = -1;
        for (var s = 0; s < series.length; s++) {
            if (series[s].t >= startTime) {
                startIndex = s;
                break;
            }
        }

        var visible = [];
        if (startIndex === -1) {
            // No sample is inside the current window, so keep the last sample as a flat line anchor.
            var tail = series[series.length - 1];
            visible.push({ t: startTime, v: tail.v });
            visible.push({ t: endTime, v: tail.v });
        } else {
            var firstInWindow = series[startIndex];
            if (startIndex > 0) {
                // Interpolate a value at the exact left edge to remove interval-sized gap.
                var prev = series[startIndex - 1];
                var dt = firstInWindow.t - prev.t;
                var edgeValue = firstInWindow.v;
                if (dt > 0) {
                    var ratio = (startTime - prev.t) / dt;
                    edgeValue = prev.v + (firstInWindow.v - prev.v) * ratio;
                }
                visible.push({ t: startTime, v: edgeValue });
            } else if (firstInWindow.t > startTime) {
                visible.push({ t: startTime, v: firstInWindow.v });
            }

            for (var vi = startIndex; vi < series.length; vi++) {
                visible.push(series[vi]);
            }
        }

        if (!visible.length) {
            return null;
        }

        visible.forEach(function (point, index) {
            var x = pad.left + ((point.t - startTime) / chartWindowMs) * plotW;
            var clamped = Math.max(0, Math.min(maxMs, point.v));
            var y = pad.top + (1 - clamped / maxMs) * plotH;
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
        return visible[visible.length - 1];
    }

    function drawCurrentValueLabel(point, color, yOffset) {
        if (!point) {
            return;
        }
        var x = pad.left + ((point.t - startTime) / chartWindowMs) * plotW;
        var clamped = Math.max(0, Math.min(maxMs, point.v));
        var y = pad.top + (1 - clamped / maxMs) * plotH;

        var label = point.v.toFixed(3);
        ctx.fillStyle = color;
        ctx.font = '11px Sansation, Segoe UI, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, Math.min(width - 4, x + 44), Math.max(12, y + yOffset));
    }

    var frLast = drawSeries(performanceChart.frTmSeries, '#f3d24f');
    var grLast = drawSeries(performanceChart.grnSeries, '#5ecf82');
    var audioLast = drawSeries(performanceChart.audioSeries, '#4fb2f7');
    drawCurrentValueLabel(frLast, '#f3d24f', -4);
    drawCurrentValueLabel(grLast, '#5ecf82', -8);
    drawCurrentValueLabel(audioLast, '#4fb2f7', -12);
}

function pushPerformancePoint(frTmMs, grnLineMs, audioTrackingMs) {
    var fr = parseMsNumber(frTmMs);
    var gr = parseMsNumber(grnLineMs);
    var audio = parseMsNumber(audioTrackingMs);
    if (fr == null || gr == null) {
        return;
    }
    if (audio == null) {
        audio = 0;
    }

    var now = Date.now();
    if (!performanceChart.sessionStartMs) {
        performanceChart.sessionStartMs = now;
    }
    performanceChart.frTmSeries.push({ t: now, v: fr });
    performanceChart.grnSeries.push({ t: now, v: gr });
    performanceChart.audioSeries.push({ t: now, v: audio });

    var cutoff = now - Math.max(performanceChart.retentionMs, performanceChart.maxHistoryMs);
    performanceChart.frTmSeries = performanceChart.frTmSeries.filter(function (point) {
        return point.t >= cutoff;
    });
    performanceChart.grnSeries = performanceChart.grnSeries.filter(function (point) {
        return point.t >= cutoff;
    });
    performanceChart.audioSeries = performanceChart.audioSeries.filter(function (point) {
        return point.t >= cutoff;
    });

    schedulePerformanceChartDraw();
}

function initializePerformanceChart() {
    performanceChart.canvas = nodeById('performance-chart');
    performanceChart.wrap = nodeById('performance-chart-wrap');
    performanceChart.scaleNode = nodeById('performance-scale-label');
    if (!performanceChart.canvas || !performanceChart.wrap) {
        return;
    }

    // Hidden scaffold for future paused review mode controls (no visible UI yet).
    window.__performanceDashboardSetChartMode = setPerformanceChartMode;
    window.__performanceDashboardGetChartMode = function () {
        return performanceChart.mode;
    };

    window.addEventListener('resize', schedulePerformanceChartDraw);
    schedulePerformanceChartDraw();
}

function updateServerStatusFastFields(update) {
    if (!update) {
        return;
    }

    var smpteNode = nodeById('ss-smpte');
    if (smpteNode && update.duration) {
        // Show full HH:MM:SS:FF if poll provides it; otherwise keep frame placeholder.
        var raw = String(update.duration).trim();
        smpteNode.textContent = /^\d{2}:\d{2}:\d{2}:\d+$/.test(raw) ? raw : (/^\d{2}:\d{2}:\d{2}$/.test(raw) ? raw + ':--' : '--:--:--:--');
    }

    var playStateNode = nodeById('ss-play-state');
    if (playStateNode && update.mode) {
        var playState = String(update.mode);
        var colour = playState === 'Playing' ? 'green' : playState === 'Stopped' ? 'slate' : 'amber';
        playStateNode.innerHTML = ssBadge(playState, colour);
    }

    var fpsNode = nodeById('ss-fps');
    if (fpsNode && update.fps != null) {
        fpsNode.textContent = String(update.fps);
    }

    var frameNode = nodeById('ss-current-frame');
    if (frameNode && update.frames != null) {
        var frameNum = parseInt(String(update.frames), 10);
        frameNode.textContent = Number.isFinite(frameNum) ? frameNum.toLocaleString() : String(update.frames);
    }

    var dropNode = nodeById('ss-frames-dropped');
    if (dropNode && update.frmDropped != null) {
        var dropped = parseInt(String(update.frmDropped), 10);
        dropNode.textContent = Number.isFinite(dropped) ? String(dropped) : String(update.frmDropped);
        dropNode.className = 'ss-val' + (Number.isFinite(dropped) && dropped > 0 ? ' warn' : '');
    }

    var movieDropNode = nodeById('ss-movie-frames-dropped');
    if (movieDropNode && update.movieFrmDropped != null) {
        var movieDropped = parseInt(String(update.movieFrmDropped), 10);
        movieDropNode.textContent = Number.isFinite(movieDropped) ? String(movieDropped) : String(update.movieFrmDropped);
        movieDropNode.className = 'ss-val' + (Number.isFinite(movieDropped) && movieDropped > 100 ? ' crit' : Number.isFinite(movieDropped) && movieDropped > 0 ? ' warn' : '');
    }

    var frTmNode = nodeById('ss-frame-time');
    if (frTmNode && update.frTmMs != null) {
        frTmNode.textContent = Number(update.frTmMs).toFixed(3) + ' ms';
    }

    var frTmAvgNode = nodeById('ss-frame-time-avg');
    if (frTmAvgNode && update.mstAvFrmTm != null) {
        frTmAvgNode.textContent = Number(update.mstAvFrmTm).toFixed(3) + ' ms';
    }
}

function updateLiveMetrics(update) {
    if (!update) {
        return;
    }

    setMetric('metric-mode', update.mode || 'Stopped');
    setMetric('metric-frames', update.frames || '0');
    setMetric('metric-frmDropped', update.frmDropped || '0');
    setMetric('metric-duration', update.duration || '00:00:00');
    setMetric('metric-movieFrmDropped', update.movieFrmDropped || '0');
    setMetric('metric-frTm', update.frTmMs || '0.00');
    setMetric('metric-grnLine', update.grnLineMs || '0.00');
    setMetric('metric-mstAvFrmTm', update.mstAvFrmTm || '0.00');
    setMetric('metric-audioTracking', update.audioTracking || '0.00');

    var liveFps = parseFloat(update.fps);
    if (Number.isFinite(liveFps) && liveFps > 0 && liveFps !== performanceChart.fps) {
        performanceChart.fps = liveFps;
        schedulePerformanceChartDraw();
    }

    pushPerformancePoint(update.frTmMs, update.grnLineMs, update.audioTracking);

    // Keep key server-status fields in lock-step with fast poll updates.
    updateServerStatusFastFields(update);

    if (update.statusMessage) {
        setSessionStatus(update.statusMessage);
    }

    if (update.connected === true) {
        setSessionState('Connected');
    } else if (update.connected === false && String(update.statusMessage || '').toLowerCase().indexOf('closed') >= 0) {
        setSessionState('Disconnected');
    }
}

function getConnectionSettings() {
    var ipNode = nodeById('connection-ip');
    var portNode = nodeById('connection-port');
    var intervalNode = nodeById('connection-interval');

    var interval = parseInt(intervalNode ? intervalNode.value : '2', 10);
    if (!interval || interval < 1) {
        interval = 2;
    }

    return {
        ip: ipNode ? String(ipNode.value || '').trim() : '',
        port: portNode ? String(portNode.value || '').trim() : '',
        logInterval: interval
    };
}

function getDefaultConnectionSettings() {
    return {
        ip: '100.94.47.25',
        port: '23',
        logInterval: 2
    };
}

function writeConnectionSettingsToForm(settings) {
    var ipNode = nodeById('connection-ip');
    var portNode = nodeById('connection-port');
    var intervalNode = nodeById('connection-interval');

    if (ipNode) {
        ipNode.value = settings.ip || '';
    }

    if (portNode) {
        portNode.value = settings.port || '';
    }

    if (intervalNode) {
        intervalNode.value = String(settings.logInterval || 2);
    }
}

function loadConnectionSettings() {
    var defaults = getDefaultConnectionSettings();
    try {
        var raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
        if (!raw) {
            return defaults;
        }
        var parsed = JSON.parse(raw);
        return Object.assign({}, defaults, parsed || {});
    } catch (e) {
        return defaults;
    }
}

function saveConnectionSettings() {
    var settings = getConnectionSettings();
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(settings));
    return settings;
}

function getDefaultConnectionPresets() {
    return [
        { name: 'Default', ip: '100.94.47.25', port: '23', logInterval: 2 },
        { name: 'Stage A', ip: '10.100.106.125', port: '23', logInterval: 2 },
        { name: 'Lab', ip: '127.0.0.1', port: '23', logInterval: 2 }
    ];
}

function loadConnectionPresets() {
    try {
        var raw = localStorage.getItem(CONNECTION_PRESETS_STORAGE_KEY);
        if (!raw) {
            return getDefaultConnectionPresets();
        }
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return getDefaultConnectionPresets();
        }
        return parsed;
    } catch (e) {
        return getDefaultConnectionPresets();
    }
}

function saveConnectionPresets(presets) {
    localStorage.setItem(CONNECTION_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function getSelectedPresetName() {
    return localStorage.getItem(CONNECTION_PRESET_SELECTED_KEY) || 'Default';
}

function setSelectedPresetName(name) {
    localStorage.setItem(CONNECTION_PRESET_SELECTED_KEY, String(name || 'Default'));
}

function fillConnectionPresetSelect(presets, selectedName) {
    var select = nodeById('connection-preset');
    if (!select) {
        return;
    }

    select.innerHTML = '';
    presets.forEach(function (preset) {
        var option = document.createElement('option');
        option.value = preset.name;
        option.textContent = preset.name;
        if (preset.name === selectedName) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function findPresetByName(presets, name) {
    var found = null;
    presets.forEach(function (preset) {
        if (!found && preset.name === name) {
            found = preset;
        }
    });
    return found;
}

function upsertPreset(presets, preset) {
    var replaced = false;
    var next = presets.map(function (entry) {
        if (entry.name === preset.name) {
            replaced = true;
            return preset;
        }
        return entry;
    });

    if (!replaced) {
        next.push(preset);
    }

    return next;
}

function removePresetByName(presets, name) {
    return presets.filter(function (preset) {
        return preset.name !== name;
    });
}

function formatSessionId(date) {
    function pad2(value) {
        return String(value).padStart(2, '0');
    }
    return 'sess-' +
        date.getFullYear() +
        pad2(date.getMonth() + 1) +
        pad2(date.getDate()) + '-' +
        pad2(date.getHours()) +
        pad2(date.getMinutes()) +
        pad2(date.getSeconds());
}

function buildSessionSnapshot() {
    var profile = readProfileFromForm();
    var now = new Date();
    return {
        sessionId: formatSessionId(now),
        startedAtIso: now.toISOString(),
        connection: getConnectionSettings(),
        resultMode: 'pending',
        testProfile: profile
    };
}

function initializeSessionControls() {
    var connectBtn = nodeById('connect-btn');
    var resumeBtn = nodeById('resume-btn');
    var saveConnectionBtn = nodeById('save-connection-btn');
    var savePresetBtn = nodeById('save-preset-btn');
    var deletePresetBtn = nodeById('delete-preset-btn');
    var presetSelect = nodeById('connection-preset');
    var presetNameInput = nodeById('connection-preset-name');
    var stopBtn = nodeById('stop-btn');

    if (!connectBtn || !resumeBtn || !stopBtn || !saveConnectionBtn || !savePresetBtn || !deletePresetBtn || !presetSelect || !presetNameInput) {
        return;
    }

    var presets = loadConnectionPresets();
    var selectedPresetName = getSelectedPresetName();
    fillConnectionPresetSelect(presets, selectedPresetName);

    var selectedPreset = findPresetByName(presets, selectedPresetName) || presets[0];
    if (selectedPreset) {
        writeConnectionSettingsToForm(selectedPreset);
        setSelectedPresetName(selectedPreset.name);
        presetNameInput.value = selectedPreset.name;
    } else {
        writeConnectionSettingsToForm(loadConnectionSettings());
    }

    if (window.performanceDashboard && typeof window.performanceDashboard.onSessionUpdate === 'function') {
        window.performanceDashboard.onSessionUpdate(function (payload) {
            updateLiveMetrics(payload);
        });
    }

    if (window.performanceDashboard && typeof window.performanceDashboard.onFullStatusUpdate === 'function') {
        window.performanceDashboard.onFullStatusUpdate(function (fj) {
            updateServerStatus(fj);
        });
    }

    connectBtn.addEventListener('click', async function () {
        // Persist the latest profile values before creating a session snapshot.
        var profile = readProfileFromForm();
        saveProfile(profile);
        saveConnectionSettings();

        var snapshot = buildSessionSnapshot();
        localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
        setSessionPayload(JSON.stringify(snapshot, null, 2));

        if (!window.performanceDashboard || typeof window.performanceDashboard.startSession !== 'function') {
            setSessionStatus('Session snapshot captured, but backend bridge is unavailable.');
            return;
        }

        var result = await window.performanceDashboard.startSession(snapshot);
        if (result && result.ok) {
            setSessionState('Connecting');
            setSessionStatus('Session snapshot captured. Connecting to target...');
        } else {
            setSessionState('Error');
            setSessionStatus('Could not start session: ' + ((result && result.message) || 'Unknown error'));
        }
    });

    resumeBtn.addEventListener('click', async function () {
        saveConnectionSettings();

        if (!window.performanceDashboard || typeof window.performanceDashboard.resumeSession !== 'function') {
            setSessionStatus('Resume unavailable: backend bridge is not ready.');
            return;
        }

        var result = await window.performanceDashboard.resumeSession();
        if (result && result.ok) {
            setSessionState('Connecting');
            setSessionStatus('Resume requested. Reconnecting...');
        } else {
            setSessionState('Error');
            setSessionStatus('Resume failed: ' + ((result && result.message) || 'Unknown error'));
        }
    });

    stopBtn.addEventListener('click', async function () {
        if (window.performanceDashboard && typeof window.performanceDashboard.stopSession === 'function') {
            await window.performanceDashboard.stopSession();
        }
        setSessionState('Stopped');
        setSessionStatus('Session stopped from UI.');
    });

    saveConnectionBtn.addEventListener('click', function () {
        var settings = saveConnectionSettings();
        setSessionStatus('Connection settings saved (' + settings.ip + ':' + settings.port + ', ' + settings.logInterval + 's).');
    });

    presetSelect.addEventListener('change', function () {
        var selected = presetSelect.value;
        var latestPresets = loadConnectionPresets();
        var preset = findPresetByName(latestPresets, selected);
        if (!preset) {
            return;
        }
        presetNameInput.value = selected;
        writeConnectionSettingsToForm(preset);
        saveConnectionSettings();
        setSelectedPresetName(selected);
        setSessionStatus('Preset loaded: ' + selected + '.');
    });

    savePresetBtn.addEventListener('click', function () {
        var name = String(presetNameInput.value || '').trim();
        if (!name) {
            setSessionStatus('Enter a preset name before saving.');
            return;
        }

        var current = getConnectionSettings();
        var preset = {
            name: name,
            ip: current.ip,
            port: current.port,
            logInterval: current.logInterval
        };

        var latest = loadConnectionPresets();
        var merged = upsertPreset(latest, preset);
        saveConnectionPresets(merged);
        fillConnectionPresetSelect(merged, name);
        setSelectedPresetName(name);
        presetNameInput.value = name;
        setSessionStatus('Preset saved: ' + name + '.');
    });

    deletePresetBtn.addEventListener('click', function () {
        var selected = String(presetSelect.value || '').trim();
        if (!selected) {
            setSessionStatus('No preset selected to delete.');
            return;
        }

        if (selected === 'Default') {
            setSessionStatus('Default preset cannot be deleted.');
            return;
        }

        var confirmed = window.confirm('Delete preset "' + selected + '"?');
        if (!confirmed) {
            setSessionStatus('Delete cancelled.');
            return;
        }

        var latest = loadConnectionPresets();
        var remaining = removePresetByName(latest, selected);
        if (remaining.length === latest.length) {
            setSessionStatus('Preset not found: ' + selected + '.');
            return;
        }

        saveConnectionPresets(remaining);

        var nextSelected = findPresetByName(remaining, 'Default') || remaining[0];
        if (nextSelected) {
            fillConnectionPresetSelect(remaining, nextSelected.name);
            writeConnectionSettingsToForm(nextSelected);
            saveConnectionSettings();
            setSelectedPresetName(nextSelected.name);
            presetNameInput.value = nextSelected.name;
            setSessionStatus('Deleted preset: ' + selected + '. Loaded ' + nextSelected.name + '.');
            return;
        }

        fillConnectionPresetSelect(getDefaultConnectionPresets(), 'Default');
        writeConnectionSettingsToForm(getDefaultConnectionSettings());
        saveConnectionSettings();
        setSelectedPresetName('Default');
        presetNameInput.value = 'Default';
        setSessionStatus('Deleted preset: ' + selected + '. Restored default settings.');
    });

    try {
        var raw = localStorage.getItem(LAST_SESSION_STORAGE_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            setSessionPayload(JSON.stringify(parsed, null, 2));
            setSessionStatus('Last session snapshot restored.');
        }
    } catch (e) {
        setSessionPayload('Could not read last session snapshot.');
    }
}

initializeProfileForm();
initializeSessionControls();
initializePerformanceChart();
initializeTabs();
initializeRegistryDiffTab();

function initializeTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabPanes = document.querySelectorAll('.tab-pane');
    tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var target = btn.getAttribute('data-tab');
            tabBtns.forEach(function (b) { b.classList.remove('active'); });
            tabPanes.forEach(function (p) { p.classList.remove('active'); });
            btn.classList.add('active');
            var pane = document.getElementById('tab-' + target);
            if (pane) { pane.classList.add('active'); }
            if (target === 'session') { schedulePerformanceChartDraw(); }
        });
    });
}

function ssBadge(text, type) {
    return '<span class="ss-badge ss-badge-' + (type || '') + '">' + text + '</span>';
}

function updateServerStatus(fs) {
    if (!fs) { return; }

    function setss(id, val) {
        var n = nodeById(id);
        if (n) { n.textContent = String(val == null ? '—' : val); }
    }
    function setssHTML(id, html) {
        var n = nodeById(id);
        if (n) { n.innerHTML = html; }
    }

    // Header
    setss('ss-server-name', '// ' + (fs.ServerName || '—'));
    setss('ss-version-badge', 'DELTA v' + (fs.DeltaVersion || '—'));
    setss('ss-arch-badge', fs.Arch || '—');
    setss('ss-group-badge', 'GROUP ' + (fs.Group != null ? fs.Group : '—'));
    var masterBadge = nodeById('ss-master-badge');
    if (masterBadge) { masterBadge.style.display = fs.Master ? '' : 'none'; }
    setss('ss-graphic-settings', fs.GraphicSettings || '—');
    setss('ss-scaling-mode', (fs.ScalingMode && fs.ScalingMode.mode) ? fs.ScalingMode.mode + ' Scaling' : '—');
    setss('ss-last-updated', 'Updated ' + new Date().toLocaleTimeString());

    // System
    setssHTML('ss-fullscreen', ssBadge(fs.Fullscreen ? 'Yes' : 'No', fs.Fullscreen ? 'green' : 'red'));
    setss('ss-fps', fs.FPS != null ? fs.FPS : '—');
    setss('ss-scaling', (fs.ScalingMode && fs.ScalingMode.mode) || '—');
    setssHTML('ss-licence', ssBadge(fs.LicenseStatus || '—', 'amber'));

    // Performance
    var dbg = fs.Debug || {};
    setss('ss-frame-time', dbg.frameTime != null ? dbg.frameTime.toFixed(3) + ' ms' : '—');
    setss('ss-frame-time-avg', dbg.masterAverageFrameTime != null ? dbg.masterAverageFrameTime.toFixed(3) + ' ms' : '—');
    setss('ss-timing-mode', dbg.timingMode || '—');
    var dropNode = nodeById('ss-frames-dropped');
    if (dropNode) {
        dropNode.textContent = dbg.framesDropped != null ? dbg.framesDropped : '—';
        dropNode.className = 'ss-val' + (dbg.framesDropped > 0 ? ' warn' : '');
    }
    var movieDropNode = nodeById('ss-movie-frames-dropped');
    if (movieDropNode) {
        movieDropNode.textContent = dbg.movieFramesDropped != null ? dbg.movieFramesDropped : '—';
        movieDropNode.className = 'ss-val' + (dbg.movieFramesDropped > 100 ? ' crit' : dbg.movieFramesDropped > 0 ? ' warn' : '');
    }
    setssHTML('ss-debug-mode', ssBadge(dbg.debugIt ? 'On' : 'Off', dbg.debugIt ? 'amber' : 'slate'));

    // Timeline — prefer the Playing timeline; fall back to first entry.
    var tlArr = (fs.TimelineInformation && fs.TimelineInformation.Timelines) || [];
    var tls = tlArr.filter(function (t) { return String(t.PlayState || '').toLowerCase() === 'playing'; })[0] || tlArr[0] || {};
    var smpteRaw = String(tls.SMPTE || '').trim().replace(/::/, ':').replace(/\s/g, '');
    // Only display if it looks like a timecode — discard "OFF" / multi-slot garbage.
    setss('ss-smpte', /^\d{2}:\d{2}:\d{2}/.test(smpteRaw) ? smpteRaw : '--:--:--:--');
    var playState = tls.PlayState || '—';
    setssHTML('ss-play-state', ssBadge(playState, playState === 'Playing' ? 'green' : playState === 'Stopped' ? 'slate' : 'amber'));
    setss('ss-current-frame', tls.CurrentFrame != null ? tls.CurrentFrame.toLocaleString() : '—');
    setssHTML('ss-tl-enabled', ssBadge(tls.Enabled ? 'Yes' : 'No', tls.Enabled ? 'green' : 'red'));

    // Audio
    var audio = fs.AudioConfig || {};
    setss('ss-audio-device', audio.deviceType ? audio.deviceType.toUpperCase() : '—');
    setss('ss-audio-channels', audio.forcedChannels === 0 ? '0 (auto)' : String(audio.forcedChannels != null ? audio.forcedChannels : '—'));
    setss('ss-audio-level', (fs.AudioLevel != null ? fs.AudioLevel : '—') + '%');

    // Video & SDI
    var sdi = fs.SDI || {};
    setss('ss-video-level', (fs.VideoLevel != null ? fs.VideoLevel : '—') + '%');
    setssHTML('ss-sdi-enabled', ssBadge(sdi.enabled ? 'Yes' : 'No', sdi.enabled ? 'green' : 'red'));
    setss('ss-sdi-bitdepth', sdi.bitDepth != null ? sdi.bitDepth + '-bit' : '—');
    setss('ss-sdi-mode', sdi.mode || '—');

    // LED Status
    var led = fs.LEDStatus || {};
    function setLed(dotId, valId, val) {
        var isOn = val > 0;
        var dot = nodeById(dotId);
        var valNode = nodeById(valId);
        if (dot) { dot.classList.toggle('on', isOn); }
        if (valNode) {
            valNode.textContent = val != null ? Number(val).toFixed(2) : '—';
            valNode.className = 'ss-led-val' + (isOn ? ' active' : '');
        }
    }
    setLed('ss-led-audio-dot', 'ss-led-audio-val', led.audio);
    setLed('ss-led-movies-dot', 'ss-led-movies-val', led.movies);
    setLed('ss-led-video-dot', 'ss-led-video-val', led.video);

    // Channel Configuration
    var cc = fs.ChannelConfig || {};
    var channels = Array.isArray(cc.channels) ? cc.channels : [];
    var enabledChs = channels.filter(function (ch) { return ch.enabled; });
    setss('ss-canvas-size', (cc.canvasWidth || '—') + ' × ' + (cc.canvasHeight || '—'));
    setss('ss-channels-active', enabledChs.length + ' / ' + channels.length);
    if (enabledChs.length > 0) {
        var firstCh = enabledChs[0];
        var chW = firstCh.right - firstCh.left;
        var chH = firstCh.bottom - firstCh.top;
        setss('ss-per-channel', chW + ' × ' + chH);
        var cols = cc.canvasWidth && chW ? Math.round(cc.canvasWidth / chW) : '—';
        var rows = cc.canvasHeight && chH ? Math.round(cc.canvasHeight / chH) : '—';
        setss('ss-ch-layout', cols + ' × ' + rows);
        var rots = channels.map(function (c) { return c.rotate; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        setss('ss-rotation', rots.length === 1 ? rots[0] + '°' : 'Mixed');
    }
    var subtitle = nodeById('ss-channel-config-subtitle');
    if (subtitle) {
        subtitle.textContent = [cc.displayModeName, cc.enabledChannels ? cc.enabledChannels + ' Channels Active' : ''].filter(Boolean).join(' · ');
    }
    var gridEl = nodeById('ss-channel-grid');
    if (gridEl && channels.length > 0) {
        gridEl.innerHTML = channels.map(function (ch) {
            return '<div class="ss-ch-cell">' +
                '<div class="ss-ch-cell-name">' + (ch.name || 'Chan ' + ch.channelIndex) + '</div>' +
                '<div class="ss-ch-cell-coords">' +
                '<span class="axis">X</span> ' + ch.left + ' – ' + ch.right +
                ' &nbsp; <span class="axis">Y</span> ' + ch.top + ' – ' + ch.bottom +
                '</div></div>';
        }).join('');
    }
}

// ── Registry Diff ──────────────────────────────────────────────────────────

function escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function flattenRegistry(obj, path) {
    var out = {};
    var keys = Object.keys(obj || {});
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var node = obj[key];
        var p = path ? (path + '\\' + key) : key;
        if (node && node.values) {
            var vKeys = Object.keys(node.values);
            for (var v = 0; v < vKeys.length; v++) {
                var vn = vKeys[v];
                var vdata = node.values[vn];
                out[p + '\\' + vn] = String(vdata && vdata.data != null ? vdata.data : '');
            }
        }
        if (node && node.subkeys) {
            var sub = flattenRegistry(node.subkeys, p);
            var subKeys = Object.keys(sub);
            for (var s = 0; s < subKeys.length; s++) {
                out[subKeys[s]] = sub[subKeys[s]];
            }
        }
    }
    return out;
}

function computeRegistryDiff(live, baseline) {
    var fl = flattenRegistry(live, '');
    var fb = flattenRegistry(baseline, '');
    var combined = {};
    Object.keys(fl).forEach(function (k) { combined[k] = true; });
    Object.keys(fb).forEach(function (k) { combined[k] = true; });
    var allKeys = Object.keys(combined).sort();
    var diffs = [];
    for (var i = 0; i < allKeys.length; i++) {
        var k = allKeys[i];
        var lv = fl.hasOwnProperty(k) ? fl[k] : null;
        var bv = fb.hasOwnProperty(k) ? fb[k] : null;
        if (lv !== bv) {
            diffs.push({
                change: bv === null ? 'ADDED' : lv === null ? 'REMOVED' : 'MODIFIED',
                key: k,
                baseline: bv,
                live: lv
            });
        }
    }
    return diffs;
}

function renderRegistryDiff(diffs) {
    var listNode = nodeById('rd-diff-list');
    var summaryPanel = nodeById('rd-summary-panel');
    if (!listNode) { return; }

    var modified = diffs.filter(function (d) { return d.change === 'MODIFIED'; });
    var added    = diffs.filter(function (d) { return d.change === 'ADDED'; });
    var removed  = diffs.filter(function (d) { return d.change === 'REMOVED'; });

    var modN = nodeById('rd-count-modified');
    var addN = nodeById('rd-count-added');
    var remN = nodeById('rd-count-removed');
    var totN = nodeById('rd-count-total');
    var subtN = nodeById('rd-results-subtitle');

    if (modN) { modN.textContent = String(modified.length); }
    if (addN) { addN.textContent = String(added.length); }
    if (remN) { remN.textContent = String(removed.length); }
    if (totN) { totN.textContent = String(diffs.length); }
    if (subtN) { subtN.textContent = diffs.length + ' difference' + (diffs.length !== 1 ? 's' : ''); }
    if (summaryPanel) { summaryPanel.style.display = ''; }

    if (diffs.length === 0) {
        listNode.innerHTML = '<div class="ss-no-data">No differences found — SUT matches the W Series default baseline.</div>';
        return;
    }

    var ordered = modified.concat(added).concat(removed);
    var html = '';
    for (var i = 0; i < ordered.length; i++) {
        var d = ordered[i];
        var badgeClass = d.change === 'ADDED' ? 'ss-badge-green' :
                         d.change === 'REMOVED' ? 'ss-badge-red' : 'ss-badge-amber';

        var valuesHtml;
        if (d.change === 'ADDED') {
            valuesHtml = '<span class="rd-live-val rd-added">' + escHtml(d.live) + '</span>';
        } else if (d.change === 'REMOVED') {
            valuesHtml =
                '<span class="rd-baseline-val">' + escHtml(d.baseline) + '</span>' +
                '<span class="rd-arrow">\u2192</span>' +
                '<span class="rd-live-val rd-removed">(not present)</span>';
        } else {
            valuesHtml =
                '<span class="rd-baseline-val">' + escHtml(d.baseline) + '</span>' +
                '<span class="rd-arrow">\u2192</span>' +
                '<span class="rd-live-val">' + escHtml(d.live) + '</span>';
        }

        html += '<div class="rd-diff-row">' +
            '<span class="ss-badge ' + badgeClass + '">' + d.change + '</span>' +
            '<span class="rd-key">' + escHtml(d.key) + '</span>' +
            '<div class="rd-values">' + valuesHtml + '</div>' +
            '</div>';
    }
    listNode.innerHTML = html;
}

function initializeRegistryDiffTab() {
    var refreshBtn = nodeById('rd-refresh-btn');
    var lastUpdatedNode = nodeById('rd-last-updated');
    var hostLabel = nodeById('rd-host-label');
    var hostBadge = nodeById('rd-host-badge');
    var ipNode = nodeById('rd-ip');
    var portNode = nodeById('rd-port');
    if (!refreshBtn) { return; }

    // Pre-populate IP from saved connection settings
    var connSettings = loadConnectionSettings();
    if (ipNode && !ipNode.value) {
        ipNode.value = connSettings.ip || '';
    }

    refreshBtn.addEventListener('click', async function () {
        var ip = ipNode ? String(ipNode.value || '').trim() : '';
        var port = portNode ? (parseInt(portNode.value, 10) || 4477) : 4477;

        if (!ip) {
            if (lastUpdatedNode) { lastUpdatedNode.textContent = 'Error: enter a registry host IP address.'; }
            return;
        }

        refreshBtn.disabled = true;
        if (lastUpdatedNode) { lastUpdatedNode.textContent = 'Fetching live registry from ' + ip + ':' + port + ' …'; }

        if (!window.performanceDashboard || typeof window.performanceDashboard.fetchRegistry !== 'function') {
            if (lastUpdatedNode) { lastUpdatedNode.textContent = 'Error: bridge unavailable — is the app running in Electron?'; }
            refreshBtn.disabled = false;
            return;
        }

        var result = await window.performanceDashboard.fetchRegistry({ ip: ip, registryPort: port });
        if (!result || !result.ok) {
            if (lastUpdatedNode) { lastUpdatedNode.textContent = 'Error: ' + ((result && result.message) || 'Could not fetch registry.'); }
            if (hostBadge) { hostBadge.textContent = 'Connection failed'; }
            refreshBtn.disabled = false;
            return;
        }

        var baseline = null;
        try {
            var resp = await fetch('assets/W_Series_default_Delta_registry.json');
            if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
            baseline = await resp.json();
        } catch (e) {
            if (lastUpdatedNode) { lastUpdatedNode.textContent = 'Error loading baseline: ' + e.message; }
            refreshBtn.disabled = false;
            return;
        }

        var diffs = computeRegistryDiff(result.data, baseline);
        renderRegistryDiff(diffs);

        if (hostLabel) { hostLabel.textContent = '// ' + ip + ':' + port; }
        if (hostBadge) { hostBadge.textContent = ip + ':' + port; }
        if (lastUpdatedNode) { lastUpdatedNode.textContent = 'Updated ' + new Date().toLocaleTimeString(); }
        refreshBtn.disabled = false;
    });
}
