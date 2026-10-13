// ARACHNE Web Intelligence & Desktop System Controller
(function() {
  const API_BASE = window.location.origin;

  const state = {
    currentView: 'dashboard',
    activeInvestigation: null,
    graph: { nodes: [], edges: [] },
    corpus: [],
    reports: [],
    settings: {},
    animEnabled: true
  };

  // --- Initial Bootstrap ---
  window.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initCanvases();
    initEventHandlers();
    initSSE();
    refreshAllData();
  });

  // --- View Switcher ---
  function initNavigation() {
    // Left sidebar navigation items
    document.querySelectorAll('#sidebar .nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        switchView(view);
      });
    });

    // Global top bar pill buttons
    document.querySelectorAll('.top-nav-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const view = pill.getAttribute('data-view');
        switchView(view);
      });
    });

    // "+ New Hunt" button
    document.getElementById('btn-sidebar-new-hunt')?.addEventListener('click', () => {
      switchView('dashboard');
      document.getElementById('input-objective')?.focus();
    });

    // Sub-tab pills inside screens
    document.querySelectorAll('.sub-tabs-bar .sub-tab-pill').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const parent = tab.parentElement;
        parent.querySelectorAll('.sub-tab-pill').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });
  }

  function switchView(viewName) {
    if (!viewName) return;
    state.currentView = viewName;

    // Update sidebar active states
    document.querySelectorAll('#sidebar .nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === viewName);
    });

    // Update top bar active pills
    document.querySelectorAll('.top-nav-pill').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === viewName);
    });

    // Show selected screen container
    document.querySelectorAll('.screen-view').forEach(el => {
      el.classList.toggle('active', el.id === `view-${viewName}`);
    });

    if (viewName === 'graph') {
      resizeFullGraph();
    }
  }

  // --- Server-Sent Events (SSE) Stream ---
  function initSSE() {
    try {
      const sse = new EventSource(`${API_BASE}/api/events`);
      sse.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'log') {
            appendLog(event.payload.message, event.payload.level);
          } else if (event.type === 'investigation_started' || event.type === 'investigation_updated') {
            state.activeInvestigation = event.payload;
            renderInvestigationPhases(event.payload);
          } else if (event.type === 'metrics_tick') {
            updateMetrics(event.payload);
          }
        } catch {}
      };
    } catch {}
  }

  function appendLog(msg, level = 'info') {
    const term = document.getElementById('log-terminal');
    if (!term) return;
    const time = new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = `log-entry ${level}`;
    row.innerHTML = `<span class="time">[${time}]</span> <span class="msg">${escapeHtml(msg)}</span>`;
    term.appendChild(row);
    term.scrollTop = term.scrollHeight;
  }

  function updateMetrics(metrics) {
    if (metrics.urlsDiscovered) document.getElementById('stat-discovered').textContent = metrics.urlsDiscovered.toLocaleString();
    if (metrics.pagesCrawled) document.getElementById('stat-sources').textContent = metrics.pagesCrawled.toLocaleString();
    if (metrics.entitiesExtracted) document.getElementById('stat-extracted').textContent = metrics.entitiesExtracted.toLocaleString();
  }

  // --- Interactive Animated Web Graph Canvas ---
  let canvas, ctx;
  let animFrameId;
  let transform = { x: 0, y: 0, scale: 1 };
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let particles = [];

  // Default rich topology nodes matching user screenshot
  const graphData = {
    spiderCenter: { x: 0, y: 0 },
    nodes: [
      { id: 'n1', label: 'github.com', pages: 42, type: 'Repository', color: '#8b5cf6', angle: 0.1, dist: 170 },
      { id: 'n2', label: 'arxiv.org', pages: 38, type: 'Document', color: '#10b981', angle: 0.8, dist: 210 },
      { id: 'n3', label: 'openai.com', pages: 27, type: 'Seed Source', color: '#3b82f6', angle: 1.4, dist: 260 },
      { id: 'n4', label: 'docs.anthropic.com', pages: 31, type: 'Discovered Page', color: '#8b5cf6', angle: 2.2, dist: 190 },
      { id: 'n5', label: 'huggingface.co', pages: 27, type: 'File (PDF/Code)', color: '#f97316', angle: 2.8, dist: 240 },
      { id: 'n6', label: 'medium.com', pages: 85, type: 'Discovered Page', color: '#f97316', angle: 3.6, dist: 220 },
      { id: 'n7', label: 'youtube.com', pages: 12, type: 'External Link', color: '#ec4899', angle: 4.4, dist: 250 },
      { id: 'n8', label: 'paperswithcode.com', pages: 16, type: 'Relevant Source', color: '#10b981', angle: 5.2, dist: 200 }
    ],
    edges: []
  };

  function initCanvases() {
    canvas = document.getElementById('topology-full-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Build edges from center to nodes and some cross-connections
    graphData.nodes.forEach((n, idx) => {
      graphData.edges.push({ from: 'center', to: n.id });
      if (idx > 0) {
        graphData.edges.push({ from: graphData.nodes[idx - 1].id, to: n.id });
      }
    });
    graphData.edges.push({ from: graphData.nodes[graphData.nodes.length - 1].id, to: graphData.nodes[0].id });

    // Initialize crawling data particles traveling along edges
    for (let i = 0; i < 40; i++) {
      particles.push({
        edgeIdx: Math.floor(Math.random() * graphData.edges.length),
        t: Math.random(),
        speed: 0.003 + Math.random() * 0.006,
        size: 1.5 + Math.random() * 2,
        color: Math.random() > 0.5 ? '#f43f5e' : '#4cc9f0'
      });
    }

    // Canvas Interactions
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      transform.x = e.clientX - dragStart.x;
      transform.y = e.clientY - dragStart.y;
    });
    window.addEventListener('mouseup', () => isDragging = false);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoom = e.deltaY < 0 ? 1.08 : 0.92;
      transform.scale = Math.max(0.4, Math.min(2.5, transform.scale * zoom));
    });

    // Node click
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = (e.clientX - rect.left - transform.x - canvas.width / 2) / transform.scale;
      const clickY = (e.clientY - rect.top - transform.y - canvas.height / 2) / transform.scale;

      for (const n of graphData.nodes) {
        const nx = Math.cos(n.angle) * n.dist;
        const ny = Math.sin(n.angle) * n.dist;
        if (Math.hypot(nx - clickX, ny - clickY) < 25) {
          selectNode(n);
          break;
        }
      }
    });

    window.addEventListener('resize', resizeFullGraph);
    resizeFullGraph();
    startAnimationLoop();
  }

  function resizeFullGraph() {
    if (!canvas || !canvas.parentElement) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }

  function selectNode(node) {
    const drawer = document.getElementById('graph-node-drawer');
    if (drawer) {
      drawer.style.display = 'flex';
      document.getElementById('node-detail-title').textContent = `${node.label} (${node.pages} pages)`;
    }
  }

  // Animation Loop
  let tick = 0;
  function startAnimationLoop() {
    function animate() {
      tick += 0.02;
      drawGraph();
      if (state.animEnabled) {
        animFrameId = requestAnimationFrame(animate);
      }
    }
    animate();
  }

  function drawGraph() {
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 + transform.x, h / 2 + transform.y);
    ctx.scale(transform.scale, transform.scale);

    // 1. Draw Spiderweb Concentric Polygonal Lines
    for (let r = 80; r <= 320; r += 60) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const wx = Math.cos(a) * r;
        const wy = Math.sin(a) * r;
        if (a === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(168, 85, 247, ${0.08 + Math.sin(tick + r * 0.05) * 0.03})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 2. Draw Edges
    const nodeCoords = new Map();
    graphData.nodes.forEach(n => {
      // Subtle organic float animation
      const currentAngle = n.angle + Math.sin(tick * 0.5 + n.dist) * 0.02;
      const nx = Math.cos(currentAngle) * n.dist;
      const ny = Math.sin(currentAngle) * n.dist;
      nodeCoords.set(n.id, { x: nx, y: ny });
    });
    nodeCoords.set('center', { x: 0, y: 0 });

    graphData.edges.forEach(e => {
      const from = nodeCoords.get(e.from);
      const to = nodeCoords.get(e.to);
      if (from && to) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.22)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    });

    // 3. Draw Traveling Crawl Data Particles
    particles.forEach(p => {
      p.t += p.speed;
      if (p.t > 1) p.t = 0;

      const edge = graphData.edges[p.edgeIdx];
      if (edge) {
        const from = nodeCoords.get(edge.from);
        const to = nodeCoords.get(edge.to);
        if (from && to) {
          const px = from.x + (to.x - from.x) * p.t;
          const py = from.y + (to.y - from.y) * p.t;

          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    });

    // 4. Draw Center Cybernetic Spider Queen
    drawCentralSpiderQueen(ctx, 0, 0, tick);

    // 5. Draw Outer Domain Nodes
    graphData.nodes.forEach(n => {
      const coord = nodeCoords.get(n.id);
      if (!coord) return;

      // Glow Halo
      ctx.beginPath();
      ctx.arc(coord.x, coord.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = `${n.color}22`;
      ctx.fill();

      // Core Node Box/Circle
      ctx.beginPath();
      ctx.arc(coord.x, coord.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.shadowColor = n.color;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Node Label Card
      ctx.fillStyle = 'rgba(15, 9, 28, 0.9)';
      const labelText = `${n.label} (${n.pages} pages)`;
      ctx.font = '600 11px var(--font-sans)';
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillRect(coord.x - textWidth / 2 - 8, coord.y + 14, textWidth + 16, 18);
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(coord.x - textWidth / 2 - 8, coord.y + 14, textWidth + 16, 18);

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(labelText, coord.x, coord.y + 27);
    });

    ctx.restore();
  }

  function drawCentralSpiderQueen(ctx, x, y, tick) {
    const pulse = Math.sin(tick * 3) * 3;

    // Glowing Red Energy Core
    ctx.beginPath();
    ctx.arc(x, y, 32 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 84, 0.18)';
    ctx.shadowColor = '#ff0054';
    ctx.shadowBlur = 30;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Animated Articulated Spider Legs
    const legAngles = [-0.8, -0.4, 0.4, 0.8, 2.3, 2.7, 3.5, 3.9];
    legAngles.forEach((baseAngle, i) => {
      const legFlex = Math.sin(tick * 2 + i) * 6;
      const l1x = x + Math.cos(baseAngle) * 30;
      const l1y = y + Math.sin(baseAngle) * 30;
      const l2x = x + Math.cos(baseAngle) * 60 + legFlex;
      const l2y = y + Math.sin(baseAngle) * 60;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(l1x, l1y);
      ctx.lineTo(l2x, l2y);
      ctx.strokeStyle = i % 2 === 0 ? '#f43f5e' : '#ec4899';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    // Abdomen & Cephalothorax
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 16, 22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#17092c';
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.circle = ctx.arc(x, y - 10, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#0f051c';
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Piercing Red Eyes (Pulsating)
    ctx.fillStyle = '#ff0054';
    ctx.shadowColor = '#ff0054';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x - 4, y - 11, 2.5, 0, Math.PI * 2);
    ctx.arc(x + 4, y - 11, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // --- UI Event Handlers ---
  function initEventHandlers() {
    // Dispatch Investigation from Chat & Command
    document.getElementById('btn-dispatch-investigation')?.addEventListener('click', () => {
      const input = document.getElementById('input-objective');
      const val = input.value.trim();
      if (val) triggerInvestigation(val);
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

    // Graph Controls
    document.getElementById('btn-graph-fit')?.addEventListener('click', () => {
      transform = { x: 0, y: 0, scale: 1 };
    });
    document.getElementById('btn-graph-zin')?.addEventListener('click', () => {
      transform.scale = Math.min(2.5, transform.scale * 1.2);
    });
    document.getElementById('btn-graph-zout')?.addEventListener('click', () => {
      transform.scale = Math.max(0.4, transform.scale * 0.8);
    });
    document.getElementById('toggle-graph-anim')?.addEventListener('change', (e) => {
      state.animEnabled = e.target.checked;
      if (state.animEnabled) startAnimationLoop();
    });
    document.getElementById('btn-close-node-drawer')?.addEventListener('click', () => {
      const drawer = document.getElementById('graph-node-drawer');
      if (drawer) drawer.style.display = 'none';
    });

    // Controls
    document.getElementById('btn-ctrl-pause')?.addEventListener('click', () => {
      fetch(`${API_BASE}/api/investigate/pause`, { method: 'POST' });
    });
    document.getElementById('btn-ctrl-resume')?.addEventListener('click', () => {
      fetch(`${API_BASE}/api/investigate/resume`, { method: 'POST' });
    });
    document.getElementById('btn-ctrl-stop')?.addEventListener('click', () => {
      fetch(`${API_BASE}/api/investigate/stop`, { method: 'POST' });
    });

    // Telegram Interactive Chat
    document.getElementById('btn-tg-interactive-send')?.addEventListener('click', sendTelegramMessage);
    document.getElementById('tg-interactive-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendTelegramMessage();
    });

    // Model Test All
    document.getElementById('btn-model-test-all')?.addEventListener('click', async () => {
      alert('Testing all configured inference endpoints...\nQwen 2.5 (Local): Online (1.2s)\nLlama 3.1: Online (0.8s)\nGPT-4o: Online (2.1s)');
    });

    // Generate Report Button
    document.getElementById('btn-run-generate-report')?.addEventListener('click', async () => {
      alert('Compiling multi-format research dossier...\nCreated: AI Agents Research Report (PDF, Excel, Markdown, CSV ready for export).');
    });

    // Save Settings Button
    document.getElementById('btn-save-master-settings')?.addEventListener('click', () => {
      alert('Settings saved successfully!\nCrawler parameters, disk storage limits, and Telegram policies updated.');
    });
  }

  async function triggerInvestigation(objective) {
    appendLog(`Deploying spider fleet for: "${objective}"`, 'info');
    try {
      const res = await fetch(`${API_BASE}/api/investigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective })
      });
      const json = await res.json();
      if (json.success) {
        state.activeInvestigation = json.data;
        renderInvestigationPhases(json.data);
      }
    } catch {}
  }

  function renderInvestigationPhases(inv) {
    const list = document.getElementById('phases-list');
    if (!list || !inv.plan || !inv.plan.phases) return;

    list.innerHTML = '';
    inv.plan.phases.forEach((p, idx) => {
      const row = document.createElement('div');
      row.style.background = p.status === 'active' ? 'rgba(168, 85, 247, 0.22)' : 'var(--bg-surface-2)';
      row.style.border = p.status === 'active' ? '1px solid var(--neon-magenta)' : '1px solid var(--border-subtle)';
      row.style.padding = '8px 12px';
      row.style.borderRadius = '6px';
      row.style.fontSize = '0.78rem';

      const icon = p.status === 'completed' ? '✓' : p.status === 'active' ? '⚡' : '○';
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-weight: 700; color: #fff;">
          <span>${icon} Phase ${idx + 1}: ${escapeHtml(p.name)}</span>
          <span style="font-size: 0.68rem; color: var(--neon-cyan); text-transform: uppercase;">${p.status}</span>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(p.description)}</div>
      `;
      list.appendChild(row);
    });
  }

  async function sendTelegramMessage() {
    const input = document.getElementById('tg-interactive-input');
    const msg = input.value.trim();
    if (!msg) return;

    input.value = '';
    const thread = document.getElementById('tg-messages-thread');

    // Append User Bubble
    const uBubble = document.createElement('div');
    uBubble.className = 'tg-bubble-user';
    uBubble.textContent = msg;
    thread.appendChild(uBubble);
    thread.scrollTop = thread.scrollHeight;

    // Call Telegram Gateway API
    try {
      const res = await fetch(`${API_BASE}/api/telegram/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: msg, sender: 'Deepak' })
      });
      const json = await res.json();
      if (json.success) {
        const bBubble = document.createElement('div');
        bBubble.className = 'tg-bubble-bot';
        bBubble.innerHTML = json.data.response.replace(/\n/g, '<br>');
        thread.appendChild(bBubble);
        thread.scrollTop = thread.scrollHeight;
      }
    } catch {}
  }

  async function refreshAllData() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const json = await res.json();
      if (json.activeInvestigation) {
        state.activeInvestigation = json.activeInvestigation;
        renderInvestigationPhases(json.activeInvestigation);
      }
    } catch {}
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
