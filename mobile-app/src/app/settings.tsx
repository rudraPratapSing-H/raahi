import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert } from 'react-native';

import { getSosContact, setSosContact } from '../core/safety/sos';
import { getCurrentPosition } from '../core/outdoor/outdoorNav';
import { getWaypoints, addWaypoint, removeWaypoint } from '../core/outdoor/waypointStore';
import type { Waypoint } from '../core/outdoor/outdoorNav';
import { colors } from '../core/theme';

export default function SettingsScreen() {
  const [contact, setContact] = useState('');
  const [waypointName, setWaypointName] = useState('');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [savingWaypoint, setSavingWaypoint] = useState(false);
  const [status, setStatus] = useState('');

  const refreshWaypoints = useCallback(async () => {
    setWaypoints(await getWaypoints());
  }, []);

  useEffect(() => {
    (async () => {
      setContact((await getSosContact()) ?? '');
      await refreshWaypoints();
    })();
  }, [refreshWaypoints]);

  const onSaveContact = useCallback(async () => {
    await setSosContact(contact.trim());
    setStatus('SOS contact saved');
  }, [contact]);

  const onSaveWaypoint = useCallback(async () => {
    const name = waypointName.trim();
    if (!name) return;
    setSavingWaypoint(true);
    try {
      const position = await getCurrentPosition();
      if (!position) {
        Alert.alert('Location permission needed', 'Grant location access to save your current spot as a waypoint.');
        return;
      }
      await addWaypoint({ name, latitude: position.coords.latitude, longitude: position.coords.longitude });
      setWaypointName('');
      await refreshWaypoints();
      setStatus(`Saved "${name}"`);
    } finally {
      setSavingWaypoint(false);
    }
  }, [waypointName, refreshWaypoints]);

  const onRemoveWaypoint = useCallback(
    async (name: string) => {
      await removeWaypoint(name);
      await refreshWaypoints();
    },
    [refreshWaypoints]
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>SOS CONTACT</Text>
      <Text style={styles.dimText}>
        Saying "S O S" or triple-pressing the wearable button sends this number a text with your current location.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={contact}
          onChangeText={setContact}
          placeholder="Phone number"
          placeholderTextColor={colors.textFaint}
          keyboardType="phone-pad"
          style={styles.input}
          accessibilityLabel="SOS contact phone number"
        />
        <Pressable onPress={onSaveContact} style={styles.btn} accessibilityRole="button" accessibilityLabel="Save SOS contact">
          <Text style={styles.btnText}>Save</Text>
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>OUTDOOR WAYPOINTS</Text>
      <Text style={styles.dimText}>
        graph.json only knows indoor rooms (built from photos). To say "find the bus stop" outdoors, stand there once
        and save it here - Raahi will then guide you back with GPS and compass.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={waypointName}
          onChangeText={setWaypointName}
          placeholder="Name this spot (e.g. bus stop)"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel="Waypoint name"
        />
        <Pressable
          onPress={onSaveWaypoint}
          disabled={savingWaypoint}
          style={styles.btn}
          accessibilityRole="button"
          accessibilityLabel="Save current location as this waypoint"
        >
          <Text style={styles.btnText}>{savingWaypoint ? 'Saving…' : 'Save here'}</Text>
        </Pressable>
      </View>

      {waypoints.length === 0 ? (
        <Text style={styles.dimText}>No waypoints saved yet.</Text>
      ) : (
        waypoints.map((w) => (
          <View key={w.name} style={styles.waypointRow}>
            <Text style={styles.waypointText}>
              {w.name} ({w.latitude.toFixed(5)}, {w.longitude.toFixed(5)})
            </Text>
            <Pressable
              onPress={() => onRemoveWaypoint(w.name)}
              accessibilityRole="button"
              accessibilityLabel={`Remove waypoint ${w.name}`}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        ))
      )}

      {!!status && <Text style={styles.status}>{status}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  sectionTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  sectionSpacing: { marginTop: 24 },
  dimText: { color: colors.textDim, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.text },
  btn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  btnText: { color: '#04141c', fontWeight: '700' },
  waypointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  waypointText: { color: colors.text, fontSize: 13, flex: 1 },
  removeText: { color: colors.danger, fontWeight: '600' },
  status: { color: colors.safe, marginTop: 12 },
});
