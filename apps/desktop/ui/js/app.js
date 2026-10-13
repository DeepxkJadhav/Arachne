// ARACHNE Web Intelligence & Desktop Client Controller
(function() {
  const API_BASE = window.location.origin;

  const state = {
    currentView: 'dashboard',
    activeInvestigation: null,
    graph: { nodes: [], edges: [] },
    corpus: [],
    reports: [],
    bookmarks: [],
    settings: {},
    selectedNode: null,
    activeReport: null
  };

  // --- Initial Bootstrap ---
  window.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSSE();
    initCanvases();
    initEventHandlers();
    refreshAllData();
  });

  // --- Navigation Router ---
  function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const targetView = item.getAttribute('data-view');
        switchView(targetView);
      });
    });

    document.getElementById('btn-expand-graph')?.addEventListener('click', () => {
      switchView('graph');
    });
  }

  function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === viewName);
    });
    document.querySelectorAll('.screen-view').forEach(el => {
      el.classList.toggle('active', el.id === `view-${viewName}`);
    });

    const titles = {
      dashboard: 'Command Center & Live Investigation',
      graph: 'Interactive Web Graph & Entity Topology',
      search: 'Corpus Search & Extracted Evidence',
      reports: 'Report Studio & Intelligence Dossiers',
      models: 'Model Studio & Inference Router',
      telegram: 'Telegram Remote Control',
      vault: 'Knowledge Vault & Provenance',
      settings: 'Crawler Budget & Policies'
    };
    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.textContent = titles[viewName] || 'Command Center';

    if (viewName === 'graph') {
      resizeCanvas('graph-canvas');
      renderGraph('graph-canvas');
    } else if (viewName === 'dashboard') {
      resizeCanvas('topology-canvas');
      renderGraph('topology-canvas');
    }
  }

  // --- Server-Sent Events (SSE) Stream ---
  function initSSE() {
    const sse = new EventSource(`${API_BASE}/api/events`);

    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        handleStreamEvent(event);
      } catch (err) {
        console.error('SSE Parse Error:', err);
      }
    };

    sse.onerror = () => {
      console.warn('SSE stream disconnected, reconnecting...');
    };
  }

  function handleStreamEvent(event) {
    const { type, payload } = event;

    if (type === 'log') {
      appendLog(payload.message, payload.level, payload.timestamp);
    } else if (type === 'metrics_tick') {
      updateMetricsUI(payload);
    } else if (type === 'investigation_started' || type === 'investigation_updated') {
      state.activeInvestigation = payload;
      renderInvestigationState(payload);
    } else if (type === 'investigation_completed') {
      state.activeInvestigation = payload.investigation;
      renderInvestigationState(payload.investigation);
      appendLog('Investigation dossier ready for review!', 'info');
      fetchReports();
    } else if (type === 'finding_added') {
      appendFinding(payload);
    } else if (type === 'graph_updated') {
      state.graph = payload;
      updateBadges();
      renderGraph(state.currentView === 'graph' ? 'graph-canvas' : 'topology-canvas');
    }
  }

  // --- Logging Terminal ---
  function appendLog(message, level = 'info', timestamp = null) {
    const terminal = document.getElementById('log-terminal');
    if (!terminal) return;

    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = `log-entry ${level}`;
    row.innerHTML = `<span class="time">[${timeStr}]</span> <span class="msg">${escapeHtml(message)}</span>`;
    terminal.appendChild(row);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function appendFinding(finding) {
    const container = document.getElementById('findings-container');
    if (!container) return;

    const card = document.createElement('div');
    card.style.background = 'var(--bg-surface-2)';
    card.style.padding = '10px 12px';
    card.style.borderRadius = '6px';
    card.style.border = '1px solid var(--border-subtle)';

    card.innerHTML = `
      <div style="font-weight: 600; font-size: 0.85rem; color: #fff;">${escapeHtml(finding.title)}</div>
      <div style="font-size: 0.75rem; color: var(--text-muted); margin: 4px 0;">${escapeHtml(finding.snippet)}</div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        ${(finding.entities || []).map(e => `<span class="nav-badge" style="font-size: 0.68rem;">${escapeHtml(e)}</span>`).join('')}
      </div>
    `;
    container.insertBefore(card, container.firstChild);
    if (container.children.length > 8) container.removeChild(container.lastChild);
  }

  // --- Canvas Force-Directed Graph Visualizer ---
  let graphNodes = [];
  let graphEdges = [];
  let graphTransform = { x: 0, y: 0, scale: 1 };
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  function initCanvases() {
    ['topology-canvas', 'graph-canvas'].forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas) return;

      canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStart = { x: e.clientX - graphTransform.x, y: e.clientY - graphTransform.y };
      });
      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        graphTransform.x = e.clientX - dragStart.x;
        graphTransform.y = e.clientY - dragStart.y;
        renderGraph(id);
      });
      window.addEventListener('mouseup', () => isDragging = false);

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoom = e.deltaY < 0 ? 1.1 : 0.9;
        graphTransform.scale = Math.max(0.3, Math.min(3, graphTransform.scale * zoom));
        renderGraph(id);
      });

      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left - graphTransform.x) / graphTransform.scale;
        const clickY = (e.clientY - rect.top - graphTransform.y) / graphTransform.scale;

        // Check if clicked any node
        for (const n of graphNodes) {
          const dx = n.x - clickX;
          const dy = n.y - clickY;
          if (Math.sqrt(dx*dx + dy*dy) <= n.radius) {
            handleNodeClick(n);
            break;
          }
        }
      });
    });

    window.addEventListener('resize', () => {
      resizeCanvas('topology-canvas');
      resizeCanvas('graph-canvas');
      renderGraph('topology-canvas');
      renderGraph('graph-canvas');
    });
  }

  function resizeCanvas(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }

  function handleNodeClick(node) {
    state.selectedNode = node;
    const drawer = document.getElementById('node-details-drawer');
    if (!drawer) return;

    drawer.style.display = 'block';
    document.getElementById('detail-node-type').textContent = node.type;
    document.getElementById('detail-node-label').textContent = node.label;
    document.getElementById('detail-node-url').textContent = node.url || 'Inferred Topological Node';
  }

  function renderGraph(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(graphTransform.x, graphTransform.y);
    ctx.scale(graphTransform.scale, graphTransform.scale);

    const nodes = state.graph.nodes || [];
    const edges = state.graph.edges || [];

    // Layout positions deterministically
    const centerX = width / 2;
    const centerY = height / 2;
    const nodeMap = new Map();

    nodes.forEach((n, idx) => {
      const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2;
      const dist = 60 + (idx % 3) * 60;
      const x = centerX + Math.cos(angle) * dist;
      const y = centerY + Math.sin(angle) * dist;
      const radius = n.type === 'Domain' ? 12 : n.type === 'AI_Model' ? 10 : 8;
      nodeMap.set(n.id, { ...n, x, y, radius });
    });
    graphNodes = Array.from(nodeMap.values());

    // Draw Edges (Spiderweb Geometry)
    edges.forEach(e => {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (src && tgt) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = 'rgba(157, 78, 221, 0.25)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    });

    // Draw Nodes
    const colors = {
      Domain: '#f72585',
      Page: '#9d4edd',
      AI_Model: '#4cc9f0',
      Repository: '#ff0054',
      Document: '#10b981',
      Technology: '#a855f7',
      Entity: '#cbd5e1'
    };

    graphNodes.forEach(n => {
      const col = colors[n.type] || '#9d4edd';

      // Glow
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.fillStyle = '#f8fafc';
      ctx.font = '9px var(--font-sans)';
      ctx.textAlign = 'center';
      ctx.fillText(n.label.slice(0, 16), n.x, n.y + n.radius + 12);
    });

    ctx.restore();
  }

  // --- UI Event Handlers ---
  function initEventHandlers() {
    // Dispatch Investigation
    document.getElementById('btn-dispatch-investigation')?.addEventListener('click', () => {
      const input = document.getElementById('input-objective');
      const obj = input.value.trim();
      if (obj) triggerInvestigation(obj);
    });

    // Sample Chips
    document.querySelectorAll('.chip-sample').forEach(chip => {
      chip.addEventListener('click', () => {
        const sample = chip.getAttribute('data-sample');
        const input = document.getElementById('input-objective');
        if (input) input.value = sample;
        triggerInvestigation(sample);
      });
    });

    // Investigation Controls
    document.getElementById('btn-ctrl-pause')?.addEventListener('click', () => {
      fetch(`${API_BASE}/api/investigate/pause`, { method: 'POST' });
    });
    document.getElementById('btn-ctrl-resume')?.addEventListener('click', () => {
      fetch(`${API_BASE}/api/investigate/resume`, { method: 'POST' });
    });
    document.getElementById('btn-ctrl-stop')?.addEventListener('click', () => {
      fetch(`${API_BASE}/api/investigate/stop`, { method: 'POST' });
    });

    // Refresh Button
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      refreshAllData();
    });

    // Reset Graph Zoom
    document.getElementById('btn-reset-graph')?.addEventListener('click', () => {
      graphTransform = { x: 0, y: 0, scale: 1 };
      renderGraph('graph-canvas');
    });

    // Close Node Detail Drawer
    document.getElementById('btn-close-detail')?.addEventListener('click', () => {
      const drawer = document.getElementById('node-details-drawer');
      if (drawer) drawer.style.display = 'none';
    });

    // Corpus Search
    document.getElementById('btn-run-search')?.addEventListener('click', () => {
      const q = document.getElementById('input-corpus-search')?.value || '';
      runCorpusSearch(q);
    });

    // Telegram Console Simulator
    document.getElementById('btn-send-tg-cmd')?.addEventListener('click', sendTelegramCommand);
    document.getElementById('input-tg-cmd')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendTelegramCommand();
    });

    // Model Studio Test
    document.getElementById('btn-test-models')?.addEventListener('click', testModelConnection);

    // Settings Save
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
  }

  async function triggerInvestigation(objective) {
    try {
      appendLog(`Dispatching objective: "${objective}"`, 'info');
      const res = await fetch(`${API_BASE}/api/investigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective })
      });
      const json = await res.json();
      if (json.success) {
        state.activeInvestigation = json.data;
        renderInvestigationState(json.data);
      }
    } catch (err) {
      appendLog(`Error starting investigation: ${err.message}`, 'error');
    }
  }

  function renderInvestigationState(inv) {
    if (!inv) return;
    const headerEl = document.getElementById('active-inv-header');
    if (headerEl) {
      headerEl.textContent = `${inv.objective} [${inv.status.toUpperCase()}]`;
    }

    const phasesContainer = document.getElementById('phases-list');
    if (phasesContainer && inv.plan && inv.plan.phases) {
      phasesContainer.innerHTML = '';
      inv.plan.phases.forEach((p, idx) => {
        const item = document.createElement('div');
        item.style.padding = '8px 12px';
        item.style.borderRadius = '6px';
        item.style.background = p.status === 'active' ? 'rgba(157, 78, 221, 0.2)' : 'var(--bg-surface-2)';
        item.style.border = p.status === 'active' ? '1px solid var(--neon-violet)' : '1px solid transparent';
        item.style.fontSize = '0.82rem';

        const statusIcon = p.status === 'completed' ? '✓' : p.status === 'active' ? '●' : '○';
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; font-weight: 600; color: #fff;">
            <span>${statusIcon} Phase ${idx + 1}: ${escapeHtml(p.name)}</span>
            <span style="font-size: 0.7rem; color: var(--neon-cyan); text-transform: uppercase;">${p.status}</span>
          </div>
          <div style="color: var(--text-muted); font-size: 0.72rem; margin-top: 2px;">${escapeHtml(p.description)}</div>
        `;
        phasesContainer.appendChild(item);
      });
    }

    if (inv.metrics) {
      updateMetricsUI(inv.metrics);
    }
  }

  function updateMetricsUI(metrics) {
    document.getElementById('metric-discovered').textContent = metrics.urlsDiscovered || 0;
    document.getElementById('metric-crawled').textContent = metrics.pagesCrawled || 0;
    document.getElementById('metric-entities').textContent = metrics.entitiesExtracted || 0;
    document.getElementById('metric-citations').textContent = metrics.citationsVerified || 0;
  }

  // --- Data Fetching ---
  async function refreshAllData() {
    try {
      const statusRes = await fetch(`${API_BASE}/api/status`);
      const statusJson = await statusRes.json();
      if (statusJson.activeInvestigation) {
        state.activeInvestigation = statusJson.activeInvestigation;
        renderInvestigationState(statusJson.activeInvestigation);
      }

      const graphRes = await fetch(`${API_BASE}/api/graph`);
      const graphJson = await graphRes.json();
      if (graphJson.success) {
        state.graph = graphJson.data;
        updateBadges();
        renderGraph('topology-canvas');
      }

      fetchCorpus();
      fetchReports();
      fetchSettings();
    } catch (err) {
      console.warn('Backend not ready yet:', err.message);
    }
  }

  async function fetchCorpus() {
    const res = await fetch(`${API_BASE}/api/corpus`);
    const json = await res.json();
    if (json.success) {
      state.corpus = json.data;
      renderCorpusResults(json.data);
      updateBadges();
    }
  }

  async function runCorpusSearch(query) {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    const json = await res.json();
    if (json.success) {
      renderCorpusResults(json.data);
    }
  }

  function renderCorpusResults(docs) {
    const container = document.getElementById('search-results-container');
    if (!container) return;
    container.innerHTML = '';

    if (docs.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); padding: 20px;">No corpus matches found.</div>`;
      return;
    }

    docs.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'panel';
      card.style.padding = '16px';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h3 style="font-size: 1rem; color: #fff; margin-bottom: 4px;">
              <a href="${doc.url}" target="_blank" style="color: #fff; text-decoration: none;">${escapeHtml(doc.title || doc.url)}</a>
            </h3>
            <span style="font-size: 0.75rem; color: var(--neon-cyan);">${escapeHtml(doc.url)}</span>
          </div>
          <span class="nav-badge">${( (doc.relevanceScore || 0.8) * 100 ).toFixed(0)}% Match</span>
        </div>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin: 8px 0;">${escapeHtml(doc.snippet || '')}</p>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          ${(doc.entities || []).map(e => `<span class="nav-badge" style="font-size: 0.7rem;">${escapeHtml(e)}</span>`).join('')}
        </div>
      `;
      container.appendChild(card);
    });
  }

  async function fetchReports() {
    const res = await fetch(`${API_BASE}/api/reports`);
    const json = await res.json();
    if (json.success) {
      state.reports = json.data;
      renderReportsList(json.data);
    }
  }

  function renderReportsList(reports) {
    const list = document.getElementById('reports-list');
    if (!list) return;
    list.innerHTML = '';

    if (reports.length === 0) {
      list.innerHTML = `<div style="color: var(--text-muted);">No reports compiled yet.</div>`;
      return;
    }

    reports.forEach(rep => {
      const item = document.createElement('div');
      item.style.padding = '12px';
      item.style.background = 'var(--bg-surface-2)';
      item.style.borderRadius = '6px';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <div style="font-weight: 700; color: #fff; font-size: 0.9rem;">${escapeHtml(rep.title)}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin: 4px 0;">${escapeHtml(rep.summary)}</div>
        <div style="font-size: 0.7rem; color: var(--neon-cyan);">${new Date(rep.createdAt).toLocaleString()}</div>
      `;
      item.addEventListener('click', () => loadReportPreview(rep));
      list.appendChild(item);
    });

    if (reports.length > 0 && !state.activeReport) {
      loadReportPreview(reports[0]);
    }
  }

  function loadReportPreview(rep) {
    state.activeReport = rep;
    document.getElementById('active-report-title').textContent = rep.title;
    const preview = document.getElementById('report-markdown-preview');
    if (preview) {
      // Basic markdown styling formatting
      preview.innerHTML = rep.markdown
        .replace(/\n\n/g, '<p></p>')
        .replace(/# (.*)/g, '<h1 style="color: #c084fc; font-size: 1.4rem; margin: 10px 0;">$1</h1>')
        .replace(/## (.*)/g, '<h2 style="color: #fff; font-size: 1.2rem; margin: 8px 0;">$1</h2>')
        .replace(/### (.*)/g, '<h3 style="color: #e2e8f0; font-size: 1rem; margin: 6px 0;">$1</h3>')
        .replace(/`([^`]+)`/g, '<code style="background: #1f163d; padding: 2px 4px; border-radius: 4px; color: #f43f5e;">$1</code>');
    }
  }

  async function sendTelegramCommand() {
    const input = document.getElementById('input-tg-cmd');
    const cmd = input.value.trim();
    if (!cmd) return;

    input.value = '';
    const history = document.getElementById('tg-chat-history');

    const userBubble = document.createElement('div');
    userBubble.style.color = '#fff';
    userBubble.innerHTML = `<span style="color: var(--neon-cyan);">Operator &gt;</span> ${escapeHtml(cmd)}`;
    history.appendChild(userBubble);

    try {
      const res = await fetch(`${API_BASE}/api/telegram/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });
      const json = await res.json();
      if (json.success) {
        const botBubble = document.createElement('div');
        botBubble.style.color = 'var(--text-muted)';
        botBubble.style.whiteSpace = 'pre-wrap';
        botBubble.style.marginBottom = '8px';
        botBubble.innerHTML = `<span style="color: var(--neon-magenta);">ARACHNE Bot &gt;</span> ${escapeHtml(json.data.response)}`;
        history.appendChild(botBubble);
        history.scrollTop = history.scrollHeight;
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function testModelConnection() {
    const resultBox = document.getElementById('model-test-result');
    resultBox.style.display = 'block';
    resultBox.textContent = 'Testing inference connection and latency...';

    const provider = document.getElementById('select-model-provider').value;
    try {
      const res = await fetch(`${API_BASE}/api/models/test?provider=${provider}`);
      const json = await res.json();
      resultBox.textContent = `Provider: ${json.provider}\nLatency: ${json.latencyMs}ms\nStatus: ${json.success ? 'HEALTHY' : 'NOTICE'}\nMessage: ${json.message}`;
    } catch (err) {
      resultBox.textContent = `Connection failed: ${err.message}`;
    }
  }

  async function fetchSettings() {
    const res = await fetch(`${API_BASE}/api/settings`);
    const json = await res.json();
    if (json.success) {
      state.settings = json.data;
      if (document.getElementById('setting-max-depth')) {
        document.getElementById('setting-max-depth').value = json.data.maxDepth || 3;
        document.getElementById('setting-max-urls').value = json.data.maxUrlsPerInvestigation || 30;
        document.getElementById('setting-rate-limit').value = json.data.perDomainRateLimitMs || 800;
      }
    }
  }

  async function saveSettings() {
    const newSettings = {
      maxDepth: parseInt(document.getElementById('setting-max-depth').value, 10),
      maxUrlsPerInvestigation: parseInt(document.getElementById('setting-max-urls').value, 10),
      perDomainRateLimitMs: parseInt(document.getElementById('setting-rate-limit').value, 10),
      respectRobotsTxt: document.getElementById('setting-respect-robots').checked,
      safeMode: document.getElementById('setting-safe-mode').checked
    };

    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    const json = await res.json();
    if (json.success) {
      appendLog('Crawler and policy settings saved.', 'info');
      alert('Settings updated successfully!');
    }
  }

  function updateBadges() {
    const bNodes = document.getElementById('badge-nodes');
    if (bNodes) bNodes.textContent = state.graph.nodes ? state.graph.nodes.length : 0;
    const bCorpus = document.getElementById('badge-corpus');
    if (bCorpus) bCorpus.textContent = state.corpus ? state.corpus.length : 0;
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
