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
createArachneServer(PORT);

// 2. Launch Client
setTimeout(() => {
  launchClient();
}, 600);

function launchClient() {
  if (process.argv.includes('--server-only')) {
    return;
  }
  const wantsElectron = process.argv.includes('--electron');

  if (wantsElectron) {
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
  }

  // Launch directly in user's browser with full functionality
  console.log(`🌐 Launching ARACHNE Command Center in browser: ${APP_URL}`);
  const openCmd = process.platform === 'win32' ? `cmd.exe /c start "" "${APP_URL}"` : process.platform === 'darwin' ? `open "${APP_URL}"` : `xdg-open "${APP_URL}"`;
  exec(openCmd);
}
