import https from 'node:https';

export class TelegramBotGateway {
  constructor({ vaultStore, researchAgent }) {
    this.vaultStore = vaultStore;
    this.researchAgent = researchAgent;
    this.isPolling = false;
    this.pollInterval = null;
    this.lastUpdateId = 0;
  }

  async processCommand(text, sender = 'Operator') {
    const raw = (text || '').trim();
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    let reply = '';

    if (cmd === '/start' || cmd === '/help') {
      reply = `🕷️ *ARACHNE Autonomous Web Intelligence Bot*\n\n` +
        `Available Commands:\n` +
        `• \`/status\` - View current investigation status & crawl metrics\n` +
        `• \`/investigate <topic>\` - Start an autonomous research mission\n` +
        `• \`/pause\` - Pause current crawling\n` +
        `• \`/resume\` - Resume current crawling\n` +
        `• \`/stop\` - Abort current investigation\n` +
        `• \`/report\` - Get latest synthesized research dossier\n` +
        `• \`/stats\` - Knowledge vault & graph statistics`;
    } else if (cmd === '/status') {
      const inv = this.researchAgent.activeInvestigation;
      if (!inv) {
        reply = `⚙️ *System Idle*\nNo active investigation is running. Send \`/investigate <topic>\` to begin.`;
      } else {
        reply = `🕷️ *Investigation Status: ${inv.status.toUpperCase()}*\n` +
          `• *Topic:* ${inv.objective}\n` +
          `• *Current Phase:* ${inv.plan?.phases?.[inv.currentPhaseIndex]?.name || 'Formulation'}\n` +
          `• *URLs Discovered:* ${inv.metrics?.urlsDiscovered || 0}\n` +
          `• *Pages Crawled:* ${inv.metrics?.pagesCrawled || 0}\n` +
          `• *Entities Extracted:* ${inv.metrics?.entitiesExtracted || 0}\n` +
          `• *Elapsed Time:* ${inv.metrics?.durationSeconds || 0}s`;
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
    } else if (cmd === '/stop') {
      this.researchAgent.stop();
      reply = `⏹️ Active investigation stopped.`;
    } else if (cmd === '/report') {
      const reports = this.vaultStore.getReports();
      if (reports.length === 0) {
        reply = `📄 *No Reports Found:*\nNo research dossiers have been generated yet.`;
      } else {
        const latest = reports[0];
        reply = `📑 *Latest Research Dossier:*\n` +
          `• *Title:* ${latest.title}\n` +
          `• *Summary:* ${latest.summary}\n` +
          `• *ID:* \`${latest.id}\`\n\n` +
          `Download the full dossier in ARACHNE Report Studio.`;
      }
    } else if (cmd === '/stats') {
      const graph = this.vaultStore.getGraph();
      const corpus = this.vaultStore.getCorpus();
      const bookmarks = this.vaultStore.getBookmarks();
      reply = `📊 *ARACHNE Knowledge Vault Stats:*\n` +
        `• *Graph Nodes:* ${graph.nodes.length}\n` +
        `• *Graph Edges:* ${graph.edges.length}\n` +
        `• *Corpus Documents:* ${corpus.length}\n` +
        `• *Saved Bookmarks:* ${bookmarks.length}`;
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
