// Speech priority queue - ported from the web-app's voice.js almost
// unchanged. A higher-priority alert preempts whatever is currently
// speaking, same/lower priority queues behind it, and a per-key throttle
// guards against a noisy sensor flickering across a threshold and
// re-announcing the same line too often. Callers never talk to the speech
// backend directly - only through here.
//
// New for the phone build: DANGER-tier-and-above announcements also fire a
// haptic pulse (see haptics.ts) as a redundant channel - centralized here
// rather than at every call site so it can never be forgotten.

import { speechProvider } from './speechProvider';
import { getSpeechLang } from '../i18n/i18n';
import { fireHapticForPriority } from '../haptics/haptics';

export const PRIORITY = {
  SOS: 100,
  DANGER: 80,
  FLOOR_DROP: 80,
  CAUTION: 50,
  AWARE: 20,
  INFO: 10,
  SAFE: 5,
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

interface QueueItem {
  text: string;
  priority: number;
  key: string | null;
}

const THROTTLE_MS = 4000;

let muted = false;
let current: QueueItem | null = null;
let lastSpokenAny: { text: string; priority: number } | null = null;
const queue: QueueItem[] = [];
const lastSpokenByKey = new Map<string, { text: string; at: number }>();
let generation = 0;

function speakNow(item: QueueItem) {
  generation += 1;
  const myGen = generation;
  current = item;
  lastSpokenAny = { text: item.text, priority: item.priority };
  if (item.key) lastSpokenByKey.set(item.key, { text: item.text, at: Date.now() });

  if (item.priority >= PRIORITY.DANGER) {
    fireHapticForPriority(item.priority);
  }

  speechProvider.synthesize(item.text, {
    lang: getSpeechLang(),
    onend: () => settle(myGen),
    onerror: () => settle(myGen),
  });
}

function settle(myGen: number) {
  if (myGen !== generation) return; // stale event from a preempted utterance
  current = null;
  dequeueNext();
}

function dequeueNext() {
  if (queue.length === 0) return;
  const next = queue.shift()!;
  speakNow(next);
}

export function enqueue(text: string, { priority = PRIORITY.INFO, key = null }: { priority?: number; key?: string | null } = {}) {
  if (!text) return;
  if (muted && priority < PRIORITY.DANGER) return;

  if (key) {
    const last = lastSpokenByKey.get(key);
    if (last && last.text === text && Date.now() - last.at < THROTTLE_MS) return;
  }

  const item: QueueItem = { text, priority, key };

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

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

export function isSpeaking(): boolean {
  return !!current;
}

export function repeatLast() {
  if (!lastSpokenAny) return;
  enqueue(lastSpokenAny.text, { priority: PRIORITY.INFO });
}

export function clearQueue() {
  queue.length = 0;
}
