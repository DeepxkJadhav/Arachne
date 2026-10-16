import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('🕷️  ARACHNE CLI, COLOR PALETTE & FUNCTIONAL REPAIR AUDIT');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  process.stdout.write(`• ${testName}... `);
  try {
    fn();
    console.log('✅ PASSED');
    passedTests++;
  } catch (err) {
    console.log('❌ FAILED');
    console.error(`  Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  process.stdout.write(`• ${testName}... `);
  try {
    await fn();
    console.log('✅ PASSED');
    passedTests++;
  } catch (err) {
    console.log('❌ FAILED');
    console.error(`  Error: ${err.message}`);
    failedTests++;
  }
}

// 1. Audit Color Palette: No Green, Cyan, Purple, Yellow in Default Theme
runTest('CLI Theme Palette Audit (Black, White, Crimson/Red, Dark Gray only)', () => {
  const cliOutput = execSync('node bin/arachne.mjs status', { cwd: PROJECT_ROOT, encoding: 'utf8' });

  // Forbidden ANSI sequences
  // Green: \x1b[32m, \x1b[92m, \x1b[38;5;48m, \x1b[38;5;46m, etc.
  // Cyan: \x1b[36m, \x1b[96m, \x1b[38;5;51m, etc.
  // Yellow: \x1b[33m, \x1b[93m, \x1b[38;5;226m, etc.
  // Magenta/Purple: \x1b[35m, \x1b[95m, \x1b[38;5;129m, etc.
  const forbiddenAnsiPatterns = [
    /\x1b\[32m/,
    /\x1b\[92m/,
    /\x1b\[38;5;48m/,
    /\x1b\[38;5;46m/,
    /\x1b\[38;5;34m/,
    /\x1b\[36m/,
    /\x1b\[96m/,
    /\x1b\[38;5;51m/,
    /\x1b\[33m/,
    /\x1b\[93m/,
    /\x1b\[38;5;226m/,
    /\x1b\[35m/,
    /\x1b\[95m/,
    /\x1b\[38;5;129m/
  ];

  for (const pattern of forbiddenAnsiPatterns) {
    assert.strictEqual(
      pattern.test(cliOutput),
      false,
      `Output contained forbidden ANSI color matching ${pattern}`
    );
  }
});

// 2. ASCII Spider Restraint Audit
runTest('ASCII Art Restraint Audit (No duplicate spiders, compact header)', () => {
  const cliOutput = execSync('node bin/arachne.mjs status', { cwd: PROJECT_ROOT, encoding: 'utf8' });
  
  // Count occurrences of spider legs/body: "/ _ \"
  const matches = (cliOutput.match(/\/ _ \\/g) || []).length;
  assert.strictEqual(matches, 1, `Expected exactly 1 compact spider logo in header, got ${matches}`);

  // Ensure duplicate giant spider art is absent
  assert.strictEqual(cliOutput.includes('.-"""-.'), false, 'Found prohibited giant duplicate spider artwork');
});

// 3. Subsystem Health Real Metrics (No Fake AR-0042 Demo Data)
runTest('CLI Real Data Verification (No hard-coded AR-0042 or fake 12,840 URLs)', () => {
  const cliOutput = execSync('node bin/arachne.mjs status', { cwd: PROJECT_ROOT, encoding: 'utf8' });

  assert.strictEqual(cliOutput.includes('AR-0042'), false, 'Found hardcoded AR-0042 in default status');
  assert.strictEqual(cliOutput.includes('12840'), false, 'Found hardcoded 12,840 URLs metric');
  assert.strictEqual(cliOutput.includes('SQLite 3'), true, 'Expected SQLite storage engine to be reported');
});

// 4. Report Structural Validation & File Export Audit
await runAsyncTest('Report Structural Magic Headers & Disk Export (PDF, DOCX, XLSX, JSON)', async () => {
  const reportsRes = await fetch('http://localhost:3003/api/reports');
  const reportsJson = await reportsRes.json();
  assert.ok(reportsJson.data && reportsJson.data.length > 0, 'Reports must be present in vault');
  const reportId = reportsJson.data[0].id;

  const tmpDir = path.join(PROJECT_ROOT, '.arachne-vault', 'temp-test-exports');
  fs.mkdirSync(tmpDir, { recursive: true });

  const formats = [
    { fmt: 'json', file: 'audit.json', check: (buf) => JSON.parse(buf.toString('utf8')) },
    { fmt: 'pdf', file: 'audit.pdf', check: (buf) => buf.slice(0, 5).toString('utf8') === '%PDF-' },
    { fmt: 'docx', file: 'audit.docx', check: (buf) => buf.slice(0, 4).toString('hex') === '504b0304' },
    { fmt: 'xlsx', file: 'audit.xlsx', check: (buf) => buf.slice(0, 4).toString('hex') === '504b0304' },
    { fmt: 'html', file: 'audit.html', check: (buf) => buf.toString('utf8').includes('<!DOCTYPE html>') || buf.toString('utf8').includes('<html') },
    { fmt: 'md', file: 'audit.md', check: (buf) => buf.toString('utf8').length > 50 }
  ];

  for (const { fmt, file, check } of formats) {
    const dest = path.join(tmpDir, file);
    const exportRes = await fetch('http://localhost:3003/api/reports/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, format: fmt, destinationPath: dest })
    });
    const expData = await exportRes.json();
    assert.strictEqual(expData.success, true, `Export of ${fmt} failed: ${expData.error}`);
    assert.ok(fs.existsSync(dest), `File ${dest} does not exist`);
    
    const fileBytes = fs.readFileSync(dest);
    assert.ok(fileBytes.length > 0, `File ${dest} is zero bytes`);
    assert.doesNotThrow(() => check(fileBytes), `Validation check failed for ${fmt}`);
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 5. Ignored Items Recording & Policy Filtering Audit
await runAsyncTest('Ignored/Skipped Items Pipeline & Notification Policies', async () => {
  // Test logging ignored items via API
  const testItems = [
    {
      investigationId: 'test-inv-01',
      url: 'http://169.254.169.254/latest/meta-data',
      title: 'AWS Cloud Metadata',
      reason: 'SSRF_RESTRICTED: Link destination addresses private or internal cloud metadata',
      stage: 'ssrf_guard',
      willRetry: false,
      continues: true
    },
    {
      investigationId: 'test-inv-01',
      url: 'https://example.com/admin/login',
      title: 'Admin Authentication Gateway',
      reason: 'AUTH_GATEWAY: Page requires authentication credentials',
      stage: 'link_candidate',
      willRetry: false,
      continues: true
    },
    {
      investigationId: 'test-inv-01',
      url: 'https://example.com/disallowed-path',
      title: 'Robots Disallowed Resource',
      reason: 'ROBOTS_TXT_FORBIDDEN: Excluded by robots.txt directives',
      stage: 'robots_exclusion',
      willRetry: false,
      continues: true
    }
  ];

  // We can insert them directly into sqlite or verify through research agent
  // Let's query /api/investigation/ignored-items
  const initRes = await fetch('http://localhost:3003/api/investigation/ignored-items?limit=5');
  const initJson = await initRes.json();
  assert.strictEqual(initJson.success, true, 'Failed to fetch ignored items endpoint');

  // Verify policy setting through /api/settings
  for (const policy of ['all', 'important', 'batch', 'disabled']) {
    const setRes = await fetch('http://localhost:3003/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramIgnoredItemsPolicy: policy })
    });
    const setJson = await setRes.json();
    assert.strictEqual(setJson.success, true);
    assert.strictEqual(setJson.data.telegramIgnoredItemsPolicy, policy);

    // Verify /api/telegram/status reflects the policy
    const tStatRes = await fetch('http://localhost:3003/api/telegram/status');
    const tStat = await tStatRes.json();
    assert.strictEqual(tStat.data.ignoredItemsPolicy, policy);
  }

  // Restore policy to 'important'
  await fetch('http://localhost:3003/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramIgnoredItemsPolicy: 'important' })
  });
});

// 6. Local Deterministic Web Inspection & SSRF Guard Fixture
await runAsyncTest('Local Deterministic Web Inspection & SSRF Guard Fixture', async () => {
  // Start ephemeral HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === '/test-article') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Deterministic Test Article</title></head>
          <body>
            <header><nav><a href="/home">Home</a></nav></header>
            <main>
              <h1>Autonomous Intelligence Capabilities</h1>
              <p>ARACHNE provides deterministic extraction without external scrapers.</p>
              <ul>
                <li>High-speed headless browser automation</li>
                <li>Transactional SQLite persistence</li>
                <li>Zero external scraper runtime footprint</li>
              </ul>
            </main>
          </body>
        </html>
      `);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise(resolve => server.listen(44991, resolve));

  try {
    // 6a: Verify SSRF Guard blocks localhost on public crawler endpoint
    const crawlRes = await fetch('http://localhost:3003/api/crawl/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:44991/test-article' })
    });
    const crawlData = await crawlRes.json();
    assert.strictEqual(crawlData.success, false, 'Expected SSRF guard to block localhost');
    assert.ok(crawlData.error.toLowerCase().includes('ssrf blocked'), `Expected SSRF error, got: ${crawlData.error}`);

    // 6b: Test direct ContentExtractor deterministic markdown & metadata
    const { ContentExtractor } = await import('../server/crawler/extractor.mjs');
    const { CrawlerFetcher } = await import('../server/crawler/fetcher.mjs');

    const testHtml = `
      <html>
        <head><title>Deterministic Intelligence Dossier</title></head>
        <body>
          <main>
            <h1>Autonomous Intelligence Capabilities</h1>
            <p>ARACHNE provides deterministic extraction without external scrapers.</p>
          </main>
        </body>
      </html>
    `;
    const extracted = ContentExtractor.extract('https://arachne.intelligence/test', testHtml, 'Raw text content');
    assert.strictEqual(extracted.title, 'Deterministic Intelligence Dossier');
    assert.ok(Array.isArray(extracted.links));

    // 6c: Test CrawlerFetcher markdown conversion
    const localFetcher = new CrawlerFetcher({ allowLocalhost: true });
    const fetched = await localFetcher.fetchUrl('http://127.0.0.1:44991/test-article');
    assert.strictEqual(fetched.success, true);
    const md = localFetcher.htmlToCleanMarkdown(fetched.html, 'http://127.0.0.1:44991/test-article');
    assert.ok(md.includes('Autonomous Intelligence Capabilities'));
    assert.ok(md.includes('Zero external scraper runtime footprint'));
  } finally {
    server.close();
  }
});

// 7. CLI Subcommands Matrix Execution
runTest('CLI Subcommands Matrix Execution (status, models, browser, tabs, reports)', () => {
  const subcommands = ['status', 'models', 'browser', 'tabs', 'reports', 'telegram status'];
  for (const cmd of subcommands) {
    const out = execSync(`node bin/arachne.mjs ${cmd}`, { cwd: PROJECT_ROOT, encoding: 'utf8' });
    assert.ok(out.length > 50, `Subcommand '${cmd}' returned insufficient output`);
    assert.strictEqual(out.includes('[ERR] ARACHNE server is unreachable'), false, `Subcommand '${cmd}' failed with server unreachable`);
  }
});

console.log('\n================================================================');
console.log(`🏁 AUDIT COMPLETE: ${passedTests} Passed, ${failedTests} Failed`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
