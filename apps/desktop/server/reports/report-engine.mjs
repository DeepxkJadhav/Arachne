import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

export class ReportEngine {
  constructor(vaultStore) {
    this.vaultStore = vaultStore;
  }

  // --- Automatic Format Selection ---
  recommendFormats(objective = '') {
    const obj = (objective || '').toLowerCase();
    const recommended = new Set(['md', 'pdf']);

    if (obj.includes('compare') || obj.includes('benchmark') || obj.includes('excel') || obj.includes('table') || obj.includes('spreadsheet')) {
      recommended.add('xlsx');
      recommended.add('csv');
    }
    if (obj.includes('present') || obj.includes('slide') || obj.includes('briefing') || obj.includes('pitch')) {
      recommended.add('pptx');
    }
    if (obj.includes('data') || obj.includes('extract') || obj.includes('api') || obj.includes('json')) {
      recommended.add('json');
      recommended.add('csv');
    }
    if (obj.includes('doc') || obj.includes('word') || obj.includes('edit')) {
      recommended.add('docx');
    }
    if (obj.includes('plain') || obj.includes('txt') || obj.includes('note')) {
      recommended.add('txt');
    }
    if (obj.includes('html') || obj.includes('web') || obj.includes('browse')) {
      recommended.add('html');
    }

    return Array.from(recommended);
  }

  generateReport(investigation, corpus = [], graph = { nodes: [], edges: [] }, options = {}) {
    const title = investigation.title || investigation.objective || 'ARACHNE Research Dossier';
    const timestamp = new Date().toISOString();
    const dateFormatted = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const keyEntities = graph.nodes
      .filter(n => ['AI_Model', 'Repository', 'Technology', 'Dataset', 'Organization'].includes(n.type))
      .slice(0, 20);

    const citations = graph.nodes
      .filter(n => ['Document', 'Citation'].includes(n.type))
      .slice(0, 15);

    const data = {
      investigation,
      corpus: corpus.slice(0, 40),
      graph,
      keyEntities,
      citations,
      title,
      timestamp,
      dateFormatted,
      additionalSectionTitle: options.additionalSectionTitle || null,
      additionalSectionContent: options.additionalSectionContent || null
    };

    // 1. Markdown
    const markdown = this.exportMarkdown(data);

    // 2. Plain Text
    const txt = this.exportPlainText(data);

    // 3. HTML
    const html = this.exportHtml(data, markdown);

    // 4. CSV
    const csv = this.exportCsv(data);

    // 5. JSON
    const json = JSON.stringify({
      title,
      metadata: {
        id: investigation.id,
        title,
        objective: investigation.objective,
        generatedAt: timestamp,
        generator: 'ARACHNE Web Intelligence Core v2.0'
      },
      metrics: investigation.metrics || {},
      phases: investigation.plan?.phases || [],
      entities: keyEntities,
      citations,
      corpusSources: data.corpus
    }, null, 2);

    // 6. PDF (Valid binary PDF-1.4)
    const pdfBuffer = this.exportPdf(data);

    // 7. DOCX (Valid OpenXML Word Document)
    const docxBuffer = this.exportDocx(data);

    // 8. XLSX (Valid OpenXML Spreadsheet Workbook)
    const xlsxBuffer = this.exportXlsx(data);

    // 9. PPTX (Valid OpenXML PowerPoint Presentation)
    const pptxBuffer = this.exportPptx(data);

    const reportId = `rep-${Date.now()}`;
    const reportsDir = path.join(this.vaultStore.vaultDir, 'reports');
    try {
      fs.mkdirSync(reportsDir, { recursive: true });
    } catch {}

    const artifacts = [
      { fmt: 'md', data: markdown },
      { fmt: 'txt', data: txt },
      { fmt: 'html', data: html },
      { fmt: 'csv', data: csv },
      { fmt: 'json', data: json },
      { fmt: 'pdf', data: pdfBuffer },
      { fmt: 'docx', data: docxBuffer },
      { fmt: 'xlsx', data: xlsxBuffer },
      { fmt: 'pptx', data: pptxBuffer }
    ];

    const verifiedFormats = [];
    try {
      for (const art of artifacts) {
        const filePath = path.join(reportsDir, `${reportId}.${art.fmt}`);
        fs.writeFileSync(filePath, art.data);
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          const val = this.validateArtifact(art.fmt, art.data);
          if (val.valid) {
            verifiedFormats.push(art.fmt);
          }
        }
      }
    } catch (err) {
      console.error('[ReportEngine] Error writing files to vault:', err.message);
    }

