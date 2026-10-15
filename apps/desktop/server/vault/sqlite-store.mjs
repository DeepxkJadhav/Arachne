import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class SqliteStore {
  constructor(vaultDir = null) {
    this.vaultDir = vaultDir || path.resolve(process.cwd(), '.arachne-vault');
    this.ensureDirectory(this.vaultDir);

    this.contentDir = path.join(this.vaultDir, 'content');
    this.reportsDir = path.join(this.vaultDir, 'reports');
    this.checkpointsDir = path.join(this.vaultDir, 'checkpoints');
    this.ensureDirectory(this.contentDir);
    this.ensureDirectory(this.reportsDir);
    this.ensureDirectory(this.checkpointsDir);

    this.dbPath = path.join(this.vaultDir, 'arachne.sqlite');
    this.db = new DatabaseSync(this.dbPath);

    this.initDatabase();
    this.migrateFromJsonIfPresent();
    this.detectAndHandleCrashRecovery();
  }

  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  initDatabase() {
    // Enable WAL mode for high performance concurrent reading and writing
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS investigations (
        id TEXT PRIMARY KEY,
        title TEXT,
        objective TEXT,
        status TEXT,
        current_phase_index INTEGER DEFAULT 0,
        plan_json TEXT,
        metrics_json TEXT,
        summary TEXT,
        state_reason TEXT,
        findings_json TEXT,
        logs_json TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        investigation_id TEXT,
        step INTEGER,
        state_snapshot TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS corpus_documents (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE,
        title TEXT,
        content_hash TEXT,
        content_path TEXT,
        word_count INTEGER DEFAULT 0,
        language TEXT DEFAULT 'en',
        crawl_timestamp TEXT,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS evidence_records (
        id TEXT PRIMARY KEY,
        investigation_id TEXT,
        url TEXT,
        claim TEXT,
        excerpt TEXT,
        confidence REAL DEFAULT 0.9,
        corroboration_count INTEGER DEFAULT 1,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        investigation_id TEXT,
        title TEXT,
        type TEXT,
        target TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        resolved_by TEXT,
        note TEXT,
        created_at TEXT,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS telegram_logs (
        id TEXT PRIMARY KEY,
        direction TEXT,
        chat_id TEXT,
        sender TEXT,
        message_type TEXT,
        command TEXT,
        response TEXT,
        timestamp TEXT
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        label TEXT,
        type TEXT,
        relevance REAL DEFAULT 0.8,
        url TEXT,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        source TEXT,
        target TEXT,
        relationship TEXT,
        weight REAL DEFAULT 1.0
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        count INTEGER DEFAULT 0,
        items_json TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        title TEXT,
        url TEXT,
        tags_json TEXT,
        notes TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        investigation_id TEXT,
        title TEXT,
        format TEXT,
        file_path TEXT,
        summary TEXT,
        size_bytes INTEGER DEFAULT 0,
        created_at TEXT
      );
    `);
  }

  detectAndHandleCrashRecovery() {
    const activeStates = ['CRAWLING', 'DISCOVERING', 'PLANNING', 'ANALYZING', 'WAITING_FOR_USER'];
    const placeholders = activeStates.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT * FROM investigations WHERE status IN (${placeholders})`);
    const interrupted = stmt.all(...activeStates);

    if (interrupted.length > 0) {
      console.log(`[SqliteStore] Detected ${interrupted.length} interrupted investigation(s) from previous session.`);
      const updateStmt = this.db.prepare(`UPDATE investigations SET status = 'INTERRUPTED', state_reason = 'System restarted during active execution', updated_at = ? WHERE id = ?`);
      const now = new Date().toISOString();
      for (const row of interrupted) {
        updateStmt.run(now, row.id);
        console.log(`[SqliteStore] Investigation [${row.id}] marked as INTERRUPTED (recoverable via checkpoint).`);
      }
    }
  }

  migrateFromJsonIfPresent() {
    const jsonFile = path.join(this.vaultDir, 'vault-db.json');
    if (!fs.existsSync(jsonFile)) return;

    // Check if SQLite already has settings
    const checkStmt = this.db.prepare('SELECT COUNT(*) as count FROM settings');
    const row = checkStmt.get();
    if (row && row.count > 0) return; // Already migrated

    try {
      console.log('[SqliteStore] Migrating legacy vault-db.json to SQLite...');
      const raw = fs.readFileSync(jsonFile, 'utf8');
      const data = JSON.parse(raw);

      // Migrate settings
      if (data.settings) {
        for (const [k, v] of Object.entries(data.settings)) {
          this.setSetting(k, v);
        }
      }

      // Migrate investigations
      if (Array.isArray(data.investigations)) {
        for (const inv of data.investigations) {
          this.saveInvestigation(inv);
        }
      }

      // Migrate nodes & edges
      if (Array.isArray(data.nodes)) {
        for (const n of data.nodes) {
          this.saveGraphNode(n);
        }
      }
      if (Array.isArray(data.edges)) {
        for (const e of data.edges) {
          this.saveGraphEdge(e);
        }
      }

      // Migrate corpus
      if (Array.isArray(data.corpus)) {
        for (const doc of data.corpus) {
          this.saveCorpusDocument(doc);
        }
      }

      // Migrate reports
      if (Array.isArray(data.reports)) {
        for (const rep of data.reports) {
          this.saveReport(rep);
        }
      }

      // Migrate collections
      if (Array.isArray(data.collections)) {
        for (const col of data.collections) {
          this.saveCollection(col);
        }
      }

      // Migrate approvals
      if (Array.isArray(data.approvals)) {
        for (const app of data.approvals) {
          this.saveApproval(app);
        }
      }

      console.log('[SqliteStore] Migration from JSON completed successfully.');
    } catch (err) {
      console.error('[SqliteStore] Failed to migrate JSON to SQLite:', err.message);
    }
  }

  // --- Content Storage (SHA-256 Addressed) ---
  saveContent(text) {
    if (!text) return { hash: null, path: null };
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const filePath = path.join(this.contentDir, `${hash}.txt`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, text, 'utf8');
    }
    return { hash, path: filePath };
  }

  readContentByHash(hash) {
    if (!hash) return '';
    const filePath = path.join(this.contentDir, `${hash}.txt`);
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch {
        return '';
      }
    }
    return '';
  }

  // --- Settings ---
  getSettings() {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all();
    const settings = {
      maxDepth: 3,
      maxUrlsPerInvestigation: 30,
      requestTimeoutMs: 10000,
      perDomainRateLimitMs: 800,
      respectRobotsTxt: true,
      safeMode: true,
      crawlScope: 'all',
      allowlist: ['arxiv.org', 'github.com', 'huggingface.co', 'paperswithcode.com'],
      blocklist: ['login.*', 'accounts.*', 'ad.*'],
      activeModelProvider: 'qwen-local',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'qwen2.5:latest',
      openaiApiKey: '',
      anthropicApiKey: '',
      telegramBotToken: '8732300173:AAGj-fOkujR5PktCNVt3E2OQkr3vyDy71Wo',
      telegramChatId: '',
      allowedTelegramUserIds: ['123456789'],
      theme: 'dark-spider',
      accentColor: 'neon-violet'
    };

    for (const r of rows) {
      try {
        settings[r.key] = JSON.parse(r.value);
      } catch {
        settings[r.key] = r.value;
      }
    }

    return settings;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    stmt.run(key, valStr, new Date().toISOString());
  }

  saveSettings(newSettings) {
    for (const [k, v] of Object.entries(newSettings)) {
      this.setSetting(k, v);
    }
  }

  // --- Investigations ---
  getInvestigations() {
    const stmt = this.db.prepare('SELECT * FROM investigations ORDER BY created_at DESC');
    const rows = stmt.all();
    return rows.map(r => this.deserializeInvestigation(r));
  }

  getInvestigation(id) {
    const stmt = this.db.prepare('SELECT * FROM investigations WHERE id = ?');
    const r = stmt.get(id);
    return r ? this.deserializeInvestigation(r) : null;
  }

  saveInvestigation(inv) {
    if (!inv || !inv.id) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO investigations (
        id, title, objective, status, current_phase_index, plan_json, metrics_json, summary, state_reason, findings_json, logs_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        objective = excluded.objective,
        status = excluded.status,
        current_phase_index = excluded.current_phase_index,
        plan_json = excluded.plan_json,
        metrics_json = excluded.metrics_json,
        summary = excluded.summary,
        state_reason = excluded.state_reason,
        findings_json = excluded.findings_json,
        logs_json = excluded.logs_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      inv.id,
      inv.title || inv.objective?.slice(0, 60) || 'Untitled',
      inv.objective || '',
      inv.status || 'QUEUED',
      inv.currentPhaseIndex || 0,
      JSON.stringify(inv.plan || {}),
      JSON.stringify(inv.metrics || {}),
      inv.summary || '',
      inv.stateReason || '',
      JSON.stringify(inv.recentFindings || []),
      JSON.stringify(inv.logs || []),
      inv.createdAt || now,
      now
    );
  }

  deserializeInvestigation(row) {
    return {
      id: row.id,
      title: row.title,
      objective: row.objective,
      status: row.status,
      currentPhaseIndex: row.current_phase_index,
      plan: row.plan_json ? JSON.parse(row.plan_json) : null,
      metrics: row.metrics_json ? JSON.parse(row.metrics_json) : {},
      summary: row.summary,
      stateReason: row.state_reason,
      recentFindings: row.findings_json ? JSON.parse(row.findings_json) : [],
      logs: row.logs_json ? JSON.parse(row.logs_json) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // --- Checkpoints ---
  saveCheckpoint(invId, step, stateSnapshot) {
    const id = `cp-${invId}-${step}-${Date.now()}`;
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, investigation_id, step, state_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, invId, step, JSON.stringify(stateSnapshot), new Date().toISOString());
    return id;
  }

  getLatestCheckpoint(invId) {
    const stmt = this.db.prepare(`
      SELECT * FROM checkpoints WHERE investigation_id = ? ORDER BY step DESC, created_at DESC LIMIT 1
    `);
    const row = stmt.get(invId);
    if (!row) return null;
    return {
      id: row.id,
      investigationId: row.investigation_id,
      step: row.step,
      stateSnapshot: JSON.parse(row.state_snapshot),
      createdAt: row.created_at
    };
  }

  // --- Corpus Documents ---
  saveCorpusDocument(doc) {
    if (!doc || !doc.url) return null;
    const id = doc.id || `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // Store large content in filesystem addressed by SHA-256
    let contentHash = doc.contentHash;
    let contentPath = doc.contentPath;
    if (doc.content && !contentHash) {
      const stored = this.saveContent(doc.content);
      contentHash = stored.hash;
      contentPath = stored.path;
    }

    const stmt = this.db.prepare(`
      INSERT INTO corpus_documents (
        id, url, title, content_hash, content_path, word_count, language, crawl_timestamp, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        content_hash = excluded.content_hash,
        content_path = excluded.content_path,
        word_count = excluded.word_count,
        language = excluded.language,
        crawl_timestamp = excluded.crawl_timestamp,
        metadata_json = excluded.metadata_json
    `);

    stmt.run(
      id,
      doc.url,
      doc.title || doc.url,
      contentHash || null,
      contentPath || null,
      doc.wordCount || 0,
      doc.language || 'en',
      doc.crawlTimestamp || doc.timestamp || now,
      JSON.stringify(doc.metadata || {})
    );

    return id;
  }

  getCorpus() {
    const stmt = this.db.prepare('SELECT * FROM corpus_documents ORDER BY crawl_timestamp DESC');
    const rows = stmt.all();
    return rows.map(r => ({
      id: r.id,
      url: r.url,
      title: r.title,
      contentHash: r.content_hash,
      contentPath: r.content_path,
      wordCount: r.word_count,
      language: r.language,
      crawlTimestamp: r.crawl_timestamp,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
      content: this.readContentByHash(r.content_hash)
    }));
  }

  // --- Knowledge Graph Nodes & Edges ---
  saveGraphNode(node) {
    if (!node || !node.id) return;
    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (id, label, type, relevance, url, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        type = excluded.type,
        relevance = excluded.relevance,
        url = excluded.url,
        metadata_json = excluded.metadata_json
    `);
    stmt.run(
      node.id,
      node.label || node.id,
      node.type || 'Web Page',
      node.relevance || 0.8,
      node.url || '',
      JSON.stringify(node.metadata || {})
    );
  }

  saveGraphEdge(edge) {
    if (!edge || !edge.source || !edge.target) return;
    const id = edge.id || `edge-${edge.source}-${edge.target}`;
    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (id, source, target, relationship, weight)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        relationship = excluded.relationship,
        weight = excluded.weight
    `);
    stmt.run(id, edge.source, edge.target, edge.relationship || 'connects_to', edge.weight || 1.0);
  }

  getGraph() {
    const nodeRows = this.db.prepare('SELECT * FROM graph_nodes').all();
    const edgeRows = this.db.prepare('SELECT * FROM graph_edges').all();

    return {
      nodes: nodeRows.map(r => ({
        id: r.id,
        label: r.label,
        type: r.type,
        relevance: r.relevance,
        url: r.url,
        metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {}
      })),
      edges: edgeRows.map(r => ({
        id: r.id,
        source: r.source,
        target: r.target,
        relationship: r.relationship,
        weight: r.weight
      }))
    };
  }

  // --- Approvals ---
  saveApproval(app) {
    if (!app || !app.id) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO approvals (
        id, investigation_id, title, type, target, reason, status, resolved_by, note, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        resolved_by = excluded.resolved_by,
        note = excluded.note,
        resolved_at = excluded.resolved_at
    `);
    stmt.run(
      app.id,
      app.investigationId || null,
      app.title || 'Human Approval Required',
      app.type || 'permission',
      app.target || '',
      app.reason || '',
      app.status || 'pending',
      app.resolvedBy || null,
      app.note || null,
      app.createdAt || now,
      app.resolvedAt || null
    );
  }

  getApprovals(status = null) {
    let stmt;
    if (status) {
      stmt = this.db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC');
      return stmt.all(status);
    } else {
      stmt = this.db.prepare('SELECT * FROM approvals ORDER BY created_at DESC');
      return stmt.all();
    }
  }

  resolveApproval(approvalId, action, note = '', resolvedBy = 'Operator') {
    const stmt = this.db.prepare(`
      UPDATE approvals
      SET status = ?, note = ?, resolved_by = ?, resolved_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();
    const res = stmt.run(action, note, resolvedBy, now, approvalId);
    if (res.changes > 0) {
      return this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
    }
    return null;
  }

  // --- Reports ---
  saveReport(report) {
    if (!report || !report.id) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO reports (id, investigation_id, title, format, file_path, summary, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        file_path = excluded.file_path,
        summary = excluded.summary,
        size_bytes = excluded.size_bytes
    `);
    stmt.run(
      report.id,
      report.investigationId || null,
      report.title || 'ARACHNE Research Dossier',
      report.format || 'markdown',
      report.filePath || '',
      report.summary || '',
      report.sizeBytes || 0,
      report.createdAt || now
    );
  }

  getReports() {
    const stmt = this.db.prepare('SELECT * FROM reports ORDER BY created_at DESC');
    return stmt.all();
  }

  getReport(id) {
    // Path traversal defense: sanitize id
    const cleanId = path.basename(id);
    const stmt = this.db.prepare('SELECT * FROM reports WHERE id = ?');
    return stmt.get(cleanId);
  }

  // --- Collections ---
  saveCollection(col) {
    if (!col || !col.id) return;
    const stmt = this.db.prepare(`
      INSERT INTO collections (id, name, description, count, items_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        count = excluded.count,
        items_json = excluded.items_json
    `);
    stmt.run(
      col.id,
      col.name,
      col.description || '',
      col.count || 0,
      JSON.stringify(col.items || []),
      col.createdAt || new Date().toISOString()
    );
  }

  getCollections() {
    const stmt = this.db.prepare('SELECT * FROM collections ORDER BY created_at DESC');
    const rows = stmt.all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      count: r.count,
      items: r.items_json ? JSON.parse(r.items_json) : [],
      createdAt: r.created_at
    }));
  }

  // --- Telegram Logs ---
  logTelegram(entry) {
    const id = `tg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const stmt = this.db.prepare(`
      INSERT INTO telegram_logs (id, direction, chat_id, sender, message_type, command, response, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      entry.direction || 'inbound',
      String(entry.chatId || ''),
      String(entry.sender || 'Operator'),
      entry.messageType || 'command',
      entry.command || '',
      entry.response || '',
      entry.timestamp || new Date().toISOString()
    );
  }

  getTelegramLogs(limit = 50) {
    const stmt = this.db.prepare('SELECT * FROM telegram_logs ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit);
  }

  // --- Metrics ---
  getStorageMetrics() {
    const tables = [
      'investigations', 'checkpoints', 'corpus_documents',
      'evidence_records', 'approvals', 'settings',
      'telegram_logs', 'graph_nodes', 'graph_edges', 'reports', 'collections'
    ];
    const counts = {};
    for (const t of tables) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${t}`).get();
        counts[t] = row?.count || 0;
      } catch {
        counts[t] = 0;
      }
    }

    let dbSizeBytes = 0;
    if (fs.existsSync(this.dbPath)) {
      try {
        dbSizeBytes = fs.statSync(this.dbPath).size;
      } catch {}
    }

    return {
      dbPath: this.dbPath,
      dbSizeBytes,
      dbSizeMb: (dbSizeBytes / (1024 * 1024)).toFixed(2),
      counts,
      totalRecords: Object.values(counts).reduce((a, b) => a + b, 0)
    };
  }

  close() {
    try {
      this.db.close();
    } catch {}
  }
}
