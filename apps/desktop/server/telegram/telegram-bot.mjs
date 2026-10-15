import https from 'node:https';

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

    const payload = JSON.stringify({
      chat_id: chatId,
      text,
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
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    // Handle slash commands
    if (cmd === '/start' || cmd === '/help') {
      reply = `🕷️ *ARACHNE Autonomous Web Intelligence Bot*\n\n` +
        `You can send me any natural language research query, or use these commands:\n\n` +
        `• \`/status\` - View current investigation lifecycle & crawl metrics\n` +
        `• \`/investigate <topic>\` - Launch an autonomous research mission\n` +
        `• \`/pause\` - Pause active crawling\n` +
        `• \`/resume\` - Resume crawling\n` +
        `• \`/retry\` - Restart active investigation\n` +
        `• \`/stop\` - Abort current investigation\n` +
        `• \`/report\` - View latest research report\n` +
        `• \`/findings\` - Show latest extracted entities and discoveries\n` +
        `• \`/approvals\` - Check pending operator approvals (Level 3)\n` +
        `• \`/approve <id>\` - Approve a pending blocked task\n` +
        `• \`/reject <id>\` - Reject a pending blocked task\n` +
        `• \`/stats\` - Knowledge Vault corpus & graph metrics\n\n` +
        `💡 *Or simply type naturally:*\n` +
        `"Research latest open-source AI agents for computer control"`;
    } else if (cmd === '/status') {
      const inv = this.researchAgent?.activeInvestigation;
      if (!inv) {
        reply = `🕷️ *ARACHNE System Status: IDLE*\nNo active investigation is running. Send a topic or \`/investigate <topic>\` to begin.`;
      } else {
        const approvals = this.vaultStore.getApprovals('pending');
        reply = `🕷️ *ARACHNE Investigation Status: ${(inv.status || 'IDLE').toUpperCase()}*\n` +
          `• *Topic:* ${inv.objective}\n` +
          `• *Phase [${(inv.currentPhaseIndex || 0) + 1}/5]:* ${inv.plan?.phases?.[inv.currentPhaseIndex]?.name || 'Active'}\n` +
          `• *URLs Discovered:* ${inv.metrics?.urlsDiscovered || 0}\n` +
          `• *Pages Crawled:* ${inv.metrics?.pagesCrawled || 0}\n` +
          `• *Entities Extracted:* ${inv.metrics?.entitiesExtracted || 0}\n` +
          `• *Citations Verified:* ${inv.metrics?.citationsVerified || 0}\n` +
          `• *Elapsed Time:* ${inv.metrics?.durationSeconds || 0}s` +
          (approvals.length > 0 ? `\n\n⚠️ *Pending Approvals:* ${approvals.length} item(s) awaiting operator intervention. Use \`/approvals\` to view.` : '');
      }
    } else if (cmd === '/investigate') {
      if (!args) {
        reply = `⚠️ *Usage Error:* Please provide an objective. Example:\n\`/investigate Open source computer use agents\``;
      } else {
        reply = `🚀 *Investigation Dispatched via Telegram:*\nInitiating deep crawl on: "${args}". Decomposing into 5 research phases with live browser inspection...`;
        this.researchAgent?.startInvestigation(args);
      }
    } else if (cmd === '/pause') {
      this.researchAgent?.pause();
      reply = `⏸️ Active investigation paused.`;
    } else if (cmd === '/resume') {
      this.researchAgent?.resume();
      reply = `▶️ Active investigation resumed.`;
    } else if (cmd === '/retry') {
      this.researchAgent?.retry();
      reply = `🔄 Retrying investigation from beginning...`;
    } else if (cmd === '/stop') {
      this.researchAgent?.stop();
      reply = `⏹️ Active investigation stopped.`;
    } else if (cmd === '/findings') {
      const inv = this.researchAgent?.activeInvestigation;
      const findings = inv?.recentFindings || [];
      if (findings.length === 0) {
        reply = `🔍 No discrete findings recorded in current session yet.`;
      } else {
        reply = `🔍 *Top Recent Discoveries:*\n\n` +
          findings.slice(0, 5).map((f, i) => `${i + 1}. *${f.title}* [${f.type || 'Web'}]\n   ${f.snippet?.slice(0, 100)}...\n   🔗 ${f.url}`).join('\n\n');
      }
    } else if (cmd === '/approvals') {
      const pending = this.vaultStore.getApprovals('pending');
      if (pending.length === 0) {
        reply = `✅ No pending human approvals. System operating within allowed parameters.`;
      } else {
        reply = `⚠️ *Pending Operator Approvals:* \n\n` +
          pending.map(a => `• *[${a.id}]* ${a.title}\n  Reason: ${a.reason}\n  Action: send \`/approve ${a.id}\` or \`/reject ${a.id}\``).join('\n\n');
      }
    } else if (cmd === '/approve') {
      if (!args) {
        reply = `⚠️ Usage: \`/approve <approval-id>\``;
      } else {
        const resolved = await this.researchAgent?.resolveApproval(args.trim(), 'approved', 'Approved via Telegram');
        reply = resolved ? `✅ Approval [${args}] granted. Crawler resumed.` : `❌ Approval [${args}] not found.`;
      }
    } else if (cmd === '/reject' || cmd === '/skip') {
      if (!args) {
        reply = `⚠️ Usage: \`/${cmd.slice(1)} <approval-id>\``;
      } else {
        const resolved = await this.researchAgent?.resolveApproval(args.trim(), cmd === '/skip' ? 'skipped' : 'rejected', `Resolved via Telegram (${cmd})`);
        reply = resolved ? `Action executed: [${args}] marked as ${cmd === '/skip' ? 'skipped' : 'rejected'}.` : `❌ Approval [${args}] not found.`;
      }
    } else if (cmd === '/report') {
      const reports = this.vaultStore.getReports();
      if (reports.length === 0) {
        reply = `📄 *No Reports Found:*\nNo research dossiers have been generated yet.`;
      } else {
        const latest = reports[0];
        reply = `📑 *Latest Research Dossier:*\n` +
          `• *Title:* ${latest.title}\n` +
          `• *Summary:* ${latest.summary}\n` +
          `• *ID:* \`${latest.id}\``;
      }
    } else if (cmd === '/stats') {
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
    } else if (raw.startsWith('/')) {
      reply = `❓ Unknown command: \`${cmd}\`. Type \`/help\` for available commands.`;
    } else {
      // Natural language research prompt!
      reply = `🕷️ *ARACHNE Autonomous Mission Initiated*\n\n` +
        `Objective parsed: *"${raw}"*\n\n` +
        `Decomposing objective into research phases with real-time browser inspection... Use \`/status\` to track live progress.`;

      this.researchAgent?.startInvestigation(raw);
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
    return {
      isPolling: this.isPolling,
      status: this.status,
      lastError: this.lastError,
      lastUpdateId: this.lastUpdateId,
      botInfo: this.botInfo,
      maskedToken: this.maskToken(this.getBotToken())
    };
  }
}
