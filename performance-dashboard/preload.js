const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('performanceDashboard', {
    appName: 'Performance Dashboard',
    appVersion: '0.1.0',
    startSession: function (snapshot) {
        return ipcRenderer.invoke('session:start', snapshot || {});
    },
    resumeSession: function () {
        return ipcRenderer.invoke('session:resume');
    },
    stopSession: function () {
        return ipcRenderer.invoke('session:stop');
    },
    fetchServerInfo: function (connection) {
        return ipcRenderer.invoke('server:fetchInfo', connection || {});
    },
    fetchRegistry: function (connection) {
        return ipcRenderer.invoke('registry:fetch', connection || {});
    },
    onFullStatusUpdate: function (callback) {
        if (typeof callback !== 'function') {
            return function () {};
        }

        var handler = function (_event, fj) {
            callback(fj || {});
        };

        ipcRenderer.on('server:fullStatus', handler);
        return function () {
            ipcRenderer.removeListener('server:fullStatus', handler);
        };
    },
    onSessionUpdate: function (callback) {
        if (typeof callback !== 'function') {
            return function () {};
        }

        var handler = function (_event, payload) {
            callback(payload || {});
        };

        ipcRenderer.on('session:update', handler);
        return function () {
            ipcRenderer.removeListener('session:update', handler);
        };
    }
});
