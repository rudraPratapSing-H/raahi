// Real SOS via SMS - the web-app's SOS explicitly stopped at "no SMS/contact
// integration, out of scope" since a browser can't send SMS. On a real phone
// this is genuinely achievable: open the native SMS composer pre-filled with
// a maps link built from the current GPS fix, addressed to a contact the
// user configures once (see settings screen).

import * as SMS from 'expo-sms';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentPosition } from '../outdoor/outdoorNav';

const SOS_CONTACT_KEY = 'raahi.sosContact';

export async function getSosContact(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SOS_CONTACT_KEY);
  } catch (err) {
    return null;
  }
}

export async function setSosContact(phoneNumber: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SOS_CONTACT_KEY, phoneNumber);
  } catch (err) {
    // ignore - contact just won't persist across app restarts
  }
}

export type SosSendStatus = 'sent' | 'unknown' | 'cancelled' | 'no_contact' | 'unavailable';

export async function sendSosMessage(): Promise<{ status: SosSendStatus }> {
  const contact = await getSosContact();
  if (!contact) return { status: 'no_contact' };

  const available = await SMS.isAvailableAsync();
  if (!available) return { status: 'unavailable' };

  let body = 'SOS from Raahi — I need help.';
  const position = await getCurrentPosition().catch(() => null);
  if (position) {
    const { latitude, longitude } = position.coords;
    body += ` My location: https://maps.google.com/?q=${latitude},${longitude}`;
  }

  const { result } = await SMS.sendSMSAsync([contact], body);
  // Android's SMS composer never reports a real status - 'unknown' there just
  // means "the composer ran," not "it failed," so it's treated as a
  // best-effort success, not an error.
  return { status: result === 'sent' || result === 'unknown' ? result : 'cancelled' };
}
