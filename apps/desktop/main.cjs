const { app, BrowserWindow, Menu, Tray, nativeImage, Notification, dialog, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

const SPIDER_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR42mNkQAO/gPg/EP9HQ4yMjP9hGKTh588fDGAaePAxDKiV8QGfAaRgYEBQv480P4AweT4mRgYGBsb/DAwMbCjCYIAqC4D4PxzDqGkAvcMPhqVomgYAPg1cZqK+V6QAAAAASUVORK5CYII=';

function createTray(win) {
  try {
    const icon = nativeImage.createFromDataURL(SPIDER_ICON_DATA_URL);
    tray = new Tray(icon);
    tray.setToolTip('ARACHNE — Autonomous Web Intelligence System');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🕷️ Open ARACHNE Command Center',
        click: () => {
          if (win) {
            win.show();
            win.focus();
          }
        }
      },
      {
        label: '⚡ New Investigation (Ctrl+N)',
        click: () => {
          if (win) {
            win.show();
            win.webContents.send('desktop-command', 'new-hunt');
          }
        }
      },
      {
        label: '🔍 Command Palette (Ctrl+K)',
        click: () => {
          if (win) {
            win.show();
            win.webContents.send('desktop-command', 'command-palette');
          }
        }
      },
      { type: 'separator' },
      {
        label: '⏸️ Pause Active Hunt',
        click: () => {
          if (win) win.webContents.send('desktop-command', 'pause');
        }
      },
      {
        label: '▶️ Resume Active Hunt',
        click: () => {
          if (win) win.webContents.send('desktop-command', 'resume');
        }
      },
      {
        label: '📁 Open Reports Vault',
        click: () => {
          const reportsDir = path.resolve(process.cwd(), '.arachne-vault/reports');
          shell.openPath(reportsDir);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit ARACHNE',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (win) {
        win.show();
        win.focus();
      }
    });
  } catch (err) {
    console.warn('[Desktop:Tray] Tray initialization skipped:', err.message);
  }
}

function setupApplicationMenu(win) {
  const template = [
    {
      label: 'ARACHNE',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => win.webContents.send('desktop-command', 'command-palette')
        },
        {
          label: 'New Investigation',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('desktop-command', 'new-hunt')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Dashboard & Hunt',
          accelerator: 'CmdOrCtrl+1',
          click: () => win.webContents.send('desktop-command', 'view-dashboard')
        },
        {
          label: 'Web Graph Topology',
          accelerator: 'CmdOrCtrl+2',
          click: () => win.webContents.send('desktop-command', 'view-graph')
        },
        {
          label: 'Discovered Results',
          accelerator: 'CmdOrCtrl+3',
          click: () => win.webContents.send('desktop-command', 'view-results')
        },
        {
          label: 'Reports Studio',
          accelerator: 'CmdOrCtrl+4',
          click: () => win.webContents.send('desktop-command', 'view-reports')
        },
        {
          label: 'Knowledge Vault',
          accelerator: 'CmdOrCtrl+5',
          click: () => win.webContents.send('desktop-command', 'view-vault')
        },
        {
          label: 'Model Studio',
          accelerator: 'CmdOrCtrl+6',
          click: () => win.webContents.send('desktop-command', 'view-models')
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Audio',
      submenu: [
        {
          label: 'Toggle Soundscape / Audio Cues',
          accelerator: 'CmdOrCtrl+M',
          click: () => win.webContents.send('desktop-command', 'toggle-audio')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupIpcHandlers() {
  ipcMain.handle('show-notification', async (_event, { title, body }) => {
    if (Notification.isSupported()) {
      const icon = nativeImage.createFromDataURL(SPIDER_ICON_DATA_URL);
      new Notification({
        title: title || 'ARACHNE Intelligence Core',
        body: body || 'Investigation updated.',
        icon
      }).show();
      return true;
    }
    return false;
  });

  ipcMain.handle('show-save-dialog', async (_event, options) => {
    if (!mainWindow) return { canceled: true };
    return dialog.showSaveDialog(mainWindow, options);
  });

  ipcMain.handle('open-external', async (_event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  ipcMain.handle('open-path', async (_event, dirPath) => {
    if (dirPath) {
      await shell.openPath(dirPath);
      return true;
    }
    return false;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#07050f',
    title: 'ARACHNE — Autonomous Web Intelligence System',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  setupApplicationMenu(mainWindow);
  createTray(mainWindow);

  mainWindow.loadURL('http://localhost:3003');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      // Keep running in tray when user closes window on Windows/macOS
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
