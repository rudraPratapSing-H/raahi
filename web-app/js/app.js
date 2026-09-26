import * as ble from './ble.js';
import * as zonesMod from './zones.js';
import * as voice from './voice.js';
import * as i18n from './i18n.js';
import * as log from './log.js';
import * as camera from './camera.js';
import * as backend from './backend.js';
import * as buttons from './buttons.js';
import * as finder from './finder.js';
import * as voiceCommands from './voiceCommands.js';
import * as actions from './actions.js';

const $ = (id) => document.getElementById(id);

const state = {
  muted: false,
  destinationNodeId: null,
  blockedEdges: [],
  activeRoute: null,
  activeFind: null,
};

const ctx = {
  voice, ble, zones: zonesMod, camera, backend, log, i18n, state,
  onSOS: () => showSosBanner(true),
};

// ---- status pill / connect ----
function setStatusPill(kind, text) {
  const pill = $('statusPill');
  pill.className = 'pill ' + kind;
  $('statusText').textContent = text;
}

// ---- sample-data placeholder (wiped as soon as real BLE data arrives) ----
let sampleActive = true;
function clearSample() {
  if (!sampleActive) return;
  sampleActive = false;
  const tag = $('sampleTag');
  if (tag) tag.remove();
  log.clearPlaceholder();
}

// ---- zone painting ----
function paintZoneDOM(elId, cm) {
  const el = $(elId);
  const z = zonesMod.zoneFor(cm);
  el.className = 'zone z-' + z;
  el.querySelector('.val').innerHTML = (cm === 0xFFFF ? '—' : cm) + ' <span class="unit">cm</span>';
  el.querySelector('.state').textContent = z === 'unknown' ? 'no echo' : z === 'safe' ? 'clear' : z;
}

const trackers = {
  L: new zonesMod.ZoneTracker(),
  F: new zonesMod.ZoneTracker(),
  R: new zonesMod.ZoneTracker(),
};
let lastFloorState = null;

const ZONE_PRIORITY = {
  danger: voice.PRIORITY.DANGER,
  caution: voice.PRIORITY.CAUTION,
  aware: voice.PRIORITY.AWARE,
  safe: voice.PRIORITY.SAFE,
};
const ZONE_TEXT_KEY = {
  danger: 'hazard.danger',
  caution: 'hazard.caution',
  aware: 'hazard.aware',
  safe: 'hazard.clear',
};

function announceZoneChange(sensorKey, sideKey, previousZone, newZone) {
  if (newZone === 'unknown') return;
  // "safe" is only worth announcing when recovering from caution/danger -
  // going aware->safe is noise, not signal.
  if (newZone === 'safe' && previousZone !== 'caution' && previousZone !== 'danger') return;
  const side = i18n.t(`side.${sideKey}`);
  const text = i18n.t(ZONE_TEXT_KEY[newZone], { side });
  voice.enqueue(text, { priority: ZONE_PRIORITY[newZone], key: `zone:${sensorKey}` });
}

