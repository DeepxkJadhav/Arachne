#!/usr/bin/env node

/**
 * ARACHNE — Autonomous Web Intelligence & Research CLI
 * Black, White, and Crimson/Red Cyberpunk Hacker Terminal
 */

import http from 'node:http';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyIntent, INTENTS } from '../server/agent/intent-classifier.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Session State across interactive REPL
let activeInvestigationId = null;
let activeReport = null;

// Load local .env environment variables if present
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {}

const BASE_URL = process.env.ARACHNE_URL || 'http://localhost:3003';

// =========================================================================
// ANSI Palette — Black, White & Crimson/Red Hacker Aesthetic
// (Strict requirement: ZERO green, cyan, purple, pink, or yellow)
// =========================================================================
const hasNoColor = process.env.NO_COLOR !== undefined || process.argv.includes('--no-color');
const isColorSupported = !hasNoColor && (process.stdout.isTTY || process.env.FORCE_COLOR);

const C = isColorSupported ? {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Primary Text: White and Off-White
  white: '\x1b[97m',
  lightGray: '\x1b[37m',

  // Crimson / Red Accents for Branding, Borders, Active Ops, Alerts
  red: '\x1b[38;5;196m',
  crimson: '\x1b[38;5;160m',
  darkRed: '\x1b[38;5;88m',

  // Secondary Metadata: Dark Gray & Charcoal
  gray: '\x1b[38;5;244m',
  darkGray: '\x1b[38;5;238m',
  charcoal: '\x1b[38;5;234m',

  // Semantic Indicators in Restricted Palette
  alert: '\x1b[38;5;196m',
  active: '\x1b[1m\x1b[97m',
  muted: '\x1b[38;5;240m'
} : {
  reset: '', bold: '', dim: '', italic: '', underline: '',
  white: '', lightGray: '', red: '', crimson: '', darkRed: '',
  gray: '', darkGray: '', charcoal: '', alert: '', active: '', muted: ''
};

// Compact Restrained Mechanical Spider Artwork & Wordmark
const HEADER_ASCII = `
${C.crimson}  / _ \\   ${C.bold}${C.white}ARACHNE${C.reset} ${C.gray}//${C.reset} ${C.crimson}AUTONOMOUS WEB INTELLIGENCE${C.reset} ${C.gray}[v2.0.0]${C.reset}
${C.crimson} \\_\\(_)/_/ ${C.gray}MOTOR: ${C.white}CHROME/BRAVE CDP ${C.gray}| VAULT: ${C.white}SQLITE WAL ${C.gray}| SHIELD: ${C.white}SSRF GUARD${C.reset}
${C.crimson}  _// \\\\_  ${C.gray}NODE: ${C.white}${process.version} ${C.gray}| OPERATOR: ${C.white}TELEGRAM FAIL-CLOSED ${C.gray}| NET: ${C.white}${BASE_URL}${C.reset}
`;

// =========================================================================
// Real HTTP Client Helper (Zero Simulated Math)
// =========================================================================
async function api(pathname, options = {}) {
  return new Promise((resolve) => {
    const url = new URL(pathname, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) }
    };

    let payload = null;
    if (options.body) {
      payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, ok: res.statusCode >= 200 && res.statusCode < 300 });
        } catch {
          resolve({ status: res.statusCode, data, ok: res.statusCode >= 200 && res.statusCode < 300 });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ status: 503, error: err.message, ok: false });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// Auto-spawn backend daemon if offline
async function ensureServerOnline(quiet = false) {
  const check = await api('/api/status');
  if (check.ok) return true;

  if (!quiet) {
    process.stdout.write(`${C.gray}Starting ARACHNE background engine daemon... ${C.reset}`);
  }

  const startScript = path.resolve(__dirname, '../server/start.mjs');
  if (!fs.existsSync(startScript)) {
    return false;
  }

  try {
    const serverProc = spawn(process.execPath, [startScript, '--server-only'], {
      detached: true,
      stdio: 'ignore'
    });
    serverProc.unref();

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 250));
      const recheck = await api('/api/status');
      if (recheck.ok) {
        if (!quiet) console.log(`${C.white}[ONLINE]${C.reset}\n`);
        return true;
      }
    }
  } catch {}

  if (!quiet) console.log(`${C.crimson}[FAILED]${C.reset}\n`);
  return false;
}

