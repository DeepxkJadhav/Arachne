#!/usr/bin/env node
/**
 * 🕷️ Arachne Interactive Terminal CLI
 * 
 * Examples:
 *   node examples/arachne-cli.mjs info
 *   node examples/arachne-cli.mjs scrape https://example.com
 *   node examples/arachne-cli.mjs map https://example.com
 */

const BASE_URL = process.env.ARACHNE_URL || 'http://localhost:3003';
const [,, command, targetUrl] = process.argv;

async function main() {
  if (!command || command === '--help' || command === 'help') {
    console.log(`
🕷️ ARACHNE CLI - Autonomous Web Intelligence & Swarm Engine

Usage:
  node examples/arachne-cli.mjs <command> [args]

Commands:
  info                  Check server status and active investigation
  swarm                 Inspect multi-agent swarm status (Scout, Analyst, Verifier, Synthesizer)
  rag <query>           Run Hybrid RAG Retrieval (BM25 + 3-Gram Cosine + RRF)
  contradictions        Audit cross-source claim contradictions across corpus
  architecture          Self-introspect ARACHNE microkernel & swarm topology
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

  if (command === 'swarm') {
    try {
      const res = await fetch(`${BASE_URL}/api/swarm`);
      const json = await res.json();
      console.log('\n🕷️ ARACHNE Multi-Agent Swarm Orchestrator (Hierarchical Evaluator-Optimizer):');
      console.log(`Topology: ${json.data.topology}\n`);
      json.data.agents.forEach(a => {
        console.log(`• [${a.role.toUpperCase()}] (${a.id})`);
        console.log(`  Status: ${a.status.toUpperCase()} | Completed: ${a.tasksCompleted}`);
        console.log(`  Active: ${a.activeTarget || 'None'}`);
        console.log(`  Role:   ${a.description}\n`);
      });
    } catch (err) {
      console.error('❌ Error fetching swarm:', err.message);
    }
    return;
  }

  if (command === 'rag') {
    const query = process.argv.slice(3).join(' ') || 'autonomous agents';
    console.log(`\n🔬 Hybrid RAG Retrieval (BM25 + 3-Gram Cosine + RRF) for: "${query}"...`);
    try {
      const res = await fetch(`${BASE_URL}/api/rag/search?q=${encodeURIComponent(query)}&limit=5`);
      const json = await res.json();
      console.log(`✅ Retrieved ${json.data.length} ranked chunks:\n`);
      json.data.forEach((c, i) => {
        console.log(`[#${i + 1}] Score: ${c.score} (BM25: ${c.bm25Score}, Vector: ${c.vectorScore})`);
        console.log(`    Source: ${c.docTitle} (${c.url})`);
        console.log(`    Chunk:  "${c.text.slice(0, 160)}..."\n`);
      });
    } catch (err) {
      console.error('❌ Error running RAG search:', err.message);
    }
    return;
  }

  if (command === 'contradictions') {
    console.log('\n⚖️ Cross-Source Contradiction Analysis...');
    try {
      const res = await fetch(`${BASE_URL}/api/rag/contradictions`);
      const json = await res.json();
      console.log(`✅ Detected ${json.count} potential contradictions across corpus:\n`);
      if (json.count === 0) {
        console.log('✓ Zero contradictions detected. Corpus claims are consistent.');
      } else {
        json.data.forEach((item, i) => {
          console.log(`[#${i + 1}] Topic: ${item.topic} (Severity: ${item.severity})`);
          console.log(`    Verdict:  ${item.verdict}`);
          console.log(`    Source A: ${item.sourceA.title} (${item.sourceA.url})`);
          console.log(`    Source B: ${item.sourceB.title} (${item.sourceB.url})\n`);
        });
      }
    } catch (err) {
      console.error('❌ Error running contradiction analysis:', err.message);
    }
    return;
  }

  if (command === 'architecture') {
    try {
      const res = await fetch(`${BASE_URL}/api/system/architecture`);
      const json = await res.json();
      console.log('\n🕸️ ARACHNE System Architecture Self-Introspection:');
      console.log(`System:   ${json.data.system} v${json.data.version}`);
      console.log(`Topology: ${json.data.topology}\n`);
      console.log(`Components (${json.data.components.length}):`);
      json.data.components.forEach(c => {
        console.log(`  - [${c.type}] ${c.name} (${c.id})`);
      });
      console.log(`\nControl & Data Flow Links (${json.data.links.length}):`);
      json.data.links.slice(0, 8).forEach(l => {
        console.log(`  ${l.source} --(${l.relation})--> ${l.target}`);
      });
    } catch (err) {
      console.error('❌ Error inspecting architecture:', err.message);
    }
    return;
  }

  console.error(`Unknown command: ${command}. Run with "help" for options.`);
}

main();