function handleSensorFrame(dv) {
  clearSample();
  const frame = zonesMod.parseSensorFrame(dv);

  if ($('rawFrame').classList.contains('show')) {
    const bytes = new Uint8Array(dv.buffer);
    $('rawFrame').textContent = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  paintZoneDOM('zoneL', frame.dL);
  paintZoneDOM('zoneF', frame.dC);
  paintZoneDOM('zoneR', frame.dR);

  const prevL = trackers.L.lastZone, prevF = trackers.F.lastZone, prevR = trackers.R.lastZone;
  const resL = trackers.L.update(frame.dL);
  const resF = trackers.F.update(frame.dC);
  const resR = trackers.R.update(frame.dR);
  // Front first: if multiple sensors change zone in the same frame, front's
  // announcement should be the one a preemption battle is judged against.
  if (resF.changed) announceZoneChange('front', 'front', prevF, resF.zone);
  if (resL.changed) announceZoneChange('left', 'left', prevL, resL.zone);
  if (resR.changed) announceZoneChange('right', 'right', prevR, resR.zone);

  if (zonesMod.classifyFloorEvent(frame.floorState) === 'drop' && lastFloorState !== zonesMod.FLOOR_DROP_INDEX) {
    voice.enqueue(i18n.t('hazard.floorDrop'), { priority: voice.PRIORITY.FLOOR_DROP, key: 'floor' });
  }
  lastFloorState = frame.floorState;

  $('floorState').textContent = zonesMod.FLOOR_STATES[frame.floorState] ?? '—';
  $('tiltVal').innerHTML = frame.tiltDeg.toFixed(1) + ' <small>deg</small>';
  $('battVal').innerHTML = frame.battPct + ' <small>%</small>';

  const flags = frame.flags;
  const chips = [];
  chips.push(flags & 0x01 ? { t: 'Standalone (no phone link)', c: 'warn' } : { t: 'Phone linked', c: 'good' });
  if (flags & 0x02) chips.push({ t: 'Left sensor covered', c: 'crit' });
  if (flags & 0x04) chips.push({ t: 'Front sensor covered', c: 'crit' });
  if (flags & 0x08) chips.push({ t: 'Right sensor covered', c: 'crit' });
  if (flags & 0x40) chips.push({ t: 'Battery low', c: 'warn' });
  $('flagChips').innerHTML = chips.map((c) => `<span class="chip ${c.c}">${c.t}</span>`).join('');

  lastFrameAt = performance.now();
  updateHz();
}

function handleButtonEvent(gestureId) {
  clearSample();
  log.addButtonEvent(gestureId);
  buttons.dispatchGesture(gestureId, ctx);
}

function handleStatusChange(kind, text) {
  setStatusPill(kind, text);
  if (kind === 'on') {
    $('connectBtn').textContent = 'Disconnect';
    $('buzzBtn').disabled = false;
    $('recalBtn').disabled = false;
  }
}

function handleDisconnected() {
  setStatusPill('lost', 'Disconnected');
  $('connectBtn').textContent = 'Connect to wearable';
  $('buzzBtn').disabled = true;
  $('recalBtn').disabled = true;
  setTimeout(() => setStatusPill('off', 'Not connected'), 2500);
}

// ---- Hz / freshness meter (ported from ReflexLink.html) ----
let lastFrameAt = 0;
let frameTimes = [];
function updateHz() {
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter((t) => now - t < 3000);
  const hz = frameTimes.length > 1
    ? (frameTimes.length - 1) / ((frameTimes[frameTimes.length - 1] - frameTimes[0]) / 1000)
    : 0;
  $('frameHz').textContent = (hz ? hz.toFixed(1) : '—') + ' Hz';
}
function fmtAgo(ms) {
  if (ms < 1000) return Math.round(ms) + ' ms';
  return (ms / 1000).toFixed(1) + ' s';
}
function tickFreshness() {
  if (!lastFrameAt) { $('freshVal').innerHTML = '— <small>ago</small>'; return; }
  $('freshVal').innerHTML = fmtAgo(performance.now() - lastFrameAt) + ' <small>ago</small>';
}
setInterval(tickFreshness, 200);

// ---- connect button ----
$('connectBtn').addEventListener('click', () => {
  if (ble.isConnected()) {
    ble.disconnect();
  } else {
    ble.connect({
      onSensorFrame: handleSensorFrame,
      onButtonEvent: handleButtonEvent,
      onStatusChange: handleStatusChange,
      onDisconnected: handleDisconnected,
    });
  }
});

$('buzzBtn').addEventListener('click', () => ble.sendCommand(ble.CMD_BUZZ_ALL).catch(() => {}));
$('recalBtn').addEventListener('click', () => ble.sendCommand(ble.CMD_RECALIBRATE).catch(() => {}));

$('rawToggle').addEventListener('click', () => {
  const rawFrame = $('rawFrame');
  rawFrame.classList.toggle('show');
  $('rawToggle').textContent = rawFrame.classList.contains('show') ? 'hide raw frame bytes' : 'show raw frame bytes';
});

if (!ble.isSupported()) {
  $('unsupportedNote').hidden = false;
  $('connectBtn').disabled = true;
  $('connectBtn').textContent = 'Bluetooth not available';
}

// ---- SOS banner ----
function showSosBanner(show) {
  $('sosBanner').classList.toggle('show', show);
}
$('sosDismissBtn').addEventListener('click', () => showSosBanner(false));

// ---- finder UI ----
$('findBtn').addEventListener('click', () => {
  const target = $('finderInputText').value.trim();
  if (target) actions.dispatch('find', ctx, { target });
});
$('guideBtn').addEventListener('click', () => actions.dispatch('guide', ctx));
$('cancelBtn').addEventListener('click', () => actions.dispatch('cancelFind', ctx));

function refreshFinderCard() {
  const target = $('finderTarget');
  const result = $('finderResult');
  const sub = $('finderSub');
  if (state.activeRoute) {
    const step = state.activeRoute.steps[state.activeRoute.index];
    target.textContent = `Route to "${state.activeRoute.targetLabel}"`;
    result.textContent = step && step.instruction ? step.instruction : i18n.t('loc.arrived');
    sub.textContent = `Step ${state.activeRoute.index + 1} of ${state.activeRoute.steps.length}`;
  } else if (state.activeFind) {
    target.textContent = `Looking for "${state.activeFind.target}"`;
    result.textContent = state.activeFind.lastDirection ? i18n.t(`direction.${state.activeFind.lastDirection}`) : '—';
    sub.textContent = state.activeFind.lastDistance || '';
  } else {
    target.textContent = 'Say "find canteen" or type below';
    result.textContent = '—';
    sub.textContent = '';
  }
  $('cancelBtn').closest('.actions').style.display = (state.activeRoute || state.activeFind) ? '' : 'none';
}

// ---- status chip refresh loop (mute / listening indicators, finder card) ----
setInterval(() => {
  $('muteChip').hidden = !state.muted;
  const listening = voiceCommands.isListening();
  $('listeningChip').textContent = listening ? 'listening' : 'mic off';
  $('listeningChip').classList.toggle('listening', listening);
  $('voiceToggle').checked = listening;
  refreshFinderCard();
}, 400);

$('voiceToggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (!voiceCommands.start(ctx)) {
      e.target.checked = false;
      log.add('Voice recognition not supported in this browser');
    }
  } else {
    voiceCommands.stop();
  }
});