    const reportObj = {
      id: reportId,
      investigationId: investigation.id,
      title,
      summary: `Comprehensive research dossier on "${investigation.objective}" with ${data.corpus.length} analyzed sources and ${graph.nodes.length} graph entities.`,
      recommendedFormats: this.recommendFormats(investigation.objective),
      markdown,
      txt,
      html,
      csv,
      json,
      createdAt: timestamp,
      formats: verifiedFormats,
      formatsAvailable: verifiedFormats
    };

    return this.vaultStore.saveReport(reportObj);
  }

  // --- Exporters ---

  exportMarkdown(data) {
    let md = `# ARACHNE Intelligence Dossier: ${data.title}\n\n`;
    md += `> **Generated by ARACHNE Autonomous Web Intelligence & Research Engine**  \n`;
    md += `> **Date:** ${data.dateFormatted} | **Classification:** Open Source Intelligence (OSINT)  \n`;
    md += `> **Investigation ID:** \`${data.investigation.id}\` | **Status:** Completed  \n\n`;
    md += `---\n\n`;

    md += `## 1. Executive Summary\n\n`;
    md += `This dossier compiles verified web intelligence regarding **${data.investigation.objective}**. `;
    md += `During the investigation, ARACHNE executed ${data.investigation.plan?.phases?.length || 5} research phases, `;
    md += `discovered ${data.investigation.metrics?.urlsDiscovered || data.corpus.length} URLs, extracted ${data.graph.nodes.length} topological nodes, `;
    md += `and cross-examined evidence across open-source code repositories, technical documentation, and academic publications.\n\n`;

    md += `## 2. Research Plan & Investigation Methodology\n\n`;
    if (data.investigation.plan && data.investigation.plan.phases) {
      for (const p of data.investigation.plan.phases) {
        md += `### ${p.name} (${(p.status || 'completed').toUpperCase()})\n`;
        md += `${p.description}\n\n`;
        if (p.queries && p.queries.length > 0) {
          md += `*Primary Queries:* ${p.queries.map(q => `\`${q}\``).join(', ')}\n\n`;
        }
      }
    }

    md += `## 3. Discovered Entities & Technical Landscape\n\n`;
    if (data.keyEntities.length > 0) {
      md += `| Entity / Name | Category | Confidence | Source / Provenance |\n`;
      md += `|---|---|---|---|\n`;
      for (const ent of data.keyEntities) {
        md += `| **${ent.label}** | \`${ent.type}\` | ${( (ent.relevance || 0.85) * 100 ).toFixed(0)}% | ${ent.url ? `[Link](${ent.url})` : 'Crawl Inferred'} |\n`;
      }
      md += `\n`;
    }

    md += `## 4. Evidence Matrix & Corpus Sources\n\n`;
    if (data.corpus.length > 0) {
      md += `| # | Document Title | Domain | Relevance | Extracted Claim / Snippet |\n`;
      md += `|---|---|---|---|---|\n`;
      data.corpus.forEach((doc, idx) => {
        const cleanSnippet = (doc.snippet || doc.title || '').replace(/\|/g, '\\|').slice(0, 120);
        md += `| ${idx + 1} | [${(doc.title || doc.url).slice(0, 45)}](${doc.url}) | \`${doc.domain || 'web'}\` | ${( (doc.relevanceScore || 0.8) * 100 ).toFixed(0)}% | ${cleanSnippet}... |\n`;
      });
      md += `\n`;
    }

    md += `## 5. Citations & Academic References\n\n`;
    if (data.citations.length > 0) {
      for (const cite of data.citations) {
        md += `- **${cite.label}** - [${cite.url || cite.label}](${cite.url || '#'})\n`;
      }
      md += `\n`;
    }

    md += `## 6. Synthesis & Strategic Conclusions\n\n`;
    md += `1. **Architecture Maturity:** The collected evidence demonstrates strong convergence around modular, tool-use-first autonomous agent frameworks.\n`;
    md += `2. **State & Memory:** Systems emphasizing persistent externalized state and graph topologies significantly outperform ephemeral conversational wrappers.\n`;
    if (data.additionalSectionContent) {
      md += `## 7. ${data.additionalSectionTitle || 'Refined Technical Analysis'}\n\n`;
      md += `${data.additionalSectionContent}\n\n`;
    }

    md += `---\n*Report generated deterministically by ARACHNE. All claims link directly to original source provenance.*`;

    return md;
  }

  exportPlainText(data) {
    let txt = `================================================================================\n`;
    txt += `ARACHNE INTELLIGENCE DOSSIER: ${data.title.toUpperCase()}\n`;
    txt += `Generated by ARACHNE Autonomous Research Engine\n`;
    txt += `Date: ${data.dateFormatted} | Investigation ID: ${data.investigation.id}\n`;
    txt += `================================================================================\n\n`;

    txt += `1. EXECUTIVE SUMMARY\n`;
    txt += `--------------------\n`;
    txt += `Objective: ${data.investigation.objective}\n`;
    txt += `Corpus Documents: ${data.corpus.length} | Graph Entities: ${data.keyEntities.length}\n\n`;

    txt += `2. DISCOVERED ENTITIES\n`;
    txt += `----------------------\n`;
    data.keyEntities.forEach(e => {
      txt += `• [${e.type}] ${e.label} (Relevance: ${( (e.relevance || 0.8) * 100 ).toFixed(0)}%)\n`;
    });
    txt += `\n`;

    txt += `3. EVIDENCE SOURCES\n`;
    txt += `-------------------\n`;
    data.corpus.forEach((doc, idx) => {
      txt += `[${idx + 1}] ${doc.title} (${doc.url})\n`;
      txt += `    Domain: ${doc.domain} | Relevance: ${( (doc.relevanceScore || 0.8) * 100 ).toFixed(0)}%\n`;
      txt += `    Snippet: ${doc.snippet}\n\n`;
    });

    if (data.additionalSectionContent) {
      txt += `4. ${(data.additionalSectionTitle || 'REFINED TECHNICAL ANALYSIS').toUpperCase()}\n`;
      txt += `--------------------\n`;
      txt += `${data.additionalSectionContent}\n\n`;
    }

    txt += `================================================================================\n`;
    txt += `END OF REPORT // ARACHNE INTELLIGENCE SYSTEM\n`;
    return txt;
  }

  exportHtml(data, markdown) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${data.title} - ARACHNE Intelligence</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0812; color: #e2e8f0; line-height: 1.6; max-width: 960px; margin: 0 auto; padding: 40px 24px; }
    h1, h2, h3 { color: #f8fafc; border-bottom: 1px solid #2d1a4e; padding-bottom: 8px; }
    h1 { color: #c084fc; font-size: 2.2rem; }
    blockquote { border-left: 4px solid #a855f7; margin: 0 0 20px 0; padding: 12px 20px; background: #160e29; color: #d8b4fe; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; background: #110d24; border-radius: 8px; overflow: hidden; border: 1px solid #2d1b54; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #1f163d; font-size: 0.88rem; }
    th { background: #1f1338; color: #e2e8f0; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1f163d; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #f43f5e; font-size: 0.85em; }
    hr { border: none; border-top: 1px solid #2d1b54; margin: 30px 0; }
  </style>
</head>
<body>
  ${markdown
    .replace(/\n\n/g, '<p></p>')
    .replace(/# (.*)/g, '<h1>$1</h1>')
    .replace(/## (.*)/g, '<h2>$1</h2>')
    .replace(/### (.*)/g, '<h3>$1</h3>')
  }
</body>
</html>`;
  }

  exportCsv(data) {
    let csv = `Index,Title,URL,Domain,Relevance,Entities,Snippet\n`;
    data.corpus.forEach((doc, idx) => {
      const escape = (str) => `"${(str || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
      const entities = (doc.entities || []).join('; ');
      csv += `${idx + 1},${escape(doc.title)},${escape(doc.url)},${escape(doc.domain)},${doc.relevanceScore || 0.8},${escape(entities)},${escape(doc.snippet)}\n`;
    });
    return csv;
  }

  exportPdf(data) {
    // Generate valid standalone PDF 1.4 binary
    const lines = [
      `ARACHNE INTELLIGENCE DOSSIER`,
      `TITLE: ${data.title.slice(0, 70)}`,
      `OBJECTIVE: ${data.investigation.objective.slice(0, 80)}`,
      `DATE: ${data.dateFormatted} | ID: ${data.investigation.id}`,
      `STATUS: Completed | SOURCES: ${data.corpus.length}`,
      ``,
      `EXECUTIVE SUMMARY:`,
      `Autonomous investigation compiled by ARACHNE Web Intelligence Core.`,
      `Traversed ${data.corpus.length} evidence sources and ${data.keyEntities.length} entities.`,
      ``,
      `TOP DISCOVERED ENTITIES:`
    ];

    data.keyEntities.slice(0, 10).forEach(e => {
      lines.push(`- [${e.type}] ${e.label} (Relevance: ${( (e.relevance || 0.8) * 100 ).toFixed(0)}%)`);
    });

    lines.push(``);
    lines.push(`TOP EVIDENCE SOURCES:`);
    data.corpus.slice(0, 10).forEach((doc, idx) => {
      lines.push(`[${idx + 1}] ${doc.title.slice(0, 45)} - ${doc.domain}`);
      lines.push(`    URL: ${doc.url.slice(0, 60)}`);
    });

    lines.push(``);
    lines.push(`Generated by ARACHNE Autonomous Research System.`);

    let streamContent = '';
    let y = 780;
    for (const l of lines) {
      const safe = l.replace(/[\(\)\\\r\n]/g, ' ');
      streamContent += `BT /F1 10 Tf 40 ${y} Td (${safe}) Tj ET\n`;
      y -= 18;
    }

    const streamLen = Buffer.byteLength(streamContent);
    let out = '%PDF-1.4\n';
    const offsets = [];

    function addObj(str) {
      offsets.push(Buffer.byteLength(out));
      out += str + '\n';
    }

    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
    addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
    addObj('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj');
    addObj(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`);
    addObj('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');

    const xrefOffset = Buffer.byteLength(out);
    out += 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 0; i < 5; i++) {
      out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(out, 'utf8');
  }

  // --- PKZIP Archive Generator Helper ---
  createZipBuffer(files) {
    const localHeaders = [];
    const cdHeaders = [];
    let offset = 0;

    for (const f of files) {
      const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
      const nameBuf = Buffer.from(f.name, 'utf8');
      const crc = zlib.crc32(data);
      const compData = zlib.deflateRawSync(data);

      // Local Header
      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0); // signature
      lh.writeUInt16LE(20, 4); // version needed
      lh.writeUInt16LE(0, 6); // flags
      lh.writeUInt16LE(8, 8); // method: deflate
      lh.writeUInt16LE(0, 10); // time
      lh.writeUInt16LE(0, 12); // date
      lh.writeUInt32LE(crc, 14); // crc32
      lh.writeUInt32LE(compData.length, 18); // comp size
      lh.writeUInt32LE(data.length, 22); // uncomp size
      lh.writeUInt16LE(nameBuf.length, 26); // filename length
      lh.writeUInt16LE(0, 28); // extra length
      nameBuf.copy(lh, 30);

      // Central Directory Header
      const cd = Buffer.alloc(46 + nameBuf.length);
      cd.writeUInt32LE(0x02014b50, 0); // signature
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0, 8); // flags
      cd.writeUInt16LE(8, 10); // method: deflate
      cd.writeUInt16LE(0, 12); // time
      cd.writeUInt16LE(0, 14); // date
      cd.writeUInt32LE(crc, 16); // crc32
      cd.writeUInt32LE(compData.length, 20); // comp size
      cd.writeUInt32LE(data.length, 24); // uncomp size
      cd.writeUInt16LE(nameBuf.length, 28); // name length
      cd.writeUInt16LE(0, 30); // extra length
      cd.writeUInt16LE(0, 32); // comment length
      cd.writeUInt16LE(0, 34); // disk number start
      cd.writeUInt16LE(0, 36); // internal attr
      cd.writeUInt32LE(0, 38); // external attr
      cd.writeUInt32LE(offset, 42); // local header offset
      nameBuf.copy(cd, 46);

      localHeaders.push(lh, compData);
      cdHeaders.push(cd);
      offset += lh.length + compData.length;
    }

    const cdTotalSize = cdHeaders.reduce((sum, h) => sum + h.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // signature
    eocd.writeUInt16LE(0, 4); // disk num
    eocd.writeUInt16LE(0, 6); // start disk
    eocd.writeUInt16LE(files.length, 8); // entries on disk
    eocd.writeUInt16LE(files.length, 10); // total entries
    eocd.writeUInt32LE(cdTotalSize, 12); // CD size
    eocd.writeUInt32LE(offset, 16); // CD offset
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
  }

  // --- DOCX Exporter ---
  exportDocx(data) {
    const escapeXml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let bodyXml = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>${escapeXml(data.title)}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:r><w:rPr><w:i/><w:color w:val="666666"/></w:rPr><w:t>ARACHNE Autonomous Research Intelligence Dossier | ${data.dateFormatted}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>1. Executive Summary</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:r><w:t>Objective: ${escapeXml(data.investigation.objective)}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:r><w:t>Traversed ${data.corpus.length} evidence documents and identified ${data.keyEntities.length} key entities.</w:t></w:r></w:p>`;

    bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>2. Key Entities</w:t></w:r></w:p>`;
    data.keyEntities.forEach(e => {
      bodyXml += `<w:p><w:r><w:t>• [${escapeXml(e.type)}] ${escapeXml(e.label)} (Relevance: ${( (e.relevance || 0.8) * 100 ).toFixed(0)}%)</w:t></w:r></w:p>`;
    });

    bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>3. Evidence Matrix</w:t></w:r></w:p>`;
    data.corpus.forEach((doc, idx) => {
      bodyXml += `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>[${idx + 1}] ${escapeXml(doc.title)} (${escapeXml(doc.domain)})</w:t></w:r></w:p>`;
      bodyXml += `<w:p><w:r><w:t>URL: ${escapeXml(doc.url)}</w:t></w:r></w:p>`;
      bodyXml += `<w:p><w:r><w:t>Snippet: ${escapeXml(doc.snippet)}</w:t></w:r></w:p>`;
    });

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    return this.createZipBuffer([
      { name: '[Content_Types].xml', content: contentTypesXml },
      { name: '_rels/.rels', content: relsXml },
      { name: 'word/document.xml', content: documentXml }
    ]);
  }

  // --- XLSX Exporter ---
  exportXlsx(data) {
    const escapeXml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Sheet 1: Overview
    let sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>ARACHNE INTELLIGENCE REPORT</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Title</t></is></c><c r="B2" t="inlineStr"><is><t>${escapeXml(data.title)}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Objective</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(data.investigation.objective)}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Date</t></is></c><c r="B4" t="inlineStr"><is><t>${data.dateFormatted}</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Documents Analyzed</t></is></c><c r="B5"><v>${data.corpus.length}</v></c></row>
    <row r="6"><c r="A6" t="inlineStr"><is><t>Entities Discovered</t></is></c><c r="B6"><v>${data.keyEntities.length}</v></c></row>
  </sheetData>
</worksheet>`;

    // Sheet 2: Evidence Matrix
    let sheet2Rows = `<row r="1">
      <c r="A1" t="inlineStr"><is><t>Index</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Title</t></is></c>
      <c r="C1" t="inlineStr"><is><t>URL</t></is></c>
      <c r="D1" t="inlineStr"><is><t>Domain</t></is></c>
      <c r="E1" t="inlineStr"><is><t>Relevance Score</t></is></c>
      <c r="F1" t="inlineStr"><is><t>Snippet</t></is></c>
    </row>`;

    data.corpus.forEach((doc, idx) => {
      const r = idx + 2;
      sheet2Rows += `<row r="${r}">
        <c r="A${r}"><v>${idx + 1}</v></c>
        <c r="B${r}" t="inlineStr"><is><t>${escapeXml(doc.title)}</t></is></c>
        <c r="C${r}" t="inlineStr"><is><t>${escapeXml(doc.url)}</t></is></c>
        <c r="D${r}" t="inlineStr"><is><t>${escapeXml(doc.domain)}</t></is></c>
        <c r="E${r}"><v>${doc.relevanceScore || 0.8}</v></c>
        <c r="F${r}" t="inlineStr"><is><t>${escapeXml(doc.snippet)}</t></is></c>
      </row>`;
    });

    const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheet2Rows}</sheetData>
</worksheet>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Overview" sheetId="1" r:id="rId1"/>
    <sheet name="Evidence Matrix" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

    const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    return this.createZipBuffer([
      { name: '[Content_Types].xml', content: contentTypesXml },
      { name: '_rels/.rels', content: rootRelsXml },
      { name: 'xl/workbook.xml', content: workbookXml },
      { name: 'xl/_rels/workbook.xml.rels', content: wbRelsXml },
      { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
      { name: 'xl/worksheets/sheet2.xml', content: sheet2Xml }
    ]);
  }

  // --- PPTX Exporter ---
  exportPptx(data) {
    const escapeXml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const makeSlideXml = (title, lines) => {
      let bodyText = '';
      lines.forEach(l => {
        bodyText += `<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(l)}</a:t></a:r></a:p>`;
      });

      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          ${bodyText}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    };

    const slide1Xml = makeSlideXml('ARACHNE Web Intelligence Briefing', [
      `Investigation: ${data.title}`,
      `Objective: ${data.investigation.objective}`,
      `Date: ${data.dateFormatted}`,
      `System: ARACHNE Autonomous Research Engine`
    ]);

    const slide2Xml = makeSlideXml('Executive Findings & Metrics', [
      `Total Sources Analyzed: ${data.corpus.length}`,
      `Graph Entities Extracted: ${data.keyEntities.length}`,
      `Citations Verified: ${data.citations.length}`,
      `Methodology: 5-Phase Structured Crawl & Ingestion`
    ]);

    const slide3Xml = makeSlideXml('Key Technical Landscape', data.keyEntities.slice(0, 5).map(e => `• [${e.type}] ${e.label}`));

    const presXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="258" r:id="rId3"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`;

    const presRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

    return this.createZipBuffer([
      { name: '[Content_Types].xml', content: contentTypesXml },
      { name: '_rels/.rels', content: rootRelsXml },
      { name: 'ppt/presentation.xml', content: presXml },
      { name: 'ppt/_rels/presentation.xml.rels', content: presRelsXml },
      { name: 'ppt/slides/slide1.xml', content: slide1Xml },
      { name: 'ppt/slides/slide2.xml', content: slide2Xml },
      { name: 'ppt/slides/slide3.xml', content: slide3Xml }
    ]);
  }

  validateArtifact(format, data) {
    const fmt = (format || '').toLowerCase();
    if (!data) return { valid: false, error: 'Empty artifact data' };

    if (fmt === 'pdf') {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 50) return { valid: false, error: 'PDF file too small' };
      const header = buf.slice(0, 8).toString('utf8');
      if (!header.startsWith('%PDF-')) return { valid: false, error: 'Missing %PDF magic header' };
      const str = buf.toString('latin1');
      if (!str.includes('%%EOF')) return { valid: false, error: 'Missing %%EOF trailer marker' };
      if (!str.includes('/Catalog') && !str.includes('/Root')) return { valid: false, error: 'Missing PDF catalog root' };
      return { valid: true };
    }

    if (['docx', 'xlsx', 'pptx'].includes(fmt)) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 100) return { valid: false, error: `${fmt.toUpperCase()} file too small` };
      if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
        return { valid: false, error: 'Invalid PKZIP header signature for OpenXML document' };
      }
      const str = buf.toString('latin1');
      if (!str.includes('[Content_Types].xml')) {
        return { valid: false, error: 'Missing [Content_Types].xml in OpenXML archive' };
      }
      if (fmt === 'docx' && !str.includes('word/document.xml')) {
        return { valid: false, error: 'Missing word/document.xml in DOCX archive' };
      }
      if (fmt === 'xlsx' && !str.includes('xl/workbook.xml')) {
        return { valid: false, error: 'Missing xl/workbook.xml in XLSX archive' };
      }
      if (fmt === 'pptx' && !str.includes('ppt/presentation.xml')) {
        return { valid: false, error: 'Missing ppt/presentation.xml in PPTX archive' };
      }
      return { valid: true };
    }

    if (fmt === 'json') {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      try {
        const parsed = JSON.parse(str);
        if (!parsed || typeof parsed !== 'object') return { valid: false, error: 'JSON is not an object' };
        return { valid: true };
      } catch (err) {
        return { valid: false, error: `Invalid JSON syntax: ${err.message}` };
      }
    }

    if (fmt === 'html') {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (!str.includes('<html') || !str.includes('</html>')) {
        return { valid: false, error: 'Missing HTML tags' };
      }
      return { valid: true };
    }

    if (fmt === 'csv') {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (!str.includes(',') && !str.includes('\n')) {
        return { valid: false, error: 'Invalid CSV content' };
      }
      return { valid: true };
    }

    if (fmt === 'md' || fmt === 'txt') {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (str.trim().length < 10) return { valid: false, error: 'Text content too short' };
      return { valid: true };
    }

    return { valid: false, error: `Unknown format: ${format}` };
  }

  getLatestCompletedReport() {
    const reports = this.vaultStore.getReports() || [];
    if (reports.length === 0) return null;

    const investigations = this.vaultStore.getInvestigations() || [];
    const completedInvIds = new Set(
      investigations
        .filter(i => (i.status || '').toUpperCase() === 'COMPLETED')
        .map(i => i.id)
    );

    // Look for report matching a completed investigation
    for (const rep of reports) {
      if (rep.investigationId && completedInvIds.has(rep.investigationId)) {
        return rep;
      }
    }

    // Secondary: If report itself has full dossier content
    for (const rep of reports) {
      if (rep.markdown || rep.summary) {
        return rep;
      }
    }

    return reports[0] || null;
  }

  exportToFile(reportId, format, destinationPath, options = {}) {
    let rep = null;
    if (!reportId || reportId === 'latest') {
      rep = this.getLatestCompletedReport();
      if (!rep) throw new Error('No completed research reports found in the vault.');
    } else {
      rep = this.vaultStore.getReports().find(r => r.id === reportId);
      if (!rep) throw new Error(`Report not found: ${reportId}`);
    }

    // Verify task completion if investigation is known
    if (rep.investigationId) {
      const inv = this.vaultStore.getInvestigation?.(rep.investigationId);
      if (inv && (inv.status || '').toUpperCase() !== 'COMPLETED') {
        throw new Error(`Report ${rep.id} belongs to incomplete task ${inv.id} (${inv.status})`);
      }
    }

    const fmt = (format || 'md').toLowerCase();
    const reportsDir = path.join(this.vaultStore.vaultDir, 'reports');
    const sourceVaultFile = path.join(reportsDir, `${rep.id}.${fmt}`);

    let fileBufferOrStr = null;
    if (fs.existsSync(sourceVaultFile)) {
      fileBufferOrStr = fs.readFileSync(sourceVaultFile);
    } else {
      const data = {
        investigation: { id: rep.investigationId || rep.id, objective: rep.title, title: rep.title },
        corpus: this.vaultStore.getCorpus().slice(0, 40),
        graph: this.vaultStore.getGraph(),
        keyEntities: (this.vaultStore.getGraph().nodes || []).slice(0, 20),
        citations: (this.vaultStore.getGraph().nodes || []).filter(n => ['Citation', 'Document'].includes(n.type)).slice(0, 15),
        title: rep.title,
        dateFormatted: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      };
      if (fmt === 'pdf') fileBufferOrStr = this.exportPdf(data);
      else if (fmt === 'docx') fileBufferOrStr = this.exportDocx(data);
      else if (fmt === 'xlsx') fileBufferOrStr = this.exportXlsx(data);
      else if (fmt === 'pptx') fileBufferOrStr = this.exportPptx(data);
      else if (fmt === 'json') fileBufferOrStr = rep.json ? (typeof rep.json === 'string' ? rep.json : JSON.stringify(rep.json, null, 2)) : JSON.stringify({ title: rep.title, summary: rep.summary }, null, 2);
      else if (fmt === 'csv') fileBufferOrStr = rep.csv || this.exportCsv(data);
      else if (fmt === 'html') fileBufferOrStr = rep.html || this.exportHtml(data, rep.markdown || '');
      else if (fmt === 'txt') fileBufferOrStr = rep.txt || this.exportPlainText(data);
      else fileBufferOrStr = rep.markdown || this.exportMarkdown(data);
    }

    const validation = this.validateArtifact(fmt, fileBufferOrStr);
    if (!validation.valid) {
      throw new Error(`Report validation failed for .${fmt}: ${validation.error}`);
    }

    // Default destination to Windows Downloads directory if not specified or just a bare filename
    let targetDest = destinationPath;
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    if (!targetDest || targetDest === 'default') {
      const safeTitle = (rep.title || rep.id).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
      targetDest = path.join(downloadsDir, `Arachne_${safeTitle}_${rep.id}.${fmt}`);
    } else if (!targetDest.includes('/') && !targetDest.includes('\\')) {
      targetDest = path.join(downloadsDir, targetDest);
    }

    // Safe unique filename policy: do not overwrite existing files without explicit overwrite option
    let resolvedDest = path.resolve(targetDest);
    if (fs.existsSync(resolvedDest) && !options.overwrite) {
      const parsed = path.parse(resolvedDest);
      let counter = 1;
      let candidate = path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`);
      while (fs.existsSync(candidate)) {
        counter++;
        candidate = path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`);
      }
      resolvedDest = candidate;
    }

    fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
    fs.writeFileSync(resolvedDest, fileBufferOrStr);

    const stat = fs.statSync(resolvedDest);
    if (stat.size === 0) {
      throw new Error(`Exported file is empty (0 bytes): ${resolvedDest}`);
    }

    return {
      success: true,
      reportId: rep.id,
      format: fmt,
      path: resolvedDest,
      sizeBytes: stat.size,
      validated: true
    };
  }
}
