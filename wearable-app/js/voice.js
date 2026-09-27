// Speech priority queue. This is the core of "minimal latency" voice output:
// a higher-priority alert preempts whatever is currently speaking, same/lower
// priority queues behind it, and a per-key throttle guards against a noisy
// sensor flickering across a threshold and re-announcing the same line too
// often. Callers never talk to SpeechSynthesis directly - only through here,
// so this module is the single place that decides what gets said and when.

import { speechProvider } from './speechProvider.js';
import * as i18n from './i18n.js';

export const PRIORITY = {
  SOS: 100,
  DANGER: 80,
  FLOOR_DROP: 80,
  CAUTION: 50,
  AWARE: 20,
  INFO: 10,
  SAFE: 5,
};

const THROTTLE_MS = 4000;

let muted = false;
let current = null; // { text, priority, key }
let lastSpokenAny = null; // { text, priority }
const queue = [];
const lastSpokenByKey = new Map();
let generation = 0;

function speakNow(item) {
  generation += 1;
  const myGen = generation;
  current = item;
  lastSpokenAny = { text: item.text, priority: item.priority };
  if (item.key) lastSpokenByKey.set(item.key, { text: item.text, at: Date.now() });

  speechProvider.synthesize(item.text, {
    lang: i18n.getSpeechLang(),
    onend: () => settle(myGen),
    onerror: () => settle(myGen),
  });
}

function settle(myGen) {
  if (myGen !== generation) return; // stale event from a preempted utterance
  current = null;
  dequeueNext();
}

function dequeueNext() {
  if (queue.length === 0) return;
  const next = queue.shift();
  speakNow(next);
}

/**
 * enqueue(text, {priority, key})
 * - priority: one of PRIORITY.* (defaults to INFO)
 * - key: optional dedupe/throttle key (e.g. "zone:front", "floor"). Repeats of
 *   the exact same text under the same key within THROTTLE_MS are dropped.
 */
export function enqueue(text, { priority = PRIORITY.INFO, key = null } = {}) {
  if (!text) return;
  if (muted && priority < PRIORITY.DANGER) return;

  if (key) {
    const last = lastSpokenByKey.get(key);
    if (last && last.text === text && (Date.now() - last.at) < THROTTLE_MS) return;
  }

  const item = { text, priority, key };

  if (current && priority > current.priority) {
    speechProvider.cancelAll();
    speakNow(item);
    return;
  }

  if (!current) {
    speakNow(item);
    return;
  }

  queue.push(item);
  queue.sort((a, b) => b.priority - a.priority);
}

export function setMuted(value) {
  muted = value;
}

export function isMuted() {
  return muted;
}

export function isSpeaking() {
  return !!current;
}

export function repeatLast() {
  if (!lastSpokenAny) return;
  enqueue(lastSpokenAny.text, { priority: PRIORITY.INFO });
}

export function clearQueue() {
  queue.length = 0;
}
