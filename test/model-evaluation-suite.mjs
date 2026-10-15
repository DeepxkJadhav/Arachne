import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load from .env if present
try {
  const envFile = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {}

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';

console.log('================================================================');
console.log('🕷️  ARACHNE AI MODEL AUDIT & 10-DIMENSION EVALUATION SUITE');
console.log('================================================================\n');

// Candidates to benchmark
const CANDIDATES = [
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'NVIDIA Nemotron 3.5 Lightning (Free)',
    provider: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    key: OPENROUTER_KEY,
    contextLimit: 1000000,
    costPerMillion: 0
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google Gemma 4 31B Instruct (Free)',
    provider: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    key: OPENROUTER_KEY,
    contextLimit: 262144,
    costPerMillion: 0
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA Nemotron 3 Nano Omni Reasoning (Free)',
    provider: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    key: OPENROUTER_KEY,
    contextLimit: 256000,
    costPerMillion: 0
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Alibaba Qwen 3.8 27B LPU',
    provider: 'Groq Cloud',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    key: GROQ_KEY,
    contextLimit: 32768,
    costPerMillion: 0.15
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code (Legacy / Deprecated Candidate)',
    provider: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    key: OPENROUTER_KEY,
    contextLimit: 256000,
    costPerMillion: 0
  }
];

async function callChat(candidate, messages, options = {}) {
  const start = Date.now();
  const payload = JSON.stringify({
    model: candidate.id,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens ?? 1000
  });

  return new Promise((resolve) => {
    const url = new URL(candidate.endpoint);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${candidate.key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'HTTP-Referer': 'https://arachne.local',
        'X-Title': 'ARACHNE Research Evaluator'
      },
      timeout: options.timeout || 25000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.message?.content || '';
            resolve({
              ok: true,
              statusCode: res.statusCode,
              latencyMs,
              content,
              usage: json.usage
            });
          } catch (e) {
            resolve({ ok: false, statusCode: res.statusCode, latencyMs, error: 'JSON parse error: ' + e.message });
          }
        } else {
          resolve({ ok: false, statusCode: res.statusCode, latencyMs, error: data.slice(0, 150) });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, latencyMs: Date.now() - start, error: 'Request timeout' });
    });

    req.write(payload);
    req.end();
  });
}

