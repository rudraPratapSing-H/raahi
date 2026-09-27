import { cosineSimilarity, localize, getPath, findNodeByFuzzyName, type Graph } from '../src/core/finder/localGraph';

const fixtureGraph: Graph = {
  nodes: [
    { id: 'entrance', name: 'Main Entrance', descriptor_vector: [1, 0, 0] },
    { id: 'room_010', name: 'My Room', descriptor_vector: [0, 1, 0] },
    { id: 'gallary', name: 'Gallary', descriptor_vector: [0, 0, 1] },
  ],
  edges: [
    { from_node: 'entrance', to_node: 'room_010', audio_instruction: 'Walk straight then turn right' },
    { from_node: 'room_010', to_node: 'entrance', audio_instruction: 'Turn left and walk out' },
    { from_node: 'entrance', to_node: 'gallary', audio_instruction: 'Walk straight ahead' },
  ],
};

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('returns 0 for a zero-magnitude vector instead of NaN', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('localize', () => {
  it('matches the closest node above the confidence threshold', () => {
    const result = localize(fixtureGraph, [0.99, 0.05, 0]);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.node?.id).toBe('entrance');
  });

  it('reports no_match when nothing clears the threshold', () => {
    const result = localize(fixtureGraph, [0.5, 0.5, 0.5], 0.99);
    expect(result.status).toBe('no_match');
  });
});

describe('getPath (BFS)', () => {
  it('finds a direct edge with its instruction', () => {
    const result = getPath(fixtureGraph, 'entrance', 'room_010');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.steps.map((s) => s.node_id)).toEqual(['entrance', 'room_010']);
      expect(result.steps[0].instruction).toBe('Walk straight then turn right');
      expect(result.steps[1].instruction).toBeNull(); // destination has no onward instruction
    }
  });

  it('respects blocked edges by finding no path when the only route is blocked', () => {
    const result = getPath(fixtureGraph, 'entrance', 'room_010', [['entrance', 'room_010']]);
    expect(result.status).toBe('error');
  });

  it('errors cleanly for an unknown node', () => {
    const result = getPath(fixtureGraph, 'entrance', 'does_not_exist');
    expect(result.status).toBe('error');
  });
});

describe('findNodeByFuzzyName', () => {
  it('matches case-insensitively by name or id substring', () => {
    expect(findNodeByFuzzyName(fixtureGraph, 'my room')?.id).toBe('room_010');
    expect(findNodeByFuzzyName(fixtureGraph, 'GALLARY')?.id).toBe('gallary');
    expect(findNodeByFuzzyName(fixtureGraph, 'canteen')).toBeNull();
  });
});