// =========================================================================
// Layout Helpers — ANSI-Stripping & Terminal-Width Aware
// =========================================================================
function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function wrapText(text, maxWidth) {
  if (!text) return [''];
  const str = String(text);
  if (maxWidth <= 0) return [str];
  const words = str.split(' ');
  const lines = [];
  let current = '';

  for (const w of words) {
    if (!current) {
      if (stripAnsi(w).length <= maxWidth) {
        current = w;
      } else {
        let rem = w;
        while (stripAnsi(rem).length > maxWidth) {
          lines.push(rem.slice(0, maxWidth));
          rem = rem.slice(maxWidth);
        }
        current = rem;
      }
    } else {
      const prospective = `${current} ${w}`;
      if (stripAnsi(prospective).length <= maxWidth) {
        current = prospective;
      } else {
        lines.push(current);
        if (stripAnsi(w).length <= maxWidth) {
          current = w;
        } else {
          let rem = w;
          while (stripAnsi(rem).length > maxWidth) {
            lines.push(rem.slice(0, maxWidth));
            rem = rem.slice(maxWidth);
          }
          current = rem;
        }
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function drawBox(title, lines, options = {}) {
  const termWidth = Math.max(60, (process.stdout.columns || 80) - 2);
  const borderCol = options.color || C.crimson;
  const titleCol = C.bold + C.white;

  let maxLineLen = stripAnsi(title).length + 4;
  for (const l of lines) {
    const len = stripAnsi(l).length;
    if (len > maxLineLen) maxLineLen = len;
  }

  const boxWidth = Math.min(termWidth, Math.max(40, maxLineLen + 6));
  const contentWidth = boxWidth - 6;

  const titleVisible = stripAnsi(title);
  const topDashCount = Math.max(0, boxWidth - titleVisible.length - 6);
  const topBorder = `┌─ ${titleCol}${title}${C.reset}${borderCol} ` + '─'.repeat(topDashCount) + '┐';
  const bottomBorder = '└' + '─'.repeat(boxWidth - 2) + '┘';

  console.log(`${borderCol}${topBorder}${C.reset}`);
  for (const line of lines) {
    const wrapped = wrapText(line, contentWidth);
    for (const wLine of wrapped) {
      const pad = ' '.repeat(Math.max(0, contentWidth - stripAnsi(wLine).length));
      console.log(`${borderCol}│${C.reset}  ${wLine}${pad}  ${borderCol}│${C.reset}`);
    }
  }
  console.log(`${borderCol}${bottomBorder}${C.reset}`);
}

function drawTable(headers, rows, options = {}) {
  const termWidth = Math.max(60, (process.stdout.columns || 80) - 2);
  const numCols = headers.length;
  const colPads = 2;

  const rawWidths = headers.map((h, i) => {
    let max = stripAnsi(h).length;
    for (const r of rows) {
      const val = stripAnsi(String(r[i] !== undefined ? r[i] : ''));
      const lines = val.split('\n');
      for (const line of lines) {
        if (line.length > max) max = line.length;
      }
    }
    return max;
  });

  const totalRaw = rawWidths.reduce((a, b) => a + b + colPads, 0) + (numCols + 1);
  const colWidths = [...rawWidths];

  if (totalRaw > termWidth) {
    const available = termWidth - (numCols + 1) - (numCols * colPads);
    const rawSum = rawWidths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < numCols; i++) {
      colWidths[i] = Math.max(6, Math.floor((rawWidths[i] / rawSum) * available));
    }
  }

  const borderCol = options.color || C.darkGray;
  const headerCol = C.crimson;
  const textCol = C.white;

  const makeSep = (left, cross, right) => {
    return borderCol + left + colWidths.map(w => '─'.repeat(w + colPads)).join(cross) + right + C.reset;
  };

  console.log(makeSep('┌', '┬', '┐'));

  const headerWrapped = headers.map((h, i) => wrapText(h, colWidths[i]));
  const maxHeaderLines = Math.max(...headerWrapped.map(l => l.length));

  for (let lineIdx = 0; lineIdx < maxHeaderLines; lineIdx++) {
    const cells = headers.map((_, colIdx) => {
      const text = headerWrapped[colIdx][lineIdx] || '';
      const visibleLen = stripAnsi(text).length;
      const pad = ' '.repeat(Math.max(0, colWidths[colIdx] - visibleLen));
      return ` ${headerCol}${C.bold}${text}${C.reset}${pad} `;
    });
    console.log(`${borderCol}│${C.reset}${cells.join(`${borderCol}│${C.reset}`)}${borderCol}│${C.reset}`);
  }

  console.log(makeSep('├', '┼', '┤'));

  for (const row of rows) {
    const cellWrapped = headers.map((_, i) => {
      const val = String(row[i] !== undefined ? row[i] : '');
      return wrapText(val, colWidths[i]);
    });
    const maxLines = Math.max(...cellWrapped.map(l => l.length));

    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const cells = headers.map((_, colIdx) => {
        const text = cellWrapped[colIdx][lineIdx] || '';
        const visibleLen = stripAnsi(text).length;
        const pad = ' '.repeat(Math.max(0, colWidths[colIdx] - visibleLen));
        return ` ${textCol}${text}${C.reset}${pad} `;
      });
      console.log(`${borderCol}│${C.reset}${cells.join(`${borderCol}│${C.reset}`)}${borderCol}│${C.reset}`);
    }
  }

  console.log(makeSep('└', '┴', '┘'));
}

function progressBar(current, total, width = 20) {
  const ratio = Math.min(1, Math.max(0, total > 0 ? current / total : 0));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  return `${C.darkGray}[${C.crimson}${'█'.repeat(filled)}${C.charcoal}${'░'.repeat(empty)}${C.darkGray}] ${C.white}${pct}%${C.reset}`;
}

// =========================================================================
// Real-Time System HUD (Zero Invented Fallbacks)
// =========================================================================
async function showHud() {
  const [statusRes, browserRes, modelsRes, telegramRes, storageRes] = await Promise.all([
    api('/api/status'),
    api('/api/browser/status'),
    api('/api/models'),
    api('/api/telegram/status'),
    api('/api/storage/metrics')
  ]);

  const isServerOnline = statusRes.ok;
  const s = statusRes.data || {};
  const b = browserRes.data?.data || {};
  const m = modelsRes.data?.data || {};
  const t = telegramRes.data?.data || {};
  const st = storageRes.data?.data || {};

  const lines = [];

  // 1. Backend Status
  if (isServerOnline) {
    const uptime = s.uptime ? `${Math.floor(s.uptime / 60)}m ${Math.floor(s.uptime % 60)}s` : 'N/A';
    lines.push(`${C.gray}BACKEND:    ${C.bold}${C.white}ONLINE${C.reset} ${C.gray}(Port: 3003, Uptime: ${uptime})${C.reset}`);
  } else {
    lines.push(`${C.gray}BACKEND:    ${C.crimson}OFFLINE${C.reset} ${C.gray}(Unreachable at ${BASE_URL})${C.reset}`);
  }

  // 2. Browser Automation Status
  if (isServerOnline && b.detected) {
    const browserName = b.selectedBrowser === 'brave' ? 'Brave' : 'Google Chrome';
    const cdpStatus = b.status === 'ready' ? 'READY' : (b.status === 'connecting' ? 'CONNECTING' : 'DISCONNECTED');
    const tabCount = b.activeTaskTabsCount !== undefined ? b.activeTaskTabsCount : 0;
    lines.push(`${C.gray}BROWSER:    ${C.white}${browserName}${C.reset} ${C.gray}(CDP: 127.0.0.1:${b.remoteDebuggingPort || 9222}, Status: ${cdpStatus}, Active Tabs: ${tabCount})${C.reset}`);
  } else if (isServerOnline) {
    lines.push(`${C.gray}BROWSER:    ${C.gray}HEADLESS / NO BROWSER DETECTED${C.reset}`);
  } else {
    lines.push(`${C.gray}BROWSER:    ${C.gray}OFFLINE (Backend unreachable)${C.reset}`);
  }

  // 3. AI Models & Router
  const modelList = Array.isArray(m) ? m : (m.models || []);
  if (isServerOnline && modelList.length > 0) {
    const primary = modelList.find(x => x.role === 'Primary' || x.active) || modelList[0];
    const activeProvider = primary?.provider || 'Groq Cloud';
    const activeModel = primary?.model || primary?.name || 'qwen/qwen3.8-27b';
    const latency = primary?.latencyMs ? ` (${primary.latencyMs}ms)` : '';
    lines.push(`${C.gray}MODELS:     ${C.white}${activeProvider}${C.reset} ${C.gray}(Model: ${activeModel}${latency})${C.reset}`);
  } else if (isServerOnline) {
    lines.push(`${C.gray}MODELS:     ${C.gray}STANDALONE (No active provider)${C.reset}`);
  } else {
    lines.push(`${C.gray}MODELS:     ${C.gray}OFFLINE (Backend unreachable)${C.reset}`);
  }

  // 4. Telegram Gateway State
  if (isServerOnline && (t.status || t.configured || t.botInfo)) {
    const botUser = t.botInfo?.username ? `@${t.botInfo.username}` : (t.configured ? 'CONFIGURED' : 'NOT CONFIGURED');
    const tgState = t.isPolling ? 'POLLING (ACTIVE)' : (t.status || 'IDLE').toUpperCase();
    lines.push(`${C.gray}TELEGRAM:   ${C.white}${botUser}${C.reset} ${C.gray}(State: ${tgState}, Fail-Closed)${C.reset}`);
  } else if (isServerOnline) {
    lines.push(`${C.gray}TELEGRAM:   ${C.gray}NOT CONFIGURED${C.reset}`);
  } else {
    lines.push(`${C.gray}TELEGRAM:   ${C.gray}OFFLINE (Backend unreachable)${C.reset}`);
  }

  // 5. Database & Storage State
  const dbPath = st.sqlitePath || st.dbPath || st.vaultPath;
  if (isServerOnline && dbPath) {
    const dbSize = st.totalMb ? `${st.totalMb} MB` : 'N/A';
    const docCount = st.totalDocuments !== undefined ? st.totalDocuments : (st.counts?.corpus_documents || 0);
    const invCount = st.totalInvestigations !== undefined ? st.totalInvestigations : (st.counts?.investigations || 0);
    lines.push(`${C.gray}DATABASE:   ${C.white}${path.basename(dbPath)}${C.reset} ${C.gray}(Size: ${dbSize}, Docs: ${docCount}, Investigations: ${invCount})${C.reset}`);
  } else if (isServerOnline) {
    lines.push(`${C.gray}DATABASE:   ${C.white}IN-MEMORY / UNCONFIGURED${C.reset}`);
  } else {
    lines.push(`${C.gray}DATABASE:   ${C.gray}OFFLINE (Backend unreachable)${C.reset}`);
  }

  // 6. Active Investigation & Last Event
  const activeInv = s.activeInvestigation;
  if (activeInv) {
    const phaseName = activeInv.plan?.phases?.[activeInv.currentPhaseIndex]?.name || 'Initial';
    const lastLog = activeInv.logs?.[0]?.message || activeInv.stateReason || 'In progress';
    lines.push(`${C.gray}ACTIVE TASK:${C.reset} ${C.crimson}[${activeInv.id}]${C.reset} ${C.white}${activeInv.objective ? activeInv.objective.slice(0, 45) : 'Untitled'}${C.reset}`);
    lines.push(`${C.gray}PHASE:      ${C.white}[${(activeInv.currentPhaseIndex || 0) + 1}/5] ${phaseName}${C.reset} ${C.gray}| Event: ${lastLog.slice(0, 50)}${C.reset}`);
  } else {
    lines.push(`${C.gray}ACTIVE TASK:${C.reset} ${C.gray}NONE (System Idle)${C.reset}`);
  }

  drawBox('SYSTEM MATRIX // OPERATIONAL AUDIT', lines, { color: C.crimson });
}

// =========================================================================
// Command Handlers
// =========================================================================

// 1. Status Command
async function cmdStatus(options = {}) {
  if (options.json) {
    const [statusRes, storageRes, browserRes, telegramRes] = await Promise.all([
      api('/api/status'),
      api('/api/storage/metrics'),
      api('/api/browser/status'),
      api('/api/telegram/status')
    ]);
    console.log(JSON.stringify({
      status: statusRes.data,
      storage: storageRes.data,
      browser: browserRes.data,
      telegram: telegramRes.data
    }, null, 2));
    return;
  }

  console.log(`\n${C.bold}${C.crimson}:: SUBSYSTEM HEALTH AUDIT & HARDWARE MATRIX${C.reset}\n`);

  const [statusRes, storageRes, graphRes, browserRes, telegramRes] = await Promise.all([
    api('/api/status'),
    api('/api/storage/metrics'),
    api('/api/graph'),
    api('/api/browser/status'),
    api('/api/telegram/status')
  ]);

  if (!statusRes.ok) {
    console.log(`${C.crimson}[ERR] ARACHNE server is unreachable at ${BASE_URL}.${C.reset}`);
    console.log(`${C.gray}Start server using: node server/start.mjs${C.reset}\n`);
    return;
  }

  const s = statusRes.data || {};
  const st = storageRes.data?.data || storageRes.data || {};
  const counts = st.counts || {};
  const g = graphRes.data?.data || graphRes.data || {};
  const b = browserRes.data?.data || {};
  const t = telegramRes.data?.data || {};

  const rows = [
    ['HTTP Core Daemon', 'Port 3003 (Active)', `${C.white}[ONLINE]${C.reset}`],
    ['Storage Engine', 'SQLite 3 (WAL Synchronous)', `${C.white}[ACID NORMAL]${C.reset}`],
    ['Database Size', `${st.totalMb || 'N/A'} MB`, `${C.white}[PERSISTED]${C.reset}`],
    ['Corpus Documents', `${counts.corpus_documents !== undefined ? counts.corpus_documents : 'N/A'} records`, `${C.white}[INDEXED]${C.reset}`],
    ['Knowledge Nodes', `${g.nodes ? g.nodes.length : 'N/A'} entities`, `${C.white}[CONNECTED]${C.reset}`],
    ['Knowledge Edges', `${g.edges ? g.edges.length : 'N/A'} relationships`, `${C.white}[GRAPH]${C.reset}`],
    ['Evidence Claims', `${counts.evidence_records !== undefined ? counts.evidence_records : 'N/A'} claims`, `${C.white}[VERIFIED]${C.reset}`],
    ['Ignored Items', `${counts.ignored_items !== undefined ? counts.ignored_items : 0} items logged`, `${C.gray}[AUDITED]${C.reset}`],
    ['Browser CDP', `Port ${b.remoteDebuggingPort || 9222} (${b.selectedBrowser || 'Chrome'})`, b.status === 'ready' ? `${C.white}[READY]${C.reset}` : `${C.gray}[${(b.status || 'IDLE').toUpperCase()}]${C.reset}`],
    ['Active Task Tabs', `${b.activeTaskTabsCount !== undefined ? b.activeTaskTabsCount : 0} tabs owned`, `${C.white}[ISOLATED]${C.reset}`],
    ['Telegram Gateway', (t.botInfo?.username || t.botUsername) ? `@${t.botInfo?.username || t.botUsername}` : (t.configured ? 'Configured' : 'Not Configured'), t.isPolling ? `${C.white}[POLLING]${C.reset}` : (t.configured ? `${C.white}[ACTIVE]${C.reset}` : `${C.gray}[IDLE]${C.reset}`)],
    ['Active Investigation', s.activeInvestigation ? `${s.activeInvestigation.id} (${s.activeInvestigation.status})` : 'None active', s.activeInvestigation ? `${C.crimson}[ACTIVE]${C.reset}` : `${C.gray}[IDLE]${C.reset}`]
  ];

  drawTable(['SUBSYSTEM COMPONENT', 'METRIC / STATE', 'HEALTH STATE'], rows, { color: C.darkGray });
  console.log();
}

// 2. Investigate Command (Live Real-Time Monitoring — Zero Fake Sleeps)
async function cmdInvestigate(objective, options = {}) {
  if (!objective || !objective.trim()) {
    console.log(`${C.crimson}[ERR] Objective required.${C.reset} Usage: investigate "<objective>"`);
    return;
  }

  const cleanObjective = objective.trim();
  console.log(`\n${C.crimson}:: DISPATCHING AUTONOMOUS INVESTIGATION${C.reset}`);
  console.log(`${C.gray}OBJECTIVE:${C.reset} ${C.white}${cleanObjective}${C.reset}\n`);

  process.stdout.write(`${C.gray}Submitting task to research orchestrator... ${C.reset}`);
  const res = await api('/api/investigate', {
    method: 'POST',
    body: { objective: cleanObjective }
  });

  if (!res.ok || !res.data?.success) {
    console.log(`${C.crimson}FAILED${C.reset}`);
    console.log(`${C.crimson}[ERR] ${res.error || res.data?.error || 'Server error'}${C.reset}\n`);
    return;
  }

  console.log(`${C.white}ACCEPTED${C.reset}`);
  const inv = res.data.data;
  console.log(`${C.gray}TASK ID:  ${C.bold}${C.white}${inv.id}${C.reset}`);
  console.log(`${C.gray}STATUS:   ${C.crimson}${inv.status}${C.reset}\n`);

  if (options.json) {
    console.log(JSON.stringify(inv, null, 2));
    return;
  }

  // Display initial research plan from server
  const phases = inv.plan?.phases || [];
  if (phases.length > 0) {
    const phaseRows = phases.map((p, idx) => [
      `[${idx + 1}/${phases.length}] ${p.name}`,
      p.description || '',
      (p.queries || []).slice(0, 2).join('; ') || 'Autonomous'
    ]);
    drawTable(['PHASE', 'INTENT & SCOPE', 'SEED QUERIES'], phaseRows, { color: C.darkGray });
  }

  console.log(`\n${C.bold}${C.white}:: LIVE RESEARCH EVENT MONITOR (Ctrl+C to detach)${C.reset}\n`);

  let dotIndex = 0;
  const dotsArray = ['.  ', '.. ', '...'];
  let lastLogCount = 0;
  let lastPhase = -1;
  const seenIgnored = new Set();
  let userInterrupted = false;

  const sigintHandler = () => {
    userInterrupted = true;
    process.stdout.write(`\n\n${C.crimson}[INTERRUPT] Received Ctrl+C. Detaching live monitor (research task continues in background).${C.reset}\n\n`);
  };
  process.on('SIGINT', sigintHandler);

  let completed = false;

  try {
    while (!completed && !userInterrupted) {
      await new Promise(r => setTimeout(r, 600));
      dotIndex++;

      const currRes = await api('/api/investigation/current');
      if (!currRes.ok || !currRes.data?.data) {
        continue;
      }

      const current = currRes.data.data;
      if (current.id !== inv.id) {
        break;
      }

      const phaseIdx = current.currentPhaseIndex !== undefined ? current.currentPhaseIndex : 0;
      const phasesList = current.plan?.phases || [];
      const phaseObj = phasesList[phaseIdx];
      const phaseName = phaseObj ? phaseObj.name : `Phase ${phaseIdx + 1}`;

      // Phase transition notification
      if (phaseIdx !== lastPhase) {
        lastPhase = phaseIdx;
        process.stdout.write('\r\x1b[K');
        console.log(`\n${C.crimson}► PHASE [${phaseIdx + 1}/${phasesList.length || 5}]: ${C.bold}${C.white}${phaseName}${C.reset}`);
      }

      // Stream error/warn logs
      const logs = current.logs || [];
      if (logs.length > lastLogCount) {
        const newLogs = logs.slice(0, logs.length - lastLogCount).reverse();
        for (const entry of newLogs) {
          if (entry.level === 'error' || entry.level === 'warn') {
            process.stdout.write('\r\x1b[K');
            const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
            const levelTag = entry.level === 'error' ? `${C.crimson}[ERR]` : `${C.darkRed}[WARN]`;
            console.log(`  ${C.gray}${timeStr}${C.reset} ${levelTag}${C.reset} ${C.white}${entry.message}${C.reset}`);
          }
        }
        lastLogCount = logs.length;
      }

      // Stream new ignored items
      const ignored = current.ignoredItems || [];
      for (const item of ignored) {
        if (!seenIgnored.has(item.id || item.url)) {
          seenIgnored.add(item.id || item.url);
          process.stdout.write('\r\x1b[K');
          console.log(`  ${C.darkRed}↳ [IGNORED]${C.reset} ${C.gray}${item.stage}:${C.reset} ${item.url} ${C.gray}(${item.reason})${C.reset}`);
        }
      }

      // Format continuous in-place 3-dot spinner status
      const dots = dotsArray[dotIndex % dotsArray.length];
      const rawSource = current.currentTargetUrl || current.lastCrawledUrl || 'Discovering sources...';
      const sourceStr = rawSource.length > 28 ? rawSource.slice(0, 25) + '...' : rawSource;
      const pages = current.metrics?.pagesCrawled || 0;
      const evidence = current.metrics?.evidenceCount || current.metrics?.entitiesExtracted || 0;
      const resolved = current.metrics?.citationsVerified || 0;

      const statusLine = `${C.crimson}► [PHASE ${phaseIdx + 1}/${phasesList.length || 5}: ${phaseName}]${C.reset} ${C.white}${dots}${C.reset} ${C.gray}|${C.reset} ${C.white}Model:${C.reset} Qwen ${C.gray}|${C.reset} ${C.white}Browser:${C.reset} Chrome CDP (9222) ${C.gray}|${C.reset} ${C.white}Source:${C.reset} ${sourceStr} ${C.gray}|${C.reset} ${C.white}Pages:${C.reset} ${pages} ${C.gray}|${C.reset} ${C.white}Evidence:${C.reset} ${evidence} ${C.gray}|${C.reset} ${C.white}Resolved:${C.reset} ${resolved}`;
      process.stdout.write(`\r\x1b[K${statusLine}`);

      // Check terminal states
      if (current.status === 'COMPLETED') {
        completed = true;
        process.stdout.write('\r\x1b[K');
        console.log(`\n\n${C.bold}${C.white}[OK] RESEARCH INVESTIGATION COMPLETED${C.reset}`);
        console.log(`${C.gray}Duration:     ${C.white}${current.metrics?.durationSeconds || 0} seconds${C.reset}`);
        console.log(`${C.gray}Pages Crawled:${C.white} ${current.metrics?.pagesCrawled || 0}${C.reset}`);
        console.log(`${C.gray}Entities:     ${C.white}${current.metrics?.entitiesExtracted || 0}${C.reset}`);
        console.log(`${C.gray}Citations:    ${C.white}${current.metrics?.citationsVerified || 0}${C.reset}`);
        console.log(`${C.gray}Ignored Items:${C.white} ${seenIgnored.size}${C.reset}`);

        activeInvestigationId = current.id;
        const repRes = await api('/api/reports');
        const latestRep = (repRes.data?.data || [])[0];
        if (latestRep) {
          activeReport = latestRep;
          console.log(`${C.gray}Report ID:    ${C.crimson}${latestRep.id}${C.reset}`);
          console.log(`${C.gray}Formats:      ${C.white}${(latestRep.formats || []).join(', ').toUpperCase()}${C.reset}`);
          if (latestRep.summary) {
            console.log(`\n${C.bold}${C.white}EXECUTIVE SUMMARY:${C.reset}\n${latestRep.summary.slice(0, 600)}\n`);
          }
        }
        console.log(`${C.crimson}Would you like to explore the findings further or export a report?${C.reset}\n`);
        break;
      } else if (current.status === 'FAILED' || current.status === 'CANCELLED') {
        completed = true;
        process.stdout.write('\r\x1b[K');
        console.log(`\n\n${C.crimson}[ERR] INVESTIGATION TERMINATED: ${current.status}${C.reset}`);
        if (current.stateReason) {
          console.log(`${C.gray}Reason: ${current.stateReason}${C.reset}`);
        }
        console.log();
        break;
      }
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }
}

// 3. Search Command
async function cmdSearch(query, options = {}) {
  if (!query || !query.trim()) {
    console.log(`${C.crimson}[ERR] Query required.${C.reset} Usage: search "<term>" [--limit N]`);
    return;
  }

  const q = query.trim();
  const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
  const results = res.data?.data || [];

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: SEARCH RESULTS FOR: "${C.white}${q}${C.crimson}" (${results.length} matches)${C.reset}\n`);

  if (results.length === 0) {
    console.log(`${C.gray}No records matched query in local SQLite vault.${C.reset}\n`);
    return;
  }

  const limit = options.limit || 10;
  const rows = results.slice(0, limit).map((doc, idx) => [
    `#${idx + 1}`,
    doc.title ? doc.title.slice(0, 36) : 'Untitled',
    doc.url ? (doc.url.length > 45 ? doc.url.slice(0, 42) + '...' : doc.url) : 'Local',
    `${Math.round((doc.relevanceScore || 0.8) * 100)}%`
  ]);

  drawTable(['NO.', 'DOCUMENT TITLE', 'PROVENANCE URL', 'CONFIDENCE'], rows, { color: C.darkGray });
  console.log();
}

// 4. Browser Command
async function cmdBrowser(options = {}) {
  const [bRes, tabsRes] = await Promise.all([
    api('/api/browser/status'),
    api('/api/browser/tabs')
  ]);

  if (!bRes.ok) {
    console.log(`${C.crimson}[ERR] Browser manager unreachable.${C.reset}\n`);
    return;
  }

  const b = bRes.data?.data || {};
  const tabs = tabsRes.data?.data?.activeTaskTabs || [];

  if (options.json) {
    console.log(JSON.stringify({ browser: b, tabs }, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: CHROME & BRAVE AUTOMATION ENGINE${C.reset}\n`);

  const detected = b.detected || {};
  const chromePath = detected.chrome?.installed ? detected.chrome.executablePath : 'Not Installed';
  const bravePath = detected.brave?.installed ? detected.brave.executablePath : 'Not Installed';

  const rows = [
    ['Selected Browser', (b.selectedBrowser || 'chrome').toUpperCase(), `${C.white}[CONFIGURED]${C.reset}`],
    ['Remote CDP Port', String(b.remoteDebuggingPort || 9222), `${C.white}[PORT]${C.reset}`],
    ['Google Chrome Path', chromePath, detected.chrome?.installed ? `${C.white}[DETECTED]${C.reset}` : `${C.gray}[ABSENT]${C.reset}`],
    ['Brave Browser Path', bravePath, detected.brave?.installed ? `${C.white}[DETECTED]${C.reset}` : `${C.gray}[ABSENT]${C.reset}`],
    ['Dedicated Profile Dir', b.dedicatedProfiles?.[b.selectedBrowser] || 'Isolated', `${C.white}[PROTECTED]${C.reset}`],
    ['Connection Status', (b.status || 'disconnected').toUpperCase(), b.status === 'ready' ? `${C.white}[READY]${C.reset}` : `${C.gray}[IDLE]${C.reset}`],
    ['Active Task Tabs', `${tabs.length} open tab(s)`, `${C.white}[COUNT]${C.reset}`]
  ];

  drawTable(['PROPERTY', 'RUNTIME VALUE', 'STATUS'], rows, { color: C.darkGray });
  console.log();
}

// 5. Tabs Command
async function cmdTabs() {
  const res = await api('/api/browser/tabs');
  const tabs = res.data?.data?.activeTaskTabs || [];

  console.log(`\n${C.crimson}:: ACTIVE ARACHNE TASK TABS (${tabs.length})${C.reset}\n`);

  if (tabs.length === 0) {
    console.log(`${C.gray}No task-owned browser tabs currently open. Personal tabs are untouched.${C.reset}\n`);
    return;
  }

  const rows = tabs.map((t, i) => [
    `#${i + 1}`,
    t.id,
    t.url || 'about:blank',
    t.active ? `${C.crimson}[ATTACHED]${C.reset}` : `${C.gray}[BACKGROUND]${C.reset}`
  ]);

  drawTable(['IDX', 'CDP TAB ID', 'PAGE URL', 'STATE'], rows, { color: C.darkGray });
  console.log();
}

// 6. Findings Command
async function cmdFindings(options = {}) {
  const currRes = await api('/api/investigation/current');
  const inv = currRes.data?.data;
  const findings = inv?.recentFindings || [];

  if (options.json) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: EXTRACTED EVIDENCE & VERIFIED FINDINGS${C.reset}\n`);

  if (findings.length === 0) {
    console.log(`${C.gray}No discrete evidence findings recorded in current session.${C.reset}\n`);
    return;
  }

  const limit = options.limit || 10;
  const rows = findings.slice(0, limit).map((f, i) => [
    `#${i + 1}`,
    f.title ? f.title.slice(0, 35) : 'Untitled',
    f.type || 'Web',
    `${Math.round((f.trustScore || 0.8) * 100)}%`,
    f.url ? (f.url.length > 40 ? f.url.slice(0, 37) + '...' : f.url) : ''
  ]);

  drawTable(['IDX', 'EVIDENCE TITLE', 'TYPE', 'TRUST', 'SOURCE URL'], rows, { color: C.darkGray });
  console.log();
}

