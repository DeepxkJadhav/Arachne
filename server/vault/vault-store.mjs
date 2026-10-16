import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SqliteStore } from './sqlite-store.mjs';

export class VaultStore {
  constructor(baseDir = null) {
    this.vaultDir = baseDir || path.resolve(process.cwd(), '.arachne-vault');
    this.ensureDirectory(this.vaultDir);
    this.ensureDirectory(path.join(this.vaultDir, 'reports'));
    this.ensureDirectory(path.join(this.vaultDir, 'corpus'));
    this.ensureDirectory(path.join(this.vaultDir, 'collections'));
    this.ensureDirectory(path.join(this.vaultDir, 'checkpoints'));
    this.ensureDirectory(path.join(this.vaultDir, 'content'));

    this.sqlite = new SqliteStore(this.vaultDir);
    this.sqliteStore = this.sqlite;
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
      settings: this.sqlite.getSettings(),
      telegramLogs: []
    };
  }

  loadState() {
    try {
      // Rehydrate state from SQLite
      const settings = this.sqlite.getSettings();
      const investigations = this.sqlite.getInvestigations();
      const graph = this.sqlite.getGraph();
      const corpus = this.sqlite.getCorpus();
      const reports = this.sqlite.getReports();
      const collections = this.sqlite.getCollections();
      const approvals = this.sqlite.getApprovals();
      const telegramLogs = this.sqlite.getTelegramLogs(50);

      const state = {
        ...this.getDefaultState(),
        settings,
        investigations,
        nodes: graph.nodes,
        edges: graph.edges,
        corpus,
        reports,
        collections: collections.length > 0 ? collections : this.getDefaultState().collections,
        approvals,
        telegramLogs
      };

      // Also read savedQueries and bookmarks from JSON if present
      if (fs.existsSync(this.dbFile)) {
        try {
          const raw = fs.readFileSync(this.dbFile, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.bookmarks)) state.bookmarks = parsed.bookmarks;
          if (Array.isArray(parsed.savedQueries)) state.savedQueries = parsed.savedQueries;
        } catch {}
      }

      return state;
    } catch (err) {
      console.error('[VaultStore] Error initializing state from SQLite:', err.message);
      return this.getDefaultState();
    }
  }

  saveState(state = null) {
    if (state) this.state = state;
    try {
      // Keep JSON export synced atomically for external tools/backups
      const tempPath = `${this.dbFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbFile);
    } catch (err) {
      console.error('[VaultStore] Error saving JSON backup:', err.message);
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
    const now = new Date().toISOString();

    let fullInv;
    if (idx >= 0) {
      this.state.investigations[idx] = { ...this.state.investigations[idx], ...inv, updatedAt: now };
      fullInv = this.state.investigations[idx];
    } else {
      fullInv = {
        id: inv.id || `inv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        createdAt: now,
        updatedAt: now,
        ...inv
      };
      this.state.investigations.unshift(fullInv);
    }

    // Persist to SQLite
    this.sqlite.saveInvestigation(fullInv);
    this.saveState();
    return fullInv;
  }

  // --- Checkpoints ---
  saveCheckpoint(invId, step, stateSnapshot) {
    return this.sqlite.saveCheckpoint(invId, step, stateSnapshot);
  }

  getLatestCheckpoint(invId) {
    return this.sqlite.getLatestCheckpoint(invId);
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
      investigationId: taskId,
      taskId,
      type,
      title,
      reason,
      options,
      payload,
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      note: null
    };
    this.state.approvals.unshift(approval);
    this.sqlite.saveApproval(approval);
    this.saveState();
    return approval;
  }

  resolveApproval(id, action, note = '') {
    if (!this.state.approvals) return null;
    const item = this.state.approvals.find(a => a.id === id);
    if (item) {
      item.status = action;
      item.resolvedAt = new Date().toISOString();
      item.note = note;
      item.resolutionNote = note;
      this.sqlite.resolveApproval(id, action, note);
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
      this.sqlite.saveGraphNode(existing);
      return existing;
    }
    const newNode = {
      status: 'discovered',
      relevance: 0.5,
      createdAt: new Date().toISOString(),
      ...node
    };
    this.state.nodes.push(newNode);
    this.sqlite.saveGraphNode(newNode);
    this.saveState();
    return newNode;
  }

  addEdge(edge) {
    if (!edge.id) edge.id = `edge-${edge.source}-${edge.target}-${edge.type || 'rel'}`;
    if (!this.state.edges) this.state.edges = [];
    const existing = this.state.edges.find(e => e.id === edge.id);
    if (existing) return existing;
    const newEdge = {
      createdAt: new Date().toISOString(),
      ...edge
    };
    this.state.edges.push(newEdge);
    this.sqlite.saveGraphEdge(newEdge);
    this.saveState();
    return newEdge;
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

    let finalDoc;
    if (idx >= 0) {
      const existing = this.state.corpus[idx];
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
      finalDoc = this.state.corpus[idx];
    } else {
      finalDoc = {
        crawledAt: new Date().toISOString(),
        revisions: [],
        contentHash,
        ...doc
      };
      this.state.corpus.unshift(finalDoc);
    }

    this.sqlite.saveCorpusDocument(finalDoc);
    this.saveState();
    return finalDoc;
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
    let fullReport;
    if (idx >= 0) {
      this.state.reports[idx] = { ...this.state.reports[idx], ...report };
      fullReport = this.state.reports[idx];
    } else {
      fullReport = {
        createdAt: new Date().toISOString(),
        ...report
      };
      this.state.reports.unshift(fullReport);
    }

    if (report.markdown) {
      const filePath = path.join(this.vaultDir, 'reports', `${report.id}.md`);
      try { fs.writeFileSync(filePath, report.markdown, 'utf8'); } catch {}
      fullReport.filePath = filePath;
    }

    this.sqlite.saveReport(fullReport);
    this.saveState();
    return fullReport;
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
        this.sqlite.saveCollection(col);
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
    return this.sqlite.getSettings();
  }

  updateSettings(newSettings) {
    this.sqlite.saveSettings(newSettings);
    this.state.settings = this.sqlite.getSettings();
    this.saveState();
    return this.state.settings;
  }

  // --- Telegram ---
  logTelegram(entry) {
    this.sqlite.logTelegram(entry);
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
    return this.sqlite.getTelegramLogs(50);
  }

  // --- Ignored Items ---
  addIgnoredItem(item) {
    return this.sqlite.addIgnoredItem(item);
  }

  getIgnoredItems(investigationId = null, limit = 50) {
    return this.sqlite.getIgnoredItems(investigationId, limit);
  }

  // --- Storage Metrics ---
  getStorageMetrics() {
    const sqliteMetrics = this.sqlite.getStorageMetrics();
    return {
      vaultPath: this.vaultDir,
      sqlitePath: sqliteMetrics.dbPath,
      mode: sqliteMetrics.journalMode || 'WAL',
      totalBytes: sqliteMetrics.dbSizeBytes,
      totalMb: sqliteMetrics.dbSizeMb,
      totalDocuments: (this.state.corpus || []).length,
      totalReports: (this.state.reports || []).length,
      totalNodes: (this.state.nodes || []).length,
      totalEdges: (this.state.edges || []).length,
      totalBookmarks: (this.state.bookmarks || []).length,
      counts: sqliteMetrics.counts,
      totalRecords: sqliteMetrics.totalRecords
    };
  }
}
