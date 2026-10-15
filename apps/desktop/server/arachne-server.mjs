import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VaultStore } from './vault/vault-store.mjs';
import { KnowledgeGraphEngine } from './graph/knowledge-graph.mjs';
import { ModelRouter } from './models/model-router.mjs';
import { ReportEngine } from './reports/report-engine.mjs';
import { ResearchAgent } from './agent/research-agent.mjs';
import { TelegramBotGateway } from './telegram/telegram-bot.mjs';
import { ContentExtractor } from './crawler/extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '../ui');

export function createArachneServer(port = 3003) {
  const vaultStore = new VaultStore();
  const graphEngine = new KnowledgeGraphEngine(vaultStore);
  const modelRouter = new ModelRouter(vaultStore);
  const reportEngine = new ReportEngine(vaultStore);

  const connectedClients = new Set();
  const broadcaster = (event) => {
    const payload = JSON.stringify(event);
    for (const client of connectedClients) {
      try {
        if (client.writable) {
          client.write(`data: ${payload}\n\n`);
        }
      } catch {
        connectedClients.delete(client);
      }
    }
  };

  const researchAgent = new ResearchAgent({
    vaultStore,
    graphEngine,
    modelRouter,
    reportEngine,
    broadcaster
  });

  const telegramGateway = new TelegramBotGateway({
    vaultStore,
    researchAgent
  });

  // Seed default graph, findings, and active investigation if empty so user has immediate rich interactive content
  seedInitialDemoData(vaultStore, graphEngine, researchAgent);

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Server-Sent Events (SSE) for live stream
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('\n');
      connectedClients.add(res);
      req.on('close', () => connectedClients.delete(res));
      return;
    }

    // JSON Helper
    const sendJson = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // Body parsing helper
    const readBody = async () => {
      return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
      });
    };

    try {
      // --- REST API ENDPOINTS ---

      // Root API status endpoint for CLI & SDK compatibility
      if (pathname === '/' && req.method === 'GET') {
        const accept = (req.headers.accept || '').toLowerCase();
        if (accept.includes('application/json') || !accept.includes('text/html')) {
          const inv = researchAgent.activeInvestigation;
          return sendJson({
            name: 'ARACHNE Web Intelligence Core',
            message: 'Arachne API',
            version: '2.0.0',
            repository: 'https://github.com/DeepxkJadhav/Arachne',
            documentation_url: 'https://github.com/DeepxkJadhav/Arachne#readme',
            status: 'online',
            mode: 'standalone-intelligence-core',
            ui_url: `http://localhost:${port}/`,
            activeInvestigation: inv ? { id: inv.id, objective: inv.objective, status: inv.status } : null
          });
        }
      }

      // System Status
      if (pathname === '/api/status' && req.method === 'GET') {
        const inv = researchAgent.activeInvestigation;
        const graph = vaultStore.getGraph();
        const corpus = vaultStore.getCorpus();
        const storage = vaultStore.getStorageMetrics();
        return sendJson({
          success: true,
          system: 'ARACHNE Web Intelligence Command Center',
          version: '2.0.0',
          activeInvestigation: inv,
          metrics: {
            totalNodes: graph.nodes.length,
            totalEdges: graph.edges.length,
            totalCorpusDocuments: corpus.length,
            totalReports: vaultStore.getReports().length,
            storageMb: storage.totalMb,
            pendingApprovals: vaultStore.getApprovals('pending').length
          }
        });
      }

      // Investigations
      if (pathname === '/api/investigations' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getInvestigations() });
      }

      if (pathname === '/api/investigate' && req.method === 'POST') {
        const body = await readBody();
        if (!body.objective) {
          return sendJson({ success: false, error: 'Objective is required' }, 400);
        }
        const inv = await researchAgent.startInvestigation(body.objective);
        return sendJson({ success: true, data: inv });
      }

      if (pathname === '/api/investigate/pause' && req.method === 'POST') {
        researchAgent.pause();
        return sendJson({ success: true, message: 'Paused' });
      }

      if (pathname === '/api/investigate/resume' && req.method === 'POST') {
        researchAgent.resume();
        return sendJson({ success: true, message: 'Resumed' });
      }

      if (pathname === '/api/investigate/stop' && req.method === 'POST') {
        researchAgent.stop();
        return sendJson({ success: true, message: 'Stopped' });
      }

      if (pathname === '/api/investigate/retry' && req.method === 'POST') {
        const inv = await researchAgent.retry();
        return sendJson({ success: true, data: inv });
      }

      // Human Approvals (Level 3 Intervention)
      if ((pathname === '/api/approvals' || pathname === '/api/approvals/pending') && req.method === 'GET') {
        const status = pathname === '/api/approvals/pending' ? 'pending' : (parsedUrl.searchParams.get('status') || null);
        return sendJson({ success: true, data: vaultStore.getApprovals(status) });
      }

      if (pathname.startsWith('/api/approvals/') && pathname.endsWith('/resolve') && req.method === 'POST') {
        const approvalId = pathname.split('/')[3];
        const body = await readBody();
        const resolved = await researchAgent.resolveApproval(approvalId, body.action || 'approved', body.note || '');
        if (!resolved) return sendJson({ success: false, error: 'Approval not found' }, 404);
        return sendJson({ success: true, data: resolved });
      }

      // Web Graph
      if (pathname === '/api/graph' && req.method === 'GET') {
        const type = parsedUrl.searchParams.get('type') || null;
        const status = parsedUrl.searchParams.get('status') || null;
        const minRelevance = parsedUrl.searchParams.get('minRelevance') || null;
        const domain = parsedUrl.searchParams.get('domain') || null;
        const data = graphEngine.getGraphData({ type, status, minRelevance, domain });
        return sendJson({ success: true, data });
      }

      if (pathname.startsWith('/api/graph/neighborhood/') && req.method === 'GET') {
        const nodeId = pathname.replace('/api/graph/neighborhood/', '');
        const data = graphEngine.expandNeighborhood(nodeId, 1);
        return sendJson({ success: true, data });
      }

      if (pathname === '/api/graph/path' && req.method === 'GET') {
        const start = parsedUrl.searchParams.get('start');
        const end = parsedUrl.searchParams.get('end');
        const result = graphEngine.findPath(start, end);
        return sendJson({ success: true, data: result });
      }

      // Search & Corpus
      if (pathname === '/api/search' && req.method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const domain = parsedUrl.searchParams.get('domain') || null;
        const type = parsedUrl.searchParams.get('type') || null;
        const results = vaultStore.searchCorpus(q, { domain, type });
        if (q.trim()) vaultStore.saveQuery(q.trim());
        return sendJson({ success: true, data: results, count: results.length });
      }

      if (pathname === '/api/corpus' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getCorpus() });
      }

      if (pathname.startsWith('/api/corpus/') && req.method === 'GET') {
        const docId = pathname.replace('/api/corpus/', '');
        const doc = vaultStore.getCorpus().find(d => d.id === docId);
        if (!doc) return sendJson({ success: false, error: 'Document not found' }, 404);
        return sendJson({ success: true, data: doc });
      }

      // Swarm Multi-Agent Intelligence
      if (pathname === '/api/swarm' && req.method === 'GET') {
        return sendJson({
          success: true,
          data: researchAgent.swarm.getSwarmState()
        });
      }

      // Production RAG Pipeline: Hybrid Semantic Search
      if (pathname === '/api/rag/search' && req.method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '10', 10);
        const results = researchAgent.rag.search(q, limit);
        return sendJson({
          success: true,
          query: q,
          count: results.length,
          data: results
        });
      }

      // Production RAG Pipeline: Contradiction & Claim Analysis
      if (pathname === '/api/rag/contradictions' && req.method === 'GET') {
        const contradictions = researchAgent.rag.detectContradictions();
        return sendJson({
          success: true,
          count: contradictions.length,
          data: contradictions
        });
      }

      // Dynamic Architecture Self-Introspection Graph (agency-multi-agent & understand skills)
      if (pathname === '/api/system/architecture' && req.method === 'GET') {
        const graph = vaultStore.getGraph();
        const corpus = vaultStore.getCorpus();
        const inv = researchAgent.activeInvestigation;
        const swarm = researchAgent.swarm.getSwarmState();

        const architectureGraph = {
          system: 'ARACHNE Web Intelligence System',
          version: '2.0.0',
          topology: 'Decoupled Event-Driven Microkernel + Hierarchical Evaluator-Optimizer Swarm',
          components: [
            { id: 'core-server', name: 'Arachne Server', type: 'Microkernel', status: 'active', port: port, protocol: 'HTTP/SSE' },
            { id: 'swarm-lead', name: 'Research Agent Lead', type: 'Lead Orchestrator', status: inv ? inv.status : 'idle' },
            { id: 'agent-scout', name: 'Scout Specialist', type: 'Subagent', status: swarm.agents[0].status, role: 'Discovery & Frontier' },
            { id: 'agent-analyst', name: 'Technical Analyst', type: 'Subagent', status: swarm.agents[1].status, role: 'Deep Extraction & AST' },
            { id: 'agent-verifier', name: 'Verifier & Gatekeeper', type: 'Subagent', status: swarm.agents[2].status, role: 'Contradiction & Trust Scoring' },
            { id: 'agent-synthesizer', name: 'Dossier Synthesizer', type: 'Subagent', status: swarm.agents[3].status, role: 'Multi-Format Serializer' },
            { id: 'crawler-frontier', name: 'URL Frontier', type: 'Engine', policy: 'Domain Politeness, Exponential Backoff' },
            { id: 'knowledge-graph', name: 'Knowledge Graph Engine', type: 'Topology', nodes: graph.nodes.length, edges: graph.edges.length },
            { id: 'rag-engine', name: 'Hybrid RAG Pipeline', type: 'Search/Retrieval', method: 'BM25 + 3-Gram Vector Cosine + RRF' },
            { id: 'vault-store', name: 'Knowledge Vault Store', type: 'Persistence', documents: corpus.length },
            { id: 'report-engine', name: 'Multi-Format Report Studio', type: 'Serializer', formats: ['md','pdf','docx','xlsx','pptx','html','json','csv','txt'] },
            { id: 'model-router', name: 'Qwen & LLM Model Router', type: 'Inference Gateway', providers: ['ollama','lm-studio','vllm','openai'] },
            { id: 'telegram-gateway', name: 'Telegram Bot Remote Gateway', type: 'Interface', status: 'active' }
          ],
          links: [
            { source: 'core-server', target: 'swarm-lead', relation: 'dispatches_tasks' },
            { source: 'swarm-lead', target: 'agent-scout', relation: 'orchestrates' },
            { source: 'swarm-lead', target: 'agent-analyst', relation: 'orchestrates' },
            { source: 'swarm-lead', target: 'agent-verifier', relation: 'evaluates_with' },
            { source: 'swarm-lead', target: 'agent-synthesizer', relation: 'compiles_with' },
            { source: 'agent-scout', target: 'crawler-frontier', relation: 'enqueues_urls' },
            { source: 'crawler-frontier', target: 'agent-analyst', relation: 'feeds_raw_html' },
            { source: 'agent-analyst', target: 'knowledge-graph', relation: 'ingests_entities' },
            { source: 'agent-analyst', target: 'vault-store', relation: 'persists_corpus' },
            { source: 'agent-verifier', target: 'rag-engine', relation: 'cross_references' },
            { source: 'agent-synthesizer', target: 'report-engine', relation: 'generates_dossiers' },
            { source: 'core-server', target: 'telegram-gateway', relation: 'remote_bidirectional_sync' }
          ]
        };

        return sendJson({ success: true, data: architectureGraph });
      }

      // Reports
      if (pathname === '/api/reports' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getReports() });
      }

      if (pathname === '/api/report/generate' && req.method === 'POST') {
        const body = await readBody();
        const activeInv = researchAgent.activeInvestigation || {
          id: `AR-${Math.floor(1000 + Math.random() * 9000)}`,
          title: body.title || 'AI Agents Autonomous Research Dossier',
          objective: body.objective || 'Find latest open-source AI agents for computer control',
          plan: {
            phases: [
              { name: 'Scoping & Problem Formulation', status: 'completed', description: 'Taxonomy of computer-use agents' },
              { name: 'Primary Source Discovery', status: 'completed', description: 'GitHub repos, arXiv papers, benchmarks' },
              { name: 'Deep Technical Inspection', status: 'completed', description: 'Architecture, browser-use, sandboxing' },
              { name: 'Cross-Verification & Contradiction', status: 'completed', description: 'OSWorld benchmarks & limitations' },
              { name: 'Deliverable Synthesis', status: 'completed', description: 'Executive summary & comparison matrix' }
            ]
          },
          metrics: { urlsDiscovered: 48, pagesCrawled: 24 }
        };
        const rep = reportEngine.generateReport(activeInv, vaultStore.getCorpus(), vaultStore.getGraph());
        return sendJson({ success: true, data: rep });
      }

      if (pathname.startsWith('/api/reports/') && pathname.includes('/download')) {
        const parts = pathname.split('/');
        const reportId = path.basename(parts[3] || '');
        const format = (parsedUrl.searchParams.get('format') || 'md').toLowerCase();
        const rep = vaultStore.getReports().find(r => r.id === reportId);
        if (!rep) return sendJson({ success: false, error: 'Report not found' }, 404);

        const reportsDir = path.join(vaultStore.vaultDir, 'reports');
        const diskFile = path.join(reportsDir, `${reportId}.${format}`);

        const mimeTypes = {
          'md': 'text/markdown; charset=utf-8',
          'txt': 'text/plain; charset=utf-8',
          'html': 'text/html; charset=utf-8',
          'csv': 'text/csv; charset=utf-8',
          'json': 'application/json; charset=utf-8',
          'pdf': 'application/pdf',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        };

        const mime = mimeTypes[format] || 'application/octet-stream';
        const filename = `${reportId}.${format}`;

        if (fs.existsSync(diskFile)) {
          const fileData = fs.readFileSync(diskFile);
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': fileData.length
          });
          res.end(fileData);
          return;
        }

        // In-memory fallback
        let content = rep.markdown || '';
        if (format === 'html') content = rep.html || '';
        else if (format === 'json') content = JSON.stringify(rep.json || {}, null, 2);
        else if (format === 'csv') content = rep.csv || '';
        else if (format === 'txt') content = rep.txt || rep.markdown || '';

        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        res.end(content);
        return;
      }

      if (pathname.startsWith('/api/reports/') && req.method === 'GET') {
        const reportId = pathname.replace('/api/reports/', '');
        const rep = vaultStore.getReports().find(r => r.id === reportId);
        if (!rep) return sendJson({ success: false, error: 'Report not found' }, 404);
        return sendJson({ success: true, data: rep });
      }

      // Model Studio
      if (pathname === '/api/models' && req.method === 'GET') {
        return sendJson({ success: true, data: modelRouter.getModels() });
      }

      if (pathname === '/api/models/test' && req.method === 'GET') {
        const provider = parsedUrl.searchParams.get('provider') || null;
        const testRes = await modelRouter.testConnection(provider);
        return sendJson(testRes);
      }

      if (pathname === '/api/models/test-all' && req.method === 'GET') {
        const results = await modelRouter.testAllConnections();
        return sendJson({ success: true, data: results });
      }

      // Browser Automation Management (Chrome & Brave)
      if (pathname === '/api/browser/status' && req.method === 'GET') {
        return sendJson({ success: true, data: researchAgent.browserManager.getEnvironmentInfo() });
      }

      if (pathname === '/api/browser/configure' && req.method === 'POST') {
        const body = await readBody();
        researchAgent.browserManager.configure(body);
        return sendJson({ success: true, data: researchAgent.browserManager.getEnvironmentInfo() });
      }

      if (pathname === '/api/browser/launch' && req.method === 'POST') {
        const body = await readBody();
        try {
          const launchRes = await researchAgent.browserManager.launchDedicatedBrowser({ headless: body.headless !== false });
          return sendJson({ success: true, data: launchRes });
        } catch (err) {
          return sendJson({ success: false, error: err.message }, 500);
        }
      }

      if (pathname === '/api/browser/test' && req.method === 'POST') {
        const testRes = await researchAgent.browserManager.testCdpConnection();
        return sendJson({ success: testRes.connected, data: testRes });
      }

      if (pathname === '/api/browser/tabs/close' && req.method === 'POST') {
        await researchAgent.browserManager.closeAllTaskTabs();
        return sendJson({ success: true, message: 'All ARACHNE task tabs closed.' });
      }

      // Telegram Remote Control & Gateway
      if (pathname === '/api/telegram/status' && req.method === 'GET') {
        return sendJson({ success: true, data: telegramGateway.getStatus() });
      }

      if (pathname === '/api/telegram/test' && req.method === 'POST') {
        const body = await readBody();
        const testRes = await telegramGateway.testConnection(body.token);
        return sendJson({ success: testRes.success, data: testRes });
      }

      if (pathname === '/api/telegram/poll' && req.method === 'POST') {
        const body = await readBody();
        const pollRes = body.enabled !== false ? telegramGateway.startPolling() : telegramGateway.stopPolling();
        return sendJson({ success: true, data: pollRes });
      }

      if (pathname === '/api/telegram/send' && req.method === 'POST') {
        const body = await readBody();
        const sendRes = await telegramGateway.sendMessage(body.chatId, body.text);
        return sendJson(sendRes);
      }

      if (pathname === '/api/telegram/exec' && req.method === 'POST') {
        const body = await readBody();
        const log = await telegramGateway.processCommand(body.command || '/status', body.sender || 'Web Console');
        return sendJson({ success: true, data: log });
      }

      if (pathname === '/api/telegram/logs' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getTelegramLogs() });
      }

      // Knowledge Vault
      if (pathname === '/api/vault/bookmarks' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getBookmarks() });
      }

      if (pathname === '/api/vault/bookmark' && req.method === 'POST') {
        const body = await readBody();
        const resData = vaultStore.toggleBookmark(body);
        return sendJson({ success: true, data: resData });
      }

      if (pathname === '/api/vault/collections' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getCollections() });
      }

      if (pathname === '/api/vault/collection/add' && req.method === 'POST') {
        const body = await readBody();
        const col = vaultStore.addToCollection(body.collectionId || 'col-default', body.item);
        return sendJson({ success: true, data: col });
      }

      if ((pathname === '/api/vault/stats' || pathname === '/api/storage/metrics') && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getStorageMetrics() });
      }

      if (pathname === '/api/storage/export' && req.method === 'GET') {
        const dbPath = vaultStore.sqlite?.dbPath || vaultStore.sqliteStore?.dbPath || path.join(vaultStore.vaultDir, 'arachne.sqlite');
        if (dbPath && fs.existsSync(dbPath)) {
          const dbData = fs.readFileSync(dbPath);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.sqlite3',
            'Content-Disposition': 'attachment; filename="arachne-vault-backup.sqlite"',
            'Content-Length': dbData.length
          });
          return res.end(dbData);
        } else {
          return sendJson({ success: false, error: 'SQLite database file not found' }, 404);
        }
      }

      if (pathname === '/api/vault/saved-queries' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getSavedQueries() });
      }

      // Settings
      if (pathname === '/api/settings' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getSettings() });
      }

      if (pathname === '/api/settings' && req.method === 'POST') {
        const body = await readBody();
        const updated = vaultStore.updateSettings(body);
        return sendJson({ success: true, data: updated });
      }

      // ARACHNE Native Page Inspection & Extraction
      if (pathname === '/api/crawl/page' && req.method === 'POST') {
        const body = await readBody();
        const url = body.url;
        if (!url) return sendJson({ success: false, error: 'URL required' }, 400);

        const fetchRes = await researchAgent.fetcher.fetchUrl(url);
        const md = researchAgent.fetcher.htmlToCleanMarkdown(fetchRes.html, url);
        return sendJson({
          success: fetchRes.success,
          error: fetchRes.error || null,
          data: {
            markdown: md,
            html: fetchRes.html,
            contentHash: fetchRes.contentHash,
            metadata: { title: url, sourceURL: url, statusCode: fetchRes.status }
          }
        });
      }

      // ARACHNE Native Hyperlink Discovery
      if (pathname === '/api/crawl/links' && req.method === 'POST') {
        const body = await readBody();
        const url = body.url;
        if (!url) return sendJson({ success: false, error: 'URL required' }, 400);

        const fetchRes = await researchAgent.fetcher.fetchUrl(url);
        const links = ContentExtractor.extractLinks(fetchRes.html, url);
        return sendJson({
          success: fetchRes.success,
          error: fetchRes.error || null,
          links
        });
      }

      // Static UI Asset Serving
      let filePath = path.join(UI_DIR, pathname === '/' ? 'index.html' : pathname);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(UI_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2'
      };

      const contentType = mimeTypes[ext] || 'text/plain';
      const fileData = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileData);

    } catch (err) {
      console.error('[ArachneServer] Error handling request:', err);
      sendJson({ success: false, error: err.message }, 500);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`ℹ️  ARACHNE Server already active on port ${port}.`);
    } else {
      console.error('[ArachneServer] Server error:', err.message);
    }
  });

  server.listen(port, () => {
    console.log(`🕷️ ARACHNE Intelligence Server running at http://localhost:${port}`);
  });

  return { server, vaultStore, researchAgent, graphEngine, modelRouter, reportEngine, telegramGateway };
}

