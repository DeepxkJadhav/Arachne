export class UrlFrontier {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth || 3;
    this.maxUrls = options.maxUrls || 50;
    this.respectRobotsTxt = options.respectRobotsTxt !== false;
    this.perDomainRateLimitMs = options.perDomainRateLimitMs || 800;

    this.queue = [];
    this.visitedUrls = new Set();
    this.domainLastAccessed = new Map();
    this.domainRobotsCache = new Map();
  }

  normalizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = ''; // Strip fragments
      // Normalize casing of hostname
      u.hostname = u.hostname.toLowerCase();
      // Remove common tracking parameters
      const cleanParams = new URLSearchParams();
      for (const [key, value] of u.searchParams.entries()) {
        if (!key.startsWith('utm_') && !key.startsWith('fbclid') && key !== 'ref') {
          cleanParams.append(key, value);
        }
      }
      u.search = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
      return u.toString();
    } catch {
      return null;
    }
  }

  enqueue(url, depth = 0, priority = 5, referrer = null) {
    const norm = this.normalizeUrl(url);
    if (!norm) return false;
    if (this.visitedUrls.has(norm)) return false;
    if (this.queue.some(item => item.url === norm)) return false;
    if (depth > this.maxDepth) return false;
    if (this.visitedUrls.size + this.queue.length >= this.maxUrls * 2) return false;

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

    // If all ready domains are throttled, grab the earliest one and enforce wait
    const item = bestIndex >= 0 ? this.queue.splice(bestIndex, 1)[0] : this.queue.shift();
    if (!item) return null;

    try {
      const hostname = new URL(item.url).hostname;
      const lastAccess = this.domainLastAccessed.get(hostname) || 0;
      const waitTime = this.perDomainRateLimitMs - (now - lastAccess);
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }
      this.domainLastAccessed.set(hostname, Date.now());
    } catch {}

    this.visitedUrls.add(item.url);
    return item;
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
}
