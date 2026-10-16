export class UrlFrontier {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : 3;
    this.maxUrls = options.maxUrls || 50;
    this.respectRobotsTxt = options.respectRobotsTxt !== false;
    this.perDomainRateLimitMs = options.perDomainRateLimitMs || 800;
    this.crawlScope = options.crawlScope || 'all'; // 'all' | 'specified_only' | 'allow_block'
    this.allowlist = new Set((options.allowlist || []).map(d => d.toLowerCase().trim()));
    this.blocklist = new Set((options.blocklist || []).map(d => d.toLowerCase().trim()));
    this.maxRetries = options.maxRetries || 3;
    this.backoffBaseMs = options.backoffBaseMs || 1000;

    this.queue = [];
    this.visitedUrls = new Set();
    this.domainLastAccessed = new Map();
    this.domainRobotsCache = new Map();
    this.retryTracker = new Map(); // url -> { attempts: number, nextTryAfter: number, lastError: string }
  }

  normalizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = ''; // Strip fragments
      u.hostname = u.hostname.toLowerCase();
      // Remove trailing slash from pathname if not root
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      // Clean tracking parameters
      const cleanParams = new URLSearchParams();
      const sortedKeys = Array.from(u.searchParams.keys()).sort();
      for (const key of sortedKeys) {
        if (!key.startsWith('utm_') && !key.startsWith('fbclid') && key !== 'ref' && key !== 'gclid') {
          for (const val of u.searchParams.getAll(key)) {
            cleanParams.append(key, val);
          }
        }
      }
      u.search = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
      return u.toString();
    } catch {
      return null;
    }
  }

  isDomainMatch(hostname, pattern) {
    if (pattern === hostname) return true;
    if (pattern.startsWith('*.')) {
      const root = pattern.slice(2);
      return hostname === root || hostname.endsWith(`.${root}`);
    }
    return false;
  }

  isUrlPermitted(url) {
    const norm = this.normalizeUrl(url);
    if (!norm) return { permitted: false, reason: 'INVALID_URL' };

    let hostname;
    try {
      hostname = new URL(norm).hostname.toLowerCase();
    } catch {
      return { permitted: false, reason: 'INVALID_HOSTNAME' };
    }

    // 1. Check explicit blocklist
    for (const blocked of this.blocklist) {
      if (this.isDomainMatch(hostname, blocked)) {
        return { permitted: false, reason: `DOMAIN_BLOCKED: ${blocked}` };
      }
    }

    // 2. Check crawl scope
    if (this.crawlScope === 'specified_only' || this.crawlScope === 'allow_block') {
      if (this.allowlist.size > 0) {
        let matched = false;
        for (const allowed of this.allowlist) {
          if (this.isDomainMatch(hostname, allowed)) {
            matched = true;
            break;
          }
        }
        if (!matched) {
          return { permitted: false, reason: `DOMAIN_NOT_IN_ALLOWLIST: ${hostname}` };
        }
      }
    }

    return { permitted: true, reason: 'PERMITTED' };
  }

  enqueue(url, depth = 0, priority = 5, referrer = null) {
    const norm = this.normalizeUrl(url);
    if (!norm) return false;
    if (this.visitedUrls.has(norm)) return false;
    if (this.queue.some(item => item.url === norm)) return false;
    if (depth > this.maxDepth) return false;
    if (this.visitedUrls.size + this.queue.length >= this.maxUrls * 2) return false;

    // Validate scope permission
    const scopeCheck = this.isUrlPermitted(norm);
    if (!scopeCheck.permitted) return false;

    this.queue.push({
      url: norm,
      depth,
      priority,
      referrer,
      enqueuedAt: Date.now()
    });

    // Sort by priority desc, then depth asc
    this.queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    return true;
  }

  enqueueMultiple(urls, depth = 0, priority = 5, referrer = null) {
    let count = 0;
    for (const u of urls) {
      if (this.enqueue(u, depth, priority, referrer)) count++;
    }
    return count;
  }

  async dequeueNext() {
    if (this.queue.length === 0) return null;

    const now = Date.now();
    let bestIndex = -1;

    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];

      // Check if item is in backoff delay
      const retryInfo = this.retryTracker.get(item.url);
      if (retryInfo && now < retryInfo.nextTryAfter) {
        continue;
      }

      try {
        const hostname = new URL(item.url).hostname;
        const lastAccess = this.domainLastAccessed.get(hostname) || 0;
        if (now - lastAccess >= this.perDomainRateLimitMs) {
          bestIndex = i;
          break;
        }
      } catch {
        bestIndex = i;
        break;
      }
    }

    // If none ready without delay, check if there's any eligible item
    if (bestIndex === -1) {
      // Find item with smallest wait
      bestIndex = 0;
    }

    const item = this.queue.splice(bestIndex, 1)[0];
    if (!item) return null;

    try {
      const hostname = new URL(item.url).hostname;
      const lastAccess = this.domainLastAccessed.get(hostname) || 0;
      const jitter = Math.floor(Math.random() * 200); // 0-200ms random jitter
      const waitTime = (this.perDomainRateLimitMs + jitter) - (now - lastAccess);
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, Math.min(waitTime, 3000)));
      }
      this.domainLastAccessed.set(hostname, Date.now());
    } catch {}

    this.visitedUrls.add(item.url);
    return item;
  }

  classifyError(err, status = 0) {
    const msg = (err?.message || '').toLowerCase();
    if (status === 429) return 'RATE_LIMITED';
    if (status === 403) return 'FORBIDDEN_OR_BLOCKED';
    if (status === 401) return 'REQUIRES_AUTHENTICATION';
    if (status === 404) return 'NOT_FOUND';
    if (status >= 500) return 'HTTP_SERVER_ERROR';
    if (status >= 400) return 'HTTP_CLIENT_ERROR';
    if (msg.includes('timeout') || msg.includes('etimedout')) return 'TIMEOUT';
    if (msg.includes('enotfound') || msg.includes('dns')) return 'DNS_FAILURE';
    if (msg.includes('captcha') || msg.includes('cloudflare')) return 'CAPTCHA_CHALLENGE';
    if (msg.includes('robots')) return 'ROBOTS_TXT_DISALLOWED';
    return 'NETWORK_FAILURE';
  }

  recordFailure(url, error, status = 0) {
    const norm = this.normalizeUrl(url) || url;
    const existing = this.retryTracker.get(norm) || { attempts: 0, nextTryAfter: 0, lastError: '' };
    existing.attempts += 1;
    existing.lastError = error?.message || `Status ${status}`;

    const classification = this.classifyError(error, status);

    // Can we retry?
    if (existing.attempts <= this.maxRetries && classification !== 'NOT_FOUND' && classification !== 'FORBIDDEN_OR_BLOCKED') {
      const jitter = Math.floor(Math.random() * 500);
      const delay = Math.pow(2, existing.attempts) * this.backoffBaseMs + jitter;
      existing.nextTryAfter = Date.now() + delay;
      this.retryTracker.set(norm, existing);

      // Re-enqueue with lower priority
      this.queue.push({
        url: norm,
        depth: 1,
        priority: 2,
        referrer: 'retry-scheduler',
        enqueuedAt: Date.now()
      });
      return { willRetry: true, attempts: existing.attempts, delayMs: delay, classification };
    }

    return { willRetry: false, attempts: existing.attempts, classification };
  }

  parseRobotsTxt(robotsText, userAgent = 'arachnespider') {
    if (!robotsText) return { disallow: [], allow: [], crawlDelay: null };
    const lines = robotsText.split(/\r?\n/);
    let applies = false;
    const disallow = [];
    const allow = [];
    let crawlDelay = null;

    for (const rawLine of lines) {
      const line = rawLine.trim().toLowerCase();
      if (!line || line.startsWith('#')) continue;

      if (line.startsWith('user-agent:')) {
        const ua = line.replace('user-agent:', '').trim();
        applies = (ua === '*' || ua.includes(userAgent));
      } else if (applies) {
        if (line.startsWith('disallow:')) {
          const path = line.replace('disallow:', '').trim();
          if (path) disallow.push(path);
        } else if (line.startsWith('allow:')) {
          const path = line.replace('allow:', '').trim();
          if (path) allow.push(path);
        } else if (line.startsWith('crawl-delay:')) {
          const delaySec = parseFloat(line.replace('crawl-delay:', '').trim());
          if (!isNaN(delaySec)) crawlDelay = Math.round(delaySec * 1000);
        }
      }
    }

    return { disallow, allow, crawlDelay };
  }

  isAllowedByRobots(url, robotsTxt = null) {
    if (!this.respectRobotsTxt) return true;
    if (!robotsTxt) return true;
    try {
      const u = new URL(url);
      const parsedRules = this.parseRobotsTxt(robotsTxt);
      if (parsedRules.crawlDelay && parsedRules.crawlDelay > this.perDomainRateLimitMs) {
        this.perDomainRateLimitMs = parsedRules.crawlDelay;
      }
      for (const allowPath of parsedRules.allow) {
        if (u.pathname.startsWith(allowPath)) return true;
      }
      for (const disallowPath of parsedRules.disallow) {
        if (u.pathname.startsWith(disallowPath)) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  markVisited(url) {
    const norm = this.normalizeUrl(url);
    if (norm) this.visitedUrls.add(norm);
  }

  hasVisited(url) {
    const norm = this.normalizeUrl(url);
    return norm ? this.visitedUrls.has(norm) : false;
  }

  size() {
    return this.queue.length;
  }

  visitedCount() {
    return this.visitedUrls.size;
  }

  exportCheckpoint() {
    return {
      queue: this.queue,
      visitedUrls: Array.from(this.visitedUrls),
      retryTracker: Array.from(this.retryTracker.entries()),
      timestamp: new Date().toISOString()
    };
  }

  importCheckpoint(data) {
    if (!data) return;
    if (Array.isArray(data.queue)) this.queue = data.queue;
    if (Array.isArray(data.visitedUrls)) this.visitedUrls = new Set(data.visitedUrls);
    if (Array.isArray(data.retryTracker)) this.retryTracker = new Map(data.retryTracker);
  }
}
