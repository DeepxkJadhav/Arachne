import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export class CrawlerFetcher {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.userAgent = options.userAgent || 'ArachneSpider/2.0 (+https://github.com/DeepxkJadhav/Arachne; web-intelligence-bot)';
    this.maxRedirects = options.maxRedirects || 5;
    this.maxSizeBytes = options.maxSizeBytes || 10 * 1024 * 1024; // 10 MB cap
    this.allowLocalhost = options.allowLocalhost || false; // Only for local test server
    this.robotsCache = new Map(); // domain -> { robotsTxt: string, fetchedAt: number }
  }

  static isIpBlocked(ipStr) {
    if (!net.isIP(ipStr)) return false;

    // IPv4 Checks
    if (net.isIPv4(ipStr)) {
      const parts = ipStr.split('.').map(Number);
      const [a, b, c, d] = parts;

      // 0.0.0.0/8
      if (a === 0) return true;
      // 127.0.0.0/8 (Loopback)
      if (a === 127) return true;
      // 10.0.0.0/8 (Private)
      if (a === 10) return true;
      // 172.16.0.0/12 (Private)
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16 (Private)
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 (Link-Local & Cloud Metadata, e.g. 169.254.169.254)
      if (a === 169 && b === 254) return true;
      // 100.64.0.0/10 (Shared address space)
      if (a === 100 && b >= 64 && b <= 127) return true;
      // Broadcast 255.255.255.255
      if (a === 255 && b === 255 && c === 255 && d === 255) return true;

      return false;
    }

    // IPv6 Checks
    if (net.isIPv6(ipStr)) {
      const lower = ipStr.toLowerCase();
      // Loopback
      if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
      // Unspecified
      if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
      // IPv4 mapped IPv6 (::ffff:127.0.0.1 etc)
      if (lower.startsWith('::ffff:')) {
        const mappedIpv4 = lower.substring(7);
        if (net.isIPv4(mappedIpv4)) {
          return CrawlerFetcher.isIpBlocked(mappedIpv4);
        }
      }
      // Unique Local Addresses (fc00::/7)
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      // Link-Local Addresses (fe80::/10)
      if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

      return false;
    }

    return false;
  }

  async validateUrlSafety(targetUrl) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { safe: false, reason: 'Malformed URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: `Disallowed protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block standard local hostnames unless allowLocalhost is explicitly enabled
    const localHostnames = ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'local', 'internal', 'metadata.google.internal'];
    if (localHostnames.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      if (this.allowLocalhost && (hostname === 'localhost' || hostname === '127.0.0.1')) {
        return { safe: true, resolvedIp: '127.0.0.1' };
      }
      return { safe: false, reason: `Blocked local or internal hostname: ${hostname}` };
    }

    // If hostname is already a direct IP literal
    if (net.isIP(hostname)) {
      if (CrawlerFetcher.isIpBlocked(hostname)) {
        if (this.allowLocalhost && (hostname === '127.0.0.1')) {
          return { safe: true, resolvedIp: hostname };
        }
        return { safe: false, reason: `Blocked IP address range (SSRF guard): ${hostname}` };
      }
      return { safe: true, resolvedIp: hostname };
    }

    // Perform DNS lookup to prevent DNS rebinding attacks
    try {
      const lookupRes = await dns.lookup(hostname, { all: true });
      if (!lookupRes || lookupRes.length === 0) {
        return { safe: false, reason: `DNS resolution failed for hostname: ${hostname}` };
      }

      for (const entry of lookupRes) {
        if (CrawlerFetcher.isIpBlocked(entry.address)) {
          if (this.allowLocalhost && (entry.address === '127.0.0.1')) {
            continue;
          }
          return { safe: false, reason: `Hostname ${hostname} resolves to blocked internal IP: ${entry.address}` };
        }
      }

      return { safe: true, resolvedIp: lookupRes[0].address };
    } catch (err) {
      return { safe: false, reason: `DNS lookup error: ${err.message}` };
    }
  }

  async fetchUrl(targetUrl, redirectCount = 0) {
    const startTime = Date.now();

    if (redirectCount > this.maxRedirects) {
      return {
        success: false,
        status: 0,
        url: targetUrl,
        error: `Exceeded maximum redirect limit of ${this.maxRedirects}`,
        latencyMs: Date.now() - startTime,
        html: '',
        contentHash: null,
        isCaptchaChallenge: false
      };
    }

    // SSRF & Security validation on every hop
    const safety = await this.validateUrlSafety(targetUrl);
    if (!safety.safe) {
      return {
        success: false,
        status: 403,
        url: targetUrl,
        error: `SSRF Blocked: ${safety.reason}`,
        latencyMs: Date.now() - startTime,
        html: '',
        contentHash: null,
        isCaptchaChallenge: false
      };
    }

    try {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      return await new Promise((resolve) => {
        const req = client.get(
          targetUrl,
          {
            headers: {
              'User-Agent': this.userAgent,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.5',
              'Accept-Language': 'en-US,en;q=0.9',
              'Connection': 'close'
            },
            timeout: this.timeoutMs
          },
          async (res) => {
            // Handle redirects with hop-by-hop destination re-validation
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              req.destroy();
              try {
                const redirectUrl = new URL(res.headers.location, targetUrl).toString();
                const redirectResult = await this.fetchUrl(redirectUrl, redirectCount + 1);
                return resolve(redirectResult);
              } catch (err) {
                return resolve({
                  success: false,
                  status: res.statusCode,
                  url: targetUrl,
                  error: `Invalid redirect location: ${res.headers.location}`,
                  latencyMs: Date.now() - startTime,
                  html: '',
                  contentHash: null,
                  isCaptchaChallenge: false
                });
              }
            }

            const contentType = (res.headers['content-type'] || '').toLowerCase();
            let rawData = '';
            let bytesReceived = 0;
            let truncated = false;
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
              bytesReceived += Buffer.byteLength(chunk);
              if (bytesReceived > this.maxSizeBytes) {
                truncated = true;
                res.destroy();
              } else {
                rawData += chunk;
              }
            });

            res.on('end', () => {
              const latencyMs = Date.now() - startTime;
              const contentHash = crypto.createHash('sha256').update(rawData).digest('hex');

              // Detect Cloudflare / CAPTCHA / Bot challenges
              const isCaptcha = (res.statusCode === 403 || res.statusCode === 503) && (
                rawData.includes('cf-browser-verification') ||
                rawData.includes('challenge-platform') ||
                rawData.includes('hCaptcha') ||
                rawData.includes('recaptcha') ||
                rawData.includes('Attention Required! | Cloudflare')
              );

              // Determine content format
              let format = 'html';
              if (contentType.includes('json')) format = 'json';
              else if (contentType.includes('xml')) format = 'xml';
              else if (contentType.includes('pdf')) format = 'pdf';
              else if (contentType.includes('plain')) format = 'text';

              resolve({
                success: res.statusCode >= 200 && res.statusCode < 400 && !isCaptcha,
                status: res.statusCode,
                url: targetUrl,
                contentType,
                format,
                contentHash,
                isCaptchaChallenge: isCaptcha,
                html: rawData,
                contentLength: rawData.length,
                truncated,
                latencyMs,
                headers: res.headers
              });
            });

            res.on('error', (err) => {
              resolve({
                success: false,
                status: res.statusCode || 0,
                url: targetUrl,
                error: err.message,
                latencyMs: Date.now() - startTime,
                html: '',
                contentHash: null,
                isCaptchaChallenge: false
              });
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            status: 0,
            url: targetUrl,
            error: `Timeout after ${this.timeoutMs}ms`,
            latencyMs: Date.now() - startTime,
            html: '',
            contentHash: null,
            isCaptchaChallenge: false
          });
        });

        req.on('error', (err) => {
          resolve({
            success: false,
            status: 0,
            url: targetUrl,
            error: err.message,
            latencyMs: Date.now() - startTime,
            html: '',
            contentHash: null,
            isCaptchaChallenge: false
          });
        });
      });
    } catch (err) {
      return {
        success: false,
        status: 0,
        url: targetUrl,
        error: err.message,
        latencyMs: Date.now() - startTime,
        html: '',
        contentHash: null,
        isCaptchaChallenge: false
      };
    }
  }

  async fetchRobotsTxt(domain) {
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0];
    const cached = this.robotsCache.get(cleanDomain);
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (cached && (Date.now() - cached.fetchedAt) < ONE_DAY) {
      return cached.robotsTxt;
    }

    try {
      const robotsUrl = `https://${cleanDomain}/robots.txt`;
      const res = await this.fetchUrl(robotsUrl);
      const text = res.success ? res.html : '';
      this.robotsCache.set(cleanDomain, { robotsTxt: text, fetchedAt: Date.now() });
      return text;
    } catch {
      return '';
    }
  }

  htmlToCleanMarkdown(html, baseUrl = '') {
    if (!html) return '';

    // Strip scripts, styles, svg, canvas, comments
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Extract Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Convert code blocks
    text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

    // Convert headings
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

    // Convert links
    text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, anchor) => {
      const cleanAnchor = anchor.replace(/<[^>]+>/g, '').trim();
      if (!cleanAnchor) return '';
      try {
        const absolute = baseUrl ? new URL(href, baseUrl).toString() : href;
        return `[${cleanAnchor}](${absolute})`;
      } catch {
        return `[${cleanAnchor}](${href})`;
      }
    });

    // Convert list items
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean up excessive whitespace
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    return title ? `# ${title}\n\n${text}` : text;
  }
}
