// On-screen event log. Ported from ReflexLink.html's eventLog/clearSample
// behavior: a placeholder example entry is shown until the first real event,
// then wiped.

const GESTURES = { 1: 'Short press', 2: 'Long press', 3: 'Double press', 4: 'Triple press (SOS)', 5: 'Very long press' };
const MAX_ENTRIES = 20;

let logEl = null;
let sampleActive = true;

export function init(eventLogElement) {
  logEl = eventLogElement;
}

export function clearPlaceholder() {
  if (!sampleActive) return;
  sampleActive = false;
  logEl.innerHTML = '<div class="empty">No events yet</div>';
}

function prependEntry(html, { crit = false } = {}) {
  clearPlaceholder();
  const empty = logEl.querySelector('.empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = crit ? 'entry crit' : 'entry';
  el.innerHTML = html;
  logEl.prepend(el);
  while (logEl.children.length > MAX_ENTRIES) logEl.removeChild(logEl.lastChild);
}

export function addButtonEvent(gestureId) {
  const name = GESTURES[gestureId] || 'Unknown gesture';
  const t = new Date().toLocaleTimeString();
  prependEntry(`<b>${name}</b> · ${t}`, { crit: gestureId === 4 });
}

export function add(text) {
  const t = new Date().toLocaleTimeString();
  prependEntry(`${text} · ${t}`);
}

export function addSOS(text) {
  const t = new Date().toLocaleTimeString();
  prependEntry(`<b>SOS</b> · ${text} · ${t}`, { crit: true });
}
