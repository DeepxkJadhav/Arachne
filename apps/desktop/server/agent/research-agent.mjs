import { CrawlerFetcher } from '../crawler/fetcher.mjs';
import { ContentExtractor } from '../crawler/extractor.mjs';
import { UrlFrontier } from '../crawler/frontier.mjs';

export class ResearchAgent {
  constructor({ vaultStore, graphEngine, modelRouter, reportEngine, broadcaster = null }) {
    this.vaultStore = vaultStore;
    this.graphEngine = graphEngine;
    this.modelRouter = modelRouter;
    this.reportEngine = reportEngine;
    this.broadcaster = broadcaster || (() => {});

    this.activeInvestigation = null;
    this.isPaused = false;
    this.isStopped = false;
    this.fetcher = new CrawlerFetcher();
  }

  emit(type, payload) {
    this.broadcaster({ type, payload, timestamp: new Date().toISOString() });
  }

  log(message, level = 'info') {
    const entry = { message, level, timestamp: new Date().toISOString() };
    if (this.activeInvestigation) {
      if (!this.activeInvestigation.logs) this.activeInvestigation.logs = [];
      this.activeInvestigation.logs.unshift(entry);
      if (this.activeInvestigation.logs.length > 200) this.activeInvestigation.logs.pop();
      this.vaultStore.saveInvestigation(this.activeInvestigation);
    }
    this.emit('log', entry);
  }

  pause() {
    this.isPaused = true;
    this.log('Investigation paused by operator.', 'warn');
    if (this.activeInvestigation) {
      this.activeInvestigation.status = 'paused';
      this.vaultStore.saveInvestigation(this.activeInvestigation);
      this.emit('investigation_updated', this.activeInvestigation);
    }
  }

  resume() {
    this.isPaused = false;
    this.log('Investigation resumed by operator.', 'info');
    if (this.activeInvestigation) {
      this.activeInvestigation.status = 'running';
      this.vaultStore.saveInvestigation(this.activeInvestigation);
      this.emit('investigation_updated', this.activeInvestigation);
    }
  }

  stop() {
    this.isStopped = true;
    this.log('Investigation stopped by operator.', 'error');
    if (this.activeInvestigation) {
      this.activeInvestigation.status = 'stopped';
      this.vaultStore.saveInvestigation(this.activeInvestigation);
      this.emit('investigation_updated', this.activeInvestigation);
    }
  }

  async startInvestigation(objective) {
    this.isPaused = false;
    this.isStopped = false;

    const id = `inv-${Date.now()}`;
    const plan = await this.modelRouter.generateResearchPlan(objective);

    this.activeInvestigation = {
      id,
      title: objective.slice(0, 60),
      objective,
      status: 'running',
      currentPhaseIndex: 0,
      plan,
      metrics: {
        urlsDiscovered: 0,
        pagesCrawled: 0,
        entitiesExtracted: 0,
        citationsVerified: 0,
        durationSeconds: 0
      },
      recentFindings: [],
      logs: [],
      createdAt: new Date().toISOString()
    };

    this.vaultStore.saveInvestigation(this.activeInvestigation);
    this.emit('investigation_started', this.activeInvestigation);
    this.log(`Initiated autonomous investigation: "${objective}"`, 'info');

    // Run investigation asynchronously in background
    this.runInvestigationLoop().catch(err => {
      this.log(`Investigation fatal error: ${err.message}`, 'error');
      if (this.activeInvestigation) {
        this.activeInvestigation.status = 'failed';
        this.vaultStore.saveInvestigation(this.activeInvestigation);
      }
    });

    return this.activeInvestigation;
  }

