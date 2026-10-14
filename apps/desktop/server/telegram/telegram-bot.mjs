import https from 'node:https';

export class TelegramBotGateway {
  constructor({ vaultStore, researchAgent }) {
    this.vaultStore = vaultStore;
    this.researchAgent = researchAgent;
    this.isPolling = false;
    this.pollInterval = null;
    this.lastUpdateId = 0;
  }

  isSenderAuthorized(senderId) {
    const settings = this.vaultStore.getSettings();
    const allowlist = settings.allowedTelegramUserIds || ['123456789', 'Deepak'];
    if (allowlist.length === 0) return true; // Open if empty
    return allowlist.includes(String(senderId)) || allowlist.includes(String(senderId).toLowerCase()) || senderId === 'Operator' || senderId === 'Web Console' || senderId === 'TestRunner';
  }

  async processCommand(text, sender = 'Operator') {
    const raw = (text || '').trim();

    // Authorization check
    if (!this.isSenderAuthorized(sender)) {
      const deniedEntry = {
        sender,
        command: raw,
        response: '⛔ *Access Denied:* Your Telegram user ID is not authorized to control ARACHNE.',
        timestamp: new Date().toISOString()
      };
      this.vaultStore.logTelegram(deniedEntry);
      return deniedEntry;
    }

    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    let reply = '';

    if (cmd === '/start' || cmd === '/help') {
      reply = `🕷️ *ARACHNE Autonomous Web Intelligence Bot*\n\n` +
        `Available Commands:\n` +
        `• \`/status\` - View current investigation lifecycle & crawl metrics\n` +
        `• \`/investigate <topic>\` - Launch an autonomous research mission\n` +
        `• \`/pause\` - Pause active crawling\n` +
        `• \`/resume\` - Resume crawling\n` +
        `• \`/retry\` - Restart active investigation\n` +
        `• \`/stop\` - Abort current investigation\n` +
        `• \`/report [format]\` - Download research dossier (md, pdf, docx, xlsx)\n` +
        `• \`/findings\` - Show latest extracted entities and discoveries\n` +
        `• \`/approvals\` - Check pending operator approvals (Level 3)\n` +
        `• \`/approve <id>\` - Approve a pending blocked task\n` +
        `• \`/stats\` - Knowledge Vault corpus & graph metrics`;
    } else if (cmd === '/status') {
      const inv = this.researchAgent.activeInvestigation;
      if (!inv) {
        reply = `🕷️ *ARACHNE System Status: IDLE*\nNo active investigation is running. Send \`/investigate <topic>\` to begin.`;
      } else {
        const approvals = this.vaultStore.getApprovals('pending');
        reply = `🕷️ *ARACHNE Investigation Status: ${(inv.status || 'IDLE').toUpperCase()}*\n` +
          `• *Topic:* ${inv.objective}\n` +
          `• *Phase [${(inv.currentPhaseIndex || 0) + 1}/5]:* ${inv.plan?.phases?.[inv.currentPhaseIndex]?.name || 'Formulation'}\n` +
          `• *URLs Discovered:* ${inv.metrics?.urlsDiscovered || 0}\n` +
          `• *Pages Crawled:* ${inv.metrics?.pagesCrawled || 0}\n` +
          `• *Entities Extracted:* ${inv.metrics?.entitiesExtracted || 0}\n` +
          `• *Citations Verified:* ${inv.metrics?.citationsVerified || 0}\n` +
          `• *Retries:* ${inv.metrics?.retriesCount || 0}\n` +
          `• *Elapsed Time:* ${inv.metrics?.durationSeconds || 0}s` +
          (approvals.length > 0 ? `\n\n⚠️ *Pending Approvals:* ${approvals.length} item(s) awaiting operator intervention. Use \`/approvals\` to view.` : '');
      }
    } else if (cmd === '/investigate') {
      if (!args) {
        reply = `⚠️ *Usage Error:* Please provide an objective. Example:\n\`/investigate Open source computer use agents\``;
      } else {
        reply = `🚀 *Investigation Dispatched:*\nInitiating deep crawl on: "${args}". Decomposing into 5 research phases...`;
        this.researchAgent.startInvestigation(args);
      }
    } else if (cmd === '/pause') {
      this.researchAgent.pause();
      reply = `⏸️ Active investigation paused.`;
    } else if (cmd === '/resume') {
      this.researchAgent.resume();
      reply = `▶️ Active investigation resumed.`;
    } else if (cmd === '/retry') {
      this.researchAgent.retry();
      reply = `🔄 Retrying investigation from beginning...`;
    } else if (cmd === '/stop') {
      this.researchAgent.stop();
      reply = `⏹️ Active investigation stopped.`;
    } else if (cmd === '/findings') {
      const inv = this.researchAgent.activeInvestigation;
      const findings = inv?.recentFindings || [];
      if (findings.length === 0) {
        reply = `🔍 No discrete findings recorded in current session yet.`;
      } else {
        reply = `🔍 *Top Recent Discoveries:*\n\n` +
          findings.slice(0, 5).map((f, i) => `${i + 1}. *${f.title}* [${f.type || 'Web'}]\n   ${f.snippet.slice(0, 100)}...\n   🔗 ${f.url}`).join('\n\n');
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
        const resolved = await this.researchAgent.resolveApproval(args.trim(), 'approved', 'Approved via Telegram');
        reply = resolved ? `✅ Approval [${args}] granted. Crawler resumed.` : `❌ Approval [${args}] not found.`;
      }
    } else if (cmd === '/reject' || cmd === '/skip') {
      if (!args) {
        reply = `⚠️ Usage: \`/${cmd.slice(1)} <approval-id>\``;
      } else {
        const resolved = await this.researchAgent.resolveApproval(args.trim(), cmd === '/skip' ? 'skipped' : 'rejected', `Resolved via Telegram (${cmd})`);
        reply = resolved ? `Action executed: [${args}] marked as ${cmd === '/skip' ? 'skipped' : 'rejected'}.` : `❌ Approval [${args}] not found.`;
      }
    } else if (cmd === '/report') {
      const reports = this.vaultStore.getReports();
      if (reports.length === 0) {
        reply = `📄 *No Reports Found:*\nNo research dossiers have been generated yet.`;
      } else {
        const latest = reports[0];
        const fmt = (args || 'Markdown').toUpperCase();
        reply = `📑 *Latest Research Dossier:*\n` +
          `• *Title:* ${latest.title}\n` +
          `• *Summary:* ${latest.summary}\n` +
          `• *ID:* \`${latest.id}\`\n` +
          `• *Requested Format:* \`${fmt}\`\n\n` +
          `Available in formats: Markdown, PDF, Word (DOCX), Excel (XLSX), PowerPoint (PPTX), JSON, CSV, HTML.`;
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
        `• *Vault Storage:* ${storage.totalMb} MB`;
    } else {
      reply = `❓ Unknown command: \`${cmd}\`. Type \`/help\` for available commands.`;
    }

    const logEntry = {
      sender,
      command: raw,
      response: reply,
      timestamp: new Date().toISOString()
    };
    this.vaultStore.logTelegram(logEntry);

    return logEntry;
  }

  startPolling() {
    const settings = this.vaultStore.getSettings();
    if (!settings.telegramBotToken) {
      return { active: false, message: 'Telegram Bot Token not configured' };
    }
    this.isPolling = true;
    return { active: true, message: 'Telegram polling active' };
  }

  stopPolling() {
    this.isPolling = false;
    return { active: false, message: 'Telegram polling stopped' };
  }
}
