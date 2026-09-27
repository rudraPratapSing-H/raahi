// Camera capture for localize/hazard/find calls. Unlike the web-app's
// camera.js (which drove a hidden <video>/<canvas> pair from plain JS),
// expo-camera's takePictureAsync() is an instance method on a *mounted*
// <CameraView> ref - so this module just holds that ref, registered once by
// the screen that renders the (off-screen, since the user doesn't need to
// see it) camera view. See HomeScreen.tsx for where attachRef() is called.

import { Camera, CameraView } from 'expo-camera';

let cameraRef: CameraView | null = null;

export function attachRef(ref: CameraView | null) {
  cameraRef = ref;
}

export function isReady(): boolean {
  return !!cameraRef;
}

/**
 * Returns a raw base64 JPEG string, matching what the Gemini client expects.
 * Requests camera permission lazily on first use (not upfront on app start) -
 * the <CameraView> itself is mounted unconditionally-but-hidden from launch
 * (see HomeScreen) so there's no async race between "permission granted" and
 * "the ref exists"; it just can't produce a photo until both are true.
 */
export async function captureFrame(): Promise<string> {
  const permission = await Camera.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('camera-permission-denied');
  if (!cameraRef) throw new Error('camera-not-ready');
  const result = await cameraRef.takePictureAsync({ base64: true, quality: 0.5, skipProcessing: true });
  if (!result?.base64) throw new Error('camera-capture-failed');
  return result.base64;
}
