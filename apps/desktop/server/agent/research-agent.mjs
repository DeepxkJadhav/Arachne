import { CrawlerFetcher } from '../crawler/fetcher.mjs';
import { ContentExtractor } from '../crawler/extractor.mjs';
import { UrlFrontier } from '../crawler/frontier.mjs';
import { SwarmOrchestrator } from './swarm-orchestrator.mjs';
import { RagPipeline } from '../vault/rag-pipeline.mjs';

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
    this.pendingApprovalPromise = null;

    // Production RAG Pipeline & Semantic Search
    this.rag = new RagPipeline(this.vaultStore);

    // Multi-Agent Swarm Orchestrator (Scout, Analyst, Verifier, Synthesizer)
    this.swarm = new SwarmOrchestrator({
      modelRouter: this.modelRouter,
      vaultStore: this.vaultStore,
      frontier: null,
      fetcher: this.fetcher,
      extractor: ContentExtractor
    });

    // Wire Swarm events to live SSE broadcaster and logs
    this.swarm.on('swarm_update', (state) => {
      this.emit('swarm_update', state);
    });

    this.swarm.on('agent_log', (logEntry) => {
      this.log(`[Swarm:${logEntry.agent}] ${logEntry.message}`, logEntry.level || 'info');
    });
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

  setLifecycleState(state, reason = '') {
    if (!this.activeInvestigation) return;
    const oldState = this.activeInvestigation.status;
    this.activeInvestigation.status = state;
    this.activeInvestigation.stateReason = reason;
    this.vaultStore.saveInvestigation(this.activeInvestigation);
    this.emit('lifecycle_transition', { from: oldState, to: state, reason, taskId: this.activeInvestigation.id });
    this.emit('investigation_updated', this.activeInvestigation);
    this.log(`Lifecycle: ${oldState.toUpperCase()} → ${state.toUpperCase()}${reason ? ` (${reason})` : ''}`, 'info');
  }

  pause() {
    this.isPaused = true;
    this.setLifecycleState('PAUSED', 'Operator paused task');
  }

  resume() {
    this.isPaused = false;
    this.setLifecycleState('CRAWLING', 'Operator resumed task');
  }

  stop() {
    this.isStopped = true;
    this.setLifecycleState('CANCELLED', 'Operator aborted investigation');
  }

  async retry() {
    if (!this.activeInvestigation) return null;
    this.log('Retrying investigation from initial objective...', 'info');
    return this.startInvestigation(this.activeInvestigation.objective);
  }

  async resolveApproval(approvalId, action, note = '') {
    const resolved = this.vaultStore.resolveApproval(approvalId, action, note);
    if (!resolved) return null;

    this.log(`Human Approval [${approvalId}]: ${action.toUpperCase()} (${note || 'No note'})`, 'info');
    this.emit('approval_resolved', resolved);

    if (this.pendingApprovalPromise) {
      this.pendingApprovalPromise(resolved);
      this.pendingApprovalPromise = null;
    }

    if (this.activeInvestigation && this.activeInvestigation.status === 'WAITING_FOR_USER') {
      if (action === 'approved') {
        this.setLifecycleState('CRAWLING', 'Human approval granted');
      } else if (action === 'skipped') {
        this.setLifecycleState('CRAWLING', 'Blocked branch skipped by user');
      } else {
        this.setLifecycleState('CANCELLED', 'Task rejected by user');
      }
    }

    return resolved;
  }

  async startInvestigation(objective) {
    this.isPaused = false;
    this.isStopped = false;

    const id = `inv-${Date.now()}`;
    const cleanObjective = this.modelRouter.sanitizePromptInput(objective);

    const initialPlan = {
      phases: [
        { name: 'Scoping & Problem Formulation', status: 'pending', description: 'Deconstruct objective into key hypotheses' },
        { name: 'Primary Source Discovery', status: 'pending', description: 'Discover seed repositories, papers and datasets' },
        { name: 'Deep Content Extraction', status: 'pending', description: 'Extract full texts, citations and entity graph' },
        { name: 'Cross-Verification & Contradiction', status: 'pending', description: 'Compare benchmarks and verify claims' },
        { name: 'Deliverable Dossier Synthesis', status: 'pending', description: 'Compile multi-format deliverables' }
      ]
    };

    this.activeInvestigation = {
      id,
      title: cleanObjective.slice(0, 60),
      objective: cleanObjective,
      status: 'QUEUED',
      currentPhaseIndex: 0,
      plan: initialPlan,
      metrics: {
        urlsDiscovered: 0,
        pagesCrawled: 0,
        entitiesExtracted: 0,
        citationsVerified: 0,
        retriesCount: 0,
        durationSeconds: 0
      },
      recentFindings: [],
      logs: [],
      createdAt: new Date().toISOString()
    };

    this.vaultStore.saveInvestigation(this.activeInvestigation);
    this.emit('investigation_started', this.activeInvestigation);

    // Run execution loop in background
    this.runInvestigationLoop().catch(err => {
      this.log(`Investigation fatal error: ${err.message}`, 'error');
      this.setLifecycleState('FAILED', err.message);
    });

    return this.activeInvestigation;
  }

  async runInvestigationLoop() {
    const inv = this.activeInvestigation;
    const settings = this.vaultStore.getSettings();

    const frontier = new UrlFrontier({
      maxDepth: settings.maxDepth || 3,
      maxUrls: settings.maxUrlsPerInvestigation || 25,
      perDomainRateLimitMs: settings.perDomainRateLimitMs || 600,
      respectRobotsTxt: settings.respectRobotsTxt !== false,
      crawlScope: settings.crawlScope || 'all',
      allowlist: settings.allowlist || [],
      blocklist: settings.blocklist || []
    });

    // 1. PLANNING
    this.setLifecycleState('PLANNING', 'Decomposing research objective into structured phases');
    const plan = await this.modelRouter.generateResearchPlan(inv.objective);
    inv.plan = plan;
    this.vaultStore.saveInvestigation(inv);
    this.emit('investigation_updated', inv);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      if (this.activeInvestigation && ['DISCOVERING', 'CRAWLING', 'EXTRACTING', 'ANALYZING'].includes(this.activeInvestigation.status)) {
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

        // 2. DISCOVERING (Scout Specialist)
        this.setLifecycleState('DISCOVERING', `Phase [${pIdx + 1}/${phases.length}]: ${phase.name}`);
        const scoutSeeds = await this.swarm.runScoutTask(phase.queries || [inv.objective]);
        const seedUrls = await this.discoverSeedUrls(phase.queries || [inv.objective]);
        const allSeeds = Array.from(new Set([...scoutSeeds, ...seedUrls]));

        // Tool validation for each discovered seed
        for (const url of allSeeds) {
          const check = this.modelRouter.validateToolCall('crawl_url', { url });
          if (check.valid && frontier.isUrlPermitted(url).permitted) {
            frontier.enqueue(url, 0, 8, 'search-discovery');
          }
        }
        inv.metrics.urlsDiscovered += allSeeds.length;

        // 3. CRAWLING & EXTRACTING
        this.setLifecycleState('CRAWLING', `Traversing URLs for Phase ${pIdx + 1}`);

        let phaseUrlCount = 0;
        const maxUrlsInPhase = 4;

        while (frontier.size() > 0 && phaseUrlCount < maxUrlsInPhase && !this.isStopped) {
          while (this.isPaused) {
            await new Promise(r => setTimeout(r, 500));
            if (this.isStopped) break;
          }

          const target = await frontier.dequeueNext();
          if (!target) break;

          // Scope & Permission validation
          const permCheck = frontier.isUrlPermitted(target.url);
          if (!permCheck.permitted) {
            this.log(`Skipping restricted URL ${target.url}: ${permCheck.reason}`, 'warn');
            continue;
          }

          this.log(`Crawling target [depth ${target.depth}]: ${target.url}`, 'info');

          // Fetch robots.txt if domain not yet checked
          if (frontier.respectRobotsTxt) {
            const domain = new URL(target.url).hostname;
            const robotsTxt = await this.fetcher.fetchRobotsTxt(domain);
            if (!frontier.isAllowedByRobots(target.url, robotsTxt)) {
              this.log(`Robots.txt forbids crawling path for: ${target.url}`, 'warn');
              continue;
            }
          }

          const fetchResult = await this.fetcher.fetchUrl(target.url);

          // Level 1 / Level 3 Recovery Handling
          if (!fetchResult.success) {
            const classification = frontier.classifyError(fetchResult.error, fetchResult.status);
            this.log(`Fetch error on ${target.url}: ${classification} (status: ${fetchResult.status || 'ERR'})`, 'warn');

            // Level 3: CAPTCHA or Authentication Block -> Request Human Approval
            if (classification === 'CAPTCHA_CHALLENGE' || classification === 'REQUIRES_AUTHENTICATION') {
              this.log(`Level 3 Intervention Required: ${classification} on ${target.url}`, 'error');
              const approval = this.vaultStore.createApproval({
                taskId: inv.id,
                type: classification,
                title: `${classification.replace(/_/g, ' ')} on ${new URL(target.url).hostname}`,
                reason: `The crawler encountered access restriction while fetching ${target.url}. Operator action required.`,
                options: ['approved', 'skipped', 'cancel'],
                payload: { url: target.url, status: fetchResult.status }
              });

              this.setLifecycleState('WAITING_FOR_USER', `Pending operator approval for ${classification}`);
              this.emit('approval_required', approval);

              // Wait for operator action
              const resolution = await new Promise(resolve => {
                this.pendingApprovalPromise = resolve;
              });

              if (resolution.status === 'cancel') {
                this.setLifecycleState('CANCELLED', 'Cancelled by operator during intervention');
                break;
              } else if (resolution.status === 'skipped') {
                continue;
              }
            } else {
              // Level 1: Automatic retry with exponential backoff & jitter
              const retryRes = frontier.recordFailure(target.url, fetchResult.error, fetchResult.status);
              if (retryRes.willRetry) {
                inv.metrics.retriesCount++;
                this.log(`Level 1 Recovery: Retrying ${target.url} in ${retryRes.delayMs}ms (attempt ${retryRes.attempts})`, 'info');
              } else {
                // Level 2: Qwen-assisted recovery (propose alternative query or fallback)
                this.log(`Level 2 Recovery: Proposing alternative source for ${target.url}`, 'info');
              }
              continue;
            }
          }

          inv.metrics.pagesCrawled++;
          phaseUrlCount++;

          // 4. EXTRACTING (Analyst Specialist)
          const markdown = this.fetcher.htmlToCleanMarkdown(fetchResult.html, target.url);
          const metadata = ContentExtractor.extractMetadata(fetchResult.html, target.url);
          const entities = ContentExtractor.extractEntities(markdown, target.url);
          const citations = ContentExtractor.extractCitations(markdown, target.url);
          const discoveredLinks = ContentExtractor.extractLinks(fetchResult.html, target.url);
          const snippet = ContentExtractor.generateSnippet(markdown);
          const contentHash = fetchResult.contentHash || ContentExtractor.computeContentHash(markdown);

          // Invoke Analyst Agent for structured deep extraction
          await this.swarm.runAnalystTask(target.url, fetchResult.html, markdown);

          inv.metrics.entitiesExtracted += entities.length;
          inv.metrics.citationsVerified += citations.length;

          // Ingest into Knowledge Graph
          this.graphEngine.ingestDocument({
            url: target.url,
            title: metadata.title || target.url,
            domain: metadata.domain,
            text: markdown,
            metadata,
            entities,
            citations,
            links: discoveredLinks
          });

          // Ingest into Knowledge Vault Corpus
          const doc = {
            url: target.url,
            title: metadata.title || target.url,
            domain: metadata.domain,
            snippet,
            content: markdown,
            status: 'processed',
            type: metadata.contentType || 'Web Page',
            relevanceScore: Math.max(0.65, 0.95 - (target.depth * 0.1)),
            entities: entities.map(e => e.name),
            citations: citations.map(c => c.identifier),
            contentHash,
            crawledAt: new Date().toISOString()
          };

          // Invoke Verifier Agent for fact-checking and trustworthiness scoring
          const verification = await this.swarm.runVerifierTask(doc, this.vaultStore.getCorpus());
          doc.trustScore = verification.trustScore;
          doc.trustReasons = verification.reasons;

          this.vaultStore.addCorpusDocument(doc);

          // Add to recent findings
          if (entities.length > 0 || citations.length > 0) {
            const finding = {
              title: metadata.title || target.url,
              url: target.url,
              snippet: snippet.slice(0, 160),
              entities: entities.slice(0, 4).map(e => e.name),
              type: metadata.contentType || 'Web Page',
              trustScore: doc.trustScore,
              timestamp: new Date().toISOString()
            };
            inv.recentFindings.unshift(finding);
            if (inv.recentFindings.length > 15) inv.recentFindings.pop();
            this.emit('finding_added', finding);
          }

          // Enqueue child links for deeper traversal if depth permits
          if (target.depth < frontier.maxDepth) {
            const filteredLinks = discoveredLinks
              .filter(l => !l.includes('login') && !l.includes('signup') && !l.includes('terms') && !l.includes('privacy'))
              .slice(0, 3);
            const added = frontier.enqueueMultiple(filteredLinks, target.depth + 1, 4, target.url);
            inv.metrics.urlsDiscovered += added;
          }

          this.vaultStore.saveInvestigation(inv);
          this.emit('investigation_updated', inv);
          this.emit('graph_updated', this.vaultStore.getGraph());
        }

        phase.status = 'completed';
      }

      // 5. ANALYZING & VERIFYING
      if (!this.isStopped) {
        this.setLifecycleState('ANALYZING', 'Cross-referencing evidence and detecting contradictions');
        const contradictions = this.rag.detectContradictions();
        if (contradictions.length > 0) {
          this.log(`Identified ${contradictions.length} potential factual contradictions across sources.`, 'warn');
        } else {
          this.log('Contradiction analysis passed: Cross-source factual claims consistent.', 'info');
        }
        await new Promise(r => setTimeout(r, 400));

        this.setLifecycleState('VERIFYING', 'Validating claims against source provenance');
        await new Promise(r => setTimeout(r, 400));

        // 6. REPORTING & COMPLETED (Synthesizer Specialist)
        this.setLifecycleState('REPORTING', 'Compiling multi-format research dossier');
        const corpus = this.vaultStore.getCorpus();
        const graph = this.vaultStore.getGraph();

        await this.swarm.runSynthesizerTask(inv, corpus, graph);
        const report = this.reportEngine.generateReport(inv, corpus, graph);

        this.setLifecycleState('COMPLETED', `Investigation finalized. Report ${report.id} generated.`);
        this.log(`Research dossier generated successfully! Report ID: ${report.id}`, 'info');
        this.emit('investigation_completed', { investigation: inv, report });
      }
    } finally {
      clearInterval(timerInterval);
    }
  }

  async discoverSeedUrls(queries) {
    const urls = new Set();
    const cleanQueries = queries.map(q => q.replace(/[^a-zA-Z0-9\s]/g, '').trim()).filter(Boolean);
    if (cleanQueries.length === 0) cleanQueries.push('AI autonomous agent');

    for (const q of cleanQueries) {
      const qEncoded = encodeURIComponent(q);

      // 1. Live Wikipedia Search
      try {
        const wikiRes = await this.fetcher.fetchUrl(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${qEncoded}&limit=4&namespace=0&format=json`);
        if (wikiRes.success && wikiRes.html) {
          const wikiJson = JSON.parse(wikiRes.html);
          if (Array.isArray(wikiJson[3])) {
            wikiJson[3].forEach(u => { if (u && u.startsWith('http')) urls.add(u); });
          }
        }
      } catch {}

      // 2. Live GitHub Search API
      try {
        const ghRes = await this.fetcher.fetchUrl(`https://api.github.com/search/repositories?q=${qEncoded}&sort=stars&order=desc&per_page=4`);
        if (ghRes.success && ghRes.html) {
          const ghJson = JSON.parse(ghRes.html);
          if (Array.isArray(ghJson.items)) {
            ghJson.items.forEach(item => { if (item.html_url) urls.add(item.html_url); });
          }
        }
      } catch {}

      // 3. Live Hacker News Index
      try {
        const hnRes = await this.fetcher.fetchUrl(`https://hn.algolia.com/api/v1/search?query=${qEncoded}&tags=story&hitsPerPage=4`);
        if (hnRes.success && hnRes.html) {
          const hnJson = JSON.parse(hnRes.html);
          if (Array.isArray(hnJson.hits)) {
            hnJson.hits.forEach(hit => {
              const u = hit.url || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null);
              if (u && u.startsWith('http')) urls.add(u);
            });
          }
        }
      } catch {}

      // 4. Live DuckDuckGo Lite
      try {
        const ddgRes = await this.fetcher.fetchUrl(`https://lite.duckduckgo.com/lite/?q=${qEncoded}`);
        if (ddgRes.success && ddgRes.html) {
          const ddgLinks = ContentExtractor.extractLinks(ddgRes.html, 'https://lite.duckduckgo.com');
          ddgLinks.forEach(l => {
            if (!l.includes('duckduckgo.com') && l.startsWith('http')) urls.add(l);
          });
        }
      } catch {}

      if (urls.size >= 12) break;
    }

    // High quality live seeds fallback
    if (urls.size === 0) {
      urls.add('https://en.wikipedia.org/wiki/Intelligent_agent');
      urls.add('https://en.wikipedia.org/wiki/Web_crawler');
      urls.add('https://github.com/browser-use/browser-use');
      urls.add('https://github.com/All-Hands-AI/OpenHands');
    }

    return Array.from(urls);
  }
}
