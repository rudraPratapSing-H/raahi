// Web Bluetooth -> react-native-ble-plx port of the web-app's ble.js. Same
// UUIDs, same command bytes, same public interface (connect/sendCommand/
// disconnect/isConnected) so the composition layer barely changes - only the
// transport underneath does. Characteristic values are base64 here (not a
// raw ArrayBuffer like the browser gave us), decoded into the same DataView
// shape zones.ts already expects.

import { BleManager, Device, Characteristic, BleError, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { base64ToDataView, bytesToBase64 } from '../util/base64';

export const SERVICE_UUID = '6e400001-7361-6e64-6e61-7669676174ff';
export const CHAR_SENSOR = '6e400002-7361-6e64-6e61-7669676174ff';
export const CHAR_COMMAND = '6e400003-7361-6e64-6e61-7669676174ff';
export const CHAR_BUTTON = '6e400004-7361-6e64-6e61-7669676174ff';
export const DEVICE_NAME = 'PS2-Wearable';

export const CMD_BUZZ_ALL = new Uint8Array([0x01, 0x00, 0x07, 0xff]);
export const CMD_HEARTBEAT = new Uint8Array([0x02]);
export const CMD_RECALIBRATE = new Uint8Array([0x03]);

export interface BleCallbacks {
  onSensorFrame: (dv: DataView) => void;
  onButtonEvent: (gestureId: number) => void;
  onStatusChange: (kind: 'off' | 'connecting' | 'on' | 'lost', text: string) => void;
  onDisconnected: () => void;
}

const manager = Platform.OS !== 'web' ? new BleManager() : null;

let device: Device | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let activeCallbacks: BleCallbacks | null = null;

export function isSupported(): boolean {
  return Platform.OS !== 'web';
}

export function isConnected(): boolean {
  return !!device;
}

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const sdkInt = Platform.Version as number;
  const permissions =
    sdkInt >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const granted = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(granted).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

function sendHeartbeat() {
  if (!device) return;
  const b64 = bytesToBase64(CMD_HEARTBEAT);
  device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CHAR_COMMAND, b64).catch(() => {});
}

export async function sendCommand(bytes: Uint8Array): Promise<void> {
  if (!device) throw new Error('not connected');
  await device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CHAR_COMMAND, bytesToBase64(bytes));
}

function handleDisconnected() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  device = null;
  activeCallbacks?.onDisconnected();
}

export async function connect(callbacks: BleCallbacks): Promise<void> {
  activeCallbacks = callbacks;

  if (!manager) {
    callbacks.onStatusChange('off', 'Bluetooth not available on web');
    return;
  }

  const permitted = await requestBlePermissions();
  if (!permitted) {
    callbacks.onStatusChange('off', 'Bluetooth permission denied');
    return;
  }

  const btState = await manager.state();
  if (btState !== State.PoweredOn) {
    callbacks.onStatusChange('off', 'Turn on Bluetooth');
    return;
  }

  callbacks.onStatusChange('connecting', 'Scanning…');

  manager.startDeviceScan([SERVICE_UUID], null, async (error: BleError | null, scanned: Device | null) => {
    if (error) {
      callbacks.onStatusChange('lost', 'Scan failed');
      setTimeout(() => callbacks.onStatusChange('off', 'Not connected'), 2500);
      return;
    }
    if (!scanned) return;

    manager.stopDeviceScan();
    callbacks.onStatusChange('connecting', 'Connecting…');

    try {
      const connected = await scanned.connect();
      device = connected;
      connected.onDisconnected(() => handleDisconnected());

      await connected.discoverAllServicesAndCharacteristics();

      connected.monitorCharacteristicForService(SERVICE_UUID, CHAR_SENSOR, (err, characteristic) => {
        if (err || !characteristic?.value) return;
        callbacks.onSensorFrame(base64ToDataView(characteristic.value));
      });

      connected.monitorCharacteristicForService(SERVICE_UUID, CHAR_BUTTON, (err, characteristic) => {
        if (err || !characteristic?.value) return;
        const dv = base64ToDataView(characteristic.value);
        callbacks.onButtonEvent(dv.getUint8(0));
      });

      callbacks.onStatusChange('on', connected.name ?? 'Connected');

      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, 1000);
    } catch (err) {
      console.error('BLE connect failed', err);
      callbacks.onStatusChange('lost', 'Connect failed');
      setTimeout(() => callbacks.onStatusChange('off', 'Not connected'), 2500);
    }
  });
}

export function disconnect(): void {
  manager?.stopDeviceScan();
  if (device) {
    device.cancelConnection().catch(() => {});
  } else {
    handleDisconnected();
  }
}