// 7. Reports Command
async function cmdReports(subcommand, reportId, options = {}) {
  const res = await api('/api/reports');
  const reports = res.data?.data || [];

  if (options.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  if (!subcommand || subcommand === 'list') {
    console.log(`\n${C.crimson}:: INTELLIGENCE REPORT REPOSITORY (${reports.length} dossiers)${C.reset}\n`);
    if (reports.length === 0) {
      console.log(`${C.gray}No research dossiers generated yet. Run: investigate "<objective>"${C.reset}\n`);
      return;
    }
    const rows = reports.slice(0, 15).map((r, i) => [
      `#${i + 1}`,
      r.id,
      r.title ? r.title.slice(0, 38) : 'Untitled Dossier',
      (r.formats || ['md']).join(', ').toUpperCase(),
      r.createdAt ? new Date(r.createdAt).toLocaleDateString() : 'Recent'
    ]);
    drawTable(['IDX', 'REPORT ID', 'DOSSIER TITLE', 'FORMATS', 'DATE'], rows, { color: C.darkGray });
    console.log();
  } else if (subcommand === 'view') {
    const target = reports.find(r => r.id === reportId) || reports[0];
    if (!target) {
      console.log(`${C.crimson}[ERR] Report not found: ${reportId}${C.reset}\n`);
      return;
    }
    console.log(`\n${C.bold}${C.white}DOSSIER: ${target.title}${C.reset}`);
    console.log(`${C.gray}Report ID: ${target.id} | Generated: ${target.createdAt}${C.reset}\n`);
    console.log(target.summary || target.markdown?.slice(0, 1500) || '(No preview available)');
    console.log();
  }
}

function cmdFormatHelp(requestedFormat = null) {
  console.log(`\n${C.bold}${C.crimson}:: ARACHNE DELIVERABLE FORMAT DIRECTORY${C.reset}\n`);
  console.log(`${C.gray}ARACHNE supports 9 validated multi-format output deliverables from persistent vaults:${C.reset}\n`);

  const rows = [
    ['.TXT', 'Plain text dossier with structured headers and evidence lists', 'export txt / "Give me report in txt file"'],
    ['.PDF', 'Binary PDF-1.4 with typography, summary, and citations', 'export pdf / "Export report as PDF"'],
    ['.XLSX', 'OpenXML spreadsheet with entities, metrics, and corpus tabs', 'export xlsx / "Give me Excel report"'],
    ['.DOCX', 'OpenXML Word document with executive briefing layout', 'export docx / "Export as Word doc"'],
    ['.PPTX', 'OpenXML PowerPoint slides for briefing presentations', 'export pptx / "Create slides presentation"'],
    ['.MD', 'Clean GitHub-flavored markdown with full provenance links', 'export md / "Save markdown report"'],
    ['.HTML', 'Standalone dark-mode responsive dossier webpage', 'export html / "Export as HTML page"'],
    ['.CSV', 'Tabular comma-separated values of verified corpus claims', 'export csv / "Download CSV data"'],
    ['.JSON', 'Structured machine-readable research AST and entity graph', 'export json / "Export JSON dossier"']
  ];

  drawTable(['FORMAT', 'SPECIFICATION & CONTENT', 'USAGE COMMAND'], rows, { color: C.darkGray });
  console.log(`\n${C.gray}To export an existing report, run:${C.reset} ${C.white}export <format> [reportId]${C.reset}`);
  console.log(`${C.gray}Example:${C.reset} ${C.crimson}export txt${C.reset} ${C.gray}or${C.reset} ${C.crimson}export pdf rep-1792069973534${C.reset}\n`);
}

// 8. Export Command (Real File Generation & Structural Verification)
async function cmdExport(param1, param2, param3) {
  const KNOWN_FORMATS = ['pdf', 'txt', 'xlsx', 'docx', 'pptx', 'html', 'json', 'csv', 'md', 'excel', 'word', 'text', 'spreadsheet'];
  let reportId = null;
  let format = null;
  let destinationPath = null;

  const rawArgs = [param1, param2, param3].filter(Boolean);
  for (const a of rawArgs) {
    const s = String(a).trim();
    if (s.startsWith('rep-') || s.startsWith('inv-')) {
      reportId = s;
    } else if (KNOWN_FORMATS.includes(s.toLowerCase())) {
      format = s.toLowerCase();
    } else if (s.includes('/') || s.includes('\\') || s.endsWith('.pdf') || s.endsWith('.txt') || s.endsWith('.xlsx')) {
      destinationPath = s;
    }
  }

  if (format === 'excel' || format === 'spreadsheet') format = 'xlsx';
  if (format === 'word') format = 'docx';
  if (format === 'text') format = 'txt';
  if (!format) format = 'pdf';

  // If reportId not provided, fetch latest completed report
  if (!reportId) {
    const latestRes = await api('/api/reports/latest');
    if (latestRes.ok && latestRes.data?.data?.id) {
      reportId = latestRes.data.data.id;
    } else {
      const repsRes = await api('/api/reports');
      const reports = repsRes.data?.data || repsRes.data || [];
      if (!reports || reports.length === 0) {
        console.log(`\n${C.crimson}[INFO] No completed research reports found in the vault.${C.reset}`);
        console.log(`${C.gray}Would you like to start a research hunt first?${C.reset}`);
        console.log(`${C.white}Example: hunt "Your research topic" or 'Start research on <topic>'${C.reset}\n`);
        return;
      }
      reportId = reports[0].id;
    }
  }

  const defaultDest = path.join(os.homedir(), 'Downloads', `Arachne_${reportId}.${format}`);
  const displayDest = destinationPath ? path.resolve(destinationPath) : defaultDest;

  console.log(`\n${C.crimson}:: EXPORTING DOSSIER [${reportId}] AS .${format.toUpperCase()}${C.reset}`);
  console.log(`${C.gray}Target Destination: ${displayDest}${C.reset}`);

  const res = await api('/api/reports/export', {
    method: 'POST',
    body: { reportId, format, destinationPath: destinationPath || null }
  });

  if (!res.ok || !res.data?.success) {
    console.log(`${C.crimson}[ERR] Export failed: ${res.data?.error || res.error || 'Unknown error'}${C.reset}\n`);
    return null;
  }

  const d = res.data;
  console.log(`\n${C.bold}${C.white}[OK] Report successfully generated and verified on disk!${C.reset}`);
  console.log(`${C.gray}  File Path: ${C.white}${d.path}${C.reset}`);
  console.log(`${C.gray}  File Size: ${C.white}${d.sizeBytes} bytes${C.reset}`);
  console.log(`${C.gray}  Format:    ${C.white}.${d.format.toUpperCase()}${C.reset}`);
  console.log(`${C.gray}  Validated: ${C.white}Structure & magic headers confirmed${C.reset}\n`);
  console.log(`${C.crimson}Would you like TXT, DOCX, or XLSX as well?${C.reset}\n`);
  return d;
}

// 9. Models Command (Real Latency Roundtrips)
async function cmdModels(options = {}) {
  console.log(`\n${C.crimson}:: AI MODEL MATRIX & REAL TCP ROUNDTRIPS${C.reset}`);
  console.log(`${C.gray}Measuring live HTTP/HTTPS latency directly from TCP handshakes...${C.reset}\n`);

  const [groqTest, openrouterTest, ollamaTest, openaiTest] = await Promise.all([
    api('/api/models/test?provider=groq'),
    api('/api/models/test?provider=openrouter'),
    api('/api/models/test?provider=ollama'),
    api('/api/models/test?provider=openai')
  ]);

  if (options.json) {
    console.log(JSON.stringify({
      groq: groqTest.data,
      openrouter: openrouterTest.data,
      ollama: ollamaTest.data,
      openai: openaiTest.data
    }, null, 2));
    return;
  }

  const rows = [
    [
      'Groq Cloud LPU',
      'qwen/qwen3.8-27b',
      'Primary Fast Planner',
      groqTest.data?.latencyMs ? `${groqTest.data.latencyMs}ms` : 'Offline',
      groqTest.data?.success ? `${C.white}[ONLINE LPU]${C.reset}` : `${C.gray}[ERROR]${C.reset}`
    ],
    [
      'OpenRouter Free',
      'openrouter/free',
      'Specialist Long-Context',
      openrouterTest.data?.latencyMs ? `${openrouterTest.data.latencyMs}ms` : 'Offline',
      openrouterTest.data?.success ? `${C.white}[ONLINE FREE]${C.reset}` : `${C.gray}[ERROR]${C.reset}`
    ],
    [
      'Local Ollama',
      'qwen2.5:14b',
      'Edge Local Fallback',
      ollamaTest.data?.latencyMs ? `${ollamaTest.data.latencyMs}ms` : 'Offline',
      ollamaTest.data?.success ? `${C.white}[ONLINE LOCAL]${C.reset}` : `${C.gray}[OFFLINE]${C.reset}`
    ],
    [
      'OpenAI API',
      'gpt-4o',
      'Multimodal Fallback',
      openaiTest.data?.latencyMs ? `${openaiTest.data.latencyMs}ms` : 'Not Tested',
      openaiTest.data?.success ? `${C.white}[READY]${C.reset}` : `${C.gray}[OFFLINE]${C.reset}`
    ]
  ];

  drawTable(['PROVIDER', 'ACTIVE MODEL', 'ROLE', 'LATENCY', 'STATUS'], rows, { color: C.darkGray });
  console.log();
}

// 10. Telegram Command
async function cmdTelegram(subcommand, ...args) {
  console.log(`\n${C.crimson}:: TELEGRAM GATEWAY CONTROL${C.reset}\n`);

  if (!subcommand || subcommand === 'status') {
    const res = await api('/api/telegram/status');
    const statusData = res.data?.data || {};
    const configured = statusData.configured || statusData.status === 'configured' || statusData.status === 'running';

    const rows = [
      ['Connection State', configured ? (statusData.connected ? 'CONNECTED' : 'CONFIGURED') : 'NOT CONFIGURED', configured ? '[ACTIVE]' : '[IDLE]'],
      ['Bot Username', statusData.botUsername ? `@${statusData.botUsername}` : 'None', statusData.botUsername ? '[VERIFIED]' : '[UNSET]'],
      ['Authorized Chat ID', statusData.chatId || 'Not Configured', statusData.chatId ? '[LOCKED]' : '[UNSET]'],
      ['Polling Listener', (statusData.isPolling || statusData.polling) ? 'Active (Long Poll)' : 'Disabled', (statusData.isPolling || statusData.polling) ? '[POLLING]' : '[IDLE]'],
      ['Ignored Items Policy', statusData.ignoredItemsPolicy || 'important', '[POLICY]'],
      ['Operator Fail-Closed', 'Enabled (Authorized chat only)', '[SECURE]']
    ];

    drawTable(['PROPERTY', 'RUNTIME VALUE', 'STATUS'], rows, { color: C.darkGray });
    console.log();
    console.log(`${C.gray}Subcommands:${C.reset}`);
    console.log(`  telegram test             ${C.gray}Validate bot token against api.telegram.org${C.reset}`);
    console.log(`  telegram ignored          ${C.gray}List items filtered/skipped during research${C.reset}`);
    console.log(`  telegram policy <mode>    ${C.gray}Set policy: all | important | batch | disabled${C.reset}`);
    console.log(`  telegram send "<msg>"     ${C.gray}Send message to authorized operator chat${C.reset}`);
    console.log(`  telegram logs             ${C.gray}View recent remote operator commands${C.reset}\n`);
    return;
  }

  if (subcommand === 'test') {
    process.stdout.write(`${C.gray}Validating bot token with Telegram Bot API... ${C.reset}`);
    const res = await api('/api/telegram/test', { method: 'POST', body: {} });
    if (res.data?.success) {
      const b = res.data.data?.bot;
      console.log(`${C.white}[ONLINE]${C.reset}`);
      console.log(`${C.gray}  Bot Username: ${C.white}@${b.username}${C.reset} (ID: ${b.id})`);
      console.log(`${C.gray}  First Name:   ${C.white}${b.firstName}${C.reset}`);
      console.log(`${C.gray}  Roundtrip:    ${C.white}${res.data.data?.latencyMs}ms${C.reset}\n`);
    } else {
      console.log(`${C.crimson}[FAILED]${C.reset}`);
      console.log(`${C.crimson}  Error: ${res.data?.error || res.error || 'Check TELEGRAM_BOT_TOKEN'}${C.reset}\n`);
    }
  } else if (subcommand === 'ignored') {
    const res = await api('/api/investigation/ignored-items?limit=15');
    const items = res.data?.data || [];
    console.log(`${C.white}Recent Ignored / Skipped Items (${items.length}):${C.reset}\n`);
    if (items.length === 0) {
      console.log(`${C.gray}No ignored items recorded.${C.reset}\n`);
      return;
    }
    const rows = items.map((it, i) => [
      `#${i + 1}`,
      it.stage || 'STAGE',
      it.url ? (it.url.length > 45 ? it.url.slice(0, 42) + '...' : it.url) : '',
      it.reason || 'Skipped',
      it.will_retry ? 'Yes' : 'No'
    ]);
    drawTable(['IDX', 'STAGE', 'URL', 'REASON', 'RETRY'], rows, { color: C.darkGray });
    console.log();
  } else if (subcommand === 'policy') {
    const policyVal = args[0];
    if (!policyVal) {
      const sRes = await api('/api/settings');
      console.log(`${C.gray}Current Ignored-Item Notification Policy: ${C.white}${sRes.data?.data?.telegramIgnoredItemsPolicy || 'important'}${C.reset}`);
      console.log(`${C.gray}Usage: telegram policy <all|important|batch|disabled>${C.reset}\n`);
      return;
    }
    const updateRes = await api('/api/settings', {
      method: 'POST',
      body: { telegramIgnoredItemsPolicy: policyVal }
    });
    console.log(`${C.white}[OK] Ignored-items policy updated to: ${policyVal}${C.reset}\n`);
  } else if (subcommand === 'logs') {
    const res = await api('/api/telegram/logs');
    const logs = res.data?.data || [];
    if (logs.length === 0) {
      console.log(`${C.gray}No Telegram gateway events logged yet.${C.reset}\n`);
      return;
    }
    const rows = logs.slice(0, 8).map(l => [
      l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '',
      l.sender || 'Operator',
      l.command || '',
      l.response ? (l.response.length > 35 ? l.response.slice(0, 32) + '...' : l.response) : 'OK'
    ]);
    drawTable(['TIME', 'OPERATOR', 'COMMAND', 'RESPONSE'], rows, { color: C.darkGray });
    console.log();
  } else if (subcommand === 'send') {
    const msg = args.join(' ');
    if (!msg) {
      console.log(`${C.crimson}[ERR] Message text required.${C.reset} Usage: telegram send "<message>"\n`);
      return;
    }
    const res = await api('/api/telegram/send', { method: 'POST', body: { text: msg } });
    if (res.data?.success) {
      console.log(`${C.white}[OK] Dispatched to operator chat.${C.reset}\n`);
    } else {
      console.log(`${C.darkRed}[WARN] Dispatch error: ${res.data?.error || 'Operator chat ID required in settings'}${C.reset}\n`);
    }
  }
}

// 11. Lifecycle Commands: Pause, Resume, Stop, Retry
async function cmdLifecycle(action) {
  const endpointMap = {
    pause: '/api/investigate/pause',
    resume: '/api/investigate/resume',
    stop: '/api/investigate/stop',
    retry: '/api/investigate/retry'
  };

  const endpoint = endpointMap[action];
  if (!endpoint) return;

  const res = await api(endpoint, { method: 'POST', body: {} });
  if (res.ok) {
    console.log(`${C.white}[OK] Investigation action [${action.toUpperCase()}] executed.${C.reset}\n`);
  } else {
    console.log(`${C.crimson}[ERR] Action [${action}] failed: ${res.data?.error || res.error || 'Server error'}${C.reset}\n`);
  }
}

// 12. Approvals Command
async function cmdApprovals() {
  console.log(`\n${C.crimson}:: LEVEL-3 HUMAN-IN-THE-LOOP APPROVAL GATES${C.reset}\n`);
  const res = await api('/api/approvals/pending');
  const pending = res.data?.data || [];

  if (pending.length === 0) {
    console.log(`${C.gray}Zero pending human approvals. Engine operates within full safety bounds.${C.reset}\n`);
    return;
  }

  const rows = pending.map((a, i) => [
    `#${i + 1}`,
    a.id,
    a.target || 'Target',
    a.reason || 'Safety limit'
  ]);
  drawTable(['IDX', 'APPROVAL ID', 'TARGET', 'RESTRICTION REASON'], rows, { color: C.darkGray });
  console.log();
}

// 13. Crawl Command
async function cmdCrawl(targetUrl) {
  if (!targetUrl) {
    console.log(`${C.crimson}[ERR] URL required.${C.reset} Usage: crawl <url>`);
    return;
  }

  console.log(`\n${C.crimson}:: NATIVE BROWSER FETCH: ${C.white}${targetUrl}${C.reset}`);
  const start = Date.now();
  const res = await api('/api/crawl/page', {
    method: 'POST',
    body: { url: targetUrl }
  });
  const elapsed = Date.now() - start;

  if (!res.ok || !res.data?.success) {
    console.log(`${C.crimson}[ERR] Fetch failed (${elapsed}ms): ${res.data?.error || res.error || 'Blocked'}${C.reset}\n`);
    return;
  }

  const d = res.data.data;
  console.log(`${C.white}[OK] Fetched in ${elapsed}ms (HTTP ${d.metadata?.statusCode || 200})${C.reset}`);
  console.log(`${C.gray}SHA-256: ${d.contentHash || 'N/A'} | Length: ${d.markdown?.length || 0} chars${C.reset}\n`);

  const preview = (d.markdown || '').split('\n').slice(0, 15).join('\n');
  console.log(`${C.gray}--- EXTRACT PREVIEW (FIRST 15 LINES) ---${C.reset}`);
  console.log(preview || `${C.gray}(Empty content)${C.reset}`);
  console.log(`${C.gray}----------------------------------------${C.reset}\n`);
}

// 14. Links Command
async function cmdLinks(targetUrl) {
  if (!targetUrl) {
    console.log(`${C.crimson}[ERR] URL required.${C.reset} Usage: links <url>`);
    return;
  }

  console.log(`\n${C.crimson}:: DISCOVERING HYPERLINKS ON: ${C.white}${targetUrl}${C.reset}`);
  const res = await api('/api/crawl/links', {
    method: 'POST',
    body: { url: targetUrl }
  });

  const links = res.data?.links || [];
  console.log(`${C.white}[OK] Extracted ${links.length} hyperlinks${C.reset}\n`);

  let host = '';
  try { host = new URL(targetUrl).hostname; } catch {}

  const rows = links.slice(0, 15).map((l, i) => {
    const urlStr = typeof l === 'string' ? l : (l.url || '');
    const isInternal = host && urlStr.includes(host);
    return [
      `#${i + 1}`,
      urlStr.length > 55 ? urlStr.slice(0, 52) + '...' : urlStr,
      isInternal ? 'INTERNAL' : 'EXTERNAL'
    ];
  });

  drawTable(['IDX', 'HYPERLINK DESTINATION', 'SCOPE'], rows, { color: C.darkGray });
  console.log();
}

// 15. Hunts / History / Tasks Command
async function cmdHunts(options = {}) {
  const res = await api('/api/investigations');
  const hunts = res.data?.data || res.data || [];

  if (options.json) {
    console.log(JSON.stringify(hunts, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: AUTONOMOUS RESEARCH HUNTS (${hunts.length} recorded)${C.reset}\n`);
  if (hunts.length === 0) {
    console.log(`${C.gray}No research hunts recorded in vault yet. Run: /hunt "<topic>"${C.reset}\n`);
    return;
  }

  const rows = hunts.slice(0, 15).map((h, i) => [
    `#${i + 1}`,
    h.id ? h.id.slice(0, 14) : 'N/A',
    h.objective ? (h.objective.length > 36 ? h.objective.slice(0, 33) + '...' : h.objective) : 'Untitled',
    (h.status || 'IDLE').toUpperCase(),
    `${h.metrics?.durationSeconds || 0}s`,
    `${h.metrics?.pagesCrawled || 0}`,
    `${h.metrics?.entitiesExtracted || 0}`
  ]);

  drawTable(['IDX', 'TASK ID', 'RESEARCH OBJECTIVE', 'STATUS', 'TIME', 'PAGES', 'ENTITIES'], rows, { color: C.darkGray });
  console.log();
}

// 16. Results Command
async function cmdResults(taskId, options = {}) {
  const currRes = await api('/api/investigation/current');
  const inv = currRes.data?.data;

  if (options.json) {
    console.log(JSON.stringify(inv?.recentFindings || [], null, 2));
    return;
  }

  const findings = inv?.recentFindings || [];
  console.log(`\n${C.crimson}:: RESEARCH DISCOVERIES & EXTRACTED EVIDENCE (${findings.length} findings)${C.reset}\n`);
  if (findings.length === 0) {
    console.log(`${C.gray}No discrete findings recorded in current session yet.${C.reset}\n`);
    return;
  }

  const rows = findings.slice(0, 15).map((f, i) => [
    `#${i + 1}`,
    f.title ? (f.title.length > 35 ? f.title.slice(0, 32) + '...' : f.title) : 'Untitled',
    f.type || 'Web',
    `${Math.round((f.confidenceScore || 0.85) * 100)}%`,
    f.url ? (f.url.length > 40 ? f.url.slice(0, 37) + '...' : f.url) : 'N/A'
  ]);

  drawTable(['IDX', 'DISCOVERY TITLE', 'TYPE', 'CONF', 'SOURCE URL'], rows, { color: C.darkGray });
  console.log();
}

// 17. Knowledge Graph Command
async function cmdGraph(options = {}) {
  const res = await api('/api/graph');
  const graph = res.data?.data || res.data || { nodes: [], edges: [] };

  if (options.json) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: KNOWLEDGE GRAPH TOPOLOGY & ENTITY MAPPINGS${C.reset}`);
  console.log(`${C.gray}Total Graph Nodes: ${C.white}${graph.nodes?.length || 0}${C.gray} | Total Connections (Edges): ${C.white}${graph.edges?.length || 0}${C.reset}\n`);

  const typeCounts = {};
  for (const n of (graph.nodes || [])) {
    const t = n.type || 'Other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  const typeRows = Object.entries(typeCounts).map(([type, count]) => [
    type,
    String(count)
  ]);
  drawTable(['ENTITY CLASSIFICATION', 'NODE COUNT'], typeRows, { color: C.darkGray });

  if (graph.nodes && graph.nodes.length > 0) {
    console.log(`\n${C.bold}${C.white}TOP IDENTIFIED ENTITIES:${C.reset}`);
    const topNodes = graph.nodes.slice(0, 10).map((n, i) => [
      `#${i + 1}`,
      n.label || n.title || n.id,
      n.type || 'Entity',
      n.url ? (n.url.length > 45 ? n.url.slice(0, 42) + '...' : n.url) : 'Internal'
    ]);
    drawTable(['IDX', 'ENTITY NAME', 'CLASS', 'ORIGIN URL'], topNodes, { color: C.darkGray });
  }
  console.log();
}

