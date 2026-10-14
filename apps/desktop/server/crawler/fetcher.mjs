import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

export class CrawlerFetcher {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.userAgent = options.userAgent || 'ArachneSpider/2.0 (+https://github.com/DeepxkJadhav/Arachne; web-intelligence-bot)';
    this.robotsCache = new Map(); // domain -> { robotsTxt: string, fetchedAt: number }
  }

  async fetchUrl(targetUrl) {
    const startTime = Date.now();
    try {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      return await new Promise((resolve, reject) => {
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
          (res) => {
            // Handle redirects
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
              const redirectUrl = new URL(res.headers.location, targetUrl).toString();
              req.destroy();
              return resolve(this.fetchUrl(redirectUrl));
            }

            const contentType = (res.headers['content-type'] || '').toLowerCase();
            let rawData = '';
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
              rawData += chunk;
              // Cap at 4MB to protect memory
              if (rawData.length > 4 * 1024 * 1024) {
                res.destroy();
              }
            });

            res.on('end', () => {
              const latencyMs = Date.now() - startTime;
              const contentHash = crypto.createHash('sha256').update(rawData).digest('hex');

              // Detect Cloudflare / CAPTCHA / Bot challenges
              const isCaptcha = res.statusCode === 403 && (
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
                latencyMs,
                headers: res.headers
              });
            });
          }
        );

        req.on('timeout', () => {
          req.destroy(new Error(`Timeout after ${this.timeoutMs}ms`));
        });

        req.on('error', (err) => {
          reject(err);
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

    // Convert list items
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

    // Convert tables
    text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (match, inner) => {
      const cols = [];
      const colRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let colMatch;
      while ((colMatch = colRegex.exec(inner)) !== null) {
        cols.push(colMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      return cols.length ? `\n| ${cols.join(' | ')} |` : '';
    });

    // Convert paragraphs & breaks
    text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
    text = text.replace(/<br\s*[\/]?>/gi, '\n');

    // Convert links
    text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, anchor) => {
      const cleanAnchor = anchor.replace(/<[^>]+>/g, '').trim();
      return cleanAnchor ? `[${cleanAnchor}](${href})` : '';
    });

    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–');

    // Clean excess whitespace
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();

    return title ? `# ${title}\n\n${text}` : text;
  }
}
