// Client-side replacement for api.py's /api/localize and /api/path: the same
// cosine-similarity match and BFS pathfinding, running on the bundled
// graph.json instead of over HTTP against our own server. Field names match
// graph.json exactly (from_node/to_node/audio_instruction), which is the
// output of the existing offline pipeline (run_pipeline.py/build_graph.py) -
// not the differently-named fields MongoDB's live edge documents use.

export interface GraphNode {
  id: string;
  name: string;
  descriptor_vector: number[];
  variant_id?: string;
}

export interface GraphEdge {
  from_node: string;
  to_node: string;
  audio_instruction: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export interface LocalizeResult {
  status: 'match' | 'no_match';
  node?: GraphNode;
  similarity: number;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

export function localize(
  graph: Graph,
  queryVector: number[],
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD
): LocalizeResult {
  let best: GraphNode | undefined;
  let bestScore = -1;
  for (const node of graph.nodes) {
    if (!node.descriptor_vector || node.descriptor_vector.length === 0) continue;
    const score = cosineSimilarity(queryVector, node.descriptor_vector);
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  if (best && bestScore > threshold) {
    return { status: 'match', node: best, similarity: bestScore };
  }
  return { status: 'no_match', similarity: bestScore === -1 ? 0 : bestScore };
}

export interface PathStep {
  node_id: string;
  node_name: string;
  instruction: string | null;
}

export type PathResult = { status: 'ok'; steps: PathStep[] } | { status: 'error'; detail: string };

/** blockedEdges: pairs of [from_node, to_node] to avoid, same semantics as api.py's blocked_edges. */
export function getPath(graph: Graph, start: string, end: string, blockedEdges: Array<[string, string]> = []): PathResult {
  const blockedSet = new Set(blockedEdges.map(([u, v]) => `${u}|${v}`));

  const adjacency = new Map<string, Array<{ to: string; instruction: string }>>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from_node)) adjacency.set(edge.from_node, []);
    adjacency.get(edge.from_node)!.push({ to: edge.to_node, instruction: edge.audio_instruction });
  }

  if (!adjacency.has(start) || !adjacency.has(end)) {
    return { status: 'error', detail: 'Start or End node does not exist.' };
  }

  const queue: Array<{ node: string; path: string[]; instructions: string[] }> = [
    { node: start, path: [start], instructions: [] },
  ];
  const visited = new Set([start]);
  let bestNodes: string[] | null = null;
  let bestInstructions: string[] | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.node === end) {
      bestNodes = current.path;
      bestInstructions = current.instructions;
      break;
    }
    for (const neighbor of adjacency.get(current.node) ?? []) {
      if (blockedSet.has(`${current.node}|${neighbor.to}`)) continue;
      if (!visited.has(neighbor.to)) {
        visited.add(neighbor.to);
        queue.push({
          node: neighbor.to,
          path: [...current.path, neighbor.to],
          instructions: [...current.instructions, neighbor.instruction],
        });
      }
    }
  }

  if (!bestNodes) {
    return { status: 'error', detail: 'No path found.' };
  }

  const steps: PathStep[] = bestNodes.map((nodeId, i) => {
    const nodeData = graph.nodes.find((n) => n.id === nodeId);
    return {
      node_id: nodeId,
      node_name: nodeData?.name ?? nodeId,
      instruction: bestInstructions && i < bestInstructions.length ? bestInstructions[i] : null,
    };
  });

  return { status: 'ok', steps };
}

/** Case-insensitive substring match of a spoken target against node name/id - same rule the web-app's finder used. */
export function findNodeByFuzzyName(graph: Graph, target: string): GraphNode | null {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  for (const node of graph.nodes) {
    const name = (node.name || '').toLowerCase();
    const id = (node.id || '').toLowerCase();
    const nameMatches = !!name && (name.includes(normalized) || normalized.includes(name));
    const idMatches = !!id && (id.includes(normalized) || normalized.includes(id));
    if (nameMatches || idMatches) return node;
  }
  return null;
}
