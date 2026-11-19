import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

import { ContentExtractor } from '../server/crawler/extractor.mjs';
import { ReportValidator } from '../server/reports/report-validator.mjs';
import { SqliteStore } from '../server/vault/sqlite-store.mjs';
import { ModelRouter } from '../server/models/model-router.mjs';
import { ReportEngine } from '../server/reports/report-engine.mjs';

test('1. ContentExtractor universal domain NER & metric extraction', () => {
  const sampleArticle = `
    QuantumScape Corporation and Factorial Energy Inc announced new all-solid-state lithium-metal battery cells for electric aviation.
    The cells demonstrated an energy density of 391 Wh/kg with a 95% capacity retention over 800 cycles.
    The FAA issued advisory circular AC 20-184 and requires compliance with RTCA DO-311A for airborne battery installations.
    European aviation regulator EASA requires SC-VTOL airworthiness certification.
    Patent US10854872B2 protects the ceramic sulfide separator architecture.
    Reference: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13721909/ and https://www.federalregister.gov/documents/2026/04/14/2026-07152/
  `;

  const entities = ContentExtractor.extractEntities(sampleArticle, 'https://aviation-week.example/article');
  const citations = ContentExtractor.extractCitations(sampleArticle, 'https://aviation-week.example/article');

  // Verify entities
  const orgs = entities.filter(e => e.type === 'Organization').map(e => e.name);
  const stds = entities.filter(e => e.type === 'Standard').map(e => e.name);
  const metrics = entities.filter(e => e.type === 'Metric').map(e => e.name);
  const patents = entities.filter(e => e.type === 'Patent').map(e => e.name);

  assert.ok(orgs.some(o => o.includes('QuantumScape') || o.includes('Factorial')), 'Should extract battery organizations');
  assert.ok(stds.some(s => s.includes('FAA') || s.includes('DO-311A') || s.includes('EASA')), 'Should extract aviation/regulatory standards');
  assert.ok(metrics.some(m => m.includes('391 Wh/kg') || m.includes('800 cycles') || m.includes('95%')), 'Should extract quantitative metrics');
  assert.ok(patents.some(p => p.includes('US10854872B2')), 'Should extract patent numbers');

  // Verify citations
  assert.ok(citations.some(c => c.type === 'PubMed Central Paper'), 'Should extract PMC paper citation');
  assert.ok(citations.some(c => c.type === 'Federal Register Document'), 'Should extract Federal Register citation');
});

test('2. ReportValidator rejects fake/boilerplate reports and tosses them in dustbin', () => {
  const fakeReport = {
    title: 'Solid-state battery commercialization timeline for electric aircraft',
    summary: 'This dossier compiles verified web intelligence regarding Solid-state battery commercialization timeline for electric aircraft.',
    markdown: `
# ARACHNE Intelligence Dossier: Solid-state battery
## 1. Executive Summary
This dossier compiles verified web intelligence regarding Solid-state battery commercialization timeline for electric aircraft. During the investigation ARACHNE executed 5 research phases.
## 6. Synthesis & Strategic Conclusions
1. **Architecture Maturity:** The collected evidence demonstrates strong convergence around modular, tool-use-first autonomous agent frameworks.
2. **State & Memory:** Systems emphasizing persistent externalized state and graph topologies significantly outperform ephemeral conversational wrappers.
    `
  };

  const verdict = ReportValidator.validate(fakeReport, 'Solid-state battery commercialization timeline for electric aircraft');
  assert.strictEqual(verdict.isReal, false, 'Fake report must be rejected by Realism Quality Gate');
  assert.ok(verdict.score < 50, 'Score must be low for stale boilerplate');
  assert.ok(verdict.issues.some(i => i.includes('DETECTED_STALE_BOILERPLATE')), 'Must detect generic agent framework boilerplate');
});

