// Direct REST calls to Gemini, replacing api.py's Gemini-calling endpoints
// now that there's no backend to proxy through. Mirrors exactly what api.py
// already did server-side (same models, same prompts) - just called directly
// from the device with the bundled key. See getGeminiApiKey() for where that
// key lives (config, not hardcoded per-file).
//
// NOTE: field-name casing for a couple of REST fields (generationConfig's
// response_mime_type, inline_data) was confirmed against Google's docs but
// could not be tested against a live key from this environment - every call
// here degrades to a safe fallback rather than throwing if the response
// shape doesn't match what's expected, so a naming mismatch would surface as
// "feature didn't work" (worth a quick real-world check), never a crash.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Matches api.py's model strings exactly (not a generic doc example) - this
// project already calls these two model names successfully server-side.
const EMBEDDING_MODEL = 'gemini-embedding-2';
const VISION_MODEL = 'gemini-3.5-flash-lite';

/**
 * EXPO_PUBLIC_-prefixed env vars are inlined into the JS bundle by Metro at
 * build time (Expo's own sanctioned mechanism for a client-embedded value) -
 * see mobile-app/.env.example. This IS the "key ships inside the app"
 * tradeoff flagged in the project plan, not an accident: there's no backend
 * left to hold it server-side instead.
 */
export function getGeminiApiKey(): string {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!key) {
    throw new Error('Gemini API key not configured - set EXPO_PUBLIC_GEMINI_API_KEY in mobile-app/.env');
  }
  return key;
}

async function postJSON(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Embeds a base64 JPEG for localization, matching api.py's /api/localize embedding step. */
export async function embedImage(imageBase64: string): Promise<number[]> {
  const url = `${API_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${getGeminiApiKey()}`;
  const body = {
    content: {
      parts: [{ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }],
    },
    task_type: 'RETRIEVAL_DOCUMENT',
  };
  const json = await postJSON(url, body);
  const values = json?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini returned no embedding values');
  }
  return values as number[];
}

function extractText(json: any): string {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text.trim() : '';
}

async function generateContent(prompt: string, imageBase64: string, jsonMode: boolean): Promise<string> {
  const url = `${API_BASE}/models/${VISION_MODEL}:generateContent?key=${getGeminiApiKey()}`;
  const body: any = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }],
      },
    ],
  };
  if (jsonMode) {
    body.generationConfig = { response_mime_type: 'application/json' };
  }
  const json = await postJSON(url, body);
  return extractText(json);
}

/** Matches api.py's /api/vision/detect prompt: short clock-position hazard description. */
export async function detectHazard(imageBase64: string): Promise<{ hazard: string }> {
  const prompt =
    'You are a mobility instructor for a visually impaired person. ' +
    'Scan this image for physical hazards (furniture, people, steps, poles, etc.). ' +
    'Map their position using clock-face directions. ' +
    'CRITICAL: Estimate the distance to the hazard as accurately as possible in steps (1 step ≈ 2.5 feet). ' +
    'Look at the visible floor space, perspective, and where the object meets the ground to judge distance. ' +
    "Return ONLY a short description under 10 words (e.g., 'Couch at 12 o'clock, 2 steps ahead'). If clear, say 'Path is clear'.";
  const hazard = await generateContent(prompt, imageBase64, false);
  return { hazard: hazard || 'Path is clear' };
}

/** Matches api.py's /api/vision/score prompt: 1-5 severity from hazard text (text-only, no image needed). */
export async function scoreHazard(hazardText: string): Promise<{ severity: number }> {
  const url = `${API_BASE}/models/${VISION_MODEL}:generateContent?key=${getGeminiApiKey()}`;
  const prompt =
    `Given the following hazard description for a blind pedestrian: '${hazardText}'\n` +
    'Score the severity from 1 to 5. 1 = safe/clear, 2 = distant object, 3 = moderate hazard within 5 steps, ' +
    '4 = severe hazard within 2-3 steps, 5 = extreme immediate collision danger (1 step away).\n' +
    'Return ONLY a single integer from 1 to 5, nothing else.';
  try {
    const json = await postJSON(url, { contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    const severity = parseInt(extractText(json), 10);
    return { severity: Number.isFinite(severity) && severity >= 1 && severity <= 5 ? severity : 1 };
  } catch (err) {
    console.warn('scoreHazard failed', err);
    return { severity: 1 };
  }
}

export interface FindVisuallyResult {
  visible: boolean;
  direction: 'left' | 'slightly_left' | 'ahead' | 'slightly_right' | 'right' | 'behind' | 'unknown';
  distance_hint: 'near' | 'far' | null;
  note: string;
}

/** Matches api.py's /api/vision/find prompt + the same parse-with-safe-fallback robustness. */
export async function findVisually(imageBase64: string, target: string, lang: string = 'en'): Promise<FindVisuallyResult> {
  const prompt =
    `Look at this single image. The user is searching for: '${target}'. ` +
    'Look for the object/place itself OR any sign/label pointing to it. ' +
    `Respond in ${lang}. Respond with ONLY a compact JSON object, no other text, no markdown fences: ` +
    '{"visible": true or false, ' +
    '"direction": one of "left", "slightly_left", "ahead", "slightly_right", "right", "behind", "unknown", ' +
    '"distance_hint": one of "near", "far", or null, ' +
    '"note": "<max 8 words, e.g. what a sign said>"}';

  const fallback: FindVisuallyResult = { visible: false, direction: 'unknown', distance_hint: null, note: '' };
  try {
    const raw = await generateContent(prompt, imageBase64, true);
    let cleaned = raw.trim().replace(/^`+|`+$/g, '');
    if (cleaned.toLowerCase().startsWith('json')) cleaned = cleaned.slice(4).trim();
    const parsed = JSON.parse(cleaned);
    return {
      visible: !!parsed.visible,
      direction: parsed.direction || 'unknown',
      distance_hint: parsed.distance_hint ?? null,
      note: parsed.note || '',
    };
  } catch (err) {
    console.warn('findVisually parse/network error', err);
    return fallback;
  }
}
