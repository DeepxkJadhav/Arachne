import { spawn } from 'node:child_process';
import path from 'node:path';
import { BrowserDetector } from './browser-detector.mjs';
import { CdpClient } from './cdp-client.mjs';

export class BrowserManager {
  constructor({ vaultStore, vaultDir = null }) {
    this.vaultStore = vaultStore;
    this.vaultDir = vaultDir || vaultStore?.vaultDir || path.resolve(process.cwd(), '.arachne-vault');
    this.selectedBrowser = 'chrome'; // 'chrome' | 'brave'
    this.profileMode = 'dedicated'; // 'dedicated' | 'user_profile' | 'cdp_attach'
    this.selectedProfileId = 'dedicated';
    this.remoteDebuggingPort = 9222;

    this.browserProcess = null;
    this.cdpClient = new CdpClient({ port: this.remoteDebuggingPort });
    this.activeTaskTabs = new Set();
    this.currentCdpSession = null;
    this.currentTaskTabId = null;

    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'ready' | 'navigating' | 'extracting'
    this.activeUrl = null;
    this.lastError = null;

    // Detect available browsers on initialization
    this.detected = BrowserDetector.detectInstalledBrowsers();
    if (!this.detected.chrome?.installed && this.detected.brave?.installed) {
      this.selectedBrowser = 'brave';
    }
  }

  getEnvironmentInfo() {
    this.detected = BrowserDetector.detectInstalledBrowsers();
    return {
      selectedBrowser: this.selectedBrowser,
      profileMode: this.profileMode,
      selectedProfileId: this.selectedProfileId,
      remoteDebuggingPort: this.remoteDebuggingPort,
      status: this.status,
      activeUrl: this.activeUrl,
      activeTaskTabsCount: this.activeTaskTabs.size,
      detected: this.detected,
      dedicatedProfiles: {
        chrome: BrowserDetector.getDedicatedProfileDir(this.vaultDir, 'chrome'),
        brave: BrowserDetector.getDedicatedProfileDir(this.vaultDir, 'brave')
      }
    };
  }

  configure({ browser = 'chrome', profileMode = 'dedicated', profileId = 'dedicated', port = 9222 }) {
    if (browser === 'chrome' || browser === 'brave') {
      this.selectedBrowser = browser;
    }
    this.profileMode = profileMode;
    this.selectedProfileId = profileId;
    this.remoteDebuggingPort = Number(port) || 9222;
    this.cdpClient = new CdpClient({ port: this.remoteDebuggingPort });
  }

  async testCdpConnection() {
    return await this.cdpClient.testConnection();
  }

  static buildLaunchArgs({ browserType = 'chrome', profileDir, port = 9222, headless = false } = {}) {
    const args = [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-features=Translate',
      '--disable-default-apps',
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled'
    ];

    if (headless) {
      args.push('--headless=new');
    }

    return args;
  }

  async launchDedicatedBrowser({ headless = false } = {}) {
    if (this.browserProcess && !this.browserProcess.killed) {
      const conn = await this.testCdpConnection();
      if (conn.connected) {
        this.status = 'ready';
        return { success: true, message: 'Browser already active and connected', port: this.remoteDebuggingPort, headless: !!headless };
      }
    }

    this.detected = BrowserDetector.detectInstalledBrowsers();
    const browserInfo = this.detected[this.selectedBrowser];

    if (!browserInfo?.installed || !browserInfo?.executablePath) {
      throw new Error(`Selected browser [${this.selectedBrowser}] is not installed on this system.`);
    }

    const dedicatedDir = BrowserDetector.getDedicatedProfileDir(this.vaultDir, this.selectedBrowser);
    const args = BrowserManager.buildLaunchArgs({
      browserType: this.selectedBrowser,
      profileDir: dedicatedDir,
      port: this.remoteDebuggingPort,
      headless
    });

    this.status = 'connecting';

    try {
      this.browserProcess = spawn(browserInfo.executablePath, args, {
        detached: false,
        stdio: 'ignore'
      });

      this.browserProcess.on('exit', () => {
        this.status = 'disconnected';
        this.browserProcess = null;
        this.currentCdpSession = null;
      });

      // Poll for CDP readiness up to 10 seconds
      const maxRetries = 20;
      for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, 500));
        const testRes = await this.testCdpConnection();
        if (testRes.connected) {
          this.status = 'ready';
          return {
            success: true,
            browser: this.selectedBrowser,
            executable: browserInfo.executablePath,
            profileDir: dedicatedDir,
            port: this.remoteDebuggingPort,
            headless: !!headless,
            latencyMs: testRes.latencyMs
          };
        }
      }

      throw new Error(`Browser launched but CDP port ${this.remoteDebuggingPort} was not reachable within 10 seconds.`);
    } catch (err) {
      this.status = 'disconnected';
      this.lastError = err.message;
      throw err;
    }
  }

  async prepareTabForUrl(targetUrl) {
    // 1. Close previously open task tab to avoid leaking tabs
    await this.closePreviousTaskTab();

    // 2. Check if CDP is reachable; if not, launch a dedicated visible browser session.
    const conn = await this.testCdpConnection();
    if (!conn.connected) {
      await this.launchDedicatedBrowser({ headless: false });
    }

    // 3. Create fresh task tab
    const tabInfo = await this.cdpClient.createTab(targetUrl);
    if (!tabInfo || !tabInfo.id || !tabInfo.webSocketDebuggerUrl) {
      throw new Error(`Failed to create task tab for: ${targetUrl}`);
    }

    this.currentTaskTabId = tabInfo.id;
    this.activeTaskTabs.add(tabInfo.id);
    this.activeUrl = targetUrl;

    // 4. Attach session
    const session = this.cdpClient.createSession(tabInfo.webSocketDebuggerUrl);
    await session.connect();
    await session.initializePage();
    this.currentCdpSession = session;

    return session;
  }

  async closePreviousTaskTab() {
    if (this.currentCdpSession) {
      this.currentCdpSession.close();
      this.currentCdpSession = null;
    }

    if (this.currentTaskTabId) {
      await this.cdpClient.closeTab(this.currentTaskTabId);
      this.activeTaskTabs.delete(this.currentTaskTabId);
      this.currentTaskTabId = null;
    }
  }

  async closeAllTaskTabs() {
    if (this.currentCdpSession) {
      this.currentCdpSession.close();
      this.currentCdpSession = null;
    }

    for (const tabId of this.activeTaskTabs) {
      await this.cdpClient.closeTab(tabId);
    }
    this.activeTaskTabs.clear();
    this.currentTaskTabId = null;
    this.activeUrl = null;
  }

  async shutdown() {
    await this.closeAllTaskTabs();
    if (this.browserProcess) {
      try {
        this.browserProcess.kill();
      } catch {}
      this.browserProcess = null;
    }
    this.status = 'disconnected';
  }
}
