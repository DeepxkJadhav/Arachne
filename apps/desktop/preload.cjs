const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('arachneDesktop', {
  platform: process.platform,
  version: '2.0.0',
  isDesktop: true
});
