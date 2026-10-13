import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class VaultStore {
  constructor(baseDir = null) {
    this.vaultDir = baseDir || path.resolve(process.cwd(), '.arachne-vault');
    this.ensureDirectory(this.vaultDir);
    this.ensureDirectory(path.join(this.vaultDir, 'reports'));
    this.ensureDirectory(path.join(this.vaultDir, 'corpus'));
    this.ensureDirectory(path.join(this.vaultDir, 'collections'));

    this.dbFile = path.join(this.vaultDir, 'vault-db.json');
    this.state = this.loadState();
  }

  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getDefaultState() {
    return {
      version: '1.0.0',
      investigations: [],
      nodes: [],
      edges: [],
      corpus: [],
      reports: [],
      collections: [
        { id: 'col-default', name: 'General Intelligence', description: 'Default repository of verified web intelligence', count: 0, createdAt: new Date().toISOString() }
      ],
      bookmarks: [],
      settings: {
        maxDepth: 3,
        maxUrlsPerInvestigation: 30,
        requestTimeoutMs: 10000,
        perDomainRateLimitMs: 800,
        respectRobotsTxt: true,
        safeMode: true,
        activeModelProvider: 'qwen-local',
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: 'qwen2.5:latest',
        openaiApiKey: '',
        anthropicApiKey: '',
        telegramBotToken: '',
        telegramChatId: '',
        theme: 'void-arachnid'
      },
      telegramLogs: []
    };
  }

  loadState() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...this.getDefaultState(), ...parsed };
      }
    } catch (err) {
      console.error('[VaultStore] Failed to load state, initializing fresh store:', err.message);
    }
    const fresh = this.getDefaultState();
    this.saveState(fresh);
    return fresh;
  }

  saveState(state = null) {
    if (state) this.state = state;
    try {
      const tempPath = `${this.dbFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbFile);
    } catch (err) {
      console.error('[VaultStore] Error saving state:', err.message);
    }
  }

  // --- Investigations ---
  getInvestigations() {
    return this.state.investigations;
  }

  getInvestigation(id) {
    return this.state.investigations.find(inv => inv.id === id) || null;
  }

  saveInvestigation(inv) {
    const idx = this.state.investigations.findIndex(i => i.id === inv.id);
    if (idx >= 0) {
      this.state.investigations[idx] = { ...this.state.investigations[idx], ...inv, updatedAt: new Date().toISOString() };
    } else {
      this.state.investigations.unshift({
        id: inv.id || `inv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...inv
      });
    }
    this.saveState();
    return this.getInvestigation(inv.id);
  }

  // --- Graph ---
  getGraph() {
    return {
      nodes: this.state.nodes || [],
      edges: this.state.edges || []
    };
  }

  addNode(node) {
    if (!node.id) node.id = `node-${crypto.randomBytes(6).toString('hex')}`;
    const existing = this.state.nodes.find(n => n.id === node.id || (node.url && n.url === node.url));
    if (existing) {
      Object.assign(existing, node);
      return existing;
    }
    this.state.nodes.push({
      status: 'discovered',
      relevance: 0.5,
      createdAt: new Date().toISOString(),
      ...node
    });
    this.saveState();
    return node;
  }

  addEdge(edge) {
    if (!edge.id) edge.id = `edge-${edge.source}-${edge.target}-${edge.type || 'rel'}`;
    const existing = this.state.edges.find(e => e.id === edge.id);
    if (existing) return existing;
    this.state.edges.push({
      createdAt: new Date().toISOString(),
      ...edge
    });
    this.saveState();
    return edge;
  }

  clearGraph() {
    this.state.nodes = [];
    this.state.edges = [];
    this.saveState();
  }

  // --- Corpus & Search ---
  getCorpus() {
    return this.state.corpus || [];
  }

  addCorpusDocument(doc) {
    if (!doc.id) doc.id = `doc-${crypto.randomBytes(6).toString('hex')}`;
    const idx = this.state.corpus.findIndex(d => d.id === doc.id || (doc.url && d.url === doc.url));
    if (idx >= 0) {
      this.state.corpus[idx] = { ...this.state.corpus[idx], ...doc, updatedAt: new Date().toISOString() };
    } else {
      this.state.corpus.unshift({
        crawledAt: new Date().toISOString(),
        ...doc
      });
    }
    this.saveState();
    return doc;
  }

  searchCorpus(query, filters = {}) {
    if (!query || !query.trim()) {
      return this.state.corpus.slice(0, 50);
    }
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);

    let results = this.state.corpus.map(doc => {
      let score = 0;
      const title = (doc.title || '').toLowerCase();
      const content = (doc.content || '').toLowerCase();
      const url = (doc.url || '').toLowerCase();
      const snippet = (doc.snippet || '').toLowerCase();

      for (const w of words) {
        if (title.includes(w)) score += 10;
        if (url.includes(w)) score += 6;
        if (snippet.includes(w)) score += 4;
        if (content.includes(w)) score += 2;
      }

      if (filters.domain && doc.domain !== filters.domain) return null;
      if (filters.type && doc.type !== filters.type) return null;

      return score > 0 ? { ...doc, searchScore: score } : null;
    }).filter(Boolean);

    results.sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0));
    return results;
  }

  // --- Reports ---
  getReports() {
    return this.state.reports || [];
  }

  saveReport(report) {
    if (!report.id) report.id = `rep-${Date.now()}`;
    const idx = this.state.reports.findIndex(r => r.id === report.id);
    if (idx >= 0) {
      this.state.reports[idx] = { ...this.state.reports[idx], ...report };
    } else {
      this.state.reports.unshift({
        createdAt: new Date().toISOString(),
        ...report
      });
    }
    // Also save markdown file directly to disk in vault/reports/
    if (report.markdown) {
      const filePath = path.join(this.vaultDir, 'reports', `${report.id}.md`);
      fs.writeFileSync(filePath, report.markdown, 'utf8');
    }
    this.saveState();
    return report;
  }

  // --- Bookmarks & Collections ---
  toggleBookmark(item) {
    const idx = this.state.bookmarks.findIndex(b => b.id === item.id || b.url === item.url);
    if (idx >= 0) {
      this.state.bookmarks.splice(idx, 1);
      this.saveState();
      return { bookmarked: false };
    } else {
      this.state.bookmarks.unshift({ ...item, bookmarkedAt: new Date().toISOString() });
      this.saveState();
      return { bookmarked: true };
    }
  }

  getBookmarks() {
    return this.state.bookmarks || [];
  }

  // --- Settings ---
  getSettings() {
    return this.state.settings || this.getDefaultState().settings;
  }

  updateSettings(newSettings) {
    this.state.settings = { ...this.getSettings(), ...newSettings };
    this.saveState();
    return this.state.settings;
  }

  // --- Telegram ---
  logTelegram(entry) {
    if (!this.state.telegramLogs) this.state.telegramLogs = [];
    this.state.telegramLogs.unshift({
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (this.state.telegramLogs.length > 100) {
      this.state.telegramLogs.pop();
    }
    this.saveState();
  }

  getTelegramLogs() {
    return this.state.telegramLogs || [];
  }
}