test('3. ReportValidator accepts genuine fact-dense research report', () => {
  const realReport = {
    title: 'Solid-state battery commercialization timeline for electric aircraft',
    summary: 'Factorial Energy and QuantumScape lead commercialization of solid-state lithium-metal batteries for electric aircraft, targeting 391 Wh/kg by 2026 and FAA DO-311A certification by 2028.',
    markdown: `
# ARACHNE Intelligence Dossier: Solid-state battery commercialization timeline for electric aircraft
## 1. Executive Summary
The commercialization of solid-state batteries for electric aircraft is advancing rapidly toward early commercial deployment between 2026 and 2030. Leading developers including Factorial Energy and QuantumScape have demonstrated cell-level energy densities of 391 Wh/kg and cycle durability exceeding 800 cycles. Primary integration hurdles center on containment requirements established under FAA RTCA DO-311A and EASA airworthiness certification standards. Fixed-wing and eVTOL platforms require a minimum pack-level density of 300 Wh/kg for regional commercial viability.
## 3. Discovered Entities & Technical Landscape
| Entity | Category |
|---|---|
| QuantumScape | Organization |
| Factorial Energy | Organization |
| FAA | Standard |
| DO-311A | Standard |
| 391 Wh/kg | Metric |
## 4. Evidence Matrix & Corpus Sources
| # | Document Title | Domain | Relevance | Extracted Claim / Snippet |
|---|---|---|---|---|
| 1 | [FAA Airworthiness Directive](https://www.federalregister.gov/documents/2026/04/14/2026-07152/electric-aircraft) | \`federalregister.gov\` | 95% | FAA proposed rule DO-311A compliance... |
## 6. Technical Analysis & Architecture Findings
Solid-state architectures employing lithium-metal anodes and ceramic separators eliminate liquid electrolyte flammability while doubling volumetric energy density.
## 8. Strategic Roadmap & Deployment Horizon
- **2025-2026:** B-sample pilot validation and eVTOL testbed integration.
- **2027-2029:** Full airworthiness flight certification under DO-311A.
- **2030+:** Regional commercial transport deployment.
## 9. Synthesis & Strategic Conclusions
1. Empirical energy density has reached 391 Wh/kg in pre-production cells.
2. Aviation certification timelines dictate initial commercial entry by 2027-2028.
    `
  };

  const verdict = ReportValidator.validate(realReport, 'Solid-state battery commercialization timeline for electric aircraft');
  assert.strictEqual(verdict.isReal, true, 'Genuine report must pass Realism Quality Gate');
  assert.ok(verdict.score >= 80, `Score (${verdict.score}) must exceed 80% threshold`);
  assert.strictEqual(verdict.issues.length, 0, 'No quality issues should be flagged');
});

test('4. ModelRouter synthesizeInvestigationDossier generates real synthesis', async () => {
  const store = new SqliteStore();
  const router = new ModelRouter(store);

  const sampleCorpus = [
    {
      title: 'Solid-State Battery Progress for Aviation',
      url: 'https://aviation.example/ssb',
      domain: 'aviation.example',
      snippet: 'Factorial Energy delivered 391 Wh/kg cells to automotive and aerospace partners, demonstrating 1000 cycles with high thermal stability.'
    },
    {
      title: 'FAA Battery Airworthiness Standards',
      url: 'https://federalregister.gov/d/2026-001',
      domain: 'federalregister.gov',
      snippet: 'FAA publishes special conditions for electric aircraft batteries requiring compliance with DO-311A thermal runaway containment up to 40,000 feet.'
    }
  ];

  const synthesis = await router.synthesizeInvestigationDossier({
    objective: 'Solid-state battery commercialization timeline for electric aircraft',
    corpus: sampleCorpus,
    keyEntities: [{ label: 'Factorial Energy', type: 'Organization' }, { label: 'FAA', type: 'Standard' }],
    forceExtractive: false
  });

  assert.ok(synthesis.executiveSummary, 'Must contain executiveSummary');
  assert.ok(synthesis.executiveSummary.length > 50, 'Executive summary must be substantive');
  assert.ok(synthesis.technicalLandscape, 'Must contain technicalLandscape');
  assert.ok(synthesis.commercialRoadmap, 'Must contain commercialRoadmap');
  assert.ok(synthesis.strategicConclusions, 'Must contain strategicConclusions');
});

test('5. ReportEngine exports verified deliverable with synthesis', () => {
  const store = new SqliteStore();
  const engine = new ReportEngine(store);

  const inv = {
    id: `inv-test-${Date.now()}`,
    title: 'Solid-State Batteries',
    objective: 'Solid-state battery commercialization timeline for electric aircraft',
    status: 'COMPLETED',
    plan: { phases: [{ name: 'Scoping', status: 'completed', description: 'Overview' }] },
    metrics: { urlsDiscovered: 5, pagesCrawled: 2 }
  };

  const synthesis = {
    executiveSummary: 'Solid-state batteries are entering pre-commercial aerospace integration with 390 Wh/kg pre-production cells developed for electric aircraft.',
    technicalLandscape: 'Ceramic sulfide and oxide separators show highest conductivity.',
    contradictionsAndDebate: 'Dispute over high stack pressure requirements in airborne battery enclosures.',
    commercialRoadmap: '2026 eVTOL flight tests, 2029 FAA DO-311A certification.',
    strategicConclusions: '1. Energy density targets met.\n2. Thermal containment standards remain primary challenge.'
  };

  const report = engine.generateReport(inv, [
    { title: 'Test Doc', url: 'https://test.example/article', domain: 'test.example', snippet: '390 Wh/kg cell tests.' }
  ], { nodes: [{ id: 'n1', label: 'Factorial', type: 'Organization' }] }, { synthesis });

  assert.ok(report.id, 'Report must be created with ID');
  assert.ok(report.markdown.includes('390 Wh/kg'), 'Markdown must contain synthesized metrics');
  assert.ok(report.markdown.includes('## 8. Strategic Roadmap'), 'Markdown must contain synthesized roadmap');

  const realism = engine.validateReportRealism(report, inv.objective);
  assert.strictEqual(realism.isReal, true, 'Report must pass realism validation');

  // Verify deletion / tossing in dustbin
  const deleted = store.deleteReport(report.id);
  assert.strictEqual(deleted, true, 'Must successfully delete report from store and disk');
  assert.strictEqual(store.getReport(report.id), null, 'Report must no longer exist after deletion');
});
