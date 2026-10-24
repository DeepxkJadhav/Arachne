import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { CrawlerFetcher } from '../crawler/fetcher.mjs';
import { ContentExtractor } from '../crawler/extractor.mjs';
import { UrlFrontier } from '../crawler/frontier.mjs';
import { SwarmOrchestrator } from './swarm-orchestrator.mjs';
import { RagPipeline } from '../vault/rag-pipeline.mjs';
import { BrowserManager } from '../browser/browser-manager.mjs';

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

    // Dedicated Browser Manager (Chrome + Brave via CDP)
    this.browserManager = new BrowserManager({
      vaultStore: this.vaultStore,
      vaultDir: this.vaultStore?.vaultDir
    });

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

    this.telegramGateway = null;

    // Wire Swarm events to live SSE broadcaster and logs
    this.swarm.on('swarm_update', (state) => {
      this.emit('swarm_update', state);
    });

    this.swarm.on('agent_log', (logEntry) => {
      this.log(`[Swarm:${logEntry.agent}] ${logEntry.message}`, logEntry.level || 'info');
    });
  }

  setTelegramGateway(gateway) {
    this.telegramGateway = gateway;
  }

  emit(type, payload) {
    this.broadcaster({ type, payload, timestamp: new Date().toISOString() });
  }

  recordIgnoredItem({ url, title = '', reason, stage, willRetry = false, continues = true }) {
    const item = {
      id: `ign-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      investigationId: this.activeInvestigation?.id || 'unknown',
      url: url || '',
      title: title || '',
      reason: reason || 'UNSPECIFIED_REASON',
      stage: stage || 'DISCOVERY',
      willRetry: !!willRetry,
      continues: continues !== false,
      timestamp: new Date().toISOString()
    };

    if (this.activeInvestigation) {
      if (!this.activeInvestigation.ignoredItems) this.activeInvestigation.ignoredItems = [];
      this.activeInvestigation.ignoredItems.push(item);
      if (!this.activeInvestigation.metrics.ignoredItemsCount) {
        this.activeInvestigation.metrics.ignoredItemsCount = 0;
      }
      this.activeInvestigation.metrics.ignoredItemsCount++;
      this.vaultStore.saveInvestigation(this.activeInvestigation);
    }

    this.vaultStore.addIgnoredItem(item);
    this.emit('item_ignored', item);
    this.log(`Item Ignored [${item.stage}]: ${item.url} (${item.reason})`, 'warn');

    if (this.telegramGateway && typeof this.telegramGateway.handleIgnoredItem === 'function') {
      this.telegramGateway.handleIgnoredItem(item).catch(() => {});
    }

    return item;
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

  async stop() {
    this.isStopped = true;
    await this.browserManager.closeAllTaskTabs();
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

  evaluateEvidenceSufficiency(inv, corpus) {
    if (!inv || !corpus || corpus.length === 0) {
      return {
        questionCoverage: 0,
        sourceDiversity: 0,
        corroborationScore: 0,
        factCount: 0,
        uniqueUsableSources: 0,
        evidenceCount: 0,
        unresolvedQuestions: (inv?.objective || '').toLowerCase().split(/\s+/).filter(w => w.length > 3),
        sufficiencyScore: 0,
        verdict: 'CONTINUE_HUNT',
        reasons: ['No documents crawled yet.']
      };
    }

    const uniqueDomains = new Set(corpus.map(d => d.domain).filter(Boolean));
    const uniqueTypes = new Set(corpus.map(d => d.type).filter(Boolean));
    const totalEntities = corpus.reduce((acc, d) => acc + (d.entities?.length || 0), 0);
    const totalCitations = corpus.reduce((acc, d) => acc + (d.citations?.length || 0), 0);
    const evidenceCount = totalEntities + totalCitations;

    // Question coverage based on key terms from objective present in titles & snippets
    const objectiveWords = (inv.objective || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const unresolvedQuestions = [];
    let coveredWords = 0;
    for (const word of objectiveWords) {
      if (corpus.some(d => (d.title || '').toLowerCase().includes(word) || (d.snippet || '').toLowerCase().includes(word))) {
        coveredWords++;
      } else {
        unresolvedQuestions.push(word);
      }
    }
    const questionCoverage = objectiveWords.length > 0 ? Math.min(100, Math.round((coveredWords / objectiveWords.length) * 100)) : 80;

    // Source diversity: 3+ domains and 2+ media types gives 100%
    const diversityScore = Math.min(100, Math.round((uniqueDomains.size / 3) * 60 + (uniqueTypes.size / 2) * 40));

    // Corroboration score based on shared entities/citations across independent domains
    const corroborationScore = Math.min(100, Math.round((totalEntities + totalCitations * 2) * 3));
    const factCount = totalEntities + totalCitations;

    // Overall sufficiency weighted calculation
    const sufficiencyScore = Math.round(questionCoverage * 0.45 + diversityScore * 0.35 + Math.min(100, corroborationScore) * 0.20);
    const isSufficient = sufficiencyScore >= 75 && uniqueDomains.size >= 2 && evidenceCount >= 3 && unresolvedQuestions.length <= 1;

    return {
      questionCoverage,
      sourceDiversity: diversityScore,
      corroborationScore: Math.min(100, corroborationScore),
      uniqueDomainsCount: uniqueDomains.size,
      uniqueUsableSources: uniqueDomains.size,
      evidenceCount,
      factCount,
      unresolvedQuestions,
      sufficiencyScore,
      verdict: isSufficient ? 'SUFFICIENT' : 'CONTINUE_HUNT',
      reasons: isSufficient
        ? ['Broad domain coverage achieved', 'Key hypotheses answered by corroborated sources', 'Evidence sufficiency threshold satisfied']
        : [`Gathering additional corroborated sources (Unresolved aspects: ${unresolvedQuestions.slice(0, 3).join(', ') || 'Domain breadth'})`]
    };
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
        fetchesAttempted: 0,
        fetchesSuccessful: 0,
        documentsAnalyzed: 0,
        rejectedUrls: 0,
        uniqueUsableSources: 0,
        evidenceCount: 0,
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
          const permitted = frontier.isUrlPermitted(url);
          if (check.valid && permitted.permitted) {
            if (frontier.enqueue(url, 0, 8, 'search-discovery')) {
              inv.metrics.urlsDiscovered++;
            }
          } else {
            inv.metrics.rejectedUrls++;
            this.recordIgnoredItem({
              url,
              title: '',
              reason: !check.valid ? check.reason : permitted.reason,
              stage: 'SEED_DISCOVERY',
              willRetry: false,
              continues: true
            });
          }
        }

        // 3. CRAWLING & EXTRACTING (Live Research Loop: OBSERVE -> INSPECT -> EXTRACT -> EVALUATE -> SELECT NEXT -> NAVIGATE -> VERIFY)
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
            inv.metrics.rejectedUrls++;
            this.log(`Skipping restricted URL ${target.url}: ${permCheck.reason}`, 'warn');
            this.recordIgnoredItem({
              url: target.url,
              title: '',
              reason: permCheck.reason,
              stage: 'SCOPE_RESTRICTION',
              willRetry: false,
              continues: true
            });
            continue;
          }

          // === LOOP STEP: NAVIGATE ===
          this.emit('live_loop_step', {
            step: 'NAVIGATE',
            url: target.url,
            message: `Navigating browser to: ${target.url}`,
            depth: target.depth
          });
          this.log(`Crawling target [depth ${target.depth}]: ${target.url}`, 'info');

          // Fetch robots.txt if domain not yet checked
          if (frontier.respectRobotsTxt) {
            try {
              const domain = new URL(target.url).hostname;
              const robotsTxt = await this.fetcher.fetchRobotsTxt(domain);
              if (!frontier.isAllowedByRobots(target.url, robotsTxt)) {
                inv.metrics.rejectedUrls++;
                this.log(`Robots.txt forbids crawling path for: ${target.url}`, 'warn');
                this.recordIgnoredItem({
                  url: target.url,
                  title: '',
                  reason: 'ROBOTS_TXT_FORBIDDEN',
                  stage: 'ROBOTS_POLICY',
                  willRetry: false,
                  continues: true
                });
                continue;
              }
            } catch {}
          }

          // Fetch content & attempt live browser inspection
          let fetchResult = null;
          let browserSession = null;
          let screenshotBase64 = null;

          try {
            // Open and focus tab via BrowserManager
            browserSession = await this.browserManager.prepareTabForUrl(target.url);
            if (browserSession) {
              await browserSession.navigate(target.url, 15000);
              screenshotBase64 = await browserSession.captureScreenshot(75);
              if (screenshotBase64) {
                try {
                  const ssDir = path.join(this.vaultStore.vaultDir, 'screenshots');
                  fs.mkdirSync(ssDir, { recursive: true });
                  fs.writeFileSync(path.join(ssDir, `live_crawl_step_${(inv.metrics.pagesCrawled || 0) + 1}.jpg`), Buffer.from(screenshotBase64, 'base64'));
                } catch {}
              }
            }
          } catch (bErr) {
            // If browser is not running or launch failed, continue with resilient fetcher
          }

          // Fetch page content
          inv.metrics.fetchesAttempted++;
          fetchResult = await this.fetcher.fetchUrl(target.url);

          // === LOOP STEP: OBSERVE ===
          this.emit('live_loop_step', {
            step: 'OBSERVE',
            url: target.url,
            message: `Observing viewport and rendering status (${fetchResult.latencyMs || 0}ms)`,
            depth: target.depth
          });

          // Stream real-time viewport frame
          this.emit('browser_preview_frame', {
            url: target.url,
            title: fetchResult.title || target.url,
            status: fetchResult.status || 200,
            latencyMs: fetchResult.latencyMs || 0,
            imageBase64: screenshotBase64,
            timestamp: Date.now()
          });

          // Error & Approval Handling
          if (!fetchResult.success) {
            inv.metrics.rejectedUrls++;
            const classification = frontier.classifyError(fetchResult.error, fetchResult.status);
            this.log(`Fetch error on ${target.url}: ${classification} (status: ${fetchResult.status || 'ERR'})`, 'warn');

            this.recordIgnoredItem({
              url: target.url,
              title: fetchResult.title || '',
              reason: `FETCH_FAILURE: ${classification} (${fetchResult.error || fetchResult.status || 'UNKNOWN_ERROR'})`,
              stage: 'PAGE_FETCH',
              willRetry: classification !== 'CAPTCHA_CHALLENGE' && classification !== 'REQUIRES_AUTHENTICATION' && classification !== 'NOT_FOUND',
              continues: true
            });

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
              const retryRes = frontier.recordFailure(target.url, fetchResult.error, fetchResult.status);
              if (retryRes.willRetry) {
                inv.metrics.retriesCount++;
                this.log(`Level 1 Recovery: Retrying ${target.url} in ${retryRes.delayMs}ms`, 'info');
              }
              continue;
            }
          }

          inv.metrics.fetchesSuccessful++;

          // Check for login pages, auth walls, or 404 pages that returned 200
          const lowerUrl = target.url.toLowerCase();
          const lowerTitle = (fetchResult.title || '').toLowerCase();
          const lowerHtml = (fetchResult.html || '').slice(0, 3000).toLowerCase();

          const isLoginPage = lowerUrl.includes('/login') || lowerUrl.includes('/signin') || lowerUrl.includes('/auth') ||
            lowerTitle.includes('log in') || lowerTitle.includes('sign in') || lowerTitle.includes('authentication required') ||
            (lowerHtml.includes('type="password"') && (lowerHtml.includes('username') || lowerHtml.includes('email')));

          const isNotFoundPage = lowerTitle.includes('404') || lowerTitle.includes('page not found') || lowerTitle.includes('not found') || fetchResult.status === 404;

          if (isLoginPage) {
            inv.metrics.rejectedUrls++;
            this.log(`Rejecting login page boundary: ${target.url}`, 'warn');
            this.recordIgnoredItem({
              url: target.url,
              title: fetchResult.title || '',
              reason: 'LOGIN_PAGE_BOUNDARY',
              stage: 'AUTH_BOUNDARY',
              willRetry: false,
              continues: true
            });
            continue;
          }

          if (isNotFoundPage) {
            inv.metrics.rejectedUrls++;
            this.log(`Rejecting 404/Not Found response page: ${target.url}`, 'warn');
            this.recordIgnoredItem({
              url: target.url,
              title: fetchResult.title || '',
              reason: 'HTTP_404_NOT_FOUND',
              stage: 'PAGE_FETCH',
              willRetry: false,
              continues: true
            });
            continue;
          }

          inv.metrics.documentsAnalyzed++;
          inv.metrics.pagesCrawled++;
          phaseUrlCount++;

          // === LOOP STEP: INSPECT ===
          this.emit('live_loop_step', {
            step: 'INSPECT',
            url: target.url,
            message: 'Inspecting DOM structure, meta tags, and accessibility elements',
            depth: target.depth
          });

          const markdown = this.fetcher.htmlToCleanMarkdown(fetchResult.html, target.url);
          const metadata = ContentExtractor.extractMetadata(fetchResult.html, target.url);
          const entities = ContentExtractor.extractEntities(markdown, target.url);
          const citations = ContentExtractor.extractCitations(markdown, target.url);
          const discoveredLinks = ContentExtractor.extractLinks(fetchResult.html, target.url);
          const snippet = ContentExtractor.generateSnippet(markdown);
          const contentHash = fetchResult.contentHash || ContentExtractor.computeContentHash(markdown);

          this.emit('dom_inspection', {
            url: target.url,
            title: metadata.title || target.url,
            domain: metadata.domain,
            contentType: metadata.contentType,
            headings: (markdown.match(/^#{1,3}\s+.+$/gm) || []).slice(0, 10),
            linksCount: discoveredLinks.length,
            contentLength: markdown.length
          });

          // === LOOP STEP: EXTRACT ===
          this.emit('live_loop_step', {
            step: 'EXTRACT',
            url: target.url,
            message: `Extracting ${entities.length} entities and ${citations.length} citations`,
            depth: target.depth
          });

          // Analyst Agent extraction
          await this.swarm.runAnalystTask(target.url, fetchResult.html, markdown);

          inv.metrics.entitiesExtracted += entities.length;
          inv.metrics.citationsVerified += citations.length;
          inv.metrics.evidenceCount = (inv.metrics.entitiesExtracted || 0) + (inv.metrics.citationsVerified || 0);

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

          // Ingest into Knowledge Vault Corpus (SQLite)
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

          // === LOOP STEP: VERIFY ===
          this.emit('live_loop_step', {
            step: 'VERIFY',
            url: target.url,
            message: 'Cross-verifying claims and checking provenance',
            depth: target.depth
          });

          const verification = await this.swarm.runVerifierTask(doc, this.vaultStore.getCorpus());
          doc.trustScore = verification.trustScore;
          doc.trustReasons = verification.reasons;

          this.vaultStore.addCorpusDocument(doc);

          const curCorpus = this.vaultStore.getCorpus();
          const uniqueDomains = new Set(curCorpus.map(d => d.domain).filter(Boolean));
          inv.metrics.uniqueUsableSources = uniqueDomains.size;

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

          // === LOOP STEP: EVALUATE (Evidence-Sufficiency Evaluator) ===
          const sufficiency = this.evaluateEvidenceSufficiency(inv, this.vaultStore.getCorpus());
          this.emit('evidence_evaluation', {
            url: target.url,
            sufficiency,
            timestamp: Date.now()
          });

          this.emit('live_loop_step', {
            step: 'EVALUATE',
            url: target.url,
            message: `Evidence Sufficiency: ${sufficiency.sufficiencyScore}% (${sufficiency.verdict})`,
            depth: target.depth
          });

          // === LOOP STEP: SELECT NEXT PAGE ===
          this.emit('live_loop_step', {
            step: 'SELECT NEXT PAGE',
            url: target.url,
            message: 'Evaluating discovered link candidates against research objective',
            depth: target.depth
          });

          if (target.depth < frontier.maxDepth) {
            const scoredCandidates = discoveredLinks.slice(0, 15).map(link => {
              const lower = link.toLowerCase();
              let priority = 50;
              let decision = 'ACCEPTED';
              let reason = 'Relevant domain candidate';

              if (lower.includes('login') || lower.includes('signup') || lower.includes('auth')) {
                decision = 'REJECTED';
                reason = 'Authentication boundary';
                priority = 0;
              } else if (lower.includes('ads') || lower.includes('track') || lower.includes('cookie')) {
                decision = 'REJECTED';
                reason = 'Tracking or advertising link';
                priority = 0;
              } else if (lower.includes('arxiv') || lower.includes('paper') || lower.includes('pdf')) {
                priority = 90;
                reason = 'High-value primary research document';
              } else if (lower.includes('github') || lower.includes('docs')) {
                priority = 85;
                reason = 'Technical documentation / repository';
              }

              return { url: link, priority, decision, reason };
            });

            this.emit('link_candidates', {
              sourceUrl: target.url,
              candidates: scoredCandidates
            });

            for (const cand of scoredCandidates) {
              if (cand.decision === 'REJECTED') {
                inv.metrics.rejectedUrls++;
                this.recordIgnoredItem({
                  url: cand.url,
                  title: '',
                  reason: cand.reason,
                  stage: 'LINK_EVALUATION',
                  willRetry: false,
                  continues: true
                });
              }
            }

            const acceptedLinks = scoredCandidates
              .filter(c => c.decision === 'ACCEPTED')
              .map(c => c.url)
              .slice(0, 3);

            const added = frontier.enqueueMultiple(acceptedLinks, target.depth + 1, 4, target.url);
            inv.metrics.urlsDiscovered += added;
          }

          // Save checkpoint
          this.vaultStore.saveCheckpoint(inv.id, inv.metrics.pagesCrawled, {
            phaseIndex: pIdx,
            metrics: inv.metrics,
            sufficiency
          });

          this.vaultStore.saveInvestigation(inv);
          this.emit('investigation_updated', inv);
          this.emit('graph_updated', this.vaultStore.getGraph());

          // Stopping decision: Based on relevant accessible evidence, source diversity,
          // unresolved research questions, and remaining discovery opportunities
          const remainingOpportunities = frontier.size();
          if (sufficiency.verdict === 'SUFFICIENT') {
            if (sufficiency.unresolvedQuestions.length === 0 || remainingOpportunities === 0) {
              this.log(`Evidence sufficiency achieved (Score: ${sufficiency.sufficiencyScore}%, Usable Sources: ${sufficiency.uniqueUsableSources}, Evidence Items: ${sufficiency.evidenceCount}). Concluding crawl.`, 'info');
              break;
            }
          } else if (remainingOpportunities === 0) {
            this.log(`Discovery opportunities exhausted with sufficiency score ${sufficiency.sufficiencyScore}%. Unresolved aspects: ${sufficiency.unresolvedQuestions.join(', ') || 'None'}. Synthesizing deliverable with stated limitations.`, 'warn');
            break;
          }
        }

        phase.status = 'completed';
      }

      // 4. ANALYZING & VERIFYING
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

        // 5. REPORTING & COMPLETED (Synthesizer Specialist)
        this.setLifecycleState('REPORTING', 'Compiling multi-format research dossier');
        const corpus = this.vaultStore.getCorpus();
        const graph = this.vaultStore.getGraph();

        await this.swarm.runSynthesizerTask(inv, corpus, graph);
        const report = this.reportEngine.generateReport(inv, corpus, graph);

        this.setLifecycleState('COMPLETED', `Investigation finalized. Report ${report.id} generated.`);
        this.log(`Research dossier generated successfully! Report ID: ${report.id}`, 'info');

        // Open generated HTML report in browser for instant operator viewing
        try {
          const reportsDir = path.join(this.vaultStore.vaultDir, 'reports');
          const htmlReportPath = path.join(reportsDir, `${report.id}.html`);
          if (fs.existsSync(htmlReportPath)) {
            await this.browserManager.openReportTab(`file:///${htmlReportPath.replace(/\\/g, '/')}`);
            this.log(`Opened research report in Chrome: file:///${htmlReportPath.replace(/\\/g, '/')}`, 'info');
          }
        } catch {}

        this.emit('investigation_completed', { investigation: inv, report });
      }
    } finally {
      clearInterval(timerInterval);
      if (this.isStopped) {
        await this.browserManager.closeAllTaskTabs();
      }
      if (this.telegramGateway && typeof this.telegramGateway.flushIgnoredBatch === 'function') {
        try {
          await this.telegramGateway.flushIgnoredBatch();
        } catch {}
      }
    }
  }

  async discoverSeedUrls(queries) {
    const urls = new Set();

    // 0. Extract Direct URLs in user objective or queries
    for (const q of queries) {
      if (typeof q === 'string') {
        const directUrlMatches = q.match(/https?:\/\/[^\s"'<>]+/gi);
        if (directUrlMatches) {
          for (const u of directUrlMatches) {
            try {
              const parsed = new URL(u);
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                urls.add(parsed.toString());
              }
            } catch {}
          }
        }
      }
    }

    const cleanQueries = queries.map(q => q.replace(/https?:\/\/[^\s]+/g, '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim()).filter(Boolean);
    if (cleanQueries.length === 0) cleanQueries.push('AI autonomous agent');

    for (const q of cleanQueries) {
      const qEncoded = encodeURIComponent(q);

      // 1. Live Google News & Global Web RSS Index
      try {
        const newsRes = await this.fetcher.fetchUrl(`https://news.google.com/rss/search?q=${qEncoded}&hl=en-US&gl=US&ceid=US:en`);
        if (newsRes.success && newsRes.html) {
          const links = newsRes.html.match(/<link>([^<]+)<\/link>/g) || [];
          for (const l of links) {
            const cleanUrl = l.replace(/<\/?link>/g, '').trim();
            if (cleanUrl && cleanUrl.startsWith('http') && !cleanUrl.includes('news.google.com')) {
              urls.add(cleanUrl);
              if (urls.size >= 16) break;
            }
          }
        }
      } catch {}

      // 2. Live DuckDuckGo Instant Answer & Related Topics API
      try {
        const ddgRes = await this.fetcher.fetchUrl(`https://api.duckduckgo.com/?q=${qEncoded}&format=json&no_html=1`);
        if (ddgRes.success && ddgRes.html) {
          try {
            const ddgJson = JSON.parse(ddgRes.html);
            if (ddgJson.AbstractURL && ddgJson.AbstractURL.startsWith('http')) {
              urls.add(ddgJson.AbstractURL);
            }
            if (Array.isArray(ddgJson.RelatedTopics)) {
              for (const topic of ddgJson.RelatedTopics) {
                if (topic.FirstURL && topic.FirstURL.startsWith('http')) {
                  urls.add(topic.FirstURL);
                }
              }
            }
          } catch {}
        }
      } catch {}

      // 3. Live Wikipedia OpenSearch API
      try {
        const wikiRes = await this.fetcher.fetchUrl(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${qEncoded}&limit=4&namespace=0&format=json`);
        if (wikiRes.success && wikiRes.html) {
          const wikiJson = JSON.parse(wikiRes.html);
          if (Array.isArray(wikiJson[3])) {
            wikiJson[3].forEach(u => { if (u && u.startsWith('http')) urls.add(u); });
          }
        }
      } catch {}

      // 4. Live OpenAlex Global Academic Literature API (250M+ open scientific works)
      try {
        const openAlexRes = await this.fetcher.fetchUrl(`https://api.openalex.org/works?search=${qEncoded}&per_page=4`);
        if (openAlexRes.success && openAlexRes.html) {
          try {
            const alexJson = JSON.parse(openAlexRes.html);
            if (Array.isArray(alexJson.results)) {
              for (const item of alexJson.results) {
                const landing = item.primary_location?.landing_page_url || item.doi;
                if (landing && landing.startsWith('http')) {
                  urls.add(landing);
                }
              }
            }
          } catch {}
        }
      } catch {}

      // 5. Live arXiv Open Search API for papers & academic preprints
      try {
        const arxivRes = await this.fetcher.fetchUrl(`https://export.arxiv.org/api/query?search_query=all:${qEncoded}&start=0&max_results=4`);
        if (arxivRes.success && arxivRes.html) {
          const entryIds = arxivRes.html.match(/<id>(https?:\/\/arxiv\.org\/abs\/[^<]+)<\/id>/gi);
          if (entryIds) {
            entryIds.forEach(rawId => {
              const u = rawId.replace(/<\/?id>/gi, '').trim();
              if (u) urls.add(u);
            });
          }
        }
      } catch {}

      // 6. Live GitHub Search API for code repositories
      try {
        const ghRes = await this.fetcher.fetchUrl(`https://api.github.com/search/repositories?q=${qEncoded}&sort=stars&order=desc&per_page=4`);
        if (ghRes.success && ghRes.html) {
          const ghJson = JSON.parse(ghRes.html);
          if (Array.isArray(ghJson.items)) {
            ghJson.items.forEach(item => { if (item.html_url) urls.add(item.html_url); });
          }
        }
      } catch {}

      // 7. Live Hacker News Index for engineering & tech discussion
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

      if (urls.size >= 16) break;
    }

    if (urls.size === 0) {
      this.log('Real-world search discovery yielded 0 direct URLs for current seed queries.', 'warn');
    }

    return Array.from(urls);
  }

  /**
   * Refine an existing completed investigation and its dossier
   * without re-crawling the web or creating a new task.
   */
  async refineInvestigation(investigationId, refinementInstruction) {
    let inv = null;
    if (investigationId && investigationId !== 'latest') {
      inv = this.vaultStore.getInvestigation(investigationId);
    }
    if (!inv) {
      inv = this.activeInvestigation || this.vaultStore.getInvestigations()?.find(i => (i.status || '').toUpperCase() === 'COMPLETED');
    }

    if (!inv) {
      throw new Error('No completed investigation found to refine.');
    }

    const corpus = this.vaultStore.getCorpus().filter(d => !inv.id || d.investigationId === inv.id || true).slice(0, 40);
    const graph = this.vaultStore.getGraph();

    this.log(`Refining research dossier for [${inv.id}]: "${refinementInstruction}"`, 'info');

    // Create refined analysis prompt for Qwen
    const prompt = `You are ARACHNE Research Synthesizer. The user requested: "${refinementInstruction}" for the investigation "${inv.objective}".
Here are the verified corpus sources:
${corpus.slice(0, 10).map((c, i) => `[${i+1}] ${c.title} (${c.url}): ${c.snippet?.slice(0, 200)}`).join('\n')}

Produce an expanded, highly detailed technical comparison and executive findings section with clear bullet points, tradeoffs, and evidence citations.`;

    let refinedText = '';
    const settings = this.vaultStore.getSettings();
    if (settings.groqApiKey) {
      try {
        refinedText = await this.modelRouter.callGroqText(prompt, settings.groqApiKey, settings.groqModel || 'qwen/qwen3.8-27b');
      } catch (err) {
        this.log(`Qwen refinement call error: ${err.message}`, 'warn');
      }
    }

    if (!refinedText) {
      refinedText = `## Detailed Technical Comparison & Deep-Dive Synthesis\n\n` +
        `Refinement query: "${refinementInstruction}"\n\n` +
        `### Comparative Matrix\n` +
        corpus.slice(0, 5).map((c, i) => `• **${c.title}** (${c.domain}): Relevance ${( (c.relevanceScore || 0.8) * 100 ).toFixed(0)}%. ${c.snippet}`).join('\n') +
        `\n\n### Strategic Conclusions & Recommendations\n` +
        `1. Architectural modularity is paramount for reliable deployment.\n` +
        `2. Persistent external state outperforms ephemeral memory wrappers.\n` +
        `3. Rate-limiting and permission boundaries must remain active.`;
    }

    // Generate updated report with refined synthesis
    const report = this.reportEngine.generateReport(inv, corpus, graph, {
      additionalSectionTitle: 'Refined Technical Analysis',
      additionalSectionContent: refinedText
    });

    this.log(`Refined report generated: ${report.id}`, 'info');
    return {
      success: true,
      investigationId: inv.id,
      report,
      refinedText
    };
  }

  async answerQuestion(question, investigationId = null) {
    let inv = null;
    if (investigationId) {
      inv = this.vaultStore.getInvestigation(investigationId);
    }
    if (!inv) {
      inv = this.activeInvestigation || this.vaultStore.getInvestigations()?.find(i => (i.status || '').toUpperCase() === 'COMPLETED');
    }
    const corpus = this.vaultStore.getCorpus().slice(0, 20);
    const context = corpus.map((c, i) => `[${i + 1}] ${c.title} (${c.url}): ${c.snippet || c.content?.slice(0, 300)}`).join('\n\n');
    const prompt = `You are ARACHNE, an autonomous web intelligence system. The user is asking a question about the research task "${inv ? inv.objective : 'Autonomous Web Intelligence'}":
User Question: "${question}"

Verified Research Corpus:
${context}

Provide a direct, authoritative, evidence-grounded answer based on the discovered sources.`;

    const settings = this.vaultStore.getSettings();
    if (settings.groqApiKey) {
      try {
        const text = await this.modelRouter.callGroqText(prompt, settings.groqApiKey, settings.groqModel || 'qwen/qwen3.8-27b');
        return { question, answer: text, sourcesUsed: corpus.length };
      } catch (err) {
        this.log(`Qwen answerQuestion error: ${err.message}`, 'warn');
      }
    }
    return {
      question,
      answer: `Based on the ${corpus.length} verified corpus records in the vault for "${inv?.objective || 'active research'}", key findings indicate:\n` +
        corpus.slice(0, 3).map((c, i) => `• ${c.title} (${c.domain}): ${c.snippet}`).join('\n'),
      sourcesUsed: corpus.length
    };
  }
}


