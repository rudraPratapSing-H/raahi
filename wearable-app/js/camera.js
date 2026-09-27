// Camera capture for localize/hazard/find calls. Lazily requests permission on
// first use (no upfront prompt on page load) and downsizes frames to keep the
// base64 payload small for latency.

const CAPTURE_WIDTH = 640;

let videoEl = null;
let canvasEl = null;
let stream = null;
let initPromise = null;

export function attachElements(video, canvas) {
  videoEl = video;
  canvasEl = canvas;
}

export async function init() {
  if (stream) return true;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: CAPTURE_WIDTH } },
      });
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
      return true;
    } catch (err) {
      console.error('camera init failed', err);
      return false;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

export function isReady() {
  return !!stream;
}

/**
 * Returns a raw base64 JPEG string (no "data:image/jpeg;base64," prefix),
 * matching what /api/localize, /api/vision/detect and /api/vision/find expect.
 */
export async function captureFrame() {
  const ok = await init();
  if (!ok) throw new Error('camera-permission-denied');

  const w = CAPTURE_WIDTH;
  const h = Math.round((videoEl.videoHeight / videoEl.videoWidth) * w) || w;
  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);
  const dataUrl = canvasEl.toDataURL('image/jpeg', 0.7);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}
