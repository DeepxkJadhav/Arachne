/**
 * ARACHNE Intent Classifier
 * 
 * Deterministic, structured intent classifier for natural-language CLI inputs,
 * Telegram bot messages, and programmatic query routing.
 * 
 * Accurately distinguishes between:
 * - EXPORT_REPORT ("Give me the last report as a TXT file", "Export rep-123 as PDF")
 * - VIEW_REPORT ("Show report rep-12345", "View latest dossier")
 * - FORMAT_HELP ("How do I generate a PDF?", "What formats are supported?")
 * - SYSTEM_STATUS ("Check whether Arachne is working.", "Is Arachne running?")
 * - NEW_RESEARCH ("Start research on computer vision", "/hunt LLM agents")
 * - LIFECYCLE (pause, resume, stop, retry)
 * - FINDINGS ("Show findings", "What did you discover?")
 * - VAULT_STATS ("Vault stats", "Database storage metrics")
 * - APPROVALS ("Pending approvals", "Approve appr-123")
 * - HELP ("help", "what can you do")
 * 
 * Zero accidental research hunts.
 */

export const INTENTS = {
  EXPORT_REPORT: 'EXPORT_REPORT',
  VIEW_REPORT: 'VIEW_REPORT',
  REFINE_REPORT: 'REFINE_REPORT',
  QUESTION: 'QUESTION',
  FORMAT_HELP: 'FORMAT_HELP',
  SYSTEM_STATUS: 'SYSTEM_STATUS',
  BROWSER_STATUS: 'BROWSER_STATUS',
  MODEL_CONFIG: 'MODEL_CONFIG',
  SETTINGS: 'SETTINGS',
  HISTORY: 'HISTORY',
  NEW_RESEARCH: 'NEW_RESEARCH',
  LIFECYCLE: 'LIFECYCLE',
  FINDINGS: 'FINDINGS',
  VAULT_STATS: 'VAULT_STATS',
  APPROVALS: 'APPROVALS',
  HELP: 'HELP',
  UNKNOWN: 'UNKNOWN'
};

const FORMAT_SYNONYMS = {
  pdf: 'pdf',
  txt: 'txt',
  text: 'txt',
  plain: 'txt',
  'plain text': 'txt',
  xlsx: 'xlsx',
  excel: 'xlsx',
  spreadsheet: 'xlsx',
  sheet: 'xlsx',
  docx: 'docx',
  word: 'docx',
  doc: 'docx',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  json: 'json',
  html: 'html',
  web: 'html',
  pptx: 'pptx',
  powerpoint: 'pptx',
  presentation: 'pptx',
  slides: 'pptx'
};

/**
 * Extract target file format from text
 */
export function extractFormat(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Explicit extension check: .txt, .pdf, .xlsx, etc.
  const extMatch = lower.match(/\.([a-z0-9]{2,5})\b/);
  if (extMatch && FORMAT_SYNONYMS[extMatch[1]]) {
    return FORMAT_SYNONYMS[extMatch[1]];
  }

  // Word token checks
  const tokens = [
    'spreadsheet', 'excel', 'xlsx', 'sheet',
    'powerpoint', 'presentation', 'slides', 'pptx',
    'plain text', 'text file', 'txt file', 'txt', 'text', 'plain',
    'word document', 'docx', 'word', 'doc',
    'markdown', 'md file', 'md',
    'json', 'csv', 'html', 'pdf'
  ];

  for (const token of tokens) {
    const regex = new RegExp(`\\b${token}\\b`, 'i');
    if (regex.test(lower)) {
      return FORMAT_SYNONYMS[token.replace(/\s+(file|document)/i, '').trim()] || FORMAT_SYNONYMS[token];
    }
  }

  return null;
}

/**
 * Extract Report ID (rep-...) or Investigation ID (inv-...) from text
 */
export function extractId(text) {
  if (!text) return null;
  const repMatch = text.match(/\b(rep-[a-zA-Z0-9_\-]+)\b/i);
  if (repMatch) return repMatch[1];
  const invMatch = text.match(/\b(inv-[a-zA-Z0-9_\-]+)\b/i);
  if (invMatch) return invMatch[1];
  return null;
}

/**
 * Classify input into a structured Intent object
 * @param {string} rawInput 
 * @returns {object} { intent, confidence, params, raw }
 */
