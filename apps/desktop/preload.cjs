const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arachneDesktop', {
  platform: process.platform,
  version: '2.0.0',
  isDesktop: true,
  sendNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (dirPath) => ipcRenderer.invoke('open-path', dirPath),
  onCommand: (callback) => {
    ipcRenderer.on('desktop-command', (_event, cmd) => callback(cmd));
  }
});
