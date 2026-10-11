#!/usr/bin/env node
/**
 * 🕷️ Arachne Interactive Terminal CLI
 * 
 * Examples:
 *   node examples/arachne-cli.mjs info
 *   node examples/arachne-cli.mjs scrape https://example.com
 *   node examples/arachne-cli.mjs map https://example.com
 */

const BASE_URL = process.env.ARACHNE_URL || 'http://localhost:3002';
const [,, command, targetUrl] = process.argv;

async function main() {
  if (!command || command === '--help' || command === 'help') {
    console.log(`
🕷️ Arachne CLI - Web Scraping & Crawling Engine

Usage:
  node examples/arachne-cli.mjs <command> [url]

Commands:
  info                  Check server status and metadata
  scrape <url>          Scrape a web page and output clean Markdown
  map <url>             Discover all hyperlinks on a page
`);
    return;
  }

  if (command === 'info') {
    try {
      const res = await fetch(`${BASE_URL}/`);
      const data = await res.json();
      console.log('\n🟢 Arachne Server Status:');
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('❌ Server unreachable:', err.message);
    }
    return;
  }

  if (command === 'scrape') {
    if (!targetUrl) {
      console.error('❌ Please provide a URL: node examples/arachne-cli.mjs scrape <url>');
      return;
    }
    console.log(`\n🕸️ Scraping: ${targetUrl}...`);
    try {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}/v1/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, formats: ['markdown'] }),
      });
      const data = await res.json();
      const elapsed = Date.now() - start;

      if (!data.success) {
        console.error('❌ Scrape error:', data.error);
        return;
      }

      console.log(`✅ Scraped in ${elapsed}ms!`);
      console.log(`Title: ${data.data?.metadata?.title}`);
      console.log(`Status: ${data.data?.metadata?.statusCode}`);
      console.log(`Markdown size: ${data.data?.markdown?.length} characters`);
      console.log('\n--- MARKDOWN OUTPUT (PREVIEW) ---');
      console.log(data.data?.markdown?.slice(0, 1000) || '(Empty)');
      console.log('--- END PREVIEW ---\n');
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
    return;
  }

  if (command === 'map') {
    if (!targetUrl) {
      console.error('❌ Please provide a URL: node examples/arachne-cli.mjs map <url>');
      return;
    }
    console.log(`\n🗺️ Mapping links for: ${targetUrl}...`);
    try {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}/v1/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await res.json();
      const elapsed = Date.now() - start;

      const links = data.links || [];
      console.log(`✅ Discovered ${links.length} links in ${elapsed}ms!\n`);
      links.slice(0, 15).forEach((l, i) => console.log(`  [${i + 1}] ${l}`));
      if (links.length > 15) {
        console.log(`  ... and ${links.length - 15} more.`);
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
    return;
  }

  console.error(`Unknown command: ${command}. Run with "help" for options.`);
}

main();
