// Thin fetch wrappers over api.py's existing (unchanged) + one new endpoint.
// Relative paths since the page is served from the same FastAPI origin.

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${path} -> ${res.status} ${detail}`);
  }
  return res.json();
}

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${path} -> ${res.status} ${detail}`);
  }
  return res.json();
}

let graphCache = null;

export async function getGraph({ force = false } = {}) {
  if (graphCache && !force) return graphCache;
  graphCache = await getJSON('/api/graph');
  return graphCache;
}

export async function localize(imageBase64) {
  return postJSON('/api/localize', { image_base64: imageBase64 });
}

export async function getPath(start, end, blockedEdges = []) {
  const params = new URLSearchParams({ start, end });
  if (blockedEdges.length) params.set('blocked_edges', blockedEdges.join(','));
  return getJSON(`/api/path?${params.toString()}`);
}

export async function detectHazard(imageBase64) {
  return postJSON('/api/vision/detect', { image_base64: imageBase64 });
}

export async function scoreHazard(hazardText) {
  return postJSON('/api/vision/score', { hazard_text: hazardText });
}

export async function findVisually(imageBase64, target, lang = 'en') {
  return postJSON('/api/vision/find', { image_base64: imageBase64, target, lang });
}