async function evaluateCandidate(candidate) {
  console.log(`\nEvaluating: [${candidate.provider}] ${candidate.name} (${candidate.id})`);
  const scores = {
    planning: 0,
    sourceEval: 0,
    synthesis: 0,
    toolCalling: 0,
    structuredJson: 0,
    coding: 0,
    naturalLanguage: 0,
    latencyMs: 0,
    costScore: 0,
    reliability: 0,
    total: 0
  };

  const evalLog = [];

  // 1. Planning Test (Structured Research Plan)
  process.stdout.write('  1. Research Planning... ');
  const planPrompt = [
    { role: 'system', content: 'You are ARACHNE. Output ONLY a valid JSON object with {"phases":[{"name":"...","queries":["..."]}]}. No markdown.' },
    { role: 'user', content: 'Create a 3-phase autonomous research plan for: "Deep learning based SLAM algorithms for robotics"' }
  ];
  const planRes = await callChat(candidate, planPrompt, { max_tokens: 600 });
  if (planRes.ok) {
    try {
      const match = planRes.content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.phases) && parsed.phases.length >= 2) {
          scores.planning = 10;
          scores.structuredJson = 10;
          console.log(`PASS (${planRes.latencyMs}ms, ${parsed.phases.length} phases)`);
        } else {
          scores.planning = 6;
          console.log(`PARTIAL (${planRes.latencyMs}ms, invalid phases array)`);
        }
      } else {
        scores.planning = 3;
        console.log(`FAIL (no JSON extracted)`);
      }
    } catch {
      scores.planning = 3;
      console.log(`FAIL (JSON parse error)`);
    }
  } else {
    console.log(`FAIL (${planRes.error})`);
  }
  evalLog.push({ test: 'planning', result: planRes });

  // 2. Source Evaluation & Ranking Test
  process.stdout.write('  2. Source Evaluation & Ranking... ');
  const sourcePrompt = [
    { role: 'system', content: 'You evaluate source reliability. Rank the sources 1 to 3 in JSON: {"rankings": [{"source": "...", "score": 1-10, "verdict": "..."}]}' },
    { role: 'user', content: 'Sources:\nA) arxiv.org/abs/2401.12345 (peer reviewed paper)\nB) random-medium-blog.info (anonymous blog)\nC) github.com/facebookresearch/slam (official repo)' }
  ];
  const sourceRes = await callChat(candidate, sourcePrompt, { max_tokens: 500 });
  if (sourceRes.ok) {
    if (sourceRes.content.includes('arxiv') && sourceRes.content.includes('facebookresearch')) {
      scores.sourceEval = 10;
      console.log(`PASS (${sourceRes.latencyMs}ms)`);
    } else {
      scores.sourceEval = 6;
      console.log(`PARTIAL (${sourceRes.latencyMs}ms)`);
    }
  } else {
    console.log(`FAIL (${sourceRes.error})`);
  }
  evalLog.push({ test: 'sourceEval', result: sourceRes });

  // 3. Synthesis & Long-Context Test
  process.stdout.write('  3. Intelligence Synthesis... ');
  const synthPrompt = [
    { role: 'system', content: 'Synthesize the following 3 findings into an executive intelligence finding: 1) Repo A provides 60 FPS SLAM on RTX 4090. 2) Repo B requires RGB-D camera and has 40ms latency. 3) Benchmark shows Repo A has 30% lower drift.' },
    { role: 'user', content: 'Summarize key operational trade-offs in 2 bullet points.' }
  ];
  const synthRes = await callChat(candidate, synthPrompt, { max_tokens: 300 });
  if (synthRes.ok && (synthRes.content.includes('RTX') || synthRes.content.includes('drift') || synthRes.content.includes('latency'))) {
    scores.synthesis = 10;
    console.log(`PASS (${synthRes.latencyMs}ms)`);
  } else {
    scores.synthesis = synthRes.ok ? 5 : 0;
    console.log(synthRes.ok ? `PARTIAL (${synthRes.latencyMs}ms)` : `FAIL (${synthRes.error})`);
  }
  evalLog.push({ test: 'synthesis', result: synthRes });

  // 4. Tool-Calling Format Gate
  process.stdout.write('  4. Tool Policy Formatting... ');
  const toolPrompt = [
    { role: 'system', content: 'Return tool call in format: {"tool": "crawl_url", "parameters": {"url": "https://example.com/spec"}}' },
    { role: 'user', content: 'Fetch the technical spec from https://example.com/spec' }
  ];
  const toolRes = await callChat(candidate, toolPrompt, { max_tokens: 200 });
  if (toolRes.ok && toolRes.content.includes('crawl_url') && toolRes.content.includes('https://example.com/spec')) {
    scores.toolCalling = 10;
    console.log(`PASS (${toolRes.latencyMs}ms)`);
  } else {
    scores.toolCalling = toolRes.ok ? 5 : 0;
    console.log(toolRes.ok ? `PARTIAL (${toolRes.latencyMs}ms)` : `FAIL (${toolRes.error})`);
  }
  evalLog.push({ test: 'toolCalling', result: toolRes });

  // 5. Code & Technical Extraction
  process.stdout.write('  5. Code & Schema Analysis... ');
  const codePrompt = [
    { role: 'system', content: 'Analyze the snippet and output JSON {"entrypoint": "...", "port": ...}' },
    { role: 'user', content: 'const app = express(); app.listen(3003, () => console.log("Running")); export default app;' }
  ];
  const codeRes = await callChat(candidate, codePrompt, { max_tokens: 200 });
  if (codeRes.ok && codeRes.content.includes('3003')) {
    scores.coding = 10;
    console.log(`PASS (${codeRes.latencyMs}ms)`);
  } else {
    scores.coding = codeRes.ok ? 5 : 0;
    console.log(codeRes.ok ? `PARTIAL (${codeRes.latencyMs}ms)` : `FAIL (${codeRes.error})`);
  }
  evalLog.push({ test: 'coding', result: codeRes });

  // 6. Natural Language & Conversational Accuracy
  process.stdout.write('  6. Conversational Instruction Following... ');
  const nlPrompt = [
    { role: 'system', content: 'You are ARACHNE Telegram agent. The operator says: "pause research now". Respond with a concise single-line confirmation.' },
    { role: 'user', content: 'pause research now' }
  ];
  const nlRes = await callChat(candidate, nlPrompt, { max_tokens: 100 });
  if (nlRes.ok && (nlRes.content.toLowerCase().includes('pause') || nlRes.content.toLowerCase().includes('paused') || nlRes.content.toLowerCase().includes('stopping'))) {
    scores.naturalLanguage = 10;
    console.log(`PASS (${nlRes.latencyMs}ms)`);
  } else {
    scores.naturalLanguage = nlRes.ok ? 5 : 0;
    console.log(nlRes.ok ? `PARTIAL (${nlRes.latencyMs}ms)` : `FAIL (${nlRes.error})`);
  }
  evalLog.push({ test: 'naturalLanguage', result: nlRes });

  // 7. Latency Calculation (Average of responsive calls)
  const validCalls = [planRes, sourceRes, synthRes, toolRes, codeRes, nlRes].filter(r => r.ok);
  const avgLatency = validCalls.length > 0 ? Math.round(validCalls.reduce((acc, c) => acc + c.latencyMs, 0) / validCalls.length) : 9999;
  scores.latencyMs = avgLatency;

  // Latency Score: < 500ms = 10, < 1500ms = 8, < 3000ms = 6, < 5000ms = 4, else 2
  const latencyScore = avgLatency < 500 ? 10 : avgLatency < 1500 ? 9 : avgLatency < 3000 ? 7 : avgLatency < 5000 ? 5 : 2;

  // 8. Cost Score (Free = 10, Low = 8)
  scores.costScore = candidate.costPerMillion === 0 ? 10 : 8;

  // 9. Reliability (Success rate across the 6 prompt tests)
  scores.reliability = Math.round((validCalls.length / 6) * 10);

  // 10. Total Weighted Score (Out of 100)
  scores.total = (
    scores.planning * 1.5 +
    scores.sourceEval * 1.0 +
    scores.synthesis * 1.5 +
    scores.toolCalling * 1.0 +
    scores.structuredJson * 1.0 +
    scores.coding * 1.0 +
    scores.naturalLanguage * 1.0 +
    latencyScore * 1.0 +
    scores.costScore * 0.5 +
    scores.reliability * 0.5
  );

  return {
    candidate,
    scores,
    avgLatency,
    reliabilityPercent: Math.round((validCalls.length / 6) * 100),
    evalLog
  };
}

