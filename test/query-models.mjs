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

const openrouterKey = process.env.OPENROUTER_API_KEY || '';
const groqKey = process.env.GROQ_API_KEY || '';

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Querying OpenRouter catalog...');
  const orData = await get('https://openrouter.ai/api/v1/models', {
    'Authorization': `Bearer ${openrouterKey}`
  });

  console.log('Total OpenRouter models:', orData.data?.length);
  const freeModels = (orData.data || []).filter(m => {
    const isFree = m.id.includes(':free') || (m.pricing && parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0);
    return isFree;
  });

  console.log(`\nFound ${freeModels.length} Free-tier models on OpenRouter:`);
  for (const m of freeModels.slice(0, 15)) {
    console.log(` - ID: ${m.id}`);
    console.log(`   Name: ${m.name}`);
    console.log(`   Context: ${m.context_length}`);
    console.log(`   Pricing: Prompt $${m.pricing?.prompt}, Completion $${m.pricing?.completion}`);
  }

  console.log('\nQuerying Groq models catalog...');
  const groqData = await get('https://api.groq.com/openai/v1/models', {
    'Authorization': `Bearer ${groqKey}`
  });

  console.log(`Found ${groqData.data?.length} Groq models:`);
  for (const m of (groqData.data || []).slice(0, 10)) {
    console.log(` - ID: ${m.id} | Owned by: ${m.owned_by}`);
  }
}

main().catch(console.error);
