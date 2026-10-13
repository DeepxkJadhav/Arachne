import http from 'node:http';
import https from 'node:https';

export class CrawlerFetcher {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.userAgent = options.userAgent || 'ArachneSpider/2.0 (+https://github.com/DeepxkJadhav/Arachne; web-intelligence-bot)';
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
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

            const contentType = res.headers['content-type'] || '';
            const isText = contentType.includes('text') || contentType.includes('json') || contentType.includes('xml');

            let rawData = '';
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
              rawData += chunk;
              // Cap at 2MB to protect memory
              if (rawData.length > 2 * 1024 * 1024) {
                res.destroy();
              }
            });

            res.on('end', () => {
              const latencyMs = Date.now() - startTime;
              resolve({
                success: res.statusCode >= 200 && res.statusCode < 400,
                status: res.statusCode,
                url: targetUrl,
                contentType,
                html: rawData,
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
        html: ''
      };
    }
  }

  htmlToCleanMarkdown(html, baseUrl = '') {
    if (!html) return '';

    // Strip scripts, styles, svg, comments
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Extract Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Convert headings
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

    // Convert list items
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

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
      .replace(/&#39;/g, "'");

    // Clean whitespace
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();

    return title ? `# ${title}\n\n${text}` : text;
  }
}
