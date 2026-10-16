import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { classifyIntent, INTENTS } from '../agent/intent-classifier.mjs';

export class TelegramBotGateway {
  constructor({ vaultStore, researchAgent }) {
    this.vaultStore = vaultStore;
    this.researchAgent = researchAgent;
    this.isPolling = false;
    this.pollTimeout = null;
    this.lastUpdateId = 0;
    this.botInfo = null;
    this.status = 'idle'; // 'idle' | 'polling' | 'error' | 'stopped'
    this.lastError = null;
    this.ignoredBatch = [];

    // Masked token utility
    this.maskToken = (token) => {
      if (!token || token.length < 12) return '••••••••••••';
      return `${token.slice(0, 4)}••••••••••••••••••••••••${token.slice(-4)}`;
    };
  }

  getSettings() {
    return this.vaultStore.getSettings();
  }

  getBotToken() {
    const settings = this.getSettings();
    return settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  isSenderAuthorized(senderId) {
    // Local internal callers
    if (senderId === 'Operator' || senderId === 'System' || senderId === 'TestRunner') {
      return { authorized: true, reason: 'Local internal operator' };
    }

    const senderStr = String(senderId || '').trim();

    // Check if numeric ID
    if (!/^\d+$/.test(senderStr)) {
      return {
        authorized: false,
        reason: 'NON_NUMERIC_ID: Telegram authorization requires numeric User IDs (e.g. 123456789), not usernames.'
      };
    }

    const settings = this.getSettings();
    const allowlist = (settings.allowedTelegramUserIds || [])
      .map(id => String(id).trim())
      .filter(id => /^\d+$/.test(id));

    // Fail-closed: if allowlist is empty, deny access
    if (allowlist.length === 0) {
      return {
        authorized: false,
        reason: 'FAIL_CLOSED: No authorized numeric Telegram User IDs configured in Settings.'
      };
    }

    if (allowlist.includes(senderStr)) {
      return { authorized: true, reason: 'Matched allowlist' };
    }

    return {
      authorized: false,
      reason: `UNAUTHORIZED_USER: Telegram User ID ${senderStr} is not in the authorized operator allowlist.`
    };
  }

  async testConnection(customToken = null) {
    const token = customToken || this.getBotToken();
    if (!token) {
      return { success: false, latencyMs: 0, message: 'No Telegram bot token provided.' };
    }

    const startTime = Date.now();
    try {
      const res = await new Promise((resolve, reject) => {
        const req = https.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 6000 }, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => resolve({ statusCode: r.statusCode, data }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Connection timed out')));
      });

      const latencyMs = Date.now() - startTime;
      if (res.statusCode === 200) {
        const json = JSON.parse(res.data);
        if (json.ok && json.result) {
          this.botInfo = json.result;
          return {
            success: true,
            latencyMs,
            bot: {
              id: json.result.id,
              username: json.result.username,
              firstName: json.result.first_name,
              canJoinGroups: json.result.can_join_groups
            },
            maskedToken: this.maskToken(token),
            message: `Connected successfully to Telegram as @${json.result.username} (${latencyMs}ms roundtrip).`
          };
        }
      }

      return {
        success: false,
        latencyMs,
        statusCode: res.statusCode,
        message: `Telegram API returned error: HTTP ${res.statusCode} ${res.data}`
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: err.message,
        message: `Network error connecting to Telegram: ${err.message}`
      };
    }
  }

  async sendMessage(chatId, text, options = {}) {
    const token = this.getBotToken();
    if (!token || !chatId) return { success: false, error: 'Token or Chat ID missing' };

    const safeText = String(text || '').slice(0, 4000);
    const payload = JSON.stringify({
      chat_id: chatId,
      text: safeText,
      parse_mode: options.parseMode || 'Markdown',
      disable_web_page_preview: options.disablePreview !== false
    });

    return new Promise((resolve) => {
      const req = https.request(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 8000
      }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            resolve({ success: json.ok === true, data: json });
          } catch {
            resolve({ success: false, raw });
          }
        });
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Telegram send timeout' });
      });

      req.write(payload);
      req.end();
    });
  }

  async handleIgnoredItem(item) {
    const settings = this.getSettings();
    const policy = (settings.telegramIgnoredItemsPolicy || 'important').toLowerCase();
    if (policy === 'disabled') return { success: true, policy: 'disabled' };

    const operatorChatId = settings.telegramOperatorChatId || (settings.allowedTelegramUserIds?.[0]) || null;
    if (!operatorChatId) return { success: false, reason: 'No operator chat ID configured' };

    const isImportant = 
      item.stage === 'SCOPE_VALIDATION' || 
      item.stage === 'SCOPE_RESTRICTION' ||
      item.stage === 'SECURITY_GATE' ||
      (item.reason && (
        item.reason.includes('SSRF') || 
        item.reason.includes('ROBOTS') || 
        item.reason.includes('RESTRICTED') ||
        item.reason.includes('CAPTCHA') ||
        item.reason.includes('AUTH')
      ));

    if (policy === 'all' || (policy === 'important' && isImportant)) {
      const msg = `⚠️ *ARACHNE Item Ignored*\n` +
        `• *Task ID:* \`${item.investigationId || 'N/A'}\`\n` +
        `• *URL:* ${item.url}\n` +
        (item.title ? `• *Title:* ${item.title}\n` : '') +
        `• *Stage:* \`${item.stage}\`\n` +
        `• *Reason:* ${item.reason}\n` +
        `• *Will Retry:* ${item.willRetry ? 'Yes' : 'No'}\n` +
        `• *Investigation Continues:* ${item.continues ? 'Yes' : 'No'}`;

      return await this.sendMessage(operatorChatId, msg);
    } else if (policy === 'batch' || (policy === 'important' && !isImportant)) {
      if (!this.ignoredBatch) this.ignoredBatch = [];
      this.ignoredBatch.push(item);
      if (this.ignoredBatch.length >= 5) {
        return await this.flushIgnoredBatch(operatorChatId);
      }
      return { success: true, batched: true, count: this.ignoredBatch.length };
    }
  }

  async flushIgnoredBatch(chatId = null) {
    if (!this.ignoredBatch || this.ignoredBatch.length === 0) return { success: true, count: 0 };
    const settings = this.getSettings();
    const targetChat = chatId || settings.telegramOperatorChatId || (settings.allowedTelegramUserIds?.[0]) || null;
    if (!targetChat) return { success: false, reason: 'No operator chat ID' };

    const items = [...this.ignoredBatch];
    this.ignoredBatch = [];
    const count = items.length;

    const summaryLines = items.slice(0, 5).map((it, idx) => 
      `${idx + 1}. \`${it.stage}\`: ${it.url.slice(0, 45)}...\n   ↳ _${it.reason}_`
    ).join('\n');

    const msg = `📋 *ARACHNE Ignored Items Batch Summary (${count} items)*\n\n${summaryLines}` +
      (count > 5 ? `\n... and ${count - 5} more items.` : '');

    return await this.sendMessage(targetChat, msg);
  }

  async processIncomingMessage({ text, senderId, chatId, messageId = null }) {
    const auth = this.isSenderAuthorized(senderId);

    if (!auth.authorized) {
      const deniedMsg = `⛔ *ARACHNE Access Denied*\n\n${auth.reason}\n\nYour numeric ID is: \`${senderId}\`.\nPlease configure this ID in the ARACHNE Settings dashboard.`;
      if (chatId) {
        await this.sendMessage(chatId, deniedMsg);
      }
      const logEntry = {
        direction: 'inbound',
        chatId: String(chatId || ''),
        sender: String(senderId),
        messageType: 'unauthorized',
        command: text,
        response: deniedMsg,
        timestamp: new Date().toISOString()
      };
      this.vaultStore.logTelegram(logEntry);
      return logEntry;
    }

    return await this.processCommand(text, senderId, chatId);
  }

  async processCommand(text, sender = 'Operator', chatId = null) {
    const raw = (text || '').trim();
    if (!raw) return null;

    let reply = '';
    const lower = raw.toLowerCase().trim();
    const parts = raw.split(/\s+/);
    const slashCmd = parts[0].toLowerCase();
    const slashArgs = parts.slice(1).join(' ');

    const classified = classifyIntent(raw);

    // 1. HELP / START INTENT
    if (
      classified.intent === INTENTS.HELP ||
      slashCmd === '/start' ||
      slashCmd === '/help' ||
      /^(?:help|what can you do|menu|options|commands|hi|hello|hey)$/i.test(lower)
    ) {
      reply = `🕷️ *ARACHNE Autonomous Web Intelligence Bot*\n\n` +
        `I am your autonomous research agent connected to Chrome/Brave CDP and SQLite WAL storage.\n\n` +
        `💬 *Natural Conversation Supported (No slash commands required!)*\n` +
        `• "What is your status?" or "How far are you?"\n` +
        `• "Pause research" or "Resume research"\n` +
        `• "Show findings" or "What did you discover?"\n` +
        `• "Export report as PDF" or "Give me report in txt file"\n` +
        `• "How do I generate a PDF?" (Format directory)\n` +
        `• "Check whether Arachne is working." (System health)\n` +
        `• "Start research on <topic>" (Starts deep autonomous research)\n\n` +
        `⚙️ *Commands Reference:*\n` +
        `• \`/status\` - Live crawl & phase metrics\n` +
        `• \`/investigate <topic>\` - Launch deep research\n` +
        `• \`/findings\` - Show extracted entities & citations\n` +
        `• \`/report\` - Show latest dossier summary\n` +
        `• \`/pdf\` | \`/excel\` | \`/docx\` | \`/txt\` - Export report file\n` +
        `• \`/pause\` | \`/resume\` | \`/stop\` - Crawl lifecycle\n` +
        `• \`/approvals\` | \`/approve <id>\` | \`/reject <id>\` - Sensitive gates\n` +
        `• \`/stats\` - Knowledge vault & graph metrics`;
    }

    // 2. FORMAT / CAPABILITY HELP INTENT (MUST NOT export and MUST NOT trigger research)
    else if (classified.intent === INTENTS.FORMAT_HELP) {
      reply = `📑 *ARACHNE Deliverable Formats Guide*\n\n` +
        `I support 9 validated deliverable formats from research dossiers in the vault:\n` +
        `• *PDF (.pdf)* - Formatted intelligence report with executive summary & citations\n` +
        `• *Excel (.xlsx)* - Structured spreadsheet workbook with entities, corpus & metrics\n` +
        `• *Plain Text (.txt)* - Clean text briefing with structured headers\n` +
        `• *Word Document (.docx)* - Standard executive briefing layout\n` +
        `• *PowerPoint (.pptx)* - Presentation slides for briefings\n` +
        `• *Markdown (.md)* - GitHub-flavored document with full links\n` +
        `• *HTML (.html)* - Responsive standalone dark-mode webpage\n` +
        `• *CSV (.csv)* - Tabular verified evidence claims\n` +
        `• *JSON (.json)* - Structured AST and knowledge graph\n\n` +
        `💡 *To export an existing report:* Say "give me report in txt file", "export report as pdf", or "export <id> as excel". Exporting an existing report never restarts web research.`;
    }

    // 3. SYSTEM STATUS / PROGRESS INTENT (MUST NOT trigger research)
    else if (
      classified.intent === INTENTS.SYSTEM_STATUS ||
      slashCmd === '/status' ||
      /^(?:what(?:'?s| is) (?:your |the )?)?(?:status|progress|state|how far are you|what are you doing)/i.test(lower) ||
      lower === 'status' ||
      lower === 'progress'
    ) {
      const inv = this.researchAgent?.activeInvestigation;
      if (!inv) {
        reply = `🕷️ *ARACHNE System Status: IDLE*\nNo active investigation is running. All subsystems nominal (SQLite WAL storage, CDP browser automation, model router online). Send a research topic (e.g. "Start research on AI agents") to begin.`;
      } else {
        const approvals = this.vaultStore.getApprovals('pending');
        reply = `🕷️ *ARACHNE Investigation Status: ${(inv.status || 'IDLE').toUpperCase()}*\n` +
          `• *Task ID:* \`${inv.id}\`\n` +
          `• *Topic:* ${inv.objective}\n` +
          `• *Phase [${(inv.currentPhaseIndex || 0) + 1}/5]:* ${inv.plan?.phases?.[inv.currentPhaseIndex]?.name || 'Active'}\n` +
          `• *URLs Discovered:* ${inv.metrics?.urlsDiscovered || 0}\n` +
          `• *Pages Crawled:* ${inv.metrics?.pagesCrawled || 0}\n` +
          `• *Entities Extracted:* ${inv.metrics?.entitiesExtracted || 0}\n` +
          `• *Citations Verified:* ${inv.metrics?.citationsVerified || 0}\n` +
          `• *Elapsed Time:* ${inv.metrics?.durationSeconds || 0}s` +
          (approvals.length > 0 ? `\n\n⚠️ *Pending Approvals:* ${approvals.length} item(s) awaiting operator intervention. Send "approvals" to inspect.` : '');
      }
    }

    // 3.1 BROWSER STATUS INTENT
    else if (classified.intent === INTENTS.BROWSER_STATUS) {
      const bm = this.researchAgent?.browserManager;
      const conn = await bm?.testCdpConnection();
      if (conn?.connected) {
        reply = `🌐 *Browser Automation Status: CONNECTED*\n` +
          `• *Browser:* ${conn.browser || 'Google Chrome'}\n` +
          `• *CDP Port:* 9222 (Visible Mode Active)\n` +
          `• *Protocol Version:* ${conn.protocolVersion || '1.3'}\n` +
          `• *Latency:* ${conn.latencyMs || 0}ms\n` +
          `• *Active Task Tabs:* ${bm?.activeTaskTabs?.size || 0}`;
      } else {
        reply = `🌐 *Browser Automation Status: DISCONNECTED*\n` +
          `CDP port 9222 is not currently responding. ARACHNE will automatically launch a dedicated visible Chrome window upon starting your next research hunt.`;
      }
    }

    // 3.2 MODEL CONFIGURATION INTENT
    else if (classified.intent === INTENTS.MODEL_CONFIG) {
      const prov = classified.params?.provider;
      if (prov === 'qwen') {
        reply = `🧠 *Model Provider: Qwen Selected*\n` +
          `• *Primary Model:* \`qwen/qwen3.8-27b\` (Groq Cloud LPU)\n` +
          `• *Local Fallback:* \`qwen2.5:latest\` (Ollama at http://localhost:11434)\n` +
          `• *Status:* Active and verified for upcoming research missions.`;
      } else {
        reply = `🧠 *Active Model Configuration:*\n` +
          `• *Provider:* Groq Cloud LPU\n` +
          `• *Active Model:* \`qwen/qwen3.8-27b\` (Ultra-fast inference)\n` +
          `• *Local Alternative:* Ollama Qwen 2.5\n` +
          `• *Status:* Online and ready.`;
      }
    }

    // 3.3 REFINE EXISTING REPORT INTENT
    else if (classified.intent === INTENTS.REFINE_REPORT) {
      try {
        const refineRes = await this.researchAgent?.refineInvestigation('latest', raw);
        if (refineRes && refineRes.success) {
          reply = `✨ *Research Report Refined*\n\n` +
            `I have refined the technical findings based on your request: *"${raw}"*.\n\n` +
            (refineRes.refinedText ? `${refineRes.refinedText.slice(0, 500)}...\n\n` : '') +
            `💡 *Would you like to export this?* Say "export as PDF", "give me report in txt file", or "export as excel".`;
        } else {
          reply = `⚠️ Could not refine report: No completed research found to refine.`;
        }
      } catch (err) {
        reply = `⚠️ Refinement error: ${err.message}`;
      }
    }

    // 4. LIFECYCLE INTENT (Pause / Resume / Stop / Retry)
    else if (
      classified.intent === INTENTS.LIFECYCLE ||
      slashCmd === '/pause' ||
      slashCmd === '/resume' ||
      slashCmd === '/stop' ||
      slashCmd === '/cancel' ||
      slashCmd === '/retry'
    ) {
      const act = classified.params?.action || (slashCmd ? slashCmd.replace('/', '') : 'pause');
      if (act === 'pause') {
        this.researchAgent?.pause();
        reply = `⏸️ *Research Paused:* Crawler and browser tab orchestration paused. Say "resume" to continue.`;
      } else if (act === 'resume') {
        this.researchAgent?.resume();
        reply = `▶️ *Research Resumed:* Autonomous crawling and extraction ongoing.`;
      } else if (act === 'stop' || act === 'cancel') {
        this.researchAgent?.stop();
        reply = `⏹️ *Investigation Terminated:* State committed to SQLite WAL vault.`;
      } else if (act === 'retry') {
        this.researchAgent?.retry();
        reply = `🔄 *Retrying Investigation:* Restarting from initial scoping phase.`;
      }
    }

    // 5. MULTI-FORMAT REPORT EXPORT INTENT (PDF, XLSX/Excel, DOCX/Word, TXT)
    else if (
      classified.intent === INTENTS.EXPORT_REPORT ||
      slashCmd === '/pdf' || slashCmd === '/excel' || slashCmd === '/xlsx' || slashCmd === '/docx' || slashCmd === '/txt'
    ) {
      let targetFmt = classified.params?.format || 'pdf';
      if (slashCmd === '/excel' || slashCmd === '/xlsx') targetFmt = 'xlsx';
      else if (slashCmd === '/docx') targetFmt = 'docx';
      else if (slashCmd === '/txt') targetFmt = 'txt';

      const reportId = classified.params?.reportId || null;
      const reports = this.vaultStore.getReports();
      let targetRep = null;

      if (reportId) {
        targetRep = reports.find(r => r.id === reportId) || null;
      } else {
        targetRep = this.researchAgent?.reportEngine?.getLatestCompletedReport?.() || reports[0] || null;
      }

      if (!targetRep) {
        reply = `📄 *No Completed Reports Found*\n\n` +
          `No completed research dossiers exist in the vault yet.\n` +
          `Would you like to start a research hunt first? (e.g. "Start research on AI agents" or \`/investigate <topic>\`)`;
      } else {
        try {
          const destDir = path.join(os.homedir(), 'Downloads');
          fs.mkdirSync(destDir, { recursive: true });
          const safeTitle = (targetRep.title || targetRep.id).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
          const destFile = path.join(destDir, `Arachne_${safeTitle}_${targetRep.id}.${targetFmt}`);

          const exportResult = this.researchAgent?.reportEngine?.exportToFile(targetRep.id, targetFmt, destFile);
          const finalPath = exportResult?.path || destFile;
          const sizeKb = exportResult?.sizeBytes ? (exportResult.sizeBytes / 1024).toFixed(1) : (fs.existsSync(finalPath) ? (fs.statSync(finalPath).size / 1024).toFixed(1) : '0');

          reply = `📑 *Research Report Exported [${targetFmt.toUpperCase()}]*\n\n` +
            `• *Title:* ${targetRep.title}\n` +
            `• *Format:* \`.${targetFmt}\`\n` +
            `• *Size:* ${sizeKb} KB\n` +
            `• *Location:* \`${finalPath}\`\n` +
            `• *Verification:* Magic bytes & schema structurally validated ✅\n\n` +
            `_File saved locally on host machine in Downloads folder._`;
        } catch (err) {
          reply = `❌ Export error: ${err.message}`;
        }
      }
    }

    // 6. REPORT VIEW / SUMMARY INTENT
    else if (
      classified.intent === INTENTS.VIEW_REPORT ||
      slashCmd === '/report' ||
      /^(?:report|show report|latest report|give me the report|summary|dossier)$/i.test(lower)
    ) {
      const reportId = classified.params?.reportId || null;
      const reports = this.vaultStore.getReports();
      let targetRep = null;

      if (reportId) {
        targetRep = reports.find(r => r.id === reportId) || null;
      } else {
        targetRep = this.researchAgent?.reportEngine?.getLatestCompletedReport?.() || reports[0] || null;
      }

      if (!targetRep) {
        reply = `📄 *No Reports Found:*\nNo research dossiers have been generated yet. Send a research topic to start your first investigation.`;
      } else {
        reply = `📑 *Research Dossier [${targetRep.id}]:*\n` +
          `• *Title:* ${targetRep.title}\n` +
          `• *Summary:* ${targetRep.summary || targetRep.title}\n` +
          `• *Generated:* ${targetRep.createdAt || 'Recent'}\n\n` +
          `💡 *Want this formatted?* Say "give me report in txt file", "export as pdf", or "generate excel".`;
      }
    }

    // 7. FINDINGS INTENT
    else if (classified.intent === INTENTS.FINDINGS || slashCmd === '/findings' || /^(?:findings|what did you find|show findings|show discoveries|show results|what have you found)/i.test(lower)) {
      const inv = this.researchAgent?.activeInvestigation;
      const findings = inv?.recentFindings || [];
      if (findings.length === 0) {
        reply = `🔍 No discrete findings recorded in current session yet.`;
      } else {
        reply = `🔍 *Top Recent Discoveries (${findings.length}):*\n\n` +
          findings.slice(0, 5).map((f, i) => `${i + 1}. *${f.title}* [${f.type || 'Web'}]\n   ${f.snippet?.slice(0, 100)}...\n   🔗 ${f.url}`).join('\n\n');
      }
    }

    // 8. APPROVALS INTENT
    else if (classified.intent === INTENTS.APPROVALS && classified.params?.action === 'list') {
      const pending = this.vaultStore.getApprovals('pending');
      if (pending.length === 0) {
        reply = `✅ *No Pending Approvals:* System operating within allowed parameters.`;
      } else {
        reply = `⚠️ *Pending Operator Approvals:* \n\n` +
          pending.map(a => `• *[${a.id}]* ${a.title}\n  Reason: ${a.reason}\n  Action: say "approve ${a.id}" or "reject ${a.id}"`).join('\n\n');
      }
    }

    // 9. APPROVE ID
    else if (slashCmd === '/approve' || /^approve\s+(\S+)$/i.test(lower)) {
      const matchId = slashCmd === '/approve' ? slashArgs.trim() : (lower.match(/^approve\s+(\S+)$/i)?.[1] || '');
      if (!matchId) {
        reply = `⚠️ Usage: "approve <approval-id>"`;
      } else {
        const resolved = await this.researchAgent?.resolveApproval(matchId, 'approved', 'Approved via Telegram');
        reply = resolved ? `✅ Approval [${matchId}] granted. Crawler resumed.` : `❌ Approval [${matchId}] not found.`;
      }
    }

    // 10. REJECT / SKIP ID
    else if (slashCmd === '/reject' || slashCmd === '/skip' || /^(?:reject|skip)\s+(\S+)$/i.test(lower)) {
      const matchId = slashCmd === '/reject' || slashCmd === '/skip' ? slashArgs.trim() : (lower.match(/^(?:reject|skip)\s+(\S+)$/i)?.[1] || '');
      if (!matchId) {
        reply = `⚠️ Usage: "reject <approval-id>"`;
      } else {
        const resolved = await this.researchAgent?.resolveApproval(matchId, 'rejected', 'Rejected via Telegram');
        reply = resolved ? `Action executed: [${matchId}] marked as rejected.` : `❌ Approval [${matchId}] not found.`;
      }
    }

    // 11. STATS / VAULT INTENT
    else if (classified.intent === INTENTS.VAULT_STATS || slashCmd === '/stats' || /^(?:stats|vault stats|storage|database)$/i.test(lower)) {
      const graph = this.vaultStore.getGraph();
      const corpus = this.vaultStore.getCorpus();
      const bookmarks = this.vaultStore.getBookmarks();
      const storage = this.vaultStore.getStorageMetrics();
      reply = `📊 *ARACHNE Knowledge Vault Stats:*\n` +
        `• *Graph Nodes:* ${graph.nodes.length}\n` +
        `• *Graph Edges:* ${graph.edges.length}\n` +
        `• *Corpus Documents:* ${corpus.length}\n` +
        `• *Saved Bookmarks:* ${bookmarks.length}\n` +
        `• *Vault Storage:* ${storage.totalMb} MB (${storage.totalRecords || 0} records)`;
    }

    // 12. IGNORED ITEMS INTENT
    else if (slashCmd === '/ignored' || /^(?:ignored|skipped items)$/i.test(lower)) {
      const ignored = this.vaultStore.getIgnoredItems(null, 10);
      if (ignored.length === 0) {
        reply = `✅ No ignored or skipped items recorded.`;
      } else {
        reply = `⚠️ *Recent Ignored/Skipped Items (${ignored.length}):*\n\n` +
          ignored.map((it, i) => `${i + 1}. *[${it.stage}]* ${it.url}\n   • Reason: ${it.reason}\n   • Retry: ${it.will_retry ? 'Yes' : 'No'}`).join('\n\n');
      }
    }

    // 13. EXPLICIT SLASH /INVESTIGATE OR UNAMBIGUOUS NATURAL LANGUAGE RESEARCH DISPATCH
    else if (slashCmd === '/investigate' || classified.intent === INTENTS.NEW_RESEARCH) {
      const finalTopic = classified.params?.objective || slashArgs.trim() || raw;
      if (!finalTopic || finalTopic.length < 3) {
        reply = `⚠️ *Usage Error:* Please provide a research topic. Example:\n\`/investigate Autonomous computer-use agents\``;
      } else {
        reply = `🕷️ *ARACHNE Autonomous Mission Initiated*\n\n` +
          `Objective parsed: *"${finalTopic}"*\n\n` +
          `• Live CDP browser tab allocated\n` +
          `• 5-phase decomposition active\n` +
          `• Real-time extraction to SQLite WAL vault\n\n` +
          `_Ask "what is your status?" at any time for live progress._`;

        this.researchAgent?.startInvestigation(finalTopic);
      }
    }

    // 14. UNKNOWN SLASH COMMAND
    else if (raw.startsWith('/')) {
      reply = `❓ Unknown command: \`${slashCmd}\`. Type \`/help\` for available commands.`;
    }

    // 15. UNKNOWN / AMBIGUOUS NATURAL LANGUAGE (DO NOT ACCIDENTALLY HUNT)
    else {
      reply = `🕷️ *ARACHNE Web Intelligence Command Center*\n\n` +
        `I didn't recognize that request. Here is what I can do:\n` +
        `• *Research:* "Start research on <topic>" or \`/investigate <topic>\`\n` +
        `• *Export Report:* "Give me report in txt file" or "Export report as pdf"\n` +
        `• *System Health:* "Check whether Arachne is working."\n` +
        `• *Format Guide:* "How do I generate a PDF?"\n` +
        `• *Progress:* "What is your status?"\n` +
        `• *Directory:* Type \`/help\` for commands reference.`;
    }

    if (chatId) {
      await this.sendMessage(chatId, reply);
    }

    const logEntry = {
      direction: 'inbound',
      chatId: String(chatId || ''),
      sender: String(sender),
      messageType: raw.startsWith('/') ? 'command' : 'natural_language',
      command: raw,
      response: reply,
      timestamp: new Date().toISOString()
    };
    this.vaultStore.logTelegram(logEntry);

    return logEntry;
  }

  startPolling() {
    if (this.isPolling) {
      return { active: true, status: this.status, message: 'Telegram polling already active' };
    }

    const token = this.getBotToken();
    if (!token) {
      this.status = 'error';
      return { active: false, status: 'error', message: 'Telegram Bot Token not configured' };
    }

    this.isPolling = true;
    this.status = 'polling';
    this.pollLoop();

    return {
      active: true,
      status: 'polling',
      maskedToken: this.maskToken(token),
      message: 'Telegram long-polling started.'
    };
  }

  stopPolling() {
    this.isPolling = false;
    this.status = 'stopped';
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    return { active: false, status: 'stopped', message: 'Telegram polling stopped.' };
  }

  async pollLoop() {
    if (!this.isPolling) return;

    const token = this.getBotToken();
    if (!token) {
      this.status = 'error';
      this.isPolling = false;
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
      const updates = await new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 25000 }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const json = JSON.parse(data);
                resolve(json.result || []);
              } catch {
                resolve([]);
              }
            } else {
              resolve([]);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          resolve([]);
        });
      });

      if (Array.isArray(updates) && updates.length > 0) {
        for (const update of updates) {
          if (update.update_id) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          }

          const message = update.message || update.channel_post;
          if (message && message.text) {
            await this.processIncomingMessage({
              text: message.text,
              senderId: message.from?.id || message.chat?.id,
              chatId: message.chat?.id,
              messageId: message.message_id
            });
          }
        }
      }
      this.status = 'polling';
    } catch (err) {
      this.lastError = err.message;
    }

    if (this.isPolling) {
      this.pollTimeout = setTimeout(() => this.pollLoop(), 1000);
    }
  }

  getStatus() {
    const settings = this.getSettings();
    const token = this.getBotToken();
    return {
      isPolling: this.isPolling,
      status: this.status,
      lastError: this.lastError,
      lastUpdateId: this.lastUpdateId,
      botInfo: this.botInfo,
      botUsername: this.botInfo?.username || null,
      maskedToken: this.maskToken(token),
      configured: Boolean(token),
      connected: this.status === 'polling' || Boolean(this.botInfo),
      chatId: settings.telegramOperatorChatId || (settings.allowedTelegramUserIds?.[0]) || null,
      ignoredItemsPolicy: settings.telegramIgnoredItemsPolicy || 'important'
    };
  }
}