// ---- language selector ----
function populateLangSelect() {
  const select = $('langSelect');
  select.innerHTML = i18n.SUPPORTED_LANGS
    .map((l) => `<option value="${l.code}">${l.label}</option>`)
    .join('');
  select.value = i18n.getLang();
}
$('langSelect').addEventListener('change', async (e) => {
  await i18n.setLang(e.target.value);
});

// ---- camera element wiring ----
camera.attachElements($('cameraVideo'), $('cameraCanvas'));

// ---- placeholder readout so the page shows what it does before a connection ----
function showSampleReadout() {
  paintZoneDOM('zoneL', 210);
  paintZoneDOM('zoneF', 95);
  paintZoneDOM('zoneR', 300);
  $('floorState').textContent = 'Unknown';
  $('tiltVal').innerHTML = '2.3 <small>deg</small>';
  $('battVal').innerHTML = '100 <small>%</small>';
  $('flagChips').innerHTML = '<span class="chip good">Phone linked</span><span class="chip">example</span>';
}

async function main() {
  await i18n.init();
  populateLangSelect();
  log.init($('eventLog'));
  showSampleReadout();

  if (voiceCommands.isSupported()) {
    voiceCommands.start(ctx);
  } else {
    $('voiceToggle').checked = false;
    $('voiceToggle').disabled = true;
    log.add('Voice recognition not supported in this browser');
  }

  window.__debug = { voice, zones: zonesMod, ble, actions, backend, finder, voiceCommands, ctx };
}

main();
