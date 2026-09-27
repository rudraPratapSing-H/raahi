// Web Bluetooth link to the Reflex wearable. Ported as-is from the ReflexLink.html
// prototype: same UUIDs, same GATT flow, same command bytes. Only the surrounding
// code changed (module exports + a callbacks object instead of a top-level IIFE).

export const SERVICE_UUID = '6e400001-7361-6e64-6e61-7669676174ff';
export const CHAR_SENSOR = '6e400002-7361-6e64-6e61-7669676174ff';
export const CHAR_COMMAND = '6e400003-7361-6e64-6e61-7669676174ff';
export const CHAR_BUTTON = '6e400004-7361-6e64-6e61-7669676174ff';
export const DEVICE_NAME = 'PS2-Wearable';

export const CMD_BUZZ_ALL = new Uint8Array([0x01, 0x00, 0x07, 0xFF]);
export const CMD_HEARTBEAT = new Uint8Array([0x02]);
export const CMD_RECALIBRATE = new Uint8Array([0x03]);

let device = null;
let server = null;
let sensorChar = null;
let cmdChar = null;
let buttonChar = null;
let heartbeatTimer = null;
let activeCallbacks = null;

export function isSupported() {
  return !!navigator.bluetooth;
}

export function isConnected() {
  return !!(device && device.gatt && device.gatt.connected);
}

function sendHeartbeat() {
  if (!cmdChar) return;
  cmdChar.writeValueWithoutResponse(CMD_HEARTBEAT).catch(() => {});
}

export function sendCommand(bytes) {
  if (!cmdChar) return Promise.reject(new Error('not connected'));
  return cmdChar.writeValueWithoutResponse(bytes);
}

function handleDisconnected() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (activeCallbacks && activeCallbacks.onDisconnected) activeCallbacks.onDisconnected();
}

/**
 * callbacks = { onSensorFrame(dataView), onButtonEvent(gestureId), onStatusChange(kind, text), onDisconnected() }
 */
export async function connect(callbacks) {
  activeCallbacks = callbacks;
  if (!navigator.bluetooth) {
    callbacks.onStatusChange('off', 'Not connected');
    return;
  }
  try {
    callbacks.onStatusChange('connecting', 'Scanning…');
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    device.addEventListener('gattserverdisconnected', handleDisconnected);

    callbacks.onStatusChange('connecting', 'Connecting…');
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);

    sensorChar = await service.getCharacteristic(CHAR_SENSOR);
    cmdChar = await service.getCharacteristic(CHAR_COMMAND);
    buttonChar = await service.getCharacteristic(CHAR_BUTTON);

    await sensorChar.startNotifications();
    sensorChar.addEventListener('characteristicvaluechanged', (e) => {
      callbacks.onSensorFrame(e.target.value);
    });

    await buttonChar.startNotifications();
    buttonChar.addEventListener('characteristicvaluechanged', (e) => {
      callbacks.onButtonEvent(e.target.value.getUint8(0));
    });

    callbacks.onStatusChange('on', device.name || 'Connected');

    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, 1000);
  } catch (err) {
    console.error(err);
    callbacks.onStatusChange('off', 'Not connected');
    if (err && err.name !== 'NotFoundError') {
      callbacks.onStatusChange('lost', 'Connect failed');
      setTimeout(() => callbacks.onStatusChange('off', 'Not connected'), 2500);
    }
  }
}

export function disconnect() {
  if (device && device.gatt && device.gatt.connected) {
    device.gatt.disconnect();
  } else {
    handleDisconnected();
  }
}