async function runEvaluationSuite() {
  const results = [];
  for (const c of CANDIDATES) {
    try {
      const res = await evaluateCandidate(c);
      results.push(res);
    } catch (e) {
      console.error(`Error evaluating ${c.id}: ${e.message}`);
    }
  }

  // Sort by total score descending
  results.sort((a, b) => b.scores.total - a.scores.total);

  console.log('\n================================================================');
  console.log('📊 ARACHNE MODEL BENCHMARK RESULTS & RANKINGS');
  console.log('================================================================\n');

  console.log(
    'Rank | Model ID                                     | Provider   | Latency | Success | Total Score\n' +
    '-----+----------------------------------------------+------------+---------+---------+------------'
  );

  results.forEach((r, idx) => {
    const idPad = r.candidate.id.padEnd(44, ' ');
    const provPad = r.candidate.provider.padEnd(10, ' ');
    const latPad = `${r.avgLatency}ms`.padEnd(7, ' ');
    const relPad = `${r.reliabilityPercent}%`.padEnd(7, ' ');
    const scorePad = r.scores.total.toFixed(1).padEnd(6, ' ');
    console.log(` #${idx + 1}  | ${idPad} | ${provPad} | ${latPad} | ${relPad} | ${scorePad}/100`);
  });

  const winner = results[0];
  console.log(`\n🏆 WINNER / PRIMARY MODEL SELECTION:`);
  console.log(`   Model:    ${winner.candidate.name}`);
  console.log(`   ID:       ${winner.candidate.id}`);
  console.log(`   Provider: ${winner.candidate.provider}`);
  console.log(`   Context:  ${winner.candidate.contextLimit.toLocaleString()} tokens`);
  console.log(`   Latency:  ${winner.avgLatency}ms average roundtrip`);
  console.log(`   Score:    ${winner.scores.total.toFixed(1)} / 100`);

  const fallback = results.find(r => r.candidate.id !== winner.candidate.id && r.reliabilityPercent >= 80) || results[1];
  console.log(`\n⚡ RECOMMENDED ULTRA-FAST LPU FALLBACK:`);
  console.log(`   Model:    ${fallback.candidate.name}`);
  console.log(`   ID:       ${fallback.candidate.id}`);
  console.log(`   Provider: ${fallback.candidate.provider}`);
  console.log(`   Latency:  ${fallback.avgLatency}ms`);

  // Write evaluation report JSON to disk for transparency and persistence
  const reportPath = path.resolve(__dirname, '../reports/model-evaluation-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    candidates: results.map(r => ({
      id: r.candidate.id,
      name: r.candidate.name,
      provider: r.candidate.provider,
      contextLimit: r.candidate.contextLimit,
      avgLatencyMs: r.avgLatency,
      reliabilityPercent: r.reliabilityPercent,
      scores: r.scores
    })),
    winner: winner.candidate.id,
    fallback: fallback.candidate.id
  }, null, 2));

  console.log(`\n✅ Evaluation report written to: ${reportPath}`);
  return { winner, fallback, results };
}

runEvaluationSuite().then(({ winner, fallback }) => {
  console.log(`\nEvaluation complete. Proceeding with architecture update.`);
}).catch(err => {
  console.error('Fatal evaluation suite error:', err);
  process.exit(1);
});