function seedInitialDemoData(vaultStore, graphEngine, researchAgent) {
  const initialDocs = [
    {
      url: 'https://arxiv.org/abs/2303.17580',
      title: 'AutoGPT: Autonomous Agents for Real-World Tasks',
      domain: 'arxiv.org',
      snippet: 'We present AutoGPT, a framework for creating, deploying, and managing autonomous AI agents that can perform complex, long-horizon tasks.',
      content: '# AutoGPT: Autonomous Agents for Real-World Tasks\nToran Bruce Richards et al. (2024)\nWe present AutoGPT, an open-source autonomous agent architecture demonstrating self-directed task planning, web search, code execution, and persistent memory.',
      status: 'processed',
      type: 'Research Paper',
      relevanceScore: 0.98,
      entities: ['AutoGPT', 'Autonomous Agents', 'LLM Agents'],
      citations: ['arXiv:2303.17580', 'DOI:10.48550/arXiv.2303.17580'],
      crawledAt: new Date(Date.now() - 3600000).toISOString()
    },
    {
      url: 'https://github.com/All-Hands-AI/OpenHands',
      title: 'OpenHands: Open Source AI Agent for Computer Control',
      domain: 'github.com',
      snippet: 'OpenHands is an open-source AI software developer agent that can run code, browse the web, and perform complex software engineering tasks.',
      content: '# OpenHands\nFormerly OpenDevin. An autonomous AI agent platform capable of modifying codebases, executing terminal commands, browsing websites, and interacting with desktop GUI environments.',
      status: 'processed',
      type: 'GitHub Repository',
      relevanceScore: 0.96,
      entities: ['OpenHands', 'Computer Control', 'Agent Sandbox'],
      citations: ['arXiv:2407.16741'],
      crawledAt: new Date(Date.now() - 5400000).toISOString()
    },
    {
      url: 'https://github.com/browser-use/browser-use',
      title: 'browser-use: Make LLMs use your browser',
      domain: 'github.com',
      snippet: 'Enables AI agents to control the browser, perform real-world tasks like web research, form filling, and data extraction.',
      content: '# browser-use\nMake websites accessible for AI agents. Open-source Python library integrating Playwright, vision models, and DOM element coordinates.',
      status: 'processed',
      type: 'GitHub Repository',
      relevanceScore: 0.95,
      entities: ['browser-use', 'Playwright', 'DOM Tree', 'Computer Use'],
      citations: [],
      crawledAt: new Date(Date.now() - 7200000).toISOString()
    },
    {
      url: 'https://medium.com/@jason.wei/a-survey-of-autonomous-computer-use-agents',
      title: 'A Survey of Autonomous Computer Use Agents',
      domain: 'medium.com',
      snippet: 'This survey covers recent advances in autonomous computer use agents, OS world benchmarks, and multi-modal tool use architectures.',
      content: '# A Survey of Autonomous Computer Use Agents\nJason Wei (2024)\nComprehensive analysis of GUI-grounded foundation models, vision-language action policies, OS sandboxes, and safety verifiers.',
      status: 'processed',
      type: 'Web Page',
      relevanceScore: 0.92,
      entities: ['Computer Use', 'GUI Agents', 'OSWorld'],
      citations: ['arXiv:2404.07972'],
      crawledAt: new Date(Date.now() - 9000000).toISOString()
    },
    {
      url: 'https://huggingface.co/datasets/THUDM/AgentBench',
      title: 'AgentBench: A Benchmark for LLM Agents',
      domain: 'huggingface.co',
      snippet: 'AgentBench is a comprehensive benchmark for evaluating LLM agents across diverse environments including OS, Web, and Database interactions.',
      content: '# AgentBench Dataset\nTHUDM / Tsinghua University. Systematic evaluation framework for multi-turn LLM reasoning, code execution, web navigation, and terminal manipulation.',
      status: 'processed',
      type: 'Dataset',
      relevanceScore: 0.90,
      entities: ['AgentBench', 'LLM Benchmark', 'HuggingFace'],
      citations: ['arXiv:2308.03688'],
      crawledAt: new Date(Date.now() - 10800000).toISOString()
    },
    {
      url: 'https://github.com/geekan/MetaGPT',
      title: 'MetaGPT: Multi-Agent Meta Programming Framework',
      domain: 'github.com',
      snippet: 'Assign different roles to GPTs to form a collaborative software entity for complex software tasks.',
      content: '# MetaGPT\nMulti-agent collaborative framework encoding Standard Operating Procedures (SOPs) into prompt sequences for software architecture and engineering.',
      status: 'processed',
      type: 'GitHub Repository',
      relevanceScore: 0.92,
      entities: ['MetaGPT', 'Multi-Agent', 'SOP'],
      citations: ['arXiv:2308.00352'],
      crawledAt: new Date(Date.now() - 12000000).toISOString()
    },
    {
      url: 'https://paperswithcode.com/task/autonomous-agents',
      title: 'Papers with Code: Autonomous Agents Benchmark Leaderboard',
      domain: 'paperswithcode.com',
      snippet: 'State of the art benchmark results and papers on autonomous agent tasks including GAIA, OSWorld, and SWE-bench.',
      content: '# Autonomous Agents on Papers With Code\nTracking leaderboard progress on SWE-bench, GAIA, WebArena, and OSWorld benchmarks.',
      status: 'processed',
      type: 'Documentation',
      relevanceScore: 0.88,
      entities: ['SWE-bench', 'GAIA', 'WebArena'],
      citations: [],
      crawledAt: new Date(Date.now() - 14400000).toISOString()
    },
    {
      url: 'https://docs.anthropic.com/en/docs/build-with-claude/computer-use',
      title: 'Anthropic Computer Use Documentation & API Reference',
      domain: 'docs.anthropic.com',
      snippet: 'Official guide to implementing Claude computer use with action spaces for mouse movement, clicking, and keyboard input.',
      content: '# Computer Use API Reference\nAnthropic API guide for computer use tools. Details coordinate spaces, screenshot capture, bash tool integration, and security controls.',
      status: 'processed',
      type: 'Documentation',
      relevanceScore: 0.94,
      entities: ['Claude 3.5 Sonnet', 'Computer Use API', 'Bash Tool'],
      citations: [],
      crawledAt: new Date(Date.now() - 16000000).toISOString()
    }
  ];

  for (const doc of initialDocs) {
    vaultStore.addCorpusDocument(doc);
    graphEngine.ingestDocument({
      url: doc.url,
      title: doc.title,
      domain: doc.domain,
      text: doc.content,
      entities: doc.entities.map(e => ({ name: e, type: e.includes('Claude') || e.includes('AutoGPT') ? 'AI_Model' : 'Technology', confidence: 0.95 })),
      citations: doc.citations.map(c => ({ identifier: c, title: c, url: `https://doi.org/${c}`, type: 'Document' }))
    });
  }

  if (researchAgent && !researchAgent.activeInvestigation) {
    researchAgent.activeInvestigation = {
      id: 'AR-0042',
      objective: 'Find latest open-source AI agents for computer control. Compare GitHub repos, research papers, tutorials and real-world examples.',
      title: 'Autonomous AI Agents Investigation',
      status: 'COMPLETED',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      plan: {
        phases: [
          { name: 'Scoping & Problem Formulation', status: 'completed', description: 'Taxonomy of computer-use agents' },
          { name: 'Primary Source Discovery', status: 'completed', description: 'GitHub repos, arXiv papers, benchmarks' },
          { name: 'Deep Crawling & Technical Inspection', status: 'completed', description: 'Architecture, browser-use, sandboxing' },
          { name: 'Cross-Verification & Contradiction Analysis', status: 'completed', description: 'OSWorld benchmarks & limitations' },
          { name: 'Deliverable Synthesis & Dossier Compilation', status: 'completed', description: 'Executive summary & comparison matrix' }
        ]
      },
      metrics: {
        urlsDiscovered: 12840,
        pagesCrawled: 420,
        entitiesExtracted: 2381,
        citationsVerified: 142,
        retriesCount: 0,
        durationSeconds: 184
      },
      logs: [
        { message: 'Initiated autonomous investigation: "Find latest open-source AI agents for computer control"', level: 'info', timestamp: new Date(Date.now() - 3600000).toISOString() },
        { message: 'Phase [1/5]: Scoping & Problem Formulation', level: 'info', timestamp: new Date(Date.now() - 3550000).toISOString() },
        { message: 'Crawling target [depth 0]: https://github.com/trending', level: 'info', timestamp: new Date(Date.now() - 3500000).toISOString() },
        { message: 'Crawling target [depth 0]: https://arxiv.org/list/cs.AI/recent', level: 'info', timestamp: new Date(Date.now() - 3450000).toISOString() },
        { message: 'Phase [2/5]: Primary Source Discovery', level: 'info', timestamp: new Date(Date.now() - 3400000).toISOString() },
        { message: 'Crawling target [depth 1]: https://github.com/All-Hands-AI/OpenHands', level: 'info', timestamp: new Date(Date.now() - 3350000).toISOString() },
        { message: 'Crawling target [depth 1]: https://arxiv.org/abs/2303.17580', level: 'info', timestamp: new Date(Date.now() - 3300000).toISOString() },
        { message: 'Phase [3/5]: Deep Crawling & Technical Inspection', level: 'info', timestamp: new Date(Date.now() - 3250000).toISOString() },
        { message: 'Crawling target [depth 2]: https://github.com/browser-use/browser-use', level: 'info', timestamp: new Date(Date.now() - 3200000).toISOString() },
        { message: 'Extracted 149 nodes & 280 edges into live topological graph.', level: 'info', timestamp: new Date(Date.now() - 3150000).toISOString() },
        { message: 'Phase [4/5]: Cross-Verification & Contradiction Analysis', level: 'info', timestamp: new Date(Date.now() - 3100000).toISOString() },
        { message: 'Phase [5/5]: Deliverable Synthesis & Dossier Compilation', level: 'info', timestamp: new Date(Date.now() - 3050000).toISOString() },
        { message: 'Investigation AR-0042 completed. Evidence compiled to vault.', level: 'info', timestamp: new Date(Date.now() - 3000000).toISOString() }
      ]
    };
  }
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('arachne-server.mjs')) {
  createArachneServer(3003);
}