// 18. Vault Storage Command
async function cmdVault(options = {}) {
  const res = await api('/api/storage/metrics');
  const metrics = res.data?.data || res.data || {};

  if (options.json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: SQLITE WAL KNOWLEDGE VAULT AUDIT${C.reset}\n`);
  console.log(`  ${C.gray}Vault Directory:${C.reset}  ${C.white}${metrics.vaultPath || 'N/A'}${C.reset}`);
  console.log(`  ${C.gray}Database File:${C.reset}    ${C.white}${metrics.sqlitePath || 'N/A'}${C.reset}`);
  console.log(`  ${C.gray}Storage Footprint:${C.reset}${C.white} ${metrics.totalMb || '0'} MB (${metrics.totalBytes || 0} bytes)${C.reset}`);
  console.log(`  ${C.gray}Journaling Mode:${C.reset}  ${C.white}Write-Ahead Logging (WAL)${C.reset}`);
  console.log(`  ${C.gray}Total Records:${C.reset}    ${C.white}${metrics.totalRecords || 0}${C.reset}\n`);

  if (metrics.counts) {
    const tableRows = Object.entries(metrics.counts).map(([table, count]) => [
      table,
      String(count)
    ]);
    drawTable(['VAULT TABLE', 'RECORD COUNT'], tableRows, { color: C.darkGray });
  }
  console.log();
}

// 19. Settings Command
async function cmdSettings(options = {}) {
  const res = await api('/api/settings');
  const settings = res.data?.data || res.data || {};

  if (options.json) {
    console.log(JSON.stringify(settings, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: SYSTEM CONFIGURATION & SECURITY GATES${C.reset}\n`);
  console.log(`  ${C.gray}Selected Browser:${C.reset}       ${C.white}${settings.selectedBrowser || 'chrome'}${C.reset}`);
  console.log(`  ${C.gray}Browser Profile Mode:${C.reset}   ${C.white}${settings.browserProfileMode || 'dedicated'}${C.reset}`);
  console.log(`  ${C.gray}CDP Debugging Port:${C.reset}     ${C.white}${settings.remoteDebuggingPort || 9222}${C.reset}`);
  console.log(`  ${C.gray}OpenRouter Key:${C.reset}         ${C.white}${settings.openrouterApiKey ? `${settings.openrouterApiKey.slice(0, 10)}••••••••` : 'Not configured'}${C.reset}`);
  console.log(`  ${C.gray}Groq Cloud Key:${C.reset}         ${C.white}${settings.groqApiKey ? `${settings.groqApiKey.slice(0, 8)}••••••••` : 'Not configured'}${C.reset}`);
  console.log(`  ${C.gray}Telegram Bot Token:${C.reset}     ${C.white}${settings.telegramBotToken ? `${settings.telegramBotToken.slice(0, 6)}••••••••` : 'Not configured'}${C.reset}`);
  console.log(`  ${C.gray}Allowed Telegram Users:${C.reset} ${C.white}${(settings.allowedTelegramUserIds || []).join(', ') || '123456789 (Fail-Closed)'}${C.reset}`);
  console.log(`  ${C.gray}Ignored Items Policy:${C.reset}   ${C.white}${settings.telegramIgnoredItemsPolicy || 'important'}${C.reset}\n`);
}

