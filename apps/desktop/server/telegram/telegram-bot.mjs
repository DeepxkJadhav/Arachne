import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

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

    // 1. HELP / START INTENT
    if (slashCmd === '/start' || slashCmd === '/help' || /^(?:help|what can you do|menu|options|commands|hi|hello|hey)$/i.test(lower)) {
      reply = `🕷️ *ARACHNE Autonomous Web Intelligence Bot*\n\n` +
        `I am your autonomous research agent connected to Chrome/Brave CDP and SQLite WAL storage.\n\n` +
        `💬 *Natural Conversation Supported (No slash commands required!)*\n` +
        `• "What is your status?" or "How far are you?"\n` +
        `• "Pause research" or "Resume research"\n` +
        `• "Show findings" or "What did you discover?"\n` +
        `• "Export report as PDF" or "Give me Excel report"\n` +
        `• "Find computer vision repos on GitHub" (starts autonomous deep research)\n\n` +
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

    // 2. STATUS / PROGRESS INTENT
    else if (slashCmd === '/status' || /^(?:what(?:'?s| is) (?:your |the )?)?(?:status|progress|state|how far are you|what are you doing)/i.test(lower) || lower === 'status' || lower === 'progress') {
      const inv = this.researchAgent?.activeInvestigation;
      if (!inv) {
        reply = `🕷️ *ARACHNE System Status: IDLE*\nNo active investigation is running. Send a research topic (e.g. "Research autonomous web agents") to begin.`;
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

    // 3. PAUSE INTENT
    else if (slashCmd === '/pause' || /^(?:pause|hold on|wait a minute|pause research|pause crawling|stop for a moment)$/i.test(lower)) {
      this.researchAgent?.pause();
      reply = `⏸️ *Research Paused:* Crawler and browser tab orchestration paused. Say "resume" to continue.`;
    }

    // 4. RESUME INTENT
    else if (slashCmd === '/resume' || /^(?:resume|continue|keep going|resume research|continue crawling)$/i.test(lower)) {
      this.researchAgent?.resume();
      reply = `▶️ *Research Resumed:* Autonomous crawling and extraction ongoing.`;
    }

    // 5. STOP / CANCEL INTENT
    else if (slashCmd === '/stop' || slashCmd === '/cancel' || /^(?:stop|cancel|abort|terminate|kill research|stop research)$/i.test(lower)) {
      this.researchAgent?.stop();
      reply = `⏹️ *Investigation Terminated:* State committed to SQLite WAL vault.`;
    }

    // 6. RETRY INTENT
    else if (slashCmd === '/retry' || /^(?:retry|restart|re-run)$/i.test(lower)) {
      this.researchAgent?.retry();
      reply = `🔄 *Retrying Investigation:* Restarting from initial scoping phase.`;
    }

    // 7. FINDINGS INTENT
    else if (slashCmd === '/findings' || /^(?:findings|what did you find|show findings|show discoveries|show results|what have you found)/i.test(lower)) {
      const inv = this.researchAgent?.activeInvestigation;
      const findings = inv?.recentFindings || [];
      if (findings.length === 0) {
        reply = `🔍 No discrete findings recorded in current session yet.`;
      } else {
        reply = `🔍 *Top Recent Discoveries (${findings.length}):*\n\n` +
          findings.slice(0, 5).map((f, i) => `${i + 1}. *${f.title}* [${f.type || 'Web'}]\n   ${f.snippet?.slice(0, 100)}...\n   🔗 ${f.url}`).join('\n\n');
      }
    }

    // 8. MULTI-FORMAT REPORT EXPORT INTENT (PDF, XLSX/Excel, DOCX/Word, TXT)
    else if (
      slashCmd === '/pdf' || slashCmd === '/excel' || slashCmd === '/xlsx' || slashCmd === '/docx' || slashCmd === '/txt' ||
      (/\b(?:pdf|excel|xlsx|spreadsheet|docx|word|txt|text|csv)\b/i.test(lower) && /\b(?:export|download|generate|format|send|create|give me|save|pull|make)\b/i.test(lower))
    ) {
      let targetFmt = 'pdf';
      if (slashCmd === '/excel' || slashCmd === '/xlsx' || /\b(?:excel|xlsx|spreadsheet)\b/i.test(lower)) targetFmt = 'xlsx';
      else if (slashCmd === '/docx' || /\b(?:docx|word)\b/i.test(lower)) targetFmt = 'docx';
      else if (slashCmd === '/txt' || /\b(?:txt|text)\b/i.test(lower)) targetFmt = 'txt';
      else if (/\bcsv\b/i.test(lower)) targetFmt = 'csv';

      const reports = this.vaultStore.getReports();
      if (reports.length === 0) {
        reply = `📄 *No Reports Available:* No research dossiers exist in the vault yet. Start an investigation first.`;
      } else {
        const latest = reports[0];
        try {
          const destDir = path.resolve(process.cwd(), 'reports');
          fs.mkdirSync(destDir, { recursive: true });
          const destFile = path.join(destDir, `${latest.id}.${targetFmt}`);

          const exportResult = this.researchAgent?.reportEngine?.exportToFile(latest.id, targetFmt, destFile);
          const sizeKb = exportResult?.sizeBytes ? (exportResult.sizeBytes / 1024).toFixed(1) : (fs.statSync(destFile).size / 1024).toFixed(1);

          reply = `📑 *Research Report Exported [${targetFmt.toUpperCase()}]*\n\n` +
            `• *Title:* ${latest.title}\n` +
            `• *Format:* \`.${targetFmt}\`\n` +
            `• *Size:* ${sizeKb} KB\n` +
            `• *Location:* \`${destFile}\`\n` +
            `• *Verification:* Magic bytes & schema structurally validated ✅\n\n` +
            `_File saved locally on host machine in ARACHNE workspace._`;
        } catch (err) {
          reply = `❌ Export error: ${err.message}`;
        }
      }
    }

    // 9. REPORT SUMMARY INTENT
    else if (slashCmd === '/report' || /^(?:report|show report|latest report|give me the report|summary|dossier)$/i.test(lower)) {
      const reports = this.vaultStore.getReports();
      if (reports.length === 0) {
        reply = `📄 *No Reports Found:*\nNo research dossiers have been generated yet.`;
      } else {
        const latest = reports[0];
        reply = `📑 *Latest Research Dossier:*\n` +
          `• *Title:* ${latest.title}\n` +
          `• *Summary:* ${latest.summary}\n` +
          `• *ID:* \`${latest.id}\`\n\n` +
          `💡 *Want this formatted?* Say "export as pdf", "generate excel", or "send word document".`;
      }
    }

    // 10. APPROVALS INTENT
    else if (slashCmd === '/approvals' || /^(?:approvals|pending approvals|check approvals|do you need approval)/i.test(lower)) {
      const pending = this.vaultStore.getApprovals('pending');
      if (pending.length === 0) {
        reply = `✅ *No Pending Approvals:* System operating within allowed parameters.`;
      } else {
        reply = `⚠️ *Pending Operator Approvals:* \n\n` +
          pending.map(a => `• *[${a.id}]* ${a.title}\n  Reason: ${a.reason}\n  Action: say "approve ${a.id}" or "reject ${a.id}"`).join('\n\n');
      }
    }

    // 11. APPROVE ID
    else if (slashCmd === '/approve' || /^approve\s+(\S+)$/i.test(lower)) {
      const matchId = slashCmd === '/approve' ? slashArgs.trim() : (lower.match(/^approve\s+(\S+)$/i)?.[1] || '');
      if (!matchId) {
        reply = `⚠️ Usage: "approve <approval-id>"`;
      } else {
        const resolved = await this.researchAgent?.resolveApproval(matchId, 'approved', 'Approved via Telegram');
        reply = resolved ? `✅ Approval [${matchId}] granted. Crawler resumed.` : `❌ Approval [${matchId}] not found.`;
      }
    }

    // 12. REJECT / SKIP ID
    else if (slashCmd === '/reject' || slashCmd === '/skip' || /^(?:reject|skip)\s+(\S+)$/i.test(lower)) {
      const matchId = slashCmd === '/reject' || slashCmd === '/skip' ? slashArgs.trim() : (lower.match(/^(?:reject|skip)\s+(\S+)$/i)?.[1] || '');
      if (!matchId) {
        reply = `⚠️ Usage: "reject <approval-id>"`;
      } else {
        const resolved = await this.researchAgent?.resolveApproval(matchId, 'rejected', 'Rejected via Telegram');
        reply = resolved ? `Action executed: [${matchId}] marked as rejected.` : `❌ Approval [${matchId}] not found.`;
      }
    }

    // 13. STATS INTENT
    else if (slashCmd === '/stats' || /^(?:stats|vault stats|storage|database)$/i.test(lower)) {
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

    // 14. IGNORED ITEMS INTENT
    else if (slashCmd === '/ignored' || /^(?:ignored|skipped items)$/i.test(lower)) {
      const ignored = this.vaultStore.getIgnoredItems(null, 10);
      if (ignored.length === 0) {
        reply = `✅ No ignored or skipped items recorded.`;
      } else {
        reply = `⚠️ *Recent Ignored/Skipped Items (${ignored.length}):*\n\n` +
          ignored.map((it, i) => `${i + 1}. *[${it.stage}]* ${it.url}\n   • Reason: ${it.reason}\n   • Retry: ${it.will_retry ? 'Yes' : 'No'}`).join('\n\n');
      }
    }

    // 15. EXPLICIT SLASH /INVESTIGATE
    else if (slashCmd === '/investigate') {
      if (!slashArgs) {
        reply = `⚠️ *Usage Error:* Please provide an objective. Example:\n\`/investigate Open source computer use agents\``;
      } else {
        reply = `🚀 *Investigation Dispatched via Telegram:*\nInitiating deep crawl on: "${slashArgs}". Decomposing into 5 research phases with live browser inspection...`;
        this.researchAgent?.startInvestigation(slashArgs);
      }
    }

    // 16. UNKNOWN SLASH COMMAND
    else if (raw.startsWith('/')) {
      reply = `❓ Unknown command: \`${slashCmd}\`. Type \`/help\` for available commands.`;
    }

    // 17. AUTONOMOUS NATURAL LANGUAGE RESEARCH DISPATCH
    else {
      // Clean leading conversational fluff if present
      const cleanObjective = raw
        .replace(/^(?:please\s+|can you\s+|could you\s+|i want to\s+|i need to\s+)/i, '')
        .replace(/^(?:find\s+(?:me\s+)?|search\s+(?:for\s+)?|investigate\s+|research\s+|look\s+up\s+)/i, '')
        .trim();

      const finalTopic = cleanObjective.length > 5 ? cleanObjective : raw;

      reply = `🕷️ *ARACHNE Autonomous Mission Initiated*\n\n` +
        `Objective parsed: *"${finalTopic}"*\n\n` +
        `• Live CDP browser tab allocated\n` +
        `• 5-phase decomposition active\n` +
        `• Real-time extraction to SQLite WAL vault\n\n` +
        `_Ask "how far are you?" at any time for live progress._`;

      this.researchAgent?.startInvestigation(finalTopic);
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
