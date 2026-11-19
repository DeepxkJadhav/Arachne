/**
 * ARACHNE Report Realism & Quality Gate Validator (Critic Specialist)
 *
 * Enforces rigorous empirical standards on generated research dossiers:
 * 1. Rejects generic placeholder boilerplate ("modular autonomous agent frameworks").
 * 2. Enforces high fact-density, quantitative metrics, and real-world entities.
 * 3. Prevents cross-contamination of unrelated AI-model entities in domain reports.
 * 4. Ensures deep provenance and non-trivial executive synthesis.
 */

export class ReportValidator {
  /**
   * Validate report realism and quality against research objective.
   * @param {Object} report - Compiled report object
   * @param {string} objective - Original research objective
   * @returns {{ isReal: boolean, score: number, issues: string[] }}
   */
  static validate(report, objective = '') {
    const issues = [];
    let score = 100;
    const cleanObj = (objective || report.title || '').toLowerCase();
    const md = report.markdown || '';
    const summary = report.summary || '';
    const fullText = `${summary}\n${md}`.toLowerCase();

    const isAiTopic = /\b(agent|ai|llm|gpt|model|swe-bench|gaia|playwright|openhands|autogpt|prompt)\b/i.test(cleanObj);

    // 1. Generic Boilerplate & Stale Template Detection
    const genericPhrases = [
      'modular, tool-use-first autonomous agent frameworks',
      'externalized state and graph topologies significantly outperform',
      'this dossier compiles verified web intelligence regarding'
    ];

    if (!isAiTopic) {
      if (fullText.includes('modular, tool-use-first autonomous agent frameworks') ||
          fullText.includes('externalized state and graph topologies')) {
        issues.push('DETECTED_STALE_BOILERPLATE: Report contains hardcoded autonomous agent framework conclusions in a non-AI domain');
        score -= 50;
      }

      const contaminatedEntities = ['autogpt', 'openhands', 'swe-bench', 'osworld', 'agentbench'];
      for (const ent of contaminatedEntities) {
        if (fullText.includes(ent)) {
          issues.push(`ENTITY_CONTAMINATION: Report contains irrelevant entity "${ent}" in non-AI domain`);
          score -= 20;
          break;
        }
      }
    }

    // 2. Executive Summary Quality & Fact Density
    // Check if summary is merely a generic one-liner placeholder
    if (summary.length < 80 && !md.includes('## 1. Executive Summary')) {
      issues.push('SHALLOW_SUMMARY: Executive summary is under 80 characters with minimal analytical depth');
      score -= 30;
    }

    // Extract executive summary section from markdown
    const execSummaryMatch = md.match(/## 1\.\s*Executive Summary([\s\S]*?)(?=## 2\.)/i);
    const execText = execSummaryMatch ? execSummaryMatch[1].trim() : summary;

    if (execText.length < 120) {
      issues.push('INSUFFICIENT_EXECUTIVE_SYNTHESIS: Executive summary section contains less than 120 characters');
      score -= 25;
    }

    // Check for presence of objective keywords in executive synthesis
    const objWords = cleanObj
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !['what', 'when', 'timeline', 'current', 'state', 'research', 'commercialization'].includes(w));

    const matchedKeywords = objWords.filter(w => execText.toLowerCase().includes(w));
    if (objWords.length > 0 && matchedKeywords.length === 0) {
      issues.push('TOPIC_DISCONNECT: Executive summary fails to reference core objective keywords');
      score -= 35;
    }

    // 3. Quantitative Claim / Metrics Density
    const metricMatches = (md.match(/\b(?:\$|€|£)?\d+(?:\.\d+)?\s*(?:Wh\/kg|Wh\/L|mAh\/g|C-rate|cycles|°C|kW|MW|GW|kWh|MWh|kV|V|A|bar|psi|kg|lbs|nm|%|billion|million)\b/gi) || []);
    if (metricMatches.length === 0 && !cleanObj.includes('definition')) {
      issues.push('LOW_METRIC_DENSITY: Zero empirical engineering or quantitative metrics found in dossier');
      score -= 15;
    }

    // 4. Source Quality (Avoid 100% root homepages)
    const linksMatch = [...md.matchAll(/\|\s*\d+\s*\|\s*\[([^\]]+)\]\(([^)]+)\)/g)];
    if (linksMatch.length > 0) {
      let rootOnlyCount = 0;
      for (const lm of linksMatch) {
        try {
          const u = new URL(lm[2]);
          if (u.pathname === '/' || !u.pathname) rootOnlyCount++;
        } catch {}
      }
      if (rootOnlyCount === linksMatch.length && linksMatch.length >= 3) {
        issues.push('SHALLOW_SOURCES: Evidence matrix consists exclusively of generic root domains without deep article citations');
        score -= 25;
      }
    }

    // 5. Final Threshold Decision
    const finalScore = Math.max(0, Math.min(100, score));
    const isReal = finalScore >= 75 && !issues.some(i => i.startsWith('DETECTED_STALE_BOILERPLATE'));

    return {
      isReal,
      score: finalScore,
      issues
    };
  }
}
