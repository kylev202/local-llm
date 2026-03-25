const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileAPI', {
    saveData: (filename, data) => ipcRenderer.invoke('save-data', filename, data),
    loadData: (filename) => ipcRenderer.invoke('load-data', filename),
    openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
    getDataFolderPath: () => ipcRenderer.invoke('get-data-folder-path'),
});
