// Sensor-frame parsing + zone classification, ported as-is from ReflexLink.html
// (same byte offsets, same thresholds), plus ZoneTracker which turns the raw
// ~15Hz frame stream into transition events for the voice layer to consume.

export const ZONE_DANGER_CM = 80;
export const ZONE_CAUTION_CM = 150;
export const ZONE_AWARE_CM = 250;
export const FLOOR_STATES = ['Calibrating', 'Floor', 'DROP!', 'Rising', 'Drop suspect', 'Unknown'];
export const FLOOR_DROP_INDEX = 2;

export function zoneFor(cm) {
  if (cm === 0xFFFF) return 'unknown';
  if (cm < ZONE_DANGER_CM) return 'danger';
  if (cm < ZONE_CAUTION_CM) return 'caution';
  if (cm < ZONE_AWARE_CM) return 'aware';
  return 'safe';
}

/**
 * dv: DataView over the 20-byte sensor frame.
 * Returns {dL, dC, dR, floorState, tiltDeg, battPct, flags}.
 */
export function parseSensorFrame(dv) {
  const dL = dv.getUint16(1, true);
  const dC = dv.getUint16(3, true);
  const dR = dv.getUint16(5, true);
  const floorState = dv.getUint8(11);
  const tiltDeci = dv.getInt16(15, true);
  const battPct = dv.getUint8(18);
  const flags = dv.getUint8(19);
  return {
    dL, dC, dR,
    floorState,
    tiltDeg: tiltDeci / 10,
    battPct,
    flags,
  };
}

export function classifyFloorEvent(floorState) {
  return floorState === FLOOR_DROP_INDEX ? 'drop' : null;
}

/**
 * Tracks the last-known zone for one sensor so callers only get notified on
 * an actual transition, not on every ~15Hz frame. This IS the debounce
 * mechanism for zone-change speech - no timer needed, just state comparison.
 */
export class ZoneTracker {
  constructor() {
    this.lastZone = null;
  }
  update(cm) {
    const zone = zoneFor(cm);
    const changed = zone !== this.lastZone;
    this.lastZone = zone;
    return { zone, changed };
  }
}