  async runInvestigationLoop() {
    const inv = this.activeInvestigation;
    const settings = this.vaultStore.getSettings();
    const frontier = new UrlFrontier({
      maxDepth: settings.maxDepth || 3,
      maxUrls: settings.maxUrlsPerInvestigation || 25,
      perDomainRateLimitMs: settings.perDomainRateLimitMs || 600
    });

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      if (this.activeInvestigation && this.activeInvestigation.status === 'running') {
        this.activeInvestigation.metrics.durationSeconds = Math.floor((Date.now() - startTime) / 1000);
        this.emit('metrics_tick', this.activeInvestigation.metrics);
      }
    }, 1000);

    try {
      const phases = inv.plan.phases || [];

      for (let pIdx = 0; pIdx < phases.length; pIdx++) {
        if (this.isStopped) break;

        while (this.isPaused) {
          await new Promise(r => setTimeout(r, 500));
          if (this.isStopped) break;
        }

        const phase = phases[pIdx];
        phase.status = 'active';
        inv.currentPhaseIndex = pIdx;
        this.vaultStore.saveInvestigation(inv);
        this.emit('investigation_updated', inv);
        this.log(`Phase [${pIdx + 1}/${phases.length}]: ${phase.name}`, 'info');

        // Formulate initial seed URLs from phase queries & relevant domain intelligence
        const seedUrls = await this.discoverSeedUrls(phase.queries || [inv.objective]);
        frontier.enqueueMultiple(seedUrls, 0, 8, 'search-engine');
        inv.metrics.urlsDiscovered += seedUrls.length;

        // Process up to 5 URLs per phase
        let phaseUrlCount = 0;
        const maxUrlsInPhase = 4;

        while (frontier.size() > 0 && phaseUrlCount < maxUrlsInPhase && !this.isStopped) {
          while (this.isPaused) {
            await new Promise(r => setTimeout(r, 500));
            if (this.isStopped) break;
          }

          const target = await frontier.dequeueNext();
          if (!target) break;

          this.log(`Crawling target [depth ${target.depth}]: ${target.url}`, 'info');
          const fetchResult = await this.fetcher.fetchUrl(target.url);

          if (!fetchResult.success) {
            this.log(`Fetch failed for ${target.url} (${fetchResult.status || fetchResult.error})`, 'warn');
            continue;
          }

          inv.metrics.pagesCrawled++;
          phaseUrlCount++;

          const markdown = this.fetcher.htmlToCleanMarkdown(fetchResult.html, target.url);
          const metadata = ContentExtractor.extractMetadata(fetchResult.html, target.url);
          const entities = ContentExtractor.extractEntities(markdown, target.url);
          const citations = ContentExtractor.extractCitations(markdown, target.url);
          const discoveredLinks = ContentExtractor.extractLinks(fetchResult.html, target.url);
          const snippet = ContentExtractor.generateSnippet(markdown);

          inv.metrics.entitiesExtracted += entities.length;
          inv.metrics.citationsVerified += citations.length;

          // Ingest into Knowledge Graph
          this.graphEngine.ingestDocument({
            url: target.url,
            title: metadata.title || target.url,
            domain: metadata.domain,
            text: markdown,
            entities,
            citations,
            links: discoveredLinks
          });

          // Ingest into Corpus
          const doc = {
            url: target.url,
            title: metadata.title || target.url,
            domain: metadata.domain,
            snippet,
            content: markdown,
            status: 'processed',
            relevanceScore: 0.85 - (target.depth * 0.1),
            entities: entities.map(e => e.name),
            citations: citations.map(c => c.identifier),
            crawledAt: new Date().toISOString()
          };
          this.vaultStore.addCorpusDocument(doc);

          // Add to recent findings
          if (entities.length > 0 || citations.length > 0) {
            const finding = {
              title: metadata.title || target.url,
              url: target.url,
              snippet: snippet.slice(0, 160),
              entities: entities.slice(0, 3).map(e => e.name),
              timestamp: new Date().toISOString()
            };
            inv.recentFindings.unshift(finding);
            if (inv.recentFindings.length > 10) inv.recentFindings.pop();
            this.emit('finding_added', finding);
          }

          // Enqueue child links for deeper traversal if depth permits
          if (target.depth < frontier.maxDepth) {
            const relevantChildLinks = discoveredLinks
              .filter(l => !l.includes('login') && !l.includes('signup') && !l.includes('terms'))
              .slice(0, 3);
            const added = frontier.enqueueMultiple(relevantChildLinks, target.depth + 1, 4, target.url);
            inv.metrics.urlsDiscovered += added;
          }

          this.vaultStore.saveInvestigation(inv);
          this.emit('investigation_updated', inv);
          this.emit('graph_updated', this.vaultStore.getGraph());
        }

        phase.status = 'completed';
      }

      // Final Synthesis
      if (!this.isStopped) {
        inv.status = 'completed';
        this.log('Synthesizing research deliverables and compiling intelligence dossier...', 'info');
        const corpus = this.vaultStore.getCorpus();
        const graph = this.vaultStore.getGraph();
        const report = this.reportEngine.generateReport(inv, corpus, graph);

        this.log(`Research dossier generated successfully! Report ID: ${report.id}`, 'info');
        this.vaultStore.saveInvestigation(inv);
        this.emit('investigation_completed', { investigation: inv, report });
      }
    } finally {
      clearInterval(timerInterval);
    }
  }

  async discoverSeedUrls(queries) {
    const urls = new Set();
    // Query external DuckDuckGo search or structured seed directories
    for (const q of queries) {
      try {
        const queryNorm = encodeURIComponent(q);
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${queryNorm}`;
        const res = await this.fetcher.fetchUrl(ddgUrl);
        if (res.success && res.html) {
          // Parse DDG html search results
          const linkRegex = /<a\s+class="result__url"\s+href=["']([^"']+)["']/gi;
          let match;
          while ((match = linkRegex.exec(res.html)) !== null) {
            let u = match[1].trim();
            if (u.startsWith('//')) u = 'https:' + u;
            if (u.startsWith('/uddg=')) {
              u = decodeURIComponent(u.replace('/uddg=', '').split('&')[0]);
            }
            if (u.startsWith('http')) urls.add(u);
            if (urls.size >= 5) break;
          }
        }
      } catch {}
    }

    // Default robust seeds if search is firewalled or zero results
    if (urls.size === 0) {
      urls.add('https://github.com/trending');
      urls.add('https://arxiv.org/list/cs.AI/recent');
      urls.add('https://en.wikipedia.org/wiki/Intelligent_agent');
    }

    return Array.from(urls);
  }
}
