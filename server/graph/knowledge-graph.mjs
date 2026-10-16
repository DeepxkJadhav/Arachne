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

    if (filters.status && filters.status !== 'all') {
      nodes = nodes.filter(n => n.status === filters.status);
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

    // Attach degree metrics
    const degreeMap = new Map();
    for (const e of edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    }
    nodes = nodes.map(n => ({ ...n, connectionsCount: degreeMap.get(n.id) || 0 }));

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
      status, // 'discovered' | 'processed' | 'relevant' | 'failed' | 'blocked'
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

  ingestDocument({ url, title, domain, text, metadata = {}, entities = [], citations = [], links = [] }) {
    // 1. Domain Node
    const domainNodeId = `dom-${domain ? domain.replace(/[^a-zA-Z0-9.-]/g, '_') : 'unknown'}`;
    this.upsertNode({
      id: domainNodeId,
      label: domain || 'web',
      type: 'Domain',
      domain,
      relevance: 0.75,
      status: 'processed'
    });

    // 2. Page Node
    const pageNodeId = `page-${encodeURIComponent(url).slice(0, 64)}`;
    this.upsertNode({
      id: pageNodeId,
      label: title || url,
      type: 'Page',
      url,
      domain,
      metadata: { ...metadata, title, url },
      relevance: 0.88,
      status: 'processed'
    });

    this.upsertEdge({
      source: pageNodeId,
      target: domainNodeId,
      type: 'HOSTED_ON',
      label: 'hosted on'
    });

    // 3. Authors
    if (metadata.author) {
      const authorId = `auth-${metadata.author.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      this.upsertNode({
        id: authorId,
        label: metadata.author,
        type: 'Author',
        metadata: { discoveredAt: url },
        relevance: 0.85,
        status: 'relevant'
      });
      this.upsertEdge({
        source: pageNodeId,
        target: authorId,
        type: 'AUTHORED_BY',
        label: 'authored by'
      });
    }

    // 4. Entities (Repositories, AI Models, Technologies, Datasets, Organizations)
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

      let edgeType = 'MENTIONS';
      if (ent.type === 'Repository') edgeType = 'LINKS_TO';
      else if (ent.type === 'Dataset') edgeType = 'BENCHMARKS';

      this.upsertEdge({
        source: pageNodeId,
        target: entNodeId,
        type: edgeType,
        label: edgeType.toLowerCase().replace('_', ' '),
        weight: ent.confidence || 1.0
      });
    }

    // 5. Citations (arXiv papers, DOIs)
    for (const cite of citations) {
      const citeNodeId = `cite-${cite.identifier.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      this.upsertNode({
        id: citeNodeId,
        label: cite.title || cite.identifier,
        type: cite.type === 'arXiv Paper' ? 'Document' : 'Citation',
        url: cite.url,
        relevance: 0.95,
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

    // 6. Outgoing links (sample of top 5)
    for (const link of links.slice(0, 5)) {
      try {
        const linkDomain = new URL(link).hostname;
        const targetDomainId = `dom-${linkDomain.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        this.upsertEdge({
          source: pageNodeId,
          target: targetDomainId,
          type: 'LINKS_TO',
          label: 'links to'
        });
      } catch {}
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

  findPath(startNodeId, endNodeId) {
    if (!startNodeId || !endNodeId) return { found: false, path: [], edges: [] };
    if (startNodeId === endNodeId) return { found: true, path: [startNodeId], edges: [] };

    const { nodes, edges } = this.vaultStore.getGraph();
    const adj = new Map();

    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source).push({ neighbor: e.target, edge: e });
      adj.get(e.target).push({ neighbor: e.source, edge: e });
    }

    // BFS
    const queue = [[startNodeId]];
    const visited = new Set([startNodeId]);
    const edgeMap = new Map();

    while (queue.length > 0) {
      const currentPath = queue.shift();
      const node = currentPath[currentPath.length - 1];

      if (node === endNodeId) {
        const pathEdges = [];
        for (let i = 0; i < currentPath.length - 1; i++) {
          const u = currentPath[i];
          const v = currentPath[i + 1];
          const edge = edges.find(e => (e.source === u && e.target === v) || (e.source === v && e.target === u));
          if (edge) pathEdges.push(edge);
        }
        const pathNodes = nodes.filter(n => currentPath.includes(n.id));
        return { found: true, path: currentPath, nodes: pathNodes, edges: pathEdges };
      }

      const neighbors = adj.get(node) || [];
      for (const { neighbor } of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...currentPath, neighbor]);
        }
      }
    }

    return { found: false, path: [], nodes: [], edges: [] };
  }
}
