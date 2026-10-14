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
    this.ensureDirectory(path.join(this.vaultDir, 'checkpoints'));

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
      version: '2.0.0',
      investigations: [],
      nodes: [],
      edges: [],
      corpus: [],
      reports: [],
      collections: [
        { id: 'col-default', name: 'General Intelligence', description: 'Default repository of verified web intelligence', count: 0, items: [], createdAt: new Date().toISOString() },
        { id: 'col-agents', name: 'Autonomous Agents', description: 'Computer-use agents, frameworks & benchmarks', count: 0, items: [], createdAt: new Date().toISOString() }
      ],
      bookmarks: [],
      approvals: [],
      savedQueries: [
        { id: 'sq-1', query: 'computer use agents', timestamp: new Date().toISOString() },
        { id: 'sq-2', query: 'openhands arxiv benchmark', timestamp: new Date().toISOString() }
      ],
      settings: {
        maxDepth: 3,
        maxUrlsPerInvestigation: 30,
        requestTimeoutMs: 10000,
        perDomainRateLimitMs: 800,
        respectRobotsTxt: true,
        safeMode: true,
        crawlScope: 'all', // 'all' | 'specified_only' | 'allow_block'
        allowlist: ['arxiv.org', 'github.com', 'huggingface.co', 'paperswithcode.com'],
        blocklist: ['login.*', 'accounts.*', 'ad.*'],
        activeModelProvider: 'qwen-local',
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: 'qwen2.5:latest',
        openaiApiKey: '',
        anthropicApiKey: '',
        telegramBotToken: '',
        telegramChatId: '',
        allowedTelegramUserIds: ['123456789', 'Deepak'],
        theme: 'dark-spider',
        accentColor: 'neon-violet'
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
    return this.state.investigations || [];
  }

  getInvestigation(id) {
    return (this.state.investigations || []).find(inv => inv.id === id) || null;
  }

  saveInvestigation(inv) {
    if (!this.state.investigations) this.state.investigations = [];
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

  // --- Approvals (Level 3 Human Intervention) ---
  getApprovals(status = null) {
    const list = this.state.approvals || [];
    return status ? list.filter(a => a.status === status) : list;
  }

  createApproval({ taskId, type, title, reason, options = ['approve', 'skip', 'cancel'], payload = {} }) {
    if (!this.state.approvals) this.state.approvals = [];
    const approval = {
      id: `appr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      taskId,
      type, // 'SCOPE_EXPANSION' | 'CAPTCHA_BLOCKED' | 'AUTHENTICATION_REQUIRED' | 'RATE_LIMIT_OVERRIDE'
      title,
      reason,
      options,
      payload,
      status: 'pending', // 'pending' | 'approved' | 'rejected' | 'skipped'
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionNote: null
    };
    this.state.approvals.unshift(approval);
    this.saveState();
    return approval;
  }

  resolveApproval(id, action, note = '') {
    if (!this.state.approvals) return null;
    const item = this.state.approvals.find(a => a.id === id);
    if (item) {
      item.status = action; // 'approved' | 'rejected' | 'skipped'
      item.resolvedAt = new Date().toISOString();
      item.resolutionNote = note;
      this.saveState();
      return item;
    }
    return null;
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
    if (!this.state.nodes) this.state.nodes = [];
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
    if (!this.state.edges) this.state.edges = [];
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
    if (!this.state.corpus) this.state.corpus = [];
    const idx = this.state.corpus.findIndex(d => d.id === doc.id || (doc.url && d.url === doc.url));

    const contentHash = doc.contentHash || crypto.createHash('sha256').update(doc.content || '').digest('hex');

    if (idx >= 0) {
      const existing = this.state.corpus[idx];
      // Check for substantive change (revision history)
      if (existing.contentHash && existing.contentHash !== contentHash) {
        if (!existing.revisions) existing.revisions = [];
        existing.revisions.unshift({
          timestamp: existing.crawledAt || existing.updatedAt || new Date().toISOString(),
          contentHash: existing.contentHash,
          title: existing.title,
          snippet: existing.snippet
        });
      }
      this.state.corpus[idx] = {
        ...existing,
        ...doc,
        contentHash,
        updatedAt: new Date().toISOString()
      };
      this.saveState();
      return this.state.corpus[idx];
    } else {
      const newDoc = {
        crawledAt: new Date().toISOString(),
        revisions: [],
        contentHash,
        ...doc
      };
      this.state.corpus.unshift(newDoc);
      this.saveState();
      return newDoc;
    }
  }

  searchCorpus(query, filters = {}) {
    const corpus = this.state.corpus || [];
    if (!query || !query.trim()) {
      let filtered = corpus;
      if (filters.domain) filtered = filtered.filter(d => (d.domain || '').toLowerCase().includes(filters.domain.toLowerCase()));
      if (filters.type) filtered = filtered.filter(d => d.type === filters.type);
      return filtered.slice(0, 50);
    }
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);

    let results = corpus.map(doc => {
      let score = 0;
      const title = (doc.title || '').toLowerCase();
      const content = (doc.content || '').toLowerCase();
      const url = (doc.url || '').toLowerCase();
      const snippet = (doc.snippet || '').toLowerCase();

      for (const w of words) {
        if (title.includes(w)) score += 12;
        if (url.includes(w)) score += 8;
        if (snippet.includes(w)) score += 5;
        if (content.includes(w)) score += 2;
      }

      if (filters.domain && !(doc.domain || '').toLowerCase().includes(filters.domain.toLowerCase())) return null;
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
    if (!this.state.reports) this.state.reports = [];
    const idx = this.state.reports.findIndex(r => r.id === report.id);
    if (idx >= 0) {
      this.state.reports[idx] = { ...this.state.reports[idx], ...report };
    } else {
      this.state.reports.unshift({
        createdAt: new Date().toISOString(),
        ...report
      });
    }

    // Save individual markdown copy to reports dir
    if (report.markdown) {
      const filePath = path.join(this.vaultDir, 'reports', `${report.id}.md`);
      try { fs.writeFileSync(filePath, report.markdown, 'utf8'); } catch {}
    }

    this.saveState();
    return report;
  }

  // --- Bookmarks & Collections ---
  toggleBookmark(item) {
    if (!this.state.bookmarks) this.state.bookmarks = [];
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

  getCollections() {
    return this.state.collections || [];
  }

  addToCollection(collectionId, item) {
    if (!this.state.collections) this.state.collections = [];
    const col = this.state.collections.find(c => c.id === collectionId);
    if (col) {
      if (!col.items) col.items = [];
      if (!col.items.some(i => i.url === item.url || i.id === item.id)) {
        col.items.push(item);
        col.count = col.items.length;
        this.saveState();
      }
      return col;
    }
    return null;
  }

  // --- Saved Searches ---
  saveQuery(query) {
    if (!query) return;
    if (!this.state.savedQueries) this.state.savedQueries = [];
    if (!this.state.savedQueries.some(q => q.query.toLowerCase() === query.toLowerCase())) {
      this.state.savedQueries.unshift({
        id: `sq-${Date.now()}`,
        query,
        timestamp: new Date().toISOString()
      });
      if (this.state.savedQueries.length > 20) this.state.savedQueries.pop();
      this.saveState();
    }
  }

  getSavedQueries() {
    return this.state.savedQueries || [];
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

  // --- Storage Metrics ---
  getStorageMetrics() {
    let totalBytes = 0;
    try {
      if (fs.existsSync(this.dbFile)) {
        totalBytes += fs.statSync(this.dbFile).size;
      }
      const reportsDir = path.join(this.vaultDir, 'reports');
      if (fs.existsSync(reportsDir)) {
        for (const file of fs.readdirSync(reportsDir)) {
          totalBytes += fs.statSync(path.join(reportsDir, file)).size;
        }
      }
    } catch {}

    return {
      vaultPath: this.vaultDir,
      totalBytes,
      totalMb: (totalBytes / (1024 * 1024)).toFixed(2),
      totalDocuments: (this.state.corpus || []).length,
      totalReports: (this.state.reports || []).length,
      totalNodes: (this.state.nodes || []).length,
      totalEdges: (this.state.edges || []).length,
      totalBookmarks: (this.state.bookmarks || []).length
    };
  }
}