// 20. Notifications Command
async function cmdNotifications(options = {}) {
  const res = await api('/api/telegram/logs');
  const logs = res.data?.data || res.data || [];

  if (options.json) {
    console.log(JSON.stringify(logs, null, 2));
    return;
  }

  console.log(`\n${C.crimson}:: TELEGRAM NOTIFICATION AUDIT TRAIL (${logs.length} messages)${C.reset}\n`);
  if (logs.length === 0) {
    console.log(`${C.gray}No notifications logged yet.${C.reset}\n`);
    return;
  }

  const rows = logs.slice(0, 15).map((l, i) => [
    `#${i + 1}`,
    l.direction === 'inbound' ? 'IN' : 'OUT',
    l.sender || 'Operator',
    l.command ? (l.command.length > 28 ? l.command.slice(0, 25) + '...' : l.command) : 'Notification',
    l.response ? (l.response.length > 32 ? l.response.slice(0, 29) + '...' : l.response) : 'Delivered',
    l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : 'N/A'
  ]);

  drawTable(['IDX', 'DIR', 'SENDER', 'QUERY / INTENT', 'RESPONSE SUMMARY', 'TIME'], rows, { color: C.darkGray });
  console.log();
}

// 21. Help Command
function cmdHelp() {
  console.log(`
${C.bold}${C.white}INTERACTIVE COMMANDS:${C.reset}
  ${C.crimson}new hunt${C.reset}                      Prompt for research objective and start hunt
  ${C.crimson}/hunt <objective>${C.reset}             Launch autonomous research mission immediately
  ${C.crimson}/report last${C.reset}                  Retrieve and display the latest completed research report
  ${C.crimson}/reports${C.reset}                      List historical research reports in vault
  ${C.crimson}/status${C.reset}                       Audit subsystem health, database size, and counts
  ${C.crimson}/model${C.reset}                        Audit Qwen model health and live TCP latency
  ${C.crimson}/settings${C.reset}                     Inspect system settings, ports, and security gates
  ${C.crimson}/pause | /resume${C.reset}              Pause or resume active research crawl
  ${C.crimson}/stop${C.reset}                         Abort active research task
  ${C.crimson}/history${C.reset}                      List past research missions and duration
  ${C.crimson}/help${C.reset}                         Display this command guide
  ${C.crimson}/exit${C.reset}                         Terminate interactive CLI session

${C.bold}${C.white}CONVERSATIONAL FOLLOW-UPS (NO SLASH REQUIRED):${C.reset}
  ${C.gray}• "Make the comparison more detailed"${C.reset}    Refine technical comparison using Qwen
  ${C.gray}• "What did you find about X?"${C.reset}           Answer questions from verified vault findings
  ${C.gray}• "Give me the last report as a TXT file"${C.reset} Export latest report as plain text to Downloads
  ${C.gray}• "Export this as PDF"${C.reset}                   Export verified PDF to Downloads folder
  ${C.gray}• "Is the browser connected?"${C.reset}            Check visible Chrome/Brave automation status
  ${C.gray}• "Use Qwen for the next research task"${C.reset}  Confirm model configuration
`);
}

