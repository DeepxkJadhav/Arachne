export class KnowledgeGraphEngine {
  constructor(vaultStore) {
    this.vaultStore = vaultStore;
  }

  getGraphData(filters = {}) {
    const raw = this.vaultStore.getGraph();
    let nodes = raw.nodes || [];
    let edges = raw.edges || [];

    if (filters.type && filters.type !== 'all') {
      nodes = nodes.filter(n => n.type === filters.type);
      const nodeIds = new Set(nodes.map(n => n.id));
      edges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    if (filters.minRelevance) {
      const min = parseFloat(filters.minRelevance);
      nodes = nodes.filter(n => (n.relevance || 0) >= min);
      const nodeIds = new Set(nodes.map(n => n.id));
      edges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    if (filters.domain) {
      nodes = nodes.filter(n => n.domain === filters.domain || n.type === 'Domain');
      const nodeIds = new Set(nodes.map(n => n.id));
      edges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    return { nodes, edges };
  }

  upsertNode({ id, label, type, url = null, domain = null, metadata = {}, relevance = 0.5, status = 'discovered' }) {
    const node = {
      id: id || `node-${Math.random().toString(36).slice(2, 9)}`,
      label: label || 'Unknown Entity',
      type: type || 'Entity',
      url,
      domain,
      metadata,
      relevance,
      status,
      updatedAt: new Date().toISOString()
    };
    return this.vaultStore.addNode(node);
  }

  upsertEdge({ source, target, type = 'LINKS_TO', label = '', weight = 1.0 }) {
    if (!source || !target || source === target) return null;
    const edge = {
      id: `edge-${source}-${target}-${type}`,
      source,
      target,
      type,
      label: label || type,
      weight
    };
    return this.vaultStore.addEdge(edge);
  }

  ingestDocument({ url, title, domain, text, entities = [], citations = [], links = [] }) {
    // 1. Create / Upsert Domain node
    const domainNodeId = `dom-${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    this.upsertNode({
      id: domainNodeId,
      label: domain,
      type: 'Domain',
      domain,
      relevance: 0.7,
      status: 'processed'
    });

    // 2. Create Page node
    const pageNodeId = `page-${encodeURIComponent(url).slice(0, 64)}`;
    this.upsertNode({
      id: pageNodeId,
      label: title || url,
      type: 'Page',
      url,
      domain,
      metadata: { title, url },
      relevance: 0.85,
      status: 'processed'
    });

    // Link page to domain
    this.upsertEdge({
      source: pageNodeId,
      target: domainNodeId,
      type: 'HOSTED_ON',
      label: 'hosted on'
    });

    // 3. Ingest Entities
    for (const ent of entities) {
      const entNodeId = `ent-${ent.type}-${ent.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      this.upsertNode({
        id: entNodeId,
        label: ent.name,
        type: ent.type,
        metadata: { extractedFrom: url },
        relevance: ent.confidence || 0.8,
        status: 'relevant'
      });

      this.upsertEdge({
        source: pageNodeId,
        target: entNodeId,
        type: 'MENTIONS',
        label: 'mentions',
        weight: ent.confidence || 1.0
      });
    }

    // 4. Ingest Citations
    for (const cite of citations) {
      const citeNodeId = `cite-${cite.identifier.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      this.upsertNode({
        id: citeNodeId,
        label: cite.title || cite.identifier,
        type: cite.type === 'arXiv Paper' ? 'Document' : 'Citation',
        url: cite.url,
        relevance: 0.9,
        status: 'relevant'
      });

      this.upsertEdge({
        source: pageNodeId,
        target: citeNodeId,
        type: 'CITES',
        label: 'cites',
        weight: 1.5
      });
    }

    return { pageNodeId, domainNodeId };
  }

  expandNeighborhood(nodeId, maxDepth = 1) {
    const { nodes, edges } = this.vaultStore.getGraph();
    const resultNodes = new Set([nodeId]);
    const resultEdges = [];

    let frontier = new Set([nodeId]);
    for (let d = 0; d < maxDepth; d++) {
      const nextFrontier = new Set();
      for (const e of edges) {
        if (frontier.has(e.source)) {
          resultNodes.add(e.target);
          nextFrontier.add(e.target);
          resultEdges.push(e);
        } else if (frontier.has(e.target)) {
          resultNodes.add(e.source);
          nextFrontier.add(e.source);
          resultEdges.push(e);
        }
      }
      frontier = nextFrontier;
    }

    const filteredNodes = nodes.filter(n => resultNodes.has(n.id));
    return { nodes: filteredNodes, edges: resultEdges };
  }
}
