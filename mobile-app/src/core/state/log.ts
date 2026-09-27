// Log entries as React state instead of DOM innerHTML (the web-app's log.js
// manipulated the DOM directly; here a screen owns a `LogEntry[]` state array
// and this factory gives plain functions - usable from non-component modules
// like actions.ts - that push into it via the setter, capped at 20 entries).

import type { LogApi, LogEntry } from './types';

const MAX_ENTRIES = 20;
const GESTURES: Record<number, string> = {
  1: 'Short press',
  2: 'Long press',
  3: 'Double press',
  4: 'Triple press (SOS)',
  5: 'Very long press',
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `log-${Date.now()}-${counter}`;
}

export function createLogApi(setEntries: (updater: (prev: LogEntry[]) => LogEntry[]) => void): LogApi {
  function push(text: string, crit: boolean) {
    const entry: LogEntry = { id: nextId(), text, crit, at: Date.now() };
    setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
  }

  return {
    add(text: string) {
      push(text, false);
    },
    addButtonEvent(gestureId: number) {
      const name = GESTURES[gestureId] ?? 'Unknown gesture';
      push(name, gestureId === 4);
    },
    addSOS(text: string) {
      push(`SOS – ${text}`, true);
    },
  };
}
