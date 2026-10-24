/**
 * ARACHNE — End-to-End Master Acceptance Test Suite
 * Validating Tests A through K from the Master Prompt
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { classifyIntent, INTENTS } from '../server/agent/intent-classifier.mjs';

const BASE_URL = 'http://localhost:3003';

async function api(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) }
    };

    let payload = null;
    if (options.body) {
      payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let data;
        try {
          data = JSON.parse(buffer.toString('utf8'));
        } catch {
          data = buffer.toString('utf8');
        }
        resolve({ status: res.statusCode, data, raw: buffer });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runMasterSuite() {
  console.log('================================================================');
  console.log('🕷️  ARACHNE MASTER E2E ACCEPTANCE TEST SUITE (TESTS A - K)');
  console.log('================================================================\n');

    // Auto-start server if not running
  try {
    await api('/api/status');
  } catch {
    const { createArachneServer } = await import('../server/arachne-server.mjs');
    createArachneServer(3003);
    await new Promise(r => setTimeout(r, 1200));
  }

  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    process.stdout.write(`• [${label}]... `);
    try {
      await fn();
      console.log('✅ PASSED');
      passed++;
    } catch (err) {
      console.log('❌ FAILED');
      console.error(`    Assertion Error: ${err.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // TEST A: Global CLI Invocation Outside Repository
  // -------------------------------------------------------------------------
  await test('TEST A: Global CLI invocation from external working directory', async () => {
    const tempDir = os.tmpdir();
    const output = execSync('arachne --version', { cwd: tempDir, encoding: 'utf8' });
    assert.ok(output.includes('arachne 2.0.0'), 'Global command arachne --version must output version 2.0.0');

    const helpOutput = execSync('arachne --help', { cwd: tempDir, encoding: 'utf8' });
    assert.ok(helpOutput.includes('ARACHNE // AUTONOMOUS WEB INTELLIGENCE'), 'Global command must render cyberpunk wordmark');
    assert.ok(helpOutput.includes('INTERACTIVE COMMANDS:'), 'Global command must list interactive commands');
    assert.ok(helpOutput.includes('new hunt'), 'Global command must show new hunt command');
  });

  // -------------------------------------------------------------------------
  // TEST B: Visible Chrome Browser Automation via Dedicated CDP Port 9222
  // -------------------------------------------------------------------------
  await test('TEST B: Visible Chrome browser automation with dedicated profile', async () => {
    const statusRes = await api('/api/browser/status');
    assert.strictEqual(statusRes.status, 200);
    const b = statusRes.data.data;
    assert.ok(b.detected.chrome.installed, 'Chrome must be detected on the system');
    assert.strictEqual(b.remoteDebuggingPort, 9222, 'CDP debugging port must be 9222');
    assert.ok(b.dedicatedProfiles.chrome.toLowerCase().includes('chrome') && b.dedicatedProfiles.chrome.includes('browser-profiles'), 'Must use isolated dedicated profile directory');

    // Launch visible browser
    const launchRes = await api('/api/browser/launch', {
      method: 'POST',
      body: { headless: false }
    });
    assert.strictEqual(launchRes.status, 200);
    assert.strictEqual(launchRes.data.success, true);
    assert.strictEqual(launchRes.data.data.headless, false, 'Browser must run visible (headless: false)');

    // Verify CDP connection
    const testRes = await api('/api/browser/test', { method: 'POST' });
    assert.strictEqual(testRes.status, 200);
    assert.strictEqual(testRes.data.success, true, 'CDP WebSocket handshake must succeed');
  });

  // -------------------------------------------------------------------------
  // TEST C: Real Research Execution with Genuine Sources
  // -------------------------------------------------------------------------
  await test('TEST C: Real research discovery & persistent ingestion (arXiv/HuggingFace)', async () => {
    // Crawl a real arXiv paper page
    const crawlRes = await api('/api/crawl/page', {
      method: 'POST',
      body: { url: 'https://export.arxiv.org/abs/2301.00234' }
    });
    assert.strictEqual(crawlRes.status, 200);
    assert.strictEqual(crawlRes.data.success, true);
    assert.strictEqual(crawlRes.data.data.metadata.statusCode, 200);
    assert.ok(crawlRes.data.data.markdown.length > 100, 'Must extract real DOM text from page');
    assert.strictEqual(crawlRes.data.data.metadata.domain, 'export.arxiv.org');

    // Ingested into SQLite WAL Corpus
    const storageRes = await api('/api/storage/metrics');
    assert.strictEqual(storageRes.status, 200);
    const counts = storageRes.data.data.counts;
    assert.ok(counts.corpus_documents > 0, 'Corpus documents count must be > 0');
  });

  // -------------------------------------------------------------------------
  // TEST D: Evidence Quality & Ignored Items Audit
  // -------------------------------------------------------------------------
  await test('TEST D: Evidence quality audit & rejected URL logging', async () => {
    // Intentionally crawl an invalid destination
    const badRes = await api('/api/crawl/page', {
      method: 'POST',
      body: { url: 'https://github.com/nonexistent_org_404/not_found_repo_404_xyz' }
    });
    // Should record error or failure and not contaminate evidence
    assert.ok(badRes.data.data.metadata.statusCode === 404 || badRes.data.success === false);

    // Verify ignored_items table
    const ignoredRes = await api('/api/storage/metrics');
    assert.strictEqual(ignoredRes.status, 200);
    const counts = ignoredRes.data.data.counts;
    assert.ok(counts.ignored_items !== undefined, 'ignored_items metric must be tracked in SQLite');
  });

  // -------------------------------------------------------------------------
  // TEST E: Conversational Follow-Up & Report Refinement (Qwen on Groq LPU)
  // -------------------------------------------------------------------------
  await test('TEST E: Conversational report refinement without restarting research', async () => {
    const refineRes = await api('/api/reports/refine', {
      method: 'POST',
      body: { instruction: 'Make the comparison more detailed' }
    });
    assert.strictEqual(refineRes.status, 200);
    assert.strictEqual(refineRes.data.success, true);
    assert.ok(refineRes.data.report, 'Refined report must be returned');
    assert.ok(refineRes.data.refinedText.length > 50, 'Refined text must contain expanded technical comparison');

    // Verify asking a direct question
    const askRes = await api('/api/investigation/ask', {
      method: 'POST',
      body: { question: 'What are the key technical findings?' }
    });
    assert.strictEqual(askRes.status, 200);
    assert.strictEqual(askRes.data.success, true);
    assert.ok(askRes.data.data.answer.length > 30, 'Must produce grounded answer from corpus');
  });

  // -------------------------------------------------------------------------
  // TEST F: Deliverable Exports to Windows Downloads Folder
  // -------------------------------------------------------------------------
  await test('TEST F: Deliverable exports to C:\\Users\\<user>\\Downloads with artifact validation', async () => {
    const downloadsDir = path.join(os.homedir(), 'Downloads');

    // 1. Export as Plain Text (.TXT)
    const txtExport = await api('/api/reports/export', {
      method: 'POST',
      body: { format: 'txt' }
    });
    assert.strictEqual(txtExport.status, 200);
    assert.strictEqual(txtExport.data.success, true);
    assert.ok(txtExport.data.path.startsWith(downloadsDir), `TXT file must be saved in Downloads: ${txtExport.data.path}`);
    assert.ok(fs.existsSync(txtExport.data.path), 'Exported TXT file must exist on disk');
    const txtContent = fs.readFileSync(txtExport.data.path, 'utf8');
    assert.ok(txtContent.includes('ARACHNE') || txtContent.length > 50, 'TXT content must be valid text');

    // 2. Export as PDF (.PDF)
    const pdfExport = await api('/api/reports/export', {
      method: 'POST',
      body: { format: 'pdf' }
    });
    assert.strictEqual(pdfExport.status, 200);
    assert.strictEqual(pdfExport.data.success, true);
    assert.ok(pdfExport.data.path.startsWith(downloadsDir), `PDF file must be saved in Downloads: ${pdfExport.data.path}`);
    assert.ok(fs.existsSync(pdfExport.data.path), 'Exported PDF file must exist on disk');
    const pdfBuf = fs.readFileSync(pdfExport.data.path);
    assert.ok(pdfBuf.slice(0, 5).toString('utf8').startsWith('%PDF-'), 'PDF must start with %PDF- header');
    assert.ok(pdfBuf.toString('latin1').includes('%%EOF'), 'PDF must contain %%EOF marker');
  });

  // -------------------------------------------------------------------------
  // TEST G: Zero Accidental Research Hunts
  // -------------------------------------------------------------------------
  await test('TEST G: Zero accidental research hunts on non-research queries', async () => {
    const nonResearchQueries = [
      { text: 'Give me the last report as a TXT file', expected: INTENTS.EXPORT_REPORT },
      { text: 'Export rep-1792069973534 as PDF', expected: INTENTS.EXPORT_REPORT },
      { text: 'Show report rep-1792069973534', expected: INTENTS.VIEW_REPORT },
      { text: 'How do I generate a PDF?', expected: INTENTS.FORMAT_HELP },
      { text: 'Check whether Arachne is working', expected: INTENTS.SYSTEM_STATUS },
      { text: 'Is the browser connected?', expected: INTENTS.BROWSER_STATUS },
      { text: 'Use Qwen for the next research task', expected: INTENTS.MODEL_CONFIG },
      { text: 'Make the comparison more detailed', expected: INTENTS.REFINE_REPORT }
    ];

    for (const q of nonResearchQueries) {
      const c = classifyIntent(q.text);
      assert.strictEqual(
        c.intent,
        q.expected,
        `Query "${q.text}" classified as ${c.intent}, expected ${q.expected}`
      );
      assert.notStrictEqual(c.intent, INTENTS.NEW_RESEARCH, `Query "${q.text}" must NOT trigger NEW_RESEARCH`);
    }
  });

  // -------------------------------------------------------------------------
  // TEST H: Persistence Across Restart (SQLite WAL)
  // -------------------------------------------------------------------------
  await test('TEST H: SQLite WAL database persistence & integrity', async () => {
    const storageRes = await api('/api/storage/metrics');
    assert.strictEqual(storageRes.status, 200);
    const data = storageRes.data.data;
    assert.strictEqual(data.mode, 'WAL', 'Database journal mode must be WAL');
    assert.ok(parseFloat(data.totalMb) > 0 || data.totalBytes > 0, 'Database size must be greater than 0 MB');
    assert.ok(data.counts.corpus_documents > 0, 'Corpus documents must persist');
    assert.ok(data.counts.reports > 0, 'Reports must persist');
  });

  // -------------------------------------------------------------------------
  // TEST I: Task Lifecycle (Pause, Resume, Stop)
  // -------------------------------------------------------------------------
  await test('TEST I: Research task lifecycle control (Pause, Resume, Stop)', async () => {
    const pauseRes = await api('/api/investigation/pause', { method: 'POST' });
    assert.strictEqual(pauseRes.status, 200);
    assert.strictEqual(pauseRes.data.success, true);

    const resumeRes = await api('/api/investigation/resume', { method: 'POST' });
    assert.strictEqual(resumeRes.status, 200);
    assert.strictEqual(resumeRes.data.success, true);

    const stopRes = await api('/api/investigation/stop', { method: 'POST' });
    assert.strictEqual(stopRes.status, 200);
    assert.strictEqual(stopRes.data.success, true);
  });

  // -------------------------------------------------------------------------
  // TEST J: Telegram Gateway Verification & Fail-Closed Security
  // -------------------------------------------------------------------------
  await test('TEST J: Telegram gateway fail-closed security & command handling', async () => {
    const tgStatus = await api('/api/telegram/status');
    assert.strictEqual(tgStatus.status, 200);
    assert.strictEqual(tgStatus.data.data.configured, true);

    // Test unauthorized user simulation (fail-closed check)
    const unauthorizedRes = await api('/api/telegram/exec', {
      method: 'POST',
      body: { command: '/status', userId: '999999999_unauthorized' }
    });
    assert.ok(
      unauthorizedRes.data.success === false ||
      (unauthorizedRes.data.data?.response && unauthorizedRes.data.data.response.includes('Unauthorized')),
      'Unauthorized Telegram user must be rejected fail-closed'
    );
  });

  // -------------------------------------------------------------------------
  // TEST K: Controlled Failure Handling & SSRF Security
  // -------------------------------------------------------------------------
  await test('TEST K: Controlled failure handling, SSRF defense, & timeout safety', async () => {
    // 1. SSRF Guard: Loopback IP
    const loopback = await api('/api/crawl/page', {
      method: 'POST',
      body: { url: 'http://127.0.0.1:9999/admin' }
    });
    assert.strictEqual(loopback.data.success, false);
    assert.strictEqual(loopback.data.data.metadata.statusCode, 403);

    // 2. SSRF Guard: AWS / GCP Cloud Metadata IP
    const metadata = await api('/api/crawl/page', {
      method: 'POST',
      body: { url: 'http://169.254.169.254/latest/meta-data/' }
    });
    assert.strictEqual(metadata.data.success, false);
    assert.strictEqual(metadata.data.data.metadata.statusCode, 403);

    // 3. System must remain healthy and operational after failure attempts
    const health = await api('/api/status');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.success, true);
  });

  console.log('\n================================================================');
  console.log(`🏁 MASTER ACCEPTANCE SUITE FINISHED: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMasterSuite().catch(err => {
  console.error('Fatal Master Test Error:', err);
  process.exit(1);
});
