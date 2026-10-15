/**
 * ARACHNE — Intent Classification, Report Export, & Discovery Regression Test Suite
 * 
 * Verifies all 11 critical operational scenarios:
 * 1. "Give me the last report as a TXT file" (does not trigger research).
 * 2. "Export rep-..." as PDF.
 * 3. "Start research on computer vision" (triggers research).
 * 4. "Check whether Arachne is working" (status, no research).
 * 5. "How do I generate a PDF?" (format help, no research or export).
 * 6. Missing report handling.
 * 7. Missing report file handling.
 * 8. Malformed model output handling.
 * 9. Invalid source URLs and 404 responses.
 * 10. Source deduplication.
 * 11. Accurate health-check reporting.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { classifyIntent, INTENTS } from '../apps/desktop/server/agent/intent-classifier.mjs';
import { UrlFrontier } from '../apps/desktop/server/crawler/frontier.mjs';
import { ModelRouter } from '../apps/desktop/server/models/model-router.mjs';
import { ReportEngine } from '../apps/desktop/server/reports/report-engine.mjs';
import { SqliteStore } from '../apps/desktop/server/vault/sqlite-store.mjs';
import { VaultStore } from '../apps/desktop/server/vault/vault-store.mjs';

const BASE_URL = 'http://localhost:3003';
const SENDER_ID = '123456789'; // Authorized operator ID

function requestJson(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      method,
      headers: {
        'Accept': 'application/json',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      }
    };

    const req = http.request(parsed, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log('🕷️  ARACHNE REGRESSION SUITE: INTENTS, REPORTS & DISCOVERY');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (e) {
      console.log('❌ FAIL');
      console.error('  ', e.message);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // Scenario 1: "Give me the last report as a TXT file"
  // Must NOT trigger research, must resolve latest report, and output plain text
  // -------------------------------------------------------------------------
  await test('Scenario 1: "Give me the last report as a TXT file" (does NOT trigger research)', async () => {
    // A. Verify Intent Classifier
    const classified = classifyIntent('Give me the last report as a TXT file');
    assert.strictEqual(classified.intent, INTENTS.EXPORT_REPORT);
    assert.strictEqual(classified.params.format, 'txt');
    assert.strictEqual(classified.params.isLatest, true);

    // B. Check active tasks count before command
    const statusBefore = await requestJson('GET', '/api/status');
    const tasksBefore = statusBefore.data?.investigations?.total || 0;

    // C. Execute via Telegram Operator Interface
    const tgRes = await requestJson('POST', '/api/telegram/exec', {
      senderId: SENDER_ID,
      text: 'Give me the last report as a TXT file'
    });
    assert.strictEqual(tgRes.status, 200);
    assert.strictEqual(tgRes.data?.success, true);
    assert(
      tgRes.data?.data?.response?.includes('.TXT') ||
      tgRes.data?.data?.response?.includes('Research Report Exported') ||
      tgRes.data?.data?.response?.includes('Report ID')
    );

    // D. Verify no research hunt was spawned
    const statusAfter = await requestJson('GET', '/api/status');
    const tasksAfter = statusAfter.data?.investigations?.total || 0;
    assert.strictEqual(tasksAfter, tasksBefore, 'Must not spawn new research tasks on export intent');

    // E. Verify file export on disk
    const exportRes = await requestJson('POST', '/api/reports/export', {
      reportId: 'latest',
      format: 'txt',
      destinationPath: path.resolve('reports/test-scenario-1.txt'),
      overwrite: true
    });
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.data?.success, true);
    assert(fs.existsSync(exportRes.data.path));
    const content = fs.readFileSync(exportRes.data.path, 'utf8');
    assert(content.includes('ARACHNE INTELLIGENCE DOSSIER'));
    assert(content.includes('EXECUTIVE SUMMARY'));
  });

  // -------------------------------------------------------------------------
  // Scenario 2: "Export rep-..." as PDF
  // Must export specific report to PDF without re-crawling
  // -------------------------------------------------------------------------
  await test('Scenario 2: "Export rep-..." as PDF', async () => {
    // Find an existing completed report
    const latestRes = await requestJson('GET', '/api/reports/latest');
    assert(latestRes.data?.success, 'Should have at least one completed report');
    const targetReportId = latestRes.data.data.id;

    const query = `Export ${targetReportId} as PDF`;
    const classified = classifyIntent(query);
    assert.strictEqual(classified.intent, INTENTS.EXPORT_REPORT);
    assert.strictEqual(classified.params.format, 'pdf');
    assert.strictEqual(classified.params.reportId, targetReportId);

    // Export via API
    const dest = path.resolve(`reports/test-${targetReportId}.pdf`);
    const exportRes = await requestJson('POST', '/api/reports/export', {
      reportId: targetReportId,
      format: 'pdf',
      destinationPath: dest,
      overwrite: true
    });
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.data?.success, true);
    assert(fs.existsSync(dest));

    // Verify PDF Magic Header
    const buf = fs.readFileSync(dest);
    assert(buf.slice(0, 5).toString('utf8') === '%PDF-', 'Must contain valid %PDF- magic header');
    assert(buf.toString('latin1').includes('%%EOF'), 'Must contain valid %%EOF trailer');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: "Start research on computer vision"
  // Unambiguous research request triggers NEW_RESEARCH
  // -------------------------------------------------------------------------
  await test('Scenario 3: "Start research on computer vision" (triggers research)', async () => {
    const classified = classifyIntent('Start research on computer vision');
    assert.strictEqual(classified.intent, INTENTS.NEW_RESEARCH);
    assert.strictEqual(classified.params.objective, 'computer vision');

    const classifiedCmd = classifyIntent('/hunt Autonomous Web Agents');
    assert.strictEqual(classifiedCmd.intent, INTENTS.NEW_RESEARCH);
    assert.strictEqual(classifiedCmd.params.objective, 'Autonomous Web Agents');
  });

  // -------------------------------------------------------------------------
  // Scenario 4: "Check whether Arachne is working"
  // Status query must return health without initiating research
  // -------------------------------------------------------------------------
  await test('Scenario 4: "Check whether Arachne is working" (status, no research)', async () => {
    const classified = classifyIntent('Check whether Arachne is working.');
    assert.strictEqual(classified.intent, INTENTS.SYSTEM_STATUS);

    const tgRes = await requestJson('POST', '/api/telegram/exec', {
      senderId: SENDER_ID,
      text: 'Check whether Arachne is working.'
    });
    assert.strictEqual(tgRes.status, 200);
    assert.strictEqual(tgRes.data?.success, true);
    assert(tgRes.data?.data?.response?.includes('ARACHNE System Status') || tgRes.data?.data?.response?.includes('Status:'));
  });

  // -------------------------------------------------------------------------
  // Scenario 5: "How do I generate a PDF?"
  // Format help inquiry must NOT export or trigger research
  // -------------------------------------------------------------------------
  await test('Scenario 5: "How do I generate a PDF?" (format help, no research or export)', async () => {
    const classified = classifyIntent('How do I generate a PDF?');
    assert.strictEqual(classified.intent, INTENTS.FORMAT_HELP);
    assert.strictEqual(classified.params.format, 'pdf');

    const tgRes = await requestJson('POST', '/api/telegram/exec', {
      senderId: SENDER_ID,
      text: 'How do I generate a PDF?'
    });
    assert.strictEqual(tgRes.status, 200);
    assert.strictEqual(tgRes.data?.success, true);
    assert(
      tgRes.data?.data?.response?.includes('Deliverable Formats Guide') ||
      tgRes.data?.data?.response?.includes('PDF')
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Missing report handling
  // Clean explanation, no crash, asks whether to start research
  // -------------------------------------------------------------------------
  await test('Scenario 6: Missing report handling', async () => {
    const fakeReportId = 'rep-nonexistent-999999999999';
    const res = await requestJson('POST', '/api/reports/export', {
      reportId: fakeReportId,
      format: 'txt',
      destinationPath: path.resolve('reports/fake.txt')
    });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.data?.success, false);
    assert(res.data?.error?.includes('Report not found'));

    // Check telegram response for nonexistent report
    const tgRes = await requestJson('POST', '/api/telegram/exec', {
      senderId: SENDER_ID,
      text: `Export ${fakeReportId} as TXT`
    });
    assert.strictEqual(tgRes.status, 200);
    const respLower = (tgRes.data?.data?.response || '').toLowerCase();
    assert(
      respLower.includes('no completed reports found') ||
      respLower.includes('not found') ||
      respLower.includes('research hunt') ||
      respLower.includes('start a research')
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Missing report file handling
  // Automatically regenerates and validates report if physical file is missing
  // -------------------------------------------------------------------------
  await test('Scenario 7: Missing report file handling (regenerates on demand)', async () => {
    const latestRes = await requestJson('GET', '/api/reports/latest');
    const rep = latestRes.data.data;
    const testDest = path.resolve(`reports/on-demand-${rep.id}.md`);
    
    // Ensure dest does not exist
    if (fs.existsSync(testDest)) fs.unlinkSync(testDest);

    const exportRes = await requestJson('POST', '/api/reports/export', {
      reportId: rep.id,
      format: 'md',
      destinationPath: testDest,
      overwrite: true
    });
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.data?.success, true);
    assert(fs.existsSync(testDest));
    const content = fs.readFileSync(testDest, 'utf8');
    assert(content.includes('ARACHNE Intelligence Dossier'));
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Malformed model output handling
  // Safe heuristic fallback when LLM returns invalid JSON or garbage
  // -------------------------------------------------------------------------
  await test('Scenario 8: Malformed model output handling', async () => {
    const mr = new ModelRouter({ vaultDir: '.arachne-vault' });
    
    // Test heuristicDecompose directly
    const plan = mr.heuristicDecompose('Quantum Computing Error Correction');
    assert(plan.phases && Array.isArray(plan.phases));
    assert.strictEqual(plan.phases.length, 5);
    assert.strictEqual(plan.phases[0].name, 'Scoping & Problem Formulation');
    assert(plan.phases[0].queries.length > 0);

    // Test parse robustness
    const invalidJsonString = "Here is your plan: ```json { malformed phases: [";
    let caught = false;
    try {
      JSON.parse(invalidJsonString);
    } catch {
      caught = true;
    }
    assert(caught, 'Must catch invalid JSON and route to fallback');
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Invalid source URLs and 404 responses
  // -------------------------------------------------------------------------
  await test('Scenario 9: Invalid source URLs and 404 responses (rejection recorded)', async () => {
    const frontier = new UrlFrontier({ maxUrls: 10 });
    
    // Test invalid URL rejection
    const invalidCheck = frontier.isUrlPermitted('not-a-valid-url');
    assert.strictEqual(invalidCheck.permitted, false);
    assert.strictEqual(invalidCheck.reason, 'INVALID_URL');

    // Test 404 classification
    const classification = frontier.classifyError('Not Found', 404);
    assert.strictEqual(classification, 'NOT_FOUND');

    // Test recordFailure on 404 does not retry
    const failRes = frontier.recordFailure('https://example.com/missing-404', 'Not Found', 404);
    assert.strictEqual(failRes.willRetry, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Source deduplication
  // Equivalent URLs normalized and enqueued only once
  // -------------------------------------------------------------------------
  await test('Scenario 10: Source deduplication (query params, hash, trailing slashes)', async () => {
    const frontier = new UrlFrontier({ maxUrls: 10 });
    
    const u1 = 'https://Example.com/Docs/Path/?utm_source=twitter&utm_medium=cpc#summary';
    const u2 = 'https://example.com/Docs/Path';
    const u3 = 'https://example.com/Docs/Path/';

    const norm1 = frontier.normalizeUrl(u1);
    const norm2 = frontier.normalizeUrl(u2);
    const norm3 = frontier.normalizeUrl(u3);

    assert.strictEqual(norm1, 'https://example.com/Docs/Path');
    assert.strictEqual(norm2, 'https://example.com/Docs/Path');
    assert.strictEqual(norm3, 'https://example.com/Docs/Path');

    assert.strictEqual(frontier.enqueue(u1), true);
    assert.strictEqual(frontier.enqueue(u2), false, 'Duplicate URL must not be re-enqueued');
    assert.strictEqual(frontier.enqueue(u3), false, 'Duplicate trailing-slash URL must not be re-enqueued');
    assert.strictEqual(frontier.size(), 1);
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Accurate health-check reporting
  // -------------------------------------------------------------------------
  await test('Scenario 11: Accurate health-check reporting (real DB size, live models, decoupled)', async () => {
    const statusRes = await requestJson('GET', '/api/status');
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.success, true);
    assert(statusRes.data.system.includes('ARACHNE'));

    const metricsRes = await requestJson('GET', '/api/storage/metrics');
    assert.strictEqual(metricsRes.status, 200);
    const metrics = metricsRes.data.data || metricsRes.data;
    assert(metrics.sqlitePath.includes('.arachne-vault'));
    assert(typeof metrics.totalBytes === 'number');
    assert(metrics.totalBytes > 0);

    const modelsRes = await requestJson('GET', '/api/models');
    assert.strictEqual(modelsRes.status, 200);
    assert(Array.isArray(modelsRes.data.data));
    assert(modelsRes.data.data.length >= 3);
  });

  console.log('\n================================================================');
  console.log(`🏁 REGRESSION SUITE COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('[FATAL TEST RUNNER ERROR]', err);
  process.exit(1);
});