export function classifyIntent(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return {
      intent: INTENTS.UNKNOWN,
      confidence: 1.0,
      params: {},
      raw: ''
    };
  }

  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  const format = extractFormat(raw);
  const reportId = extractId(raw);
  const isLatest = /\b(latest|last|recent|current|previous)\b/i.test(raw) || (!reportId && /\breport\b/i.test(raw));

  // 1. HELP INTENT
  if (
    /^\/(?:help|\?|start)$/i.test(raw) ||
    /^(?:help|what can you do|commands|usage|menu|options|how does this work)$/i.test(lower)
  ) {
    return {
      intent: INTENTS.HELP,
      confidence: 1.0,
      params: {},
      raw
    };
  }

  // 2. FORMAT / CAPABILITY HELP INTENT
  // Questions inquiring how to generate, export, or what formats are supported.
  // Crucially: MUST NOT trigger export or research.
  const isHelpQuestion = /^(?:how\s+(?:do\s+i|can\s+i|to)|what\s+formats?|which\s+formats?|can\s+(?:i|you)\s+(?:generate|export)|is\s+(?:it\s+possible|there\s+support)\s+to)\b/i.test(lower) ||
    /\b(?:how\s+to\s+(?:generate|export|create|make|get|download))\b/i.test(lower) ||
    /\b(?:supported\s+formats?|format\s+options?|available\s+formats?)\b/i.test(lower);

  if (isHelpQuestion) {
    return {
      intent: INTENTS.FORMAT_HELP,
      confidence: 0.95,
      params: { format },
      raw
    };
  }

  // 3. SYSTEM STATUS / HEALTH CHECK INTENT
  // Inquiring whether Arachne is working, healthy, online, or checking status.
  // Crucially: MUST NOT trigger research.
  const isStatusInquiry =
    /^\/(?:status|sys|info|health)$/i.test(raw) ||
    /^(?:status|health|ping|sys)$/i.test(lower) ||
    /\b(?:is\s+arachne\s+(?:working|running|online|alive|up|healthy))\b/i.test(lower) ||
    /\b(?:check\s+(?:whether|if)\s+arachne\s+is\s+(?:working|running|online|healthy|alive))\b/i.test(lower) ||
    /\b(?:check\s+(?:system\s+)?status|system\s+(?:status|health|matrix|diagnostic))\b/i.test(lower) ||
    /\b(?:are\s+(?:all\s+)?systems\s+(?:online|working|running|healthy))\b/i.test(lower) ||
    /\b(?:what(?:'?s|\s+is)\s+your\s+(?:status|progress|state))\b/i.test(lower) ||
    /\b(?:how\s+far\s+are\s+you|what\s+are\s+you\s+doing)\b/i.test(lower);

  if (isStatusInquiry) {
    return {
      intent: INTENTS.SYSTEM_STATUS,
      confidence: 0.95,
      params: {},
      raw
    };
  }

  // 4. LIFECYCLE INTENT (Pause / Resume / Stop / Retry)
  if (/^\/pause\b/i.test(raw) || /^(?:pause|hold on|wait a minute|pause research|pause crawling)$/i.test(lower)) {
    return { intent: INTENTS.LIFECYCLE, confidence: 1.0, params: { action: 'pause' }, raw };
  }
  if (/^\/resume\b/i.test(raw) || /^(?:resume|continue|keep going|resume research|continue crawling)$/i.test(lower)) {
    return { intent: INTENTS.LIFECYCLE, confidence: 1.0, params: { action: 'resume' }, raw };
  }
  if (/^\/(?:stop|cancel|abort)\b/i.test(raw) || /^(?:stop|cancel|abort|terminate|kill research|stop research)$/i.test(lower)) {
    return { intent: INTENTS.LIFECYCLE, confidence: 1.0, params: { action: 'stop' }, raw };
  }
  if (/^\/retry\b/i.test(raw) || /^(?:retry|restart|re-run)$/i.test(lower)) {
    return { intent: INTENTS.LIFECYCLE, confidence: 1.0, params: { action: 'retry' }, raw };
  }

  // 5. VIEW REPORT INTENT
  // "Show report rep-1792069973534", "View report", "Display dossier rep-...", "Show the latest report"
  const isViewReport =
    /^\/reports?\s+view\b/i.test(raw) ||
    /^(?:show|view|display|read|open|print)\s+(?:the\s+)?(?:report|dossier|summary)(?:\s+(?:id\s+)?(rep-[a-zA-Z0-9_\-]+))?$/i.test(lower) ||
    /^(?:show|view|display)\s+(rep-[a-zA-Z0-9_\-]+)$/i.test(lower) ||
    /^(?:show|view|display)\s+(?:the\s+)?(?:latest|last|recent)\s+(?:report|dossier)$/i.test(lower);

  if (isViewReport) {
    return {
      intent: INTENTS.VIEW_REPORT,
      confidence: 0.95,
      params: {
        reportId: reportId || null,
        isLatest: isLatest || !reportId
      },
      raw
    };
  }

  // 6. EXPORT REPORT INTENT
  // "Give me the last report as a TXT file", "Export rep-1792069973534 as PDF",
  // "give me report in txt file", "Export report as excel", "download report to pdf"
  const hasExportVerb = /\b(?:export|give\s+me|send(?:\s+me)?|download|generate|save|pull|create|make|produce)\b/i.test(lower);
  const mentionsReport = /\b(?:report|dossier|summary|file|document)\b/i.test(lower) || !!reportId;
  const isDirectExportCmd = /^\/(?:pdf|excel|xlsx|docx|word|txt|text|csv|json|html|pptx|export)\b/i.test(raw);

  if (
    isDirectExportCmd ||
    (hasExportVerb && (mentionsReport || !!format)) ||
    (/^(?:give\s+me|export|download|send\s+me)\s+.+\b(?:txt|pdf|excel|xlsx|word|docx|csv|json|html|pptx|markdown|md)\b/i.test(lower))
  ) {
    return {
      intent: INTENTS.EXPORT_REPORT,
      confidence: 0.95,
      params: {
        format: format || 'txt',
        reportId: reportId || null,
        isLatest: isLatest || !reportId
      },
      raw
    };
  }

  // 7. FINDINGS INTENT
  if (
    /^\/findings\b/i.test(raw) ||
    /^(?:findings|what did you find|show findings|show discoveries|show results|what have you found)/i.test(lower)
  ) {
    return {
      intent: INTENTS.FINDINGS,
      confidence: 0.95,
      params: {},
      raw
    };
  }

  // 8. VAULT STATS INTENT
  if (
    /^\/(?:stats|vault)\b/i.test(raw) ||
    /^(?:(?:show\s+)?(?:vault\s+stats|vault|stats|database\s+stats|storage\s+stats|storage\s+metrics|storage|corpus|graph\s+stats))$/i.test(lower) ||
    /\b(?:show\s+(?:vault|storage|database)\s+stats)\b/i.test(lower)
  ) {
    return {
      intent: INTENTS.VAULT_STATS,
      confidence: 0.95,
      params: {},
      raw
    };
  }

  // 9. APPROVALS INTENT
  if (
    /^\/approvals\b/i.test(raw) ||
    /^(?:approvals|pending approvals|check approvals|do you need approval)/i.test(lower)
  ) {
    return {
      intent: INTENTS.APPROVALS,
      confidence: 0.95,
      params: { action: 'list' },
      raw
    };
  }
  const apprMatch = lower.match(/^(?:approve|reject|skip)\s+(appr-[a-zA-Z0-9_\-]+|\S+)/i);
  if (apprMatch) {
    const act = lower.startsWith('approve') ? 'approve' : (lower.startsWith('reject') ? 'reject' : 'skip');
    return {
      intent: INTENTS.APPROVALS,
      confidence: 0.95,
      params: { action: act, approvalId: apprMatch[1] },
      raw
    };
  }

  // 10. BROWSER STATUS INTENT
  if (
    /^\/(?:browser|tabs)\b/i.test(raw) ||
    /\b(?:is\s+(?:the\s+)?browser\s+connected|check\s+browser(?:\s+status)?|browser\s+connection\s+state|is\s+chrome\s+connected|is\s+brave\s+connected|browser\s+status)\b/i.test(lower)
  ) {
    return {
      intent: INTENTS.BROWSER_STATUS,
      confidence: 0.95,
      params: {},
      raw
    };
  }

  // 11. MODEL CONFIGURATION INTENT
  if (
    /^\/models?\b/i.test(raw) ||
    /\b(?:use\s+qwen|switch\s+to\s+qwen|which\s+model|what\s+model|show\s+model|current\s+model|model\s+settings)\b/i.test(lower)
  ) {
    return {
      intent: INTENTS.MODEL_CONFIG,
      confidence: 0.95,
      params: { provider: lower.includes('qwen') ? 'qwen' : null },
      raw
    };
  }

  // 12. SETTINGS INTENT
  if (
    /^\/(?:settings|config)\b/i.test(raw) ||
    /^(?:settings|configure|configuration|preferences)$/i.test(lower)
  ) {
    return {
      intent: INTENTS.SETTINGS,
      confidence: 0.95,
      params: {},
      raw
    };
  }

  // 13. HISTORY INTENT
  if (
    /^\/(?:history|hunts|tasks)\b/i.test(raw) ||
    /^(?:history|previous hunts|previous investigations|past research|list tasks)$/i.test(lower)
  ) {
    return {
      intent: INTENTS.HISTORY,
      confidence: 0.95,
      params: {},
      raw
    };
  }

  // 14. REFINE EXISTING REPORT INTENT (MUST NOT start a new research task)
  // "Make the comparison more detailed", "Make the report more detailed", "Elaborate on the findings"
  const isRefineReport =
    /\b(?:make\s+(?:the\s+)?(?:report|comparison|summary|dossier|analysis|findings)|elaborate|expand|deepen|add\s+more\s+detail)\b/i.test(lower) ||
    /^(?:make\s+(?:it\s+)?more\s+detailed|more\s+details?|elaborate|expand|go\s+deeper)\b/i.test(lower);

  if (isRefineReport) {
    return {
      intent: INTENTS.REFINE_REPORT,
      confidence: 0.95,
      params: {
        instruction: raw
      },
      raw
    };
  }

  // 15. QUESTION / FOLLOW-UP INQUIRY INTENT
  // Follow-up queries inquiring about findings or content: "What did you find about X?", "Explain...", "Tell me about..."
  const isQuestion =
    /^(?:what|why|how|who|when|where|which|tell me|explain|can you explain|summarize)\b/i.test(lower) &&
    !isHelpQuestion && !isStatusInquiry && !isViewReport && !hasExportVerb;

  if (isQuestion) {
    return {
      intent: INTENTS.QUESTION,
      confidence: 0.9,
      params: { question: raw },
      raw
    };
  }

  // 16. NEW RESEARCH INTENT
  // Explicit commands: /hunt, /investigate, /research, hunt, investigate, research
  const explicitResearchMatch = raw.match(/^\/(?:hunt|investigate|research|run|go)\s+(.+)$/i) ||
    raw.match(/^(?:hunt|investigate|research)\s+(.+)$/i);

  if (explicitResearchMatch) {
    return {
      intent: INTENTS.NEW_RESEARCH,
      confidence: 1.0,
      params: {
        objective: explicitResearchMatch[1].trim()
      },
      raw
    };
  }

  // Unambiguous natural-language research requests:
  // "Start research on computer vision", "Research latest breakthroughs in fusion",
  // "Find open source agents on GitHub", "Investigate recent developments in NLP"
  const researchPrefixMatch = lower.match(
    /^(?:start\s+research\s+on|conduct\s+research\s+on|begin\s+research\s+on|research|investigate|deep\s+dive\s+into|find\s+information\s+(?:on|about)|gather\s+intelligence\s+on|crawl\s+and\s+analyze|search\s+for\s+papers\s+on|analyze\s+market\s+trends\s+in)\s+(.+)$/i
  );

  if (researchPrefixMatch) {
    const obj = researchPrefixMatch[1].trim();
    return {
      intent: INTENTS.NEW_RESEARCH,
      confidence: 0.95,
      params: {
        objective: obj
      },
      raw
    };
  }

  // General questions or statements starting with search verbs that clearly mean web research:
  if (
    /^(?:find|search|look\s+up|analyze|survey|explore)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?([a-zA-Z0-9].{5,})$/i.test(lower) &&
    !mentionsReport
  ) {
    const cleaned = raw.replace(/^(?:find|search|look\s+up|analyze|survey|explore)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?/i, '').trim();
    return {
      intent: INTENTS.NEW_RESEARCH,
      confidence: 0.85,
      params: {
        objective: cleaned
      },
      raw
    };
  }

  // 11. UNKNOWN / AMBIGUOUS
  return {
    intent: INTENTS.UNKNOWN,
    confidence: 0.5,
    params: {},
    raw
  };
}
