import { spawn, exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createArachneServer } from './server/arachne-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3003;
const APP_URL = `http://localhost:${PORT}`;

console.log('---------------------------------------------------------');
console.log('🕷️  ARACHNE — Autonomous Web Intelligence & Research System');
console.log('---------------------------------------------------------');

// 1. Start Intelligence Core Server
const serverInstance = createArachneServer(PORT);

// 2. Launch Client
setTimeout(() => {
  launchClient();
}, 600);

function launchClient() {
  const isWebOnly = process.argv.includes('--web');

  if (!isWebOnly) {
    // Try launching Electron if installed
    try {
      const electronExe = path.resolve(__dirname, 'node_modules/electron/dist/electron.exe');
      if (fs.existsSync(electronExe)) {
        console.log('🚀 Launching native Electron desktop window...');
        const electronProc = spawn(electronExe, [path.join(__dirname, 'main.cjs')], {
          stdio: 'inherit',
          detached: true
        });
        electronProc.unref();
        return;
      }
    } catch {}

    // Check for Microsoft Edge or Chrome in app-window mode (Windows Desktop Application Mode)
    if (process.platform === 'win32') {
      const edgePaths = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ];
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      ];

      for (const p of [...edgePaths, ...chromePaths]) {
        if (fs.existsSync(p)) {
          console.log(`🖥️  Launching ARACHNE Desktop Window via: ${path.basename(p)}`);
          spawn(p, [`--app=${APP_URL}`, '--window-size=1440,920'], { detached: true });
          return;
        }
      }
    }
  }

  // Fallback to opening default web browser
  console.log(`🌐 Opening ARACHNE Command Center at ${APP_URL}`);
  const openCmd = process.platform === 'win32' ? `start "" "${APP_URL}"` : process.platform === 'darwin' ? `open "${APP_URL}"` : `xdg-open "${APP_URL}"`;
  exec(openCmd);
}
