import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class BrowserDetector {
  static getKnownExecutablePaths() {
    const platform = os.platform();
    const paths = {
      chrome: [],
      brave: []
    };

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

      paths.chrome.push(
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
      );

      paths.brave.push(
        path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
      );
    } else if (platform === 'darwin') {
      paths.chrome.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      );
      paths.brave.push(
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        path.join(os.homedir(), 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
      );
    } else {
      // Linux
      paths.chrome.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium'
      );
      paths.brave.push(
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/snap/bin/brave'
      );
    }

    return paths;
  }

  static getKnownUserDataPaths() {
    const platform = os.platform();
    const dataPaths = {
      chrome: null,
      brave: null
    };

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      dataPaths.chrome = path.join(localAppData, 'Google', 'Chrome', 'User Data');
      dataPaths.brave = path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data');
    } else if (platform === 'darwin') {
      const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
      dataPaths.chrome = path.join(appSupport, 'Google', 'Chrome');
      dataPaths.brave = path.join(appSupport, 'BraveSoftware', 'Brave-Browser');
    } else {
      const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      dataPaths.chrome = path.join(configDir, 'google-chrome');
      dataPaths.brave = path.join(configDir, 'BraveSoftware', 'Brave-Browser');
    }

    return dataPaths;
  }

  static detectInstalledBrowsers() {
    const knownPaths = this.getKnownExecutablePaths();
    const result = {
      chrome: {
        installed: false,
        executablePath: null,
        userDataPath: null,
        profiles: []
      },
      brave: {
        installed: false,
        executablePath: null,
        userDataPath: null,
        profiles: []
      }
    };

    const userDataPaths = this.getKnownUserDataPaths();

    // Check Chrome
    for (const p of knownPaths.chrome) {
      if (fs.existsSync(p)) {
        result.chrome.installed = true;
        result.chrome.executablePath = p;
        break;
      }
    }
    if (userDataPaths.chrome && fs.existsSync(userDataPaths.chrome)) {
      result.chrome.userDataPath = userDataPaths.chrome;
      result.chrome.profiles = this.discoverProfiles(userDataPaths.chrome);
    }

    // Check Brave
    for (const p of knownPaths.brave) {
      if (fs.existsSync(p)) {
        result.brave.installed = true;
        result.brave.executablePath = p;
        break;
      }
    }
    if (userDataPaths.brave && fs.existsSync(userDataPaths.brave)) {
      result.brave.userDataPath = userDataPaths.brave;
      result.brave.profiles = this.discoverProfiles(userDataPaths.brave);
    }

    return result;
  }

  static discoverProfiles(userDataDir) {
    const profiles = [];
    if (!userDataDir || !fs.existsSync(userDataDir)) {
      return profiles;
    }

    // Always add Default if exists
    const defaultProfilePath = path.join(userDataDir, 'Default');
    if (fs.existsSync(defaultProfilePath)) {
      profiles.push({
        id: 'Default',
        name: 'Default',
        path: defaultProfilePath
      });
    }

    // Read Local State to get user profile names safely without locking
    const localStatePath = path.join(userDataDir, 'Local State');
    if (fs.existsSync(localStatePath)) {
      try {
        const raw = fs.readFileSync(localStatePath, 'utf8');
        const state = JSON.parse(raw);
        const infoCache = state?.profile?.info_cache || {};

        for (const [folderName, info] of Object.entries(infoCache)) {
          if (folderName === 'Default') {
            const defItem = profiles.find(p => p.id === 'Default');
            if (defItem && info.name) defItem.name = info.name;
          } else {
            profiles.push({
              id: folderName,
              name: info.name || folderName,
              path: path.join(userDataDir, folderName)
            });
          }
        }
      } catch {
        // Fallback: scan directories for Profile 1, Profile 2, etc.
        try {
          const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory() && ent.name.startsWith('Profile ')) {
              profiles.push({
                id: ent.name,
                name: ent.name,
                path: path.join(userDataDir, ent.name)
              });
            }
          }
        } catch {}
      }
    }

    return profiles;
  }

  static getDedicatedProfileDir(vaultDir, browserType = 'chrome') {
    const targetDir = path.resolve(vaultDir, 'browser-profiles', browserType.toLowerCase());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
  }
}
