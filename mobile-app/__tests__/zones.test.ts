import { zoneFor, parseSensorFrame, classifyFloorEvent, ZoneTracker, FLOOR_DROP_INDEX } from '../src/core/sensors/zones';

describe('zoneFor', () => {
  it('classifies the boundary values matching the wearable firmware thresholds', () => {
    expect(zoneFor(79)).toBe('danger');
    expect(zoneFor(80)).toBe('caution');
    expect(zoneFor(149)).toBe('caution');
    expect(zoneFor(150)).toBe('aware');
    expect(zoneFor(249)).toBe('aware');
    expect(zoneFor(250)).toBe('safe');
  });

  it('treats 0xFFFF as unknown (no echo)', () => {
    expect(zoneFor(0xffff)).toBe('unknown');
  });
});

describe('ZoneTracker', () => {
  it('only reports changed=true on an actual zone transition', () => {
    const tracker = new ZoneTracker();
    expect(tracker.update(90)).toEqual({ zone: 'caution', changed: true });
    expect(tracker.update(85)).toEqual({ zone: 'caution', changed: false });
    expect(tracker.update(200)).toEqual({ zone: 'aware', changed: true });
    expect(tracker.update(200)).toEqual({ zone: 'aware', changed: false });
  });
});

describe('parseSensorFrame', () => {
  it('reads the same byte layout the wearable firmware / ReflexLink.html use', () => {
    const buf = new ArrayBuffer(20);
    const dv = new DataView(buf);
    dv.setUint16(1, 123, true);
    dv.setUint16(3, 45, true);
    dv.setUint16(5, 6789, true);
    dv.setUint8(11, FLOOR_DROP_INDEX);
    dv.setInt16(15, 47, true); // 4.7 deg
    dv.setUint8(18, 88);
    dv.setUint8(19, 0x05);

    const frame = parseSensorFrame(dv);
    expect(frame).toEqual({
      dL: 123,
      dC: 45,
      dR: 6789,
      floorState: FLOOR_DROP_INDEX,
      tiltDeg: 4.7,
      battPct: 88,
      flags: 0x05,
    });
    expect(classifyFloorEvent(frame.floorState)).toBe('drop');
    expect(classifyFloorEvent(1)).toBeNull();
  });
});
