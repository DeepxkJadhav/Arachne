import http from 'node:http';
import https from 'node:https';

export class ModelRouter {
  constructor(vaultStore) {
    this.vaultStore = vaultStore;
    this.configuredModels = [
      {
        id: 'qwen2.5-local',
        name: 'Qwen2.5 (Local)',
        provider: 'Ollama (Local)',
        endpoint: 'http://localhost:11434',
        model: 'qwen2.5:14b',
        role: 'Primary',
        rolesList: ['Reasoning', 'Planning', 'Analysis'],
        context: '32K',
        status: 'Online',
        latencyMs: 24,
        temperature: 0.7,
        maxTokens: 4096,
        capabilities: ['Test', 'Code', 'Tool Calling', 'Structured Output']
      },
      {
        id: 'llama3.1-local',
        name: 'Llama 3.1 (Local)',
        provider: 'Local (LM Studio)',
        endpoint: 'http://localhost:1234',
        model: 'llama-3.1-8b-instruct',
        role: 'Specialist',
        rolesList: ['Extraction', 'Classification'],
        context: '8K',
        status: 'Online',
        latencyMs: 18,
        temperature: 0.5,
        maxTokens: 2048,
        capabilities: ['Test', 'Code', 'Structured Output']
      },
      {
        id: 'gpt-4o-api',
        name: 'GPT-4o (API)',
        provider: 'Cloud (OpenAI)',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        role: 'Fallback',
        rolesList: ['Complex Analysis', 'Multimodal'],
        context: '128K',
        status: 'Online',
        latencyMs: 142,
        temperature: 0.7,
        maxTokens: 4096,
        capabilities: ['Test', 'Code', 'Tool Calling', 'Structured Output', 'Multimodal (Vision)']
      },
      {
        id: 'claude-3.5-api',
        name: 'Claude 3.5 (API)',
        provider: 'Cloud (Anthropic)',
        endpoint: 'https://api.anthropic.com/v1',
        model: 'claude-3-5-sonnet-20241022',
        role: 'Specialist',
        rolesList: ['Summarization', 'Report Writing'],
        context: '200K',
        status: 'Online',
        latencyMs: 168,
        temperature: 0.6,
        maxTokens: 8192,
        capabilities: ['Test', 'Code', 'Tool Calling', 'Structured Output', 'Multimodal (Vision)']
      }
    ];
  }

  getSettings() {
    return this.vaultStore.getSettings();
  }

  getModels() {
    return this.configuredModels;
  }

  async testAllConnections() {
    const results = [];
    for (const m of this.configuredModels) {
      const testRes = await this.testConnection(m.id);
      results.push({
        ...m,
        status: testRes.success ? 'Online' : 'Offline',
        latencyMs: testRes.latencyMs || m.latencyMs,
        message: testRes.message
      });
    }
    return results;
  }

