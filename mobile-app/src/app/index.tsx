import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Switch,
  Pressable,
  TextInput,
  Platform,
} from 'react-native';
import { CameraView } from 'expo-camera';
import { Link } from 'expo-router';

import * as ble from '../core/ble/reflexBle';
import * as zonesMod from '../core/sensors/zones';
import * as voice from '../core/voice/voiceQueue';
import * as i18n from '../core/i18n/i18n';
import * as camera from '../core/camera/camera';
import * as backend from '../core/backend/backend';
import * as voiceCommands from '../core/voice/voiceCommands';
import * as actionsMod from '../core/actions/actions';
import * as buttons from '../core/actions/buttons';
import { createLogApi } from '../core/state/log';
import { createAppState, type Ctx, type LogEntry } from '../core/state/types';
import { colors, zoneColor } from '../core/theme';

type ZoneKey = 'L' | 'F' | 'R';
type ConnKind = 'off' | 'connecting' | 'on' | 'lost';

const ZONE_SENSORS: Array<{ key: ZoneKey; sideKey: string; label: string }> = [
  { key: 'F', sideKey: 'front', label: 'FRONT' },
  { key: 'L', sideKey: 'left', label: 'LEFT' },
  { key: 'R', sideKey: 'right', label: 'RIGHT' },
];

function fmtAgo(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function HomeScreen() {
  const [connStatus, setConnStatus] = useState<{ kind: ConnKind; text: string }>({
    kind: 'off',
    text: 'Not connected',
  });
  const [zoneValues, setZoneValues] = useState<Record<ZoneKey, { cm: number; zone: string }>>({
    F: { cm: 95, zone: 'caution' },
    L: { cm: 210, zone: 'aware' },
    R: { cm: 300, zone: 'safe' },
  });
  const [sampleData, setSampleData] = useState(true);
  const [floorState, setFloorState] = useState('Unknown');
  const [tiltDeg, setTiltDeg] = useState(2.3);
  const [battPct, setBattPct] = useState(100);
  const [flags, setFlags] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState(0);
  const [, forceTick] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [sosVisible, setSosVisible] = useState(false);
  const [langCode, setLangCodeState] = useState('en');
  const [voiceListening, setVoiceListening] = useState(false);
  const [findInput, setFindInput] = useState('');

  const stateRef = useRef(createAppState());
  const trackersRef = useRef({
    F: new zonesMod.ZoneTracker(),
    L: new zonesMod.ZoneTracker(),
    R: new zonesMod.ZoneTracker(),
  });
  const lastFloorStateRef = useRef<number | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const [hz, setHz] = useState<string>('—');

  const logApi = useMemo(() => createLogApi(setLogEntries), []);

  const ctx: Ctx = useMemo(
    () => ({
      voice,
      ble,
      camera,
      backend,
      i18n,
      log: logApi,
      state: stateRef.current,
      onSOS: () => setSosVisible(true),
    }),
    [logApi]
  );

  // ctx.state / finder / actions mutate plain objects outside React state, so
  // a light periodic re-render keeps the finder card / mute chip honest.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await i18n.init();
      if (cancelled) return;
      setLangCodeState(i18n.getLang());
      const started = await voiceCommands.start(ctx);
      if (!cancelled) setVoiceListening(started);
    })();
    return () => {
      cancelled = true;
      voiceCommands.stop();
      ble.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateHz = useCallback(() => {
    const now = Date.now();
    const times = frameTimesRef.current.filter((t) => now - t < 3000);
    times.push(now);
    frameTimesRef.current = times;
    const rate = times.length > 1 ? (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000) : 0;
    setHz(rate ? rate.toFixed(1) : '—');
  }, []);

  const handleSensorFrame = useCallback(
    (dv: DataView) => {
      setSampleData(false);
      const frame = zonesMod.parseSensorFrame(dv);
      const cmByKey: Record<ZoneKey, number> = { F: frame.dC, L: frame.dL, R: frame.dR };
      const trackers = trackersRef.current;
      const nextZones: Record<ZoneKey, { cm: number; zone: string }> = { ...zoneValues };

      for (const sensor of ZONE_SENSORS) {
        const cm = cmByKey[sensor.key];
        const prevZone = trackers[sensor.key].lastZone;
        const { zone, changed } = trackers[sensor.key].update(cm);
        nextZones[sensor.key] = { cm, zone };
        if (changed && zone !== 'unknown') {
          if (zone === 'safe' && prevZone !== 'caution' && prevZone !== 'danger') continue;
          const side = i18n.t(`side.${sensor.sideKey}`);
          const textKey =
            zone === 'danger'
              ? 'hazard.danger'
              : zone === 'caution'
                ? 'hazard.caution'
                : zone === 'aware'
                  ? 'hazard.aware'
                  : 'hazard.clear';
          const priority =
            zone === 'danger'
              ? voice.PRIORITY.DANGER
              : zone === 'caution'
                ? voice.PRIORITY.CAUTION
                : zone === 'aware'
                  ? voice.PRIORITY.AWARE
                  : voice.PRIORITY.SAFE;
          voice.enqueue(i18n.t(textKey, { side }), { priority, key: `zone:${sensor.key}` });
        }
      }
      setZoneValues(nextZones);

      if (zonesMod.classifyFloorEvent(frame.floorState) === 'drop' && lastFloorStateRef.current !== zonesMod.FLOOR_DROP_INDEX) {
        voice.enqueue(i18n.t('hazard.floorDrop'), { priority: voice.PRIORITY.FLOOR_DROP, key: 'floor' });
      }
      lastFloorStateRef.current = frame.floorState;

      setFloorState(zonesMod.FLOOR_STATES[frame.floorState] ?? '—');
      setTiltDeg(frame.tiltDeg);
      setBattPct(frame.battPct);
      setFlags(frame.flags);
      setLastFrameAt(Date.now());
      updateHz();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoneValues]
  );

  const handleButtonEvent = useCallback(
    (gestureId: number) => {
      logApi.addButtonEvent(gestureId);
      buttons.dispatchGesture(gestureId, ctx);
    },
    [ctx, logApi]
  );

  const handleStatusChange = useCallback((kind: ConnKind, text: string) => {
    setConnStatus({ kind, text });
  }, []);

  const handleDisconnected = useCallback(() => {
    setConnStatus({ kind: 'lost', text: 'Disconnected' });
    setTimeout(() => setConnStatus({ kind: 'off', text: 'Not connected' }), 2500);
  }, []);

  const onConnectPress = useCallback(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSensorFrame, handleButtonEvent]);

  const onToggleVoice = useCallback(
    async (value: boolean) => {
      if (value) {
        const started = await voiceCommands.start(ctx);
        setVoiceListening(started);
      } else {
        voiceCommands.stop();
        setVoiceListening(false);
      }
    },
    [ctx]
  );

  const onChangeLang = useCallback(async (code: string) => {
    await i18n.setLang(code);
    setLangCodeState(code);
  }, []);

  const onFindPress = useCallback(() => {
    if (findInput.trim()) actionsMod.dispatch('find', ctx, { target: findInput.trim() });
  }, [ctx, findInput]);

  const flagChips: Array<{ text: string; kind: 'good' | 'warn' | 'crit' }> = [];
  flagChips.push(
    flags & 0x01 ? { text: 'Standalone (no phone link)', kind: 'warn' } : { text: 'Phone linked', kind: 'good' }
  );
  if (flags & 0x02) flagChips.push({ text: 'Left sensor covered', kind: 'crit' });
  if (flags & 0x04) flagChips.push({ text: 'Front sensor covered', kind: 'crit' });
  if (flags & 0x08) flagChips.push({ text: 'Right sensor covered', kind: 'crit' });
  if (flags & 0x40) flagChips.push({ text: 'Battery low', kind: 'warn' });

  const activeRoute = stateRef.current.activeRoute;
  const activeFind = stateRef.current.activeFind;
  const hasActiveSearch = !!(activeRoute || activeFind);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View
          style={[styles.pill, connStatus.kind === 'on' ? styles.pillOn : connStatus.kind === 'lost' ? styles.pillLost : styles.pillOff]}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Wearable status: ${connStatus.text}`}
        >
          <Text style={styles.pillText}>{connStatus.text}</Text>
        </View>
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" style={styles.settingsBtn}>
            <Text style={styles.settingsBtnText}>Settings</Text>
          </Pressable>
        </Link>
      </View>

      <Pressable
        onPress={onConnectPress}
        style={styles.primaryBtn}
        accessibilityRole="button"
        accessibilityLabel={ble.isConnected() ? 'Disconnect from wearable' : 'Connect to wearable'}
      >
        <Text style={styles.primaryBtnText}>{ble.isConnected() ? 'Disconnect' : 'Connect to wearable'}</Text>
      </Pressable>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>VOICE CONTROL</Text>
          <View style={styles.rowBetween} accessible accessibilityLabel={`Voice listening ${voiceListening ? 'on' : 'off'}`}>
            <Switch value={voiceListening} onValueChange={onToggleVoice} />
          </View>
        </View>
        <Text style={styles.dimText}>{voiceListening ? 'Listening for commands…' : 'Mic off'}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>OBSTACLE SENSORS</Text>
          {sampleData && <Text style={styles.dimText}>example data</Text>}
        </View>
        <View style={styles.zonesRow}>
          {(['L', 'F', 'R'] as ZoneKey[]).map((key) => {
            const z = zoneValues[key];
            const label = key === 'L' ? 'LEFT' : key === 'F' ? 'FRONT' : 'RIGHT';
            return (
              <View
                key={key}
                style={[styles.zoneTile, { borderTopColor: zoneColor[z.zone] }]}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${label} sensor: ${z.cm === 0xffff ? 'no reading' : `${z.cm} centimeters`}, ${z.zone}`}
              >
                <Text style={styles.zoneLabel}>{label}</Text>
                <Text style={styles.zoneValue}>{z.cm === 0xffff ? '—' : z.cm}</Text>
                <Text style={[styles.zoneState, { color: zoneColor[z.zone] }]}>{z.zone}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DEVICE STATUS</Text>
        <View style={styles.grid2}>
          <View style={styles.card}>
            <Text style={styles.cardKey}>Floor sensor</Text>
            <Text style={styles.cardValue}>{floorState}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardKey}>Tilt</Text>
            <Text style={styles.cardValue}>{tiltDeg.toFixed(1)}°</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardKey}>Battery</Text>
            <Text style={styles.cardValue}>{battPct}%</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardKey}>Last frame</Text>
            <Text style={styles.cardValue}>{lastFrameAt ? fmtAgo(Date.now() - lastFrameAt) : '—'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>FLAGS</Text>
        <View style={styles.chipsRow}>
          {flagChips.map((chip, i) => (
            <View
              key={i}
              style={[
                styles.chip,
                chip.kind === 'good' ? styles.chipGood : chip.kind === 'crit' ? styles.chipCrit : styles.chipWarn,
              ]}
            >
              <Text style={styles.chipText}>{chip.text}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>FIND A PLACE</Text>
        <View style={styles.card}>
          <Text style={styles.dimText}>
            {activeRoute
              ? `Route to "${activeRoute.targetLabel}" – step ${activeRoute.index + 1} of ${activeRoute.steps.length}`
              : activeFind
                ? `Looking for "${activeFind.target}"`
                : 'Say "find canteen" or type below'}
          </Text>
          <View style={styles.findInputRow}>
            <TextInput
              value={findInput}
              onChangeText={setFindInput}
              placeholder="e.g. canteen"
              placeholderTextColor={colors.textFaint}
              style={styles.textInput}
              accessibilityLabel="Place to find"
            />
            <Pressable onPress={onFindPress} style={styles.outlineBtn} accessibilityRole="button" accessibilityLabel="Find">
              <Text style={styles.outlineBtnText}>Find</Text>
            </Pressable>
          </View>
          {hasActiveSearch && (
            <View style={styles.findInputRow}>
              <Pressable
                onPress={() => actionsMod.dispatch('guide', ctx)}
                style={[styles.outlineBtn, styles.flex1]}
                accessibilityRole="button"
                accessibilityLabel="Guide me"
              >
                <Text style={styles.outlineBtnText}>Guide me</Text>
              </Pressable>
              <Pressable
                onPress={() => actionsMod.dispatch('cancelFind', ctx)}
                style={[styles.outlineBtn, styles.flex1]}
                accessibilityRole="button"
                accessibilityLabel="Cancel search"
              >
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {sosVisible && (
        <View style={styles.sosBanner} accessible accessibilityLabel="SOS activated">
          <Text style={styles.sosText}>SOS activated</Text>
          <Pressable onPress={() => setSosVisible(false)} accessibilityRole="button" accessibilityLabel="Dismiss SOS banner">
            <Text style={styles.sosDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>BUTTON EVENTS</Text>
          <Text style={styles.dimText}>{hz} Hz</Text>
        </View>
        <View style={styles.log}>
          {logEntries.length === 0 ? (
            <Text style={styles.logEmpty}>No events yet</Text>
          ) : (
            logEntries.map((entry) => (
              <Text key={entry.id} style={[styles.logEntry, entry.crit && styles.logEntryCrit]}>
                {entry.text} · {new Date(entry.at).toLocaleTimeString()}
              </Text>
            ))
          )}
        </View>
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          onPress={() => ble.sendCommand(ble.CMD_BUZZ_ALL).catch(() => {})}
          disabled={connStatus.kind !== 'on'}
          style={[styles.outlineBtn, styles.flex1]}
          accessibilityRole="button"
          accessibilityLabel="Test buzz all motors"
        >
          <Text style={styles.outlineBtnText}>Test buzz</Text>
        </Pressable>
        <Pressable
          onPress={() => ble.sendCommand(ble.CMD_RECALIBRATE).catch(() => {})}
          disabled={connStatus.kind !== 'on'}
          style={[styles.outlineBtn, styles.flex1]}
          accessibilityRole="button"
          accessibilityLabel="Recalibrate floor sensor"
        >
          <Text style={styles.outlineBtnText}>Recalibrate</Text>
        </Pressable>
      </View>

      <View style={styles.langRow}>
        {i18n.SUPPORTED_LANGS.map((l) => (
          <Pressable
            key={l.code}
            onPress={() => onChangeLang(l.code)}
            style={[styles.langChip, langCode === l.code && styles.langChipActive]}
            accessibilityRole="button"
            accessibilityLabel={`Switch language to ${l.label}`}
          >
            <Text style={styles.langChipText}>{l.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.note}>
        Say "find &lt;place&gt;", "repeat", "mute", "where am I", or "S O S" any time — the physical button on
        the wearable does the same five things by press pattern if speech isn't available.
      </Text>

      {/* Hidden camera - never shown, since the user doesn't need to see it. Kept
          permanently mounted so captureFrame() always has a ref to call. */}
      <CameraView
        ref={(r) => camera.attachRef(r)}
        style={styles.hiddenCamera}
        facing="back"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillOff: { backgroundColor: colors.surface2 },
  pillOn: { backgroundColor: colors.safeBg },
  pillLost: { backgroundColor: colors.dangerBg },
  pillText: { color: colors.text, fontWeight: '600', fontSize: 12 },
  settingsBtn: { padding: 8 },
  settingsBtnText: { color: colors.accent, fontWeight: '600' },
  primaryBtn: { backgroundColor: colors.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 8 },
  primaryBtnText: { color: '#04141c', fontWeight: '700', fontSize: 16 },
  section: { marginTop: 16 },
  sectionTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  dimText: { color: colors.textDim, fontSize: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zonesRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  zoneTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    padding: 10,
    alignItems: 'center',
  },
  zoneLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  zoneValue: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 4 },
  zoneState: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  card: { flexGrow: 1, flexBasis: '47%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12 },
  cardKey: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  cardValue: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 4 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface2 },
  chipGood: { backgroundColor: colors.safeBg },
  chipWarn: { backgroundColor: colors.cautionBg },
  chipCrit: { backgroundColor: colors.dangerBg },
  chipText: { color: colors.textDim, fontSize: 11 },
  findInputRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  textInput: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.text },
  outlineBtn: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  outlineBtnText: { color: colors.text, fontWeight: '600' },
  flex1: { flex: 1 },
  sosBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.dangerBg, borderRadius: 14, padding: 14, marginTop: 16 },
  sosText: { color: colors.danger, fontWeight: '700' },
  sosDismiss: { color: colors.danger, fontWeight: '700' },
  log: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 10, marginTop: 8, maxHeight: 160 },
  logEmpty: { color: colors.textFaint, textAlign: 'center', padding: 8 },
  logEntry: { color: colors.textDim, fontSize: 12, paddingVertical: 4 },
  logEntryCrit: { color: colors.danger },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  langRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  langChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  langChipActive: { borderColor: colors.accent },
  langChipText: { color: colors.text, fontWeight: '600' },
  note: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 16 },
  hiddenCamera: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
