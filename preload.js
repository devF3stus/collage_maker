const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  writeClipboardImage: (d) => ipcRenderer.invoke('clipboard:writeImage', d),
  readFullFile: (p) => ipcRenderer.invoke('file:readFull', p),
  readPreviewFile: (p) => ipcRenderer.invoke('file:readPreview', p),
  exportImage: (opts) => ipcRenderer.invoke('dialog:export', opts),
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  openProject: () => ipcRenderer.invoke('project:open'),
  storageRead: (key) => ipcRenderer.invoke('storage:read', key),
  storageWrite: (key, value) => ipcRenderer.invoke('storage:write', key, value),
  testComplete: (res) => ipcRenderer.send('test:complete', res),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return null;
    }
  },
});