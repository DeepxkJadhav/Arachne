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

  // Seed default graph and findings if empty so user has immediate rich interactive content
  if (vaultStore.getCorpus().length === 0) {
    seedInitialDemoData(vaultStore, graphEngine);
  }

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

      // System Status
      if (pathname === '/api/status' && req.method === 'GET') {
        const inv = researchAgent.activeInvestigation;
        const graph = vaultStore.getGraph();
        const corpus = vaultStore.getCorpus();
        return sendJson({
          success: true,
          system: 'ARACHNE Web Intelligence Command Center',
          version: '2.0.0',
          activeInvestigation: inv,
          metrics: {
            totalNodes: graph.nodes.length,
            totalEdges: graph.edges.length,
            totalCorpusDocuments: corpus.length,
            totalReports: vaultStore.getReports().length
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

      // Web Graph
      if (pathname === '/api/graph' && req.method === 'GET') {
        const type = parsedUrl.searchParams.get('type') || null;
        const minRelevance = parsedUrl.searchParams.get('minRelevance') || null;
        const domain = parsedUrl.searchParams.get('domain') || null;
        const data = graphEngine.getGraphData({ type, minRelevance, domain });
        return sendJson({ success: true, data });
      }

      if (pathname.startsWith('/api/graph/neighborhood/') && req.method === 'GET') {
        const nodeId = pathname.replace('/api/graph/neighborhood/', '');
        const data = graphEngine.expandNeighborhood(nodeId, 1);
        return sendJson({ success: true, data });
      }

      // Search & Corpus
      if (pathname === '/api/search' && req.method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const domain = parsedUrl.searchParams.get('domain') || null;
        const type = parsedUrl.searchParams.get('type') || null;
        const results = vaultStore.searchCorpus(q, { domain, type });
        return sendJson({ success: true, data: results, count: results.length });
      }

      if (pathname === '/api/corpus' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getCorpus() });
      }

      // Reports
      if (pathname === '/api/reports' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getReports() });
      }

      if (pathname.startsWith('/api/reports/') && req.method === 'GET') {
        const reportId = pathname.replace('/api/reports/', '');
        const rep = vaultStore.getReports().find(r => r.id === reportId);
        if (!rep) return sendJson({ success: false, error: 'Report not found' }, 404);
        return sendJson({ success: true, data: rep });
      }

      // Model Studio & Connection Test
      if (pathname === '/api/models/test' && req.method === 'GET') {
        const provider = parsedUrl.searchParams.get('provider') || null;
        const testRes = await modelRouter.testConnection(provider);
        return sendJson(testRes);
      }

      // Telegram Remote Control
      if (pathname === '/api/telegram/exec' && req.method === 'POST') {
        const body = await readBody();
        const log = await telegramGateway.processCommand(body.command || '/status', body.sender || 'Web Console');
        return sendJson({ success: true, data: log });
      }

      if (pathname === '/api/telegram/logs' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getTelegramLogs() });
      }

      // Knowledge Vault Bookmarks
      if (pathname === '/api/vault/bookmarks' && req.method === 'GET') {
        return sendJson({ success: true, data: vaultStore.getBookmarks() });
      }

      if (pathname === '/api/vault/bookmark' && req.method === 'POST') {
        const body = await readBody();
        const resData = vaultStore.toggleBookmark(body);
        return sendJson({ success: true, data: resData });
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

      // Backwards-compatible /v1/scrape API endpoint
      if (pathname === '/v1/scrape' && req.method === 'POST') {
        const body = await readBody();
        const url = body.url;
        if (!url) return sendJson({ success: false, error: 'URL required' }, 400);

        const fetchRes = await researchAgent.fetcher.fetchUrl(url);
        const md = researchAgent.fetcher.htmlToCleanMarkdown(fetchRes.html, url);
        return sendJson({
          success: fetchRes.success,
          data: {
            markdown: md,
            html: fetchRes.html,
            metadata: { title: url, sourceURL: url, statusCode: fetchRes.status }
          }
        });
      }

      // Static UI Asset Serving
      let filePath = path.join(UI_DIR, pathname === '/' ? 'index.html' : pathname);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(UI_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
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

  server.listen(port, () => {
    console.log(`🕷️ ARACHNE Intelligence Server running at http://localhost:${port}`);
  });

  return { server, vaultStore, researchAgent, graphEngine, modelRouter, reportEngine, telegramGateway };
}

function seedInitialDemoData(vaultStore, graphEngine) {
  // Seed high-value initial intelligence items so the UI opens populated with real graph and corpus
  const initialDocs = [
    {
      url: 'https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo',
      title: 'Anthropic Computer Use Demo & OSWorld Implementation',
      domain: 'github.com',
      snippet: 'Reference implementation of Anthropic computer use agent enabling Claude to interact with GUI desktop environments.',
      content: '# Anthropic Computer Use\nReference implementation of Anthropic computer use agent enabling Claude to interact with GUI environments, executing mouse clicks, typing, and screenshot feedback loops.',
      status: 'processed',
      relevanceScore: 0.95,
      entities: ['Claude 3.5 Sonnet', 'OSWorld', 'Computer Use'],
      citations: ['arXiv:2404.07972'],
      crawledAt: new Date(Date.now() - 3600000).toISOString()
    },
    {
      url: 'https://github.com/browser-use/browser-use',
      title: 'Browser-Use: Autonomous Web Browser Agent for AI',
      domain: 'github.com',
      snippet: 'Open-source library to make websites accessible for AI agents through Playwright and visual element extraction.',
      content: '# Browser-Use\nMake websites accessible for AI agents. Open-source Python library integrating Playwright, vision models, and DOM element coordinates.',
      status: 'processed',
      relevanceScore: 0.92,
      entities: ['Browser-Use', 'Playwright', 'Python', 'Qwen 2.5'],
      citations: [],
      crawledAt: new Date(Date.now() - 7200000).toISOString()
    },
    {
      url: 'https://arxiv.org/abs/2410.08182',
      title: 'OSWorld: Benchmarking Multimodal Agents on Open-Ended Desktop Tasks',
      domain: 'arxiv.org',
      snippet: 'Comprehensive environment and benchmark for evaluating multimodal computer-use agents across real operating systems.',
      content: '# OSWorld Benchmark\nEvaluates multimodal computer agents across real operating system tasks including file management, office applications, and system settings.',
      status: 'processed',
      relevanceScore: 0.89,
      entities: ['OSWorld', 'Multimodal Agents'],
      citations: ['10.48550/arXiv.2410.08182'],
      crawledAt: new Date(Date.now() - 10800000).toISOString()
    }
  ];

  for (const doc of initialDocs) {
    vaultStore.addCorpusDocument(doc);
    graphEngine.ingestDocument({
      url: doc.url,
      title: doc.title,
      domain: doc.domain,
      text: doc.content,
      entities: doc.entities.map(e => ({ name: e, type: e.includes('Sonnet') || e.includes('Qwen') ? 'AI_Model' : 'Technology', confidence: 0.9 })),
      citations: doc.citations.map(c => ({ identifier: c, title: c, url: `https://doi.org/${c}`, type: 'Document' }))
    });
  }
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('arachne-server.mjs')) {
  createArachneServer(3003);
}
