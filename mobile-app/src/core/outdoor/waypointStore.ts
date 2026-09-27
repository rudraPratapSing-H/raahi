// Saved outdoor waypoints (name + GPS coordinate), the outdoor counterpart of
// graph.json's indoor nodes. graph.json has no coordinates (it's built from
// image embeddings, not GPS), so outdoor destinations are a separate small
// list the user builds by standing somewhere and saving it - see the
// settings screen's "save current location" action.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Waypoint } from './outdoorNav';

const STORAGE_KEY = 'raahi.outdoorWaypoints';

export async function getWaypoints(): Promise<Waypoint[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Waypoint[]) : [];
  } catch (err) {
    return [];
  }
}

export async function addWaypoint(waypoint: Waypoint): Promise<void> {
  const existing = await getWaypoints();
  const withoutDuplicate = existing.filter((w) => w.name.toLowerCase() !== waypoint.name.toLowerCase());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...withoutDuplicate, waypoint]));
}

export async function removeWaypoint(name: string): Promise<void> {
  const existing = await getWaypoints();
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(existing.filter((w) => w.name.toLowerCase() !== name.toLowerCase()))
  );
}

export async function findWaypointByFuzzyName(target: string): Promise<Waypoint | null> {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  const waypoints = await getWaypoints();
  return (
    waypoints.find((w) => {
      const name = w.name.toLowerCase();
      return name.includes(normalized) || normalized.includes(name);
    }) ?? null
  );
}
