/**
 * Arachne Standalone Interactive Demo Server
 * 
 * Runs a zero-dependency local instance of the Arachne API on port 3002
 * allowing you to immediately test:
 * - GET  /           (Metadata & Status)
 * - POST /v1/scrape  (Real-time Web Scrape & Markdown Extraction)
 * - POST /v1/map     (Real-time URL / Link Discovery)
 * 
 * Usage:
 *   node examples/arachne-local-demo-server.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const PORT = 3002;
const HOST = '0.0.0.0';

function htmlToMarkdown(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const regex = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl).href;
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        links.add(resolved);
      }
    } catch {}
  }
  return Array.from(links);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Root / UI / Metadata
  if (req.method === 'GET' && (req.url === '/' || req.url === '/playground' || req.url === '/studio')) {
    const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
    const isExplicitUI = req.url === '/playground' || req.url === '/studio';

    if (acceptsHtml || isExplicitUI) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(indexPath));
        return;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Arachne API',
      version: '1.0.0',
      repository: 'https://github.com/DeepxkJadhav/Arachne',
      documentation_url: 'https://github.com/DeepxkJadhav/Arachne#readme',
      status: 'operational',
      mode: 'standalone-demo',
      ui_url: 'http://localhost:3002/'
    }, null, 2));
    return;
  }

  // Helper for JSON body parsing
  const getBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });

  // 2. Scrape Endpoint
  if (req.method === 'POST' && (req.url === '/v1/scrape' || req.url === '/scrape')) {
    const { url, formats = ['markdown'] } = await getBody();
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'url parameter is required' }));
      return;
    }

    try {
      console.log(`[Arachne] Scraping: ${url}`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Arachne-Scraper/1.0 (+https://github.com/DeepxkJadhav/Arachne)' }
      });
      const html = await response.text();
      const markdown = htmlToMarkdown(html);

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: {
          markdown,
          metadata: {
            title,
            sourceURL: url,
            statusCode: response.status,
            pageStatusCode: response.status
          }
        }
      }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. Map Endpoint
  if (req.method === 'POST' && (req.url === '/v1/map' || req.url === '/map')) {
    const { url } = await getBody();
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'url parameter is required' }));
      return;
    }

    try {
      console.log(`[Arachne] Discovering links for: ${url}`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Arachne-Scraper/1.0 (+https://github.com/DeepxkJadhav/Arachne)' }
      });
      const html = await response.text();
      const links = extractLinks(html, url);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        links
      }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
});

server.listen(PORT, HOST, () => {
  console.log(`\n🕷️ Arachne Demo Server running at http://localhost:${PORT}`);
  console.log(`Ready to receive requests on:`);
  console.log(`  - GET  http://localhost:${PORT}/`);
  console.log(`  - POST http://localhost:${PORT}/v1/scrape`);
  console.log(`  - POST http://localhost:${PORT}/v1/map\n`);
});
