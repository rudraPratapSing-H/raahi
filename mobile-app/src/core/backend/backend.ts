// Composes the bundled graph + direct Gemini calls behind the exact same
// function names the web-app's backend.js exposed (getGraph, localize,
// getPath, detectHazard, scoreHazard, findVisually) - so actions.ts/finder.ts
// need no changes at their call sites, only what's underneath them differs:
// local math + a direct Gemini REST call instead of a fetch() to our FastAPI.

import graphJson from '../../../assets/graph.json';
import {
  type Graph,
  localize as localGraphLocalize,
  getPath as localGraphGetPath,
  findNodeByFuzzyName as localGraphFindNodeByFuzzyName,
} from '../finder/localGraph';
import {
  embedImage,
  detectHazard as geminiDetectHazard,
  scoreHazard as geminiScoreHazard,
  findVisually as geminiFindVisually,
} from '../gemini/geminiClient';

const graph = graphJson as unknown as Graph;

export async function getGraph(): Promise<Graph> {
  return graph;
}

export async function localize(imageBase64: string) {
  const vector = await embedImage(imageBase64);
  return localGraphLocalize(graph, vector);
}

export async function getPath(start: string, end: string, blockedEdges: Array<[string, string]> = []) {
  return localGraphGetPath(graph, start, end, blockedEdges);
}

export function findNodeByFuzzyName(target: string) {
  return localGraphFindNodeByFuzzyName(graph, target);
}

export const detectHazard = geminiDetectHazard;
export const scoreHazard = geminiScoreHazard;
export const findVisually = geminiFindVisually;
