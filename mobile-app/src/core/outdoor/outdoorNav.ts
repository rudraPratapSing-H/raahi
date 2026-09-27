// Outdoor GPS+compass navigation - new capability, no web-app equivalent
// (browsers on a phone technically have geolocation, but pairing it with a
// dedicated wearable for indoor obstacle sensing plus real compass heading
// is squarely a "real phone app" feature). Plain-JS haversine distance +
// bearing math against a saved waypoint; no external routing service.

import * as Location from 'expo-location';
import { enqueue, PRIORITY } from '../voice/voiceQueue';
import { t } from '../i18n/i18n';

export interface Waypoint {
  name: string;
  latitude: number;
  longitude: number;
}

export type RelativeDirection = 'left' | 'slightly_left' | 'ahead' | 'slightly_right' | 'right' | 'behind';

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Bearing-to-target minus current heading, bucketed into a spoken-friendly direction. */
export function relativeDirection(bearingToTarget: number, currentHeading: number): RelativeDirection {
  const diff = (((bearingToTarget - currentHeading + 540) % 360) - 180);
  const abs = Math.abs(diff);
  if (abs <= 20) return 'ahead';
  if (abs <= 70) return diff < 0 ? 'slightly_left' : 'slightly_right';
  if (abs <= 135) return diff < 0 ? 'left' : 'right';
  return 'behind';
}

type DistanceBucket = 'far' | 'mid' | 'near' | 'arrived';
const ARRIVAL_RADIUS_M = 8;

function distanceBucket(m: number): DistanceBucket {
  if (m < ARRIVAL_RADIUS_M) return 'arrived';
  if (m < 15) return 'near';
  if (m < 50) return 'mid';
  return 'far';
}

let positionSub: Location.LocationSubscription | null = null;
let headingSub: Location.LocationSubscription | null = null;
let lastHeading = 0;
let lastAnnouncedDirection: RelativeDirection | null = null;
let lastAnnouncedBucket: DistanceBucket | null = null;
let target: Waypoint | null = null;

function handlePosition(loc: Location.LocationObject) {
  if (!target) return;
  const { latitude, longitude } = loc.coords;
  const distance = haversineDistanceMeters(latitude, longitude, target.latitude, target.longitude);
  const bucket = distanceBucket(distance);

  if (bucket === 'arrived') {
    enqueue(t('outdoor.arrived', { name: target.name }), { priority: PRIORITY.INFO });
    stopOutdoorGuidance();
    return;
  }

  const bearing = bearingDegrees(latitude, longitude, target.latitude, target.longitude);
  const direction = relativeDirection(bearing, lastHeading);
  const changed = direction !== lastAnnouncedDirection || bucket !== lastAnnouncedBucket;

  if (changed) {
    lastAnnouncedDirection = direction;
    lastAnnouncedBucket = bucket;
    enqueue(
      t('outdoor.guidance', {
        name: target.name,
        direction: t(`direction.${direction}`),
        distance: String(Math.round(distance)),
      }),
      { priority: PRIORITY.INFO, key: 'outdoor' }
    );
  }
}

/** Starts watching GPS+compass and speaking directional guidance toward `waypoint`. */
export async function startOutdoorGuidance(waypoint: Waypoint): Promise<boolean> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return false;

  stopOutdoorGuidance();
  target = waypoint;
  lastAnnouncedDirection = null;
  lastAnnouncedBucket = null;

  headingSub = await Location.watchHeadingAsync((h) => {
    lastHeading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
  });
  positionSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 3000 },
    handlePosition
  );
  return true;
}

export function stopOutdoorGuidance() {
  positionSub?.remove();
  headingSub?.remove();
  positionSub = null;
  headingSub = null;
  target = null;
}

export function isGuiding(): boolean {
  return !!target;
}

export async function getCurrentPosition(): Promise<Location.LocationObject | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}
