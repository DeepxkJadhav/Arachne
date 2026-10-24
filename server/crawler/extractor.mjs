import crypto from 'node:crypto';

export class ContentExtractor {
  static extractMetadata(html, url) {
    const meta = {
      title: '',
      description: '',
      author: '',
      domain: '',
      canonical: url,
      language: 'en',
      contentType: 'Web Page',
      publishedAt: null,
      keywords: [],
      schemaType: null
    };

    try {
      meta.domain = new URL(url).hostname;
    } catch {}

    if (!html) return meta;

    // Title
    const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleM) meta.title = titleM[1].trim();

    // OpenGraph & Meta tags
    const descM = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description|twitter:description)["']\s+content=["']([^"']*)["']/i);
    if (descM) meta.description = descM[1].trim();

    const authorM = html.match(/<meta\s+(?:name|property)=["'](?:author|og:article:author|citation_author|dc\.creator)["']\s+content=["']([^"']*)["']/i);
    if (authorM) meta.author = authorM[1].trim();

    const dateM = html.match(/<meta\s+(?:name|property)=["'](?:article:published_time|datePublished|pubdate|citation_publication_date)["']\s+content=["']([^"']*)["']/i);
    if (dateM) meta.publishedAt = dateM[1].trim();

    const keywordsM = html.match(/<meta\s+(?:name|property)=["'](?:keywords|news_keywords)["']\s+content=["']([^"']*)["']/i);
    if (keywordsM) {
      meta.keywords = keywordsM[1].split(',').map(k => k.trim()).filter(Boolean);
    }

    // Canonical link
    const canonM = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
    if (canonM) meta.canonical = canonM[1].trim();

    // JSON-LD Schema detection
    const jsonLdMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const schema = JSON.parse(jsonLdMatch[1].trim());
        const root = Array.isArray(schema) ? schema[0] : (schema['@graph'] ? schema['@graph'][0] : schema);
        if (root && root['@type']) {
          meta.schemaType = root['@type'];
          if (!meta.title && root.name) meta.title = root.name;
          if (!meta.description && root.description) meta.description = root.description;
          if (!meta.author && root.author) {
            meta.author = typeof root.author === 'string' ? root.author : (root.author.name || '');
          }
        }
      } catch {}
    }

    meta.contentType = this.classifyContentType(url, html);
    return meta;
  }

  static classifyContentType(url, html = '', text = '') {
    const u = (url || '').toLowerCase();
    const content = `${html} ${text}`.toLowerCase();

    if (u.includes('arxiv.org') || u.includes('biorxiv.org') || u.includes('openreview.net') || u.includes('doi.org') || content.includes('citation_title') || content.includes('abstract:')) {
      return 'Research Paper';
    }
    if (u.includes('github.com') || u.includes('gitlab.com') || u.includes('huggingface.co/spaces')) {
      return 'GitHub Repository';
    }
    if (u.includes('huggingface.co/datasets') || u.includes('kaggle.com') || content.includes('dataset card') || content.includes('csv') && content.includes('rows')) {
      return 'Dataset';
    }
    if (u.includes('docs.') || u.includes('/docs/') || u.includes('/api/') || u.includes('documentation') || u.includes('gitbook.io')) {
      return 'Documentation';
    }
    if (u.includes('news.google.com') || u.includes('reuters.com') || u.includes('bbc.com') || u.includes('techcrunch.com') || content.includes('newsarticle')) {
      return 'News Article';
    }
    if (u.endsWith('.pdf') || u.includes('/pdf/')) {
      return 'Research Paper';
    }
    return 'Web Page';
  }

  static extractLinks(html, baseUrl) {
    if (!html) return [];
    const links = new Set();
    const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const href = match[1].trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
        continue;
      }
      try {
        const resolved = new URL(href, baseUrl).toString();
        // Exclude common binary/asset links
        if (!resolved.match(/\.(png|jpg|jpeg|gif|css|js|woff|woff2|ico|svg|zip|tar|gz|mp4|webm|avi|mp3|exe|dll)$/i)) {
          links.add(resolved);
        }
      } catch {}
    }

    return Array.from(links);
  }

  static extractEntities(text, url) {
    if (!text) return [];
    const entities = [];
    const seen = new Set();

    const addEntity = (name, type, confidence = 0.85) => {
      const clean = name.trim().replace(/^['"([{]+|[')\]}.,:;]+$/g, '');
      const key = `${type}:${clean.toLowerCase()}`;
      if (!seen.has(key) && clean.length >= 2 && !clean.match(/^\d+$/)) {
        seen.add(key);
        entities.push({ name: clean, type, confidence });
      }
    };

    // 1. GitHub Repositories
    const repoMatches = text.match(/(?:github\.com\/|[\s(])([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)(?:[\s),.]|$)/g);
    if (repoMatches) {
      for (const m of repoMatches) {
        const clean = m.replace(/^github\.com\//, '').trim().replace(/[(),.]$/, '');
        if (clean.includes('/') && !clean.startsWith('http') && clean.split('/').length === 2) {
          addEntity(clean, 'Repository', 0.95);
        }
      }
    }

    // 2. AI Models, LLMs & Multi-Agent Frameworks
    const aiModelPatterns = [
      /\b(Qwen[-_ ]?[0-9.]*(?:-[A-Za-z0-9]+)?)\b/gi,
      /\b(DeepSeek[-_ ]?(?:V[0-9]|R[0-9]|Coder|MoE)?)\b/gi,
      /\b(Claude[-_ ]?[0-9.]*(?:-[A-Za-z]+)?)\b/gi,
      /\b(GPT[-_ ]?[0-9.]*(?:-[A-Za-z]+)?)\b/gi,
      /\b(Llama[-_ ]?[0-9.]*(?:-[A-Za-z0-9]+)?)\b/gi,
      /\b(Mistral[-_ ]?[0-9.]*(?:-[A-Za-z0-9]+)?)\b/gi,
      /\b(Gemini[-_ ]?[0-9.]*(?:-[A-Za-z0-9]+)?)\b/gi,
      /\b(Grok[-_ ]?[0-9.]*)\b/gi,
      /\b(Nemotron[-_ ]?[0-9.]*(?:-[A-Za-z0-9]+)?)\b/gi,
      /\b(AgentOps|LangChain|AutoGPT|CrewAI|AutoGen|Browser-Use|OpenHands|MetaGPT|Arachne|Smolagents)\b/gi
    ];

    for (const pat of aiModelPatterns) {
      let m;
      while ((m = pat.exec(text)) !== null) {
        addEntity(m[1].trim(), 'AI_Model', 0.92);
      }
    }

    // 3. Technologies, Frameworks & Protocols
    const techPatterns = /\b(TypeScript|JavaScript|Python|Rust|Go|C\+\+|Docker|Kubernetes|PyTorch|TensorFlow|Electron|Node\.js|Ollama|vLLM|Playwright|Selenium|FastAPI|GraphQL|SQLite|PostgreSQL|Redis|Wasm|CDP|gRPC|WebRTC)\b/gi;
    let techM;
    while ((techM = techPatterns.exec(text)) !== null) {
      addEntity(techM[1], 'Technology', 0.88);
    }

    // 4. Benchmarks & Datasets
    const datasetPatterns = /\b(SWE-bench|OSWorld|WebArena|AgentBench|GAIA|HumanEval|MMLU|GSM8K|ImageNet|Common Crawl|TriviaQA|MATH)\b/gi;
    let dsM;
    while ((dsM = datasetPatterns.exec(text)) !== null) {
      addEntity(dsM[1], 'Dataset', 0.9);
    }

    // 5. Global Organizations, Labs, Companies & Universities
    const orgPatterns = /\b(Anthropic|OpenAI|Google|Google DeepMind|Meta|Meta AI|Microsoft|Microsoft Research|Stanford University|MIT|Harvard University|Berkeley|Tsinghua University|Hugging Face|Alibaba|Baidu|Tencent|Amazon|AWS|Apple|NVIDIA|SpaceX|CERN|World Bank|WHO|NASA)\b/gi;
    let orgM;
    while ((orgM = orgPatterns.exec(text)) !== null) {
      addEntity(orgM[1], 'Organization', 0.88);
    }

    // 6. Quantitative Claims, Benchmarks & Metrics (e.g. 98.4%, $45B, 1.2M parameters)
    const metricMatches = text.match(/\b(?:\$|€|£)?\d+(?:\.\d+)?(?:\s*(?:%|billion|million|trillion|B|M|GB|TB|ms|tokens\/s|parameters|params|QPS))\b/gi);
    if (metricMatches) {
      for (const met of metricMatches.slice(0, 10)) {
        addEntity(met.trim(), 'Metric', 0.82);
      }
    }

    return entities;
  }

  static extractCitations(text, url) {
    if (!text) return [];
    const citations = [];
    const seen = new Set();

    // arXiv papers
    const arxivRegex = /(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)([0-9]{4}\.[0-9]{4,5})/gi;
    let m;
    while ((m = arxivRegex.exec(text)) !== null) {
      const id = m[1];
      if (!seen.has(id)) {
        seen.add(id);
        citations.push({
          type: 'arXiv Paper',
          identifier: id,
          url: `https://arxiv.org/abs/${id}`,
          title: `arXiv:${id}`
        });
      }
    }

    // DOI references
    const doiRegex = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/gi;
    while ((m = doiRegex.exec(text)) !== null) {
      const doi = m[1].replace(/[.,]$/, '');
      if (!seen.has(doi)) {
        seen.add(doi);
        citations.push({
          type: 'DOI Publication',
          identifier: doi,
          url: `https://doi.org/${doi}`,
          title: doi
        });
      }
    }

    // GitHub repository links as citations
    const ghRegex = /https?:\/\/github\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)/gi;
    while ((m = ghRegex.exec(text)) !== null) {
      const repo = m[1].replace(/[.,]$/, '');
      if (!seen.has(repo) && repo !== 'github/gitignore') {
        seen.add(repo);
        citations.push({
          type: 'Code Repository',
          identifier: repo,
          url: `https://github.com/${repo}`,
          title: `GitHub: ${repo}`
        });
      }
    }

    return citations;
  }

  static generateSnippet(text, maxLength = 240) {
    if (!text) return '';
    const clean = text
      .replace(/#+\s+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length <= maxLength) return clean;
    return clean.slice(0, maxLength).trim() + '...';
  }

  static computeContentHash(text) {
    if (!text) return '';
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  static extract(url, html, text) {
    const metadata = this.extractMetadata(html, url);
    const entities = this.extractEntities(text || html, url);
    const citations = this.extractCitations(text || html, url);
    const links = this.extractLinks(html, url);
    const snippet = this.generateSnippet(text || html);
    const contentHash = this.computeContentHash(text || html);
    return {
      url,
      title: metadata.title || url,
      metadata,
      entities,
      citations,
      links,
      snippet,
      contentHash
    };
  }
}