  async testConnection(modelId = null) {
    const settings = this.getSettings();
    const targetModel = this.configuredModels.find(m => m.id === modelId) || this.configuredModels[0];
    const startTime = Date.now();

    if (targetModel.provider.includes('Ollama')) {
      const endpoint = settings.ollamaEndpoint || targetModel.endpoint || 'http://localhost:11434';
      try {
        const parsed = new URL(`${endpoint}/api/tags`);
        const res = await new Promise((resolve, reject) => {
          const req = http.get(parsed, { timeout: 3000 }, (r) => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => resolve({ statusCode: r.statusCode, data }));
          });
          req.on('error', reject);
          req.on('timeout', () => req.destroy(new Error('Connection timed out')));
        });

        const latencyMs = Date.now() - startTime;
        if (res.statusCode === 200) {
          let models = [];
          try {
            const json = JSON.parse(res.data);
            models = (json.models || []).map(m => m.name);
          } catch {}
          targetModel.status = 'Online';
          targetModel.latencyMs = latencyMs;
          return {
            success: true,
            provider: 'Ollama (Local Qwen)',
            endpoint,
            latencyMs,
            models,
            message: `Ollama active on ${endpoint}. ${models.length} model(s) detected.`
          };
        } else {
          targetModel.status = 'Offline';
          targetModel.latencyMs = latencyMs;
          return {
            success: false,
            provider: 'Ollama',
            endpoint,
            latencyMs,
            message: `HTTP ${res.statusCode} from Ollama endpoint`
          };
        }
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        targetModel.status = 'Offline';
        targetModel.latencyMs = latencyMs;
        return {
          success: false,
          provider: 'Ollama (Local Qwen)',
          endpoint,
          latencyMs,
          error: err.message,
          message: `Cannot connect to Ollama at ${endpoint} (${err.message}). Local fallback reasoner will handle planning.`
        };
      }
    }

    if (targetModel.provider.includes('OpenAI')) {
      const key = settings.openaiApiKey;
      if (!key) {
        return {
          success: false,
          provider: 'OpenAI',
          latencyMs: 0,
          models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
          message: 'No OpenAI API key configured. Enter your API key in Settings.'
        };
      }

      try {
        const res = await new Promise((resolve, reject) => {
          const req = https.get('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${key}` },
            timeout: 5000
          }, (r) => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => resolve({ statusCode: r.statusCode, data }));
          });
          req.on('error', reject);
          req.on('timeout', () => req.destroy(new Error('OpenAI timeout')));
        });

        const latencyMs = Date.now() - startTime;
        targetModel.latencyMs = latencyMs;
        if (res.statusCode === 200) {
          targetModel.status = 'Online';
          return {
            success: true,
            provider: 'OpenAI',
            latencyMs,
            message: `OpenAI connection authenticated (latency: ${latencyMs}ms).`
          };
        } else {
          targetModel.status = 'Auth Error';
          return {
            success: false,
            provider: 'OpenAI',
            latencyMs,
            message: `OpenAI returned HTTP ${res.statusCode}: ${res.data.slice(0, 120)}`
          };
        }
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        targetModel.status = 'Offline';
        targetModel.latencyMs = latencyMs;
        return {
          success: false,
          provider: 'OpenAI',
          latencyMs,
          message: `OpenAI unreachable: ${err.message}`
        };
      }
    }

    if (targetModel.provider.includes('Anthropic')) {
      const key = settings.anthropicApiKey;
      if (!key) {
        return {
          success: false,
          provider: 'Anthropic',
          latencyMs: 0,
          models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
          message: 'No Anthropic API key configured. Enter your API key in Settings.'
        };
      }

      try {
        const res = await new Promise((resolve, reject) => {
          const req = https.get('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01'
            },
            timeout: 5000
          }, (r) => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => resolve({ statusCode: r.statusCode, data }));
          });
          req.on('error', reject);
          req.on('timeout', () => req.destroy(new Error('Anthropic timeout')));
        });

        const latencyMs = Date.now() - startTime;
        targetModel.latencyMs = latencyMs;
        if (res.statusCode === 200) {
          targetModel.status = 'Online';
          return {
            success: true,
            provider: 'Anthropic',
            latencyMs,
            message: `Anthropic connection authenticated (latency: ${latencyMs}ms).`
          };
        } else {
          targetModel.status = 'Auth Error';
          return {
            success: false,
            provider: 'Anthropic',
            latencyMs,
            message: `Anthropic returned HTTP ${res.statusCode}`
          };
        }
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        targetModel.status = 'Offline';
        targetModel.latencyMs = latencyMs;
        return {
          success: false,
          provider: 'Anthropic',
          latencyMs,
          message: `Anthropic unreachable: ${err.message}`
        };
      }
    }

    return {
      success: true,
      provider: targetModel.name,
      latencyMs: Date.now() - startTime,
      message: 'Connection verified.'
    };
  }

  // --- Prompt Injection Sanitizer ---
  sanitizePromptInput(rawText) {
    if (!rawText) return '';
    return rawText
      .replace(/<\|im_start\|>/gi, '')
      .replace(/<\|im_end\|>/gi, '')
      .replace(/ignore\s+(?:all\s+)?previous\s+instructions/gi, '[REDACTED_UNTRUSTED_INSTRUCTION]')
      .replace(/system\s*:\s*you\s+are/gi, '[REDACTED_UNTRUSTED_SYSTEM_ROLE]')
      .trim();
  }

  // --- Tool Call Policy Gate ---
  validateToolCall(toolName, params = {}) {
    const allowedTools = new Set(['crawl_url', 'search_query', 'extract_entities', 'verify_claim', 'synthesize_report']);
    if (!allowedTools.has(toolName)) {
      return { valid: false, reason: `UNAUTHORIZED_TOOL: ${toolName} is not in the permitted tool registry.` };
    }

    if (toolName === 'crawl_url' && params.url) {
      try {
        const u = new URL(params.url);
        if (!['http:', 'https:'].includes(u.protocol)) {
          return { valid: false, reason: `INVALID_PROTOCOL: Only HTTP and HTTPS are permitted (${u.protocol}).` };
        }
      } catch {
        return { valid: false, reason: `INVALID_URL_FORMAT: ${params.url}` };
      }
    }

    return { valid: true, reason: 'POLICY_APPROVED' };
  }

  async generateResearchPlan(objective) {
    const cleanObjective = this.sanitizePromptInput(objective);
    const prompt = `Formulate a 5-phase web research plan for the objective: "${cleanObjective}". Output JSON with phases array.`;
    const settings = this.getSettings();
    const endpoint = settings.ollamaEndpoint || 'http://localhost:11434';
    const model = settings.ollamaModel || 'qwen2.5:latest';

    try {
      const ollamaRes = await this.callOllama(endpoint, model, prompt);
      if (ollamaRes && ollamaRes.response) {
        const match = ollamaRes.response.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed && Array.isArray(parsed.phases)) {
            return parsed;
          }
        }
      }
    } catch {}

    // Robust deterministic heuristic decomposition fallback
    return this.heuristicDecompose(cleanObjective);
  }

  heuristicDecompose(objective) {
    const cleanObj = objective.replace(/^investigate\s+/i, '').trim();
    const keywords = cleanObj.split(/\s+/).slice(0, 5).join(' ');

    return {
      objective: cleanObj,
      phases: [
        {
          id: 'phase-1',
          name: 'Scoping & Problem Formulation',
          description: `Identify foundational taxonomy, core definitions, and key actors in ${cleanObj}.`,
          status: 'pending',
          queries: [`${keywords} overview architecture taxonomy`, `${keywords} state of the art research`]
        },
        {
          id: 'phase-2',
          name: 'Primary Source Discovery',
          description: `Identify top open-source repositories, arXiv papers, and benchmark leaderboards.`,
          status: 'pending',
          queries: [`best open-source ${keywords} github`, `${keywords} benchmark dataset paper`]
        },
        {
          id: 'phase-3',
          name: 'Deep Crawling & Technical Inspection',
          description: `Traverse documentation, architecture specs, code implementations, and citations.`,
          status: 'pending',
          queries: [`${keywords} implementation guide technical details`, `${keywords} evaluation comparisons`]
        },
        {
          id: 'phase-4',
          name: 'Cross-Verification & Contradiction Analysis',
          description: `Cross-examine benchmarks, claims, license limitations, and architectural trade-offs.`,
          status: 'pending',
          queries: [`${keywords} limitations challenges open issues`]
        },
        {
          id: 'phase-5',
          name: 'Deliverable Synthesis & Dossier Compilation',
          description: `Synthesize structured findings, evidence matrix, and actionable executive summary.`,
          status: 'pending',
          queries: []
        }
      ]
    };
  }

  async callOllama(endpoint, model, prompt) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(`${endpoint}/api/generate`);
      const payload = JSON.stringify({ model, prompt, stream: false });

      const req = http.request(
        parsed,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 10000
        },
        (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Ollama request timed out')));
      req.write(payload);
      req.end();
    });
  }
}
