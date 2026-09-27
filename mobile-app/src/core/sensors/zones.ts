// Sensor-frame parsing + zone classification. Ported as-is from the web-app's
// zones.js (same byte offsets, same thresholds) - this is pure logic with no
// DOM/browser dependency, so it needed no changes to run on-device.

export const ZONE_DANGER_CM = 80;
export const ZONE_CAUTION_CM = 150;
export const ZONE_AWARE_CM = 250;
export const FLOOR_STATES = ['Calibrating', 'Floor', 'DROP!', 'Rising', 'Drop suspect', 'Unknown'];
export const FLOOR_DROP_INDEX = 2;

export type Zone = 'unknown' | 'danger' | 'caution' | 'aware' | 'safe';

export function zoneFor(cm: number): Zone {
  if (cm === 0xffff) return 'unknown';
  if (cm < ZONE_DANGER_CM) return 'danger';
  if (cm < ZONE_CAUTION_CM) return 'caution';
  if (cm < ZONE_AWARE_CM) return 'aware';
  return 'safe';
}

export interface SensorFrame {
  dL: number;
  dC: number;
  dR: number;
  floorState: number;
  tiltDeg: number;
  battPct: number;
  flags: number;
}

/** dv: DataView over the 20-byte sensor frame (same layout as the wearable firmware/ReflexLink.html). */
export function parseSensorFrame(dv: DataView): SensorFrame {
  const dL = dv.getUint16(1, true);
  const dC = dv.getUint16(3, true);
  const dR = dv.getUint16(5, true);
  const floorState = dv.getUint8(11);
  const tiltDeci = dv.getInt16(15, true);
  const battPct = dv.getUint8(18);
  const flags = dv.getUint8(19);
  return {
    dL,
    dC,
    dR,
    floorState,
    tiltDeg: tiltDeci / 10,
    battPct,
    flags,
  };
}

export function classifyFloorEvent(floorState: number): 'drop' | null {
  return floorState === FLOOR_DROP_INDEX ? 'drop' : null;
}

/**
 * Tracks the last-known zone for one sensor so callers only get notified on
 * an actual transition, not on every ~15Hz frame. This IS the debounce
 * mechanism for zone-change speech - no timer needed, just state comparison.
 */
export class ZoneTracker {
  lastZone: Zone | null = null;

  update(cm: number): { zone: Zone; changed: boolean } {
    const zone = zoneFor(cm);
    const changed = zone !== this.lastZone;
    this.lastZone = zone;
    return { zone, changed };
  }
}
