import http from 'node:http';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3003';

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    let payload = null;
    if (options.body) {
      payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      reqOptions.headers['Content-Type'] = reqOptions.headers['Content-Type'] || 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let body;
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(buffer.toString('utf8'));
          } catch {
            body = buffer.toString('utf8');
          }
        } else if (contentType.includes('text/') || contentType.includes('markdown')) {
          body = buffer.toString('utf8');
        } else {
          body = buffer; // binary
        }
        resolve({ status: res.statusCode, headers: res.headers, body, raw: buffer });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log('🕷️  ARACHNE FULL SUBSYSTEM VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log('✅ PASSED');
      passed++;
    } catch (err) {
      console.log('❌ FAILED');
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Health & Status
  await test('System status check (/api/status)', async () => {
    const res = await request('/api/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.metrics);
    assert.ok(res.body.metrics.totalNodes >= 0);
  });

  // 2. Native ARACHNE Protocol Root
  await test('ARACHNE Core protocol root check (GET / with JSON Accept)', async () => {
    const res = await request('/', { headers: { Accept: 'application/json' } });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.name.includes('ARACHNE'));
    assert.strictEqual(res.body.status, 'online');
    assert.strictEqual(res.body.mode, 'standalone-intelligence-core');
  });

  // 3. Strict SSRF Defense & Private Network Blocking
  await test('SSRF Defense: Block loopback IP (127.0.0.1)', async () => {
    const res = await request('/api/crawl/page', {
      method: 'POST',
      body: { url: 'http://127.0.0.1:8080/secret' }
    });
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.data.metadata.statusCode, 403);
  });

  await test('SSRF Defense: Block AWS/GCP cloud metadata (169.254.169.254)', async () => {
    const res = await request('/api/crawl/page', {
      method: 'POST',
      body: { url: 'http://169.254.169.254/latest/meta-data/' }
    });
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.data.metadata.statusCode, 403);
  });

  await test('SSRF Defense: Block private Class A subnet (10.0.0.1)', async () => {
    const res = await request('/api/crawl/page', {
      method: 'POST',
      body: { url: 'http://10.0.0.1/admin' }
    });
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.data.metadata.statusCode, 403);
  });

  // 4. Native Browser Detection & Management
  await test('Browser detection & profile discovery (/api/browser/status)', async () => {
    const res = await request('/api/browser/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.detected);
    assert.ok(res.body.data.detected.chrome.installed !== undefined);
    assert.ok(Array.isArray(res.body.data.detected.chrome.profiles));
    assert.ok(Array.isArray(res.body.data.detected.brave.profiles));
  });

  await test('Task tab cleanup without touching user tabs (/api/browser/tabs/close)', async () => {
    const res = await request('/api/browser/tabs/close', { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  // 5. Transactional SQLite Persistence & Storage Metrics
  await test('Transactional SQLite metrics in WAL mode (/api/storage/metrics)', async () => {
    const res = await request('/api/storage/metrics');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.totalBytes > 0);
    assert.ok(res.body.data.counts);
    assert.ok(res.body.data.counts.corpus_documents >= 0);
  });

  await test('SQLite backup snapshot download (/api/storage/export)', async () => {
    const res = await request('/api/storage/export');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/vnd.sqlite3');
    assert.ok(res.raw.length > 1000);
    // SQLite header magic check "SQLite format 3\0"
    const magic = res.raw.slice(0, 16).toString('utf8');
    assert.ok(magic.startsWith('SQLite format 3'), `Expected SQLite header, got ${magic}`);
  });

  // 6. Knowledge Graph & BFS Path Finding
  await test('Web Graph retrieval (/api/graph)', async () => {
    const res = await request('/api/graph');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.nodes));
    assert.ok(Array.isArray(res.body.data.edges));
  });

  await test('Knowledge Graph BFS Path Finding (/api/graph/path)', async () => {
    const res = await request('/api/graph/path?start=arxiv.org&end=github.com');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.path));
  });

  // 7. Model Router & Security Gate
  await test('Model Studio connection test (/api/models/test)', async () => {
    const res = await request('/api/models/test');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.provider);
    assert.strictEqual(typeof res.body.latencyMs, 'number');
  });

  await test('Groq Cloud High-Speed LPU ping test (/api/models/test?provider=groq)', async () => {
    const res = await request('/api/models/test?provider=groq');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.provider, 'Groq Cloud');
    assert.ok(res.body.latencyMs > 0, 'Measured Groq latency must be positive');
  });

  await test('OpenRouter Free Tier authentication test (/api/models/test?provider=openrouter)', async () => {
    const res = await request('/api/models/test?provider=openrouter');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.provider, 'OpenRouter Free Tier');
    assert.ok(res.body.latencyMs > 0, 'Measured OpenRouter latency must be positive');
  });

  // 8. Telegram Bot Gateway & Real API Handshake
  await test('Telegram Gateway status check (/api/telegram/status)', async () => {
    const res = await request('/api/telegram/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.botInfo?.username === 'Ikxros_bot' || res.body.data.botInfo?.username === 'arachnewi_bot' || res.body.data.maskedToken);
  });

  await test('Live Telegram Bot API handshake test (/api/telegram/test)', async () => {
    const settingsRes = await request('/api/settings');
    const token = settingsRes.body?.data?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
    const res = await request('/api/telegram/test', {
      method: 'POST',
      body: { token }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(['Ikxros_bot', 'arachnewi_bot'].includes(res.body.data.bot.username));
    assert.ok(res.body.data.latencyMs > 0, 'Measured roundtrip latency must be positive number');
  });

  await test('Telegram Bot remote status command (/api/telegram/exec)', async () => {
    const res = await request('/api/telegram/exec', {
      method: 'POST',
      body: { command: '/status', sender: 'TestRunner' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.response.includes('ARACHNE'));
  });

  await test('Telegram Bot findings inspection (/top5)', async () => {
    const res = await request('/api/telegram/exec', {
      method: 'POST',
      body: { command: '/top5', sender: 'TestRunner' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.response.length > 10);
  });

  // 6. Report Studio: Multi-Format Generation & Downloads (All 9 Formats)
  let testReportId = null;
  const allFormats = ['md', 'txt', 'html', 'csv', 'json', 'pdf', 'docx', 'xlsx', 'pptx'];

  await test('Report Generation in all 9 formats (/api/report/generate)', async () => {
    const res = await request('/api/report/generate', {
      method: 'POST',
      body: {
        title: 'Autonomous Research on Computer-Use Agents',
        objective: 'Evaluate open-source AI agent architectures',
        formats: allFormats
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    testReportId = res.body.data.id;
    assert.ok(testReportId);
    assert.ok(Array.isArray(res.body.data.formats));
    assert.strictEqual(res.body.data.formats.length, 9);
  });

  // Test downloading each of the 9 formats
  for (const fmt of allFormats) {
    await test(`Download report format: .${fmt.toUpperCase()}`, async () => {
      const res = await request(`/api/reports/${testReportId}/download?format=${fmt}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.raw.length > 20, `File length too small (${res.raw.length} bytes)`);

      if (fmt === 'pdf') {
        const magic = res.raw.slice(0, 5).toString('ascii');
        assert.ok(magic.startsWith('%PDF'), `Expected %PDF header, got ${magic}`);
      } else if (['docx', 'xlsx', 'pptx'].includes(fmt)) {
        // Must be valid PKZIP header
        const magic = res.raw.slice(0, 4);
        assert.strictEqual(magic[0], 0x50, 'PK header byte 0');
        assert.strictEqual(magic[1], 0x4b, 'PK header byte 1');
        assert.strictEqual(magic[2], 0x03, 'PK header byte 2');
        assert.strictEqual(magic[3], 0x04, 'PK header byte 3');
      } else if (fmt === 'json') {
        const parsed = JSON.parse(res.raw.toString('utf8'));
        assert.ok(parsed.title || parsed.sections);
      } else if (fmt === 'html') {
        const text = res.raw.toString('utf8');
        assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<html'));
      } else if (fmt === 'csv') {
        const text = res.raw.toString('utf8');
        assert.ok(text.includes(',') || text.includes('\n'));
      } else if (fmt === 'md') {
        const text = res.raw.toString('utf8');
        assert.ok(text.includes('# '));
      }
    });
  }

  // 7. Human-in-the-Loop Approval Queue (Level 3 Gate)
  await test('Approvals pending list check (/api/approvals/pending)', async () => {
    const res = await request('/api/approvals/pending');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
  });

  // 8. Corpus Full-Text Search
  await test('Corpus search & relevance ranking (/api/search)', async () => {
    const res = await request('/api/search?q=agents');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
  });

  // 9. Multi-Agent Swarm Orchestrator (agency-multi-agent-systems-architect)
  await test('Swarm Multi-Agent State check (/api/swarm)', async () => {
    const res = await request('/api/swarm');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.topology, 'Hierarchical Evaluator-Optimizer');
    assert.ok(Array.isArray(res.body.data.agents));
    assert.strictEqual(res.body.data.agents.length, 4);
    const roles = res.body.data.agents.map(a => a.id);
    assert.ok(roles.includes('agent-scout'));
    assert.ok(roles.includes('agent-analyst'));
    assert.ok(roles.includes('agent-verifier'));
    assert.ok(roles.includes('agent-synthesizer'));
  });

  // 10. Production RAG Hybrid Search (agency-rag-pipeline-engineer)
  await test('Hybrid RAG Semantic Retrieval (/api/rag/search?q=...)', async () => {
    const res = await request('/api/rag/search?q=autonomous%20agents&limit=5');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    if (res.body.data.length > 0) {
      const topChunk = res.body.data[0];
      assert.ok(topChunk.score !== undefined, 'Chunk must have hybrid score');
      assert.ok(topChunk.bm25Score !== undefined, 'Chunk must have BM25 score');
      assert.ok(topChunk.vectorScore !== undefined, 'Chunk must have Vector Cosine score');
    }
  });

  // 11. Production RAG Contradiction & Claim Analysis
  await test('RAG Cross-Source Contradiction Analysis (/api/rag/contradictions)', async () => {
    const res = await request('/api/rag/contradictions');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
  });

  // 12. Dynamic System Architecture Self-Introspection (understand skill)
  await test('Architecture Self-Introspection Graph (/api/system/architecture)', async () => {
    const res = await request('/api/system/architecture');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.components));
    assert.ok(Array.isArray(res.body.data.links));
    assert.ok(res.body.data.components.length >= 10);
    assert.ok(res.body.data.links.length >= 10);
  });

  console.log('\n================================================================');
  console.log(`🏁 VERIFICATION COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('\n💥 Unhandled verification exception:', err);
  process.exit(1);
});
