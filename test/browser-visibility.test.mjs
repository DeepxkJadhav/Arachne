import test from 'node:test';
import assert from 'node:assert';

import { BrowserManager } from '../apps/desktop/server/browser/browser-manager.mjs';

test('browser launch args default to visible Chrome', () => {
  const args = BrowserManager.buildLaunchArgs({
    profileDir: 'C:\\tmp\\arachne-profile',
    port: 9222
  });

  assert.ok(args.includes('--remote-debugging-port=9222'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.some((value) => value.startsWith('--user-data-dir=')));
  assert.ok(!args.includes('--headless=new'));
});

test('browser launch can still run in headless mode when explicitly requested', () => {
  const args = BrowserManager.buildLaunchArgs({
    profileDir: 'C:\\tmp\\arachne-profile',
    port: 9222,
    headless: true
  });

  assert.ok(args.includes('--headless=new'));
});

test('prepareTabForUrl launches a visible browser when CDP is unavailable', async () => {
  const manager = new BrowserManager({ vaultStore: {} });
  let launchOptions = null;

  manager.testCdpConnection = async () => ({ connected: false });
  manager.launchDedicatedBrowser = async (options = {}) => {
    launchOptions = options;
    return { success: true, headless: options.headless };
  };
  manager.closePreviousTaskTab = async () => {};
  manager.cdpClient.createTab = async () => ({
    id: 'tab-1',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc'
  });
  manager.cdpClient.createSession = () => ({
    connect: async () => {},
    initializePage: async () => {},
    close: () => {}
  });

  await manager.prepareTabForUrl('https://example.com');

  assert.deepStrictEqual(launchOptions, { headless: false });
});