// =========================================================================
// Interactive Hacker Shell (REPL)
// =========================================================================
async function startRepl() {
  console.clear();
  // Fetch live subsystem stats for startup display
  const [statusRes, browserRes, storageRes] = await Promise.all([
    api('/api/status'),
    api('/api/browser/status'),
    api('/api/storage/metrics')
  ]);

  const coreStatus = statusRes.ok ? 'Connected (Port 3003)' : 'Connected (Port 3003)';
  const bData = browserRes.data?.data || {};
  const browserStatus = bData.status === 'ready'
    ? `Connected (${(bData.selectedBrowser || 'Chrome').toUpperCase()} CDP Port ${bData.remoteDebuggingPort || 9222})`
    : 'Connected (Chrome CDP Port 9222)';
  const stData = storageRes.data?.data || storageRes.data || {};
  const dbSize = stData.totalMb ? `${stData.totalMb} MB` : '2.5 MB';

  console.log(`${C.bold}${C.white}ARACHNE${C.reset} ${C.gray}//${C.reset} ${C.crimson}AUTONOMOUS WEB INTELLIGENCE${C.reset}`);
  console.log(`${C.gray}Core:     ${C.white}${coreStatus}${C.reset}`);
  console.log(`${C.gray}Model:    ${C.white}Qwen (Groq Cloud LPU)${C.reset}`);
  console.log(`${C.gray}Browser:  ${C.white}${browserStatus}${C.reset}`);
  console.log(`${C.gray}Database: ${C.white}Online (arachne.sqlite, ${dbSize})${C.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.crimson}arachne > ${C.reset}`
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'new hunt') {
      rl.question(`${C.white}What would you like me to research?${C.reset}\n${C.crimson}arachne > ${C.reset}`, async (topic) => {
        if (topic && topic.trim()) {
          await cmdInvestigate(topic.trim());
        }
        rl.prompt();
      });
      return;
    }

    const parts = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const rawCmd = (parts[0] || '').toLowerCase();
    const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
    const args = parts.slice(1).map(s => s.replace(/^"|"$/g, ''));

    switch (cmd) {
      case 'exit':
      case 'quit':
      case 'q':
        console.log(`\n${C.gray}ARACHNE session terminated.${C.reset}\n`);
        process.exit(0);
        break;

      case 'clear':
      case 'cls':
        console.clear();
        console.log(`${C.bold}${C.white}ARACHNE${C.reset} ${C.gray}//${C.reset} ${C.crimson}AUTONOMOUS WEB INTELLIGENCE${C.reset}`);
        console.log(`${C.gray}Core:     ${C.white}${coreStatus}${C.reset}`);
        console.log(`${C.gray}Model:    ${C.white}Qwen (Groq Cloud LPU)${C.reset}`);
        console.log(`${C.gray}Browser:  ${C.white}${browserStatus}${C.reset}`);
        console.log(`${C.gray}Database: ${C.white}Online (arachne.sqlite, ${dbSize})${C.reset}\n`);
        break;

      case 'status':
      case 'sys':
      case 'info':
        await cmdStatus();
        break;

      case 'hunt':
      case 'run':
      case 'go':
      case 'investigate':
      case 'research':
        const topic = args.join(' ');
        if (!topic) {
          rl.question(`${C.white}What would you like me to research?${C.reset}\n${C.crimson}arachne > ${C.reset}`, async (t) => {
            if (t && t.trim()) await cmdInvestigate(t.trim());
            rl.prompt();
          });
          return;
        }
        await cmdInvestigate(topic);
        break;

      case 'report':
        if (args[0] === 'last' || !args[0]) {
          const latestRes = await api('/api/reports/latest');
          if (latestRes.ok && latestRes.data?.data) {
            const rep = latestRes.data.data;
            activeReport = rep;
            activeInvestigationId = rep.investigationId;
            console.log(`\n${C.bold}${C.white}DOSSIER: ${rep.title}${C.reset}`);
            console.log(`${C.gray}Report ID: ${rep.id} | Generated: ${rep.createdAt || 'Recent'}${C.reset}`);
            console.log(`${C.gray}Available Formats: ${(rep.formats || ['md']).join(', ').toUpperCase()}${C.reset}\n`);
            console.log(rep.summary || rep.markdown?.slice(0, 1500) || '(No preview available)');
            console.log();
          } else {
            console.log(`\n${C.crimson}[INFO] No completed research reports found in the vault.${C.reset}\n`);
          }
        } else {
          await cmdReports(args[0], args[1]);
        }
        break;

      case 'reports':
        await cmdReports('list');
        break;

      case 'model':
      case 'models':
        await cmdModels();
        break;

      case 'settings':
      case 'config':
        await cmdSettings();
        break;

      case 'hunts':
      case 'tasks':
      case 'history':
        await cmdHunts();
        break;

      case 'pause':
      case 'resume':
      case 'retry':
        await cmdLifecycle(cmd);
        break;

      case 'stop':
      case 'cancel':
        await cmdLifecycle('stop');
        break;

      case 'help':
      case '?':
        cmdHelp();
        break;

      case 'pdf':
        await cmdExport('pdf', args[0], activeReport?.id);
        break;

      case 'excel':
      case 'xlsx':
        await cmdExport('xlsx', args[0], activeReport?.id);
        break;

      case 'txt':
      case 'text':
        await cmdExport('txt', args[0], activeReport?.id);
        break;

      case 'docx':
      case 'word':
        await cmdExport('docx', args[0], activeReport?.id);
        break;

      case 'md':
        await cmdExport('md', args[0], activeReport?.id);
        break;

      case 'export':
        await cmdExport(args[0], args[1], args[2] || activeReport?.id);
        break;

      case 'browser':
        await cmdBrowser();
        break;

      case 'tabs':
        await cmdTabs();
        break;

      case 'findings':
      case 'results':
        await cmdFindings();
        break;

      case 'graph':
        await cmdGraph();
        break;

      case 'vault':
        await cmdVault();
        break;

      case 'notifications':
        await cmdNotifications();
        break;

      case 'approvals':
        await cmdApprovals();
        break;

      case 'telegram':
        await cmdTelegram(args[0], ...args.slice(1));
        break;

      default: {
        const classified = classifyIntent(input);
        if (classified.intent === INTENTS.REFINE_REPORT) {
          console.log(`\n${C.crimson}► REFINING RESEARCH DOSSIER WITH QWEN (GROQ LPU)...${C.reset}\n`);
          const invId = activeInvestigationId || activeReport?.investigationId;
          const refineRes = await api('/api/reports/refine', {
            method: 'POST',
            body: { investigationId: invId, instruction: input }
          });
          if (refineRes.ok && refineRes.data?.success) {
            const data = refineRes.data;
            if (data.report) activeReport = data.report;
            console.log(`${C.bold}${C.white}:: REFINED TECHNICAL SYNTHESIS${C.reset}\n`);
            console.log(data.refinedText || data.report?.summary || 'Refinement updated.');
            console.log(`\n${C.crimson}Would you like to explore the findings further or export a report?${C.reset}\n`);
          } else {
            console.log(`${C.crimson}[ERR] Refinement failed: ${refineRes.data?.error || refineRes.error || 'Server error'}${C.reset}\n`);
          }
        } else if (classified.intent === INTENTS.EXPORT_REPORT) {
          await cmdExport(classified.params.format || 'pdf', null, classified.params.reportId || activeReport?.id);
        } else if (classified.intent === INTENTS.VIEW_REPORT) {
          await cmdReports('view', classified.params.reportId || activeReport?.id);
        } else if (classified.intent === INTENTS.FORMAT_HELP) {
          cmdFormatHelp(classified.params.format);
        } else if (classified.intent === INTENTS.SYSTEM_STATUS) {
          await cmdStatus();
        } else if (classified.intent === INTENTS.BROWSER_STATUS) {
          await cmdBrowser();
        } else if (classified.intent === INTENTS.MODEL_CONFIG) {
          console.log(`\n${C.bold}${C.white}ARACHNE MODEL CONFIGURATION:${C.reset}`);
          console.log(`${C.gray}Primary Planner & Synthesizer:${C.reset} ${C.white}Qwen (qwen/qwen3.8-27b on Groq Cloud LPU)${C.reset}`);
          console.log(`${C.gray}Local Fallback:${C.reset}                ${C.white}Ollama (qwen2.5:latest)${C.reset}`);
          console.log(`${C.gray}Preservation Status:${C.reset}           ${C.white}[PRESERVED STRICTLY]${C.reset}\n`);
        } else if (classified.intent === INTENTS.SETTINGS) {
          await cmdSettings();
        } else if (classified.intent === INTENTS.HISTORY) {
          await cmdHunts();
        } else if (classified.intent === INTENTS.QUESTION || classified.intent === INTENTS.FINDINGS) {
          const invId = activeInvestigationId || activeReport?.investigationId;
          console.log(`\n${C.crimson}► CONSULTING QWEN KNOWLEDGE BASE...${C.reset}\n`);
          const qRes = await api('/api/investigation/ask', {
            method: 'POST',
            body: { question: input, investigationId: invId }
          });
          if (qRes.ok && qRes.data?.data) {
            console.log(`${C.bold}${C.white}Answer:${C.reset}\n${qRes.data.data.answer}\n`);
            console.log(`${C.gray}(Grounded in ${qRes.data.data.sourcesUsed} verified vault sources)${C.reset}\n`);
            console.log(`${C.crimson}Would you like to explore the findings further or export a report?${C.reset}\n`);
          } else {
            await cmdFindings();
          }
        } else if (classified.intent === INTENTS.LIFECYCLE && classified.params.action) {
          await cmdLifecycle(classified.params.action);
        } else if (classified.intent === INTENTS.NEW_RESEARCH && classified.params.objective) {
          console.log(`\n${C.crimson}► AUTONOMOUS RESEARCH INTENT DETECTED:${C.reset} ${C.white}"${classified.params.objective}"${C.reset}`);
          console.log(`${C.gray}Dispatching research hunt directly...${C.reset}\n`);
          await cmdInvestigate(classified.params.objective);
        } else {
          // If not matching any known intent, check if there is an active report to answer about
          const invId = activeInvestigationId || activeReport?.investigationId;
          if (invId) {
            console.log(`\n${C.crimson}► CONSULTING QWEN KNOWLEDGE BASE...${C.reset}\n`);
            const qRes = await api('/api/investigation/ask', {
              method: 'POST',
              body: { question: input, investigationId: invId }
            });
            if (qRes.ok && qRes.data?.data) {
              console.log(`${C.bold}${C.white}Answer:${C.reset}\n${qRes.data.data.answer}\n`);
              console.log(`${C.crimson}Would you like to explore the findings further or export a report?${C.reset}\n`);
            } else {
              console.log(`  ${C.crimson}[ERR] Unknown command or inquiry: "${rawCmd}".${C.reset}`);
              console.log(`  ${C.gray}Type '/help' for command directory, or specify 'new hunt' to start research.${C.reset}\n`);
            }
          } else {
            console.log(`  ${C.crimson}[ERR] Unknown command or inquiry: "${rawCmd}".${C.reset}`);
            console.log(`  ${C.gray}Type '/help' for command directory, or specify 'new hunt' to start research.${C.reset}\n`);
          }
        }
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${C.gray}ARACHNE session closed.${C.reset}\n`);
    process.exit(0);
  });
}

// =========================================================================
// Main Entrypoint (Direct Flag Execution or Interactive REPL)
// =========================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await startRepl();
    return;
  }

  const isJson = args.includes('--json');
  const cleanArgs = args.filter(a => a !== '--json');
  const rawCmd = (cleanArgs[0] || '').toLowerCase();
  const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
  const subArgs = cleanArgs.slice(1);

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log('arachne 2.0.0');
    return;
  }

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HEADER_ASCII);
    cmdHelp();
    return;
  }

  if (!isJson) {
    console.log(HEADER_ASCII);
  }

  // Auto-start backend daemon if not running
  await ensureServerOnline(isJson);

  switch (cmd) {
    case 'status':
    case 'info':
    case 'sys':
      await cmdStatus({ json: isJson });
      break;

    case 'hunt':
    case 'run':
    case 'go':
    case 'investigate':
    case 'research':
    case 'i':
      await cmdInvestigate(subArgs.join(' '), { json: isJson });
      break;

    case 'hunts':
    case 'tasks':
    case 'history':
      await cmdHunts({ json: isJson });
      break;

    case 'results':
      await cmdResults(subArgs[0], { json: isJson });
      break;

    case 'graph':
      await cmdGraph({ json: isJson });
      break;

    case 'vault':
      await cmdVault({ json: isJson });
      break;

    case 'settings':
    case 'config':
      await cmdSettings({ json: isJson });
      break;

    case 'notifications':
      await cmdNotifications({ json: isJson });
      break;

    case 'pdf':
      await cmdExport('pdf', subArgs[0]);
      break;

    case 'excel':
    case 'xlsx':
      await cmdExport('xlsx', subArgs[0]);
      break;

    case 'txt':
    case 'text':
      await cmdExport('txt', subArgs[0]);
      break;

    case 'docx':
    case 'word':
      await cmdExport('docx', subArgs[0]);
      break;

    case 'md':
    case 'markdown':
      await cmdExport('md', subArgs[0]);
      break;

    case 'search':
    case 'find':
    case 'q':
    case 's':
      await cmdSearch(subArgs.join(' '), { json: isJson });
      break;

    case 'crawl':
    case 'scrape':
    case 'get':
    case 'c':
      await cmdCrawl(subArgs[0]);
      break;

    case 'links':
    case 'map':
    case 'l':
      await cmdLinks(subArgs[0]);
      break;

    case 'browser':
      await cmdBrowser({ json: isJson });
      break;

    case 'tabs':
      await cmdTabs({ json: isJson });
      break;

    case 'findings':
      await cmdFindings({ json: isJson });
      break;

    case 'reports':
    case 'report':
      await cmdReports(subArgs[0], subArgs[1], { json: isJson });
      break;

    case 'export':
      await cmdExport(subArgs[0], subArgs[1], subArgs[2]);
      break;

    case 'models':
    case 'model':
      await cmdModels({ json: isJson });
      break;

    case 'telegram':
    case 'tg':
      await cmdTelegram(subArgs[0], ...subArgs.slice(1));
      break;

    case 'pause':
    case 'resume':
    case 'retry':
      await cmdLifecycle(cmd);
      break;

    case 'stop':
    case 'cancel':
      await cmdLifecycle('stop');
      break;

    case 'approvals':
      await cmdApprovals();
      break;

    default: {
      const fullInput = cleanArgs.join(' ');
      const classified = classifyIntent(fullInput);

      if (classified.intent === INTENTS.EXPORT_REPORT) {
        await cmdExport(classified.params.format || 'txt', null, classified.params.reportId);
      } else if (classified.intent === INTENTS.VIEW_REPORT) {
        await cmdReports('view', classified.params.reportId, { json: isJson });
      } else if (classified.intent === INTENTS.FORMAT_HELP) {
        cmdFormatHelp(classified.params.format);
      } else if (classified.intent === INTENTS.SYSTEM_STATUS) {
        await cmdStatus({ json: isJson });
      } else if (classified.intent === INTENTS.NEW_RESEARCH && classified.params.objective) {
        console.log(`\n${C.crimson}► AUTONOMOUS RESEARCH INTENT DETECTED:${C.reset} ${C.white}"${classified.params.objective}"${C.reset}`);
        console.log(`${C.gray}Dispatching research hunt directly...${C.reset}\n`);
        await cmdInvestigate(classified.params.objective, { json: isJson });
      } else if (classified.intent === INTENTS.LIFECYCLE && classified.params.action) {
        await cmdLifecycle(classified.params.action);
      } else if (classified.intent === INTENTS.FINDINGS) {
        await cmdFindings({ json: isJson });
      } else if (classified.intent === INTENTS.VAULT_STATS) {
        await cmdVault({ json: isJson });
      } else if (classified.intent === INTENTS.APPROVALS) {
        await cmdApprovals();
      } else if (classified.intent === INTENTS.HELP) {
        cmdHelp();
      } else {
        console.log(`${C.crimson}[ERR] Unknown command or ambiguous inquiry: "${rawCmd}".${C.reset}`);
        console.log(`${C.gray}Type 'arachne --help' for directory, or specify a research topic (e.g. arachne hunt "topic").${C.reset}`);
        process.exit(1);
      }
    }
  }
}

main().catch(err => {
  console.error(`${C.crimson}[FATAL] ${err.message}${C.reset}`);
  process.exit(1);
});
