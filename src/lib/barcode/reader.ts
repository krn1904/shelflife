/**
 * Camera barcode scanning, behind one contract so the decoder can be swapped.
 *
 * Chrome on Android ships BarcodeDetector natively — it decodes on the GPU and costs
 * nothing to ship. Everywhere else (iOS Safari, desktop Firefox) falls back to
 * @zxing/browser, which is imported lazily so its WASM decoder never reaches a device
 * that already has a native one.
 *
 * Failures are returned as a typed reason rather than thrown: the caller needs to tell
 * "you denied the camera" apart from "this browser can't scan" to show the right thing.
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const SCAN_INTERVAL_MS = 200;      // how often the native path samples a video frame
const DUPLICATE_WINDOW_MS = 1500;  // suppress repeats while a code stays in frame

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

declare global {
  var BarcodeDetector: BarcodeDetectorCtor | undefined;
}

export type ReaderKind = 'native' | 'zxing';

export type StartResult =
  | { ok: true; kind: ReaderKind }
  | { ok: false; reason: ScanFailure };

export type ScanFailure =
  | 'camera-denied'
  | 'camera-not-found'
  | 'camera-unsupported'
  | 'decoder-failed';

export const SCAN_FAILURE_MESSAGE: Record<ScanFailure, string> = {
  'camera-denied': 'Camera access was blocked. Allow it in your browser settings, or type the barcode below.',
  'camera-not-found': 'No camera found on this device. Type the barcode below instead.',
  'camera-unsupported': 'This browser cannot open a camera. Type the barcode below instead.',
  'decoder-failed': 'The scanner could not start. Type the barcode below instead.',
};

export type BarcodeReader = {
  start(video: HTMLVideoElement, onCode: (code: string) => void): Promise<StartResult>;
  stop(): void;
};

function cameraFailure(error: unknown): ScanFailure {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'camera-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'camera-not-found';
  return 'decoder-failed';
}

export function createBarcodeReader(): BarcodeReader {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let zxingControls: { stop(): void } | null = null;
  let stopped = false;
  let lastCode = '';
  let lastAt = 0;

  function release() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (zxingControls) {
      zxingControls.stop();
      zxingControls = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  // A camera reports the same barcode on every frame it stays in view. Collapsing
  // that here means the caller sees one scan per physical presentation of the item.
  function emit(code: string, onCode: (code: string) => void) {
    const now = Date.now();
    if (code === lastCode && now - lastAt < DUPLICATE_WINDOW_MS) return;
    lastCode = code;
    lastAt = now;
    onCode(code);
  }

  async function openCamera(video: HTMLVideoElement): Promise<ScanFailure | null> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (error) {
      return cameraFailure(error);
    }
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', 'true'); // iOS refuses to play inline without it
    await video.play().catch(() => {});
    return null;
  }

  async function startNative(
    video: HTMLVideoElement,
    onCode: (code: string) => void,
  ): Promise<StartResult> {
    let detector: BarcodeDetectorLike;
    try {
      detector = new globalThis.BarcodeDetector!({ formats: FORMATS });
    } catch {
      // Some builds expose the constructor but reject these formats.
      return { ok: false, reason: 'decoder-failed' };
    }

    const failure = await openCamera(video);
    if (failure) return { ok: false, reason: failure };
    // stop() may have been called while the camera was opening, when it had nothing to
    // release yet. Without this the stream and the sampling timer would outlive the scanner.
    if (stopped) {
      release();
      return { ok: true, kind: 'native' };
    }

    timer = setInterval(async () => {
      if (stopped || video.readyState < 2) return;
      try {
        const found = await detector.detect(video);
        if (found.length > 0) emit(found[0].rawValue, onCode);
      } catch {
        // One dropped frame is not worth surfacing — the next tick retries.
      }
    }, SCAN_INTERVAL_MS);

    return { ok: true, kind: 'native' };
  }

  async function startZxing(
    video: HTMLVideoElement,
    onCode: (code: string) => void,
  ): Promise<StartResult> {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      zxingControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (result) emit(result.getText(), onCode);
      });
      // stop() may have been called while the decoder was still loading.
      if (stopped) {
        zxingControls.stop();
        zxingControls = null;
      }
      return { ok: true, kind: 'zxing' };
    } catch (error) {
      return { ok: false, reason: cameraFailure(error) };
    }
  }

  return {
    async start(video, onCode) {
      stopped = false;
      if (!navigator.mediaDevices?.getUserMedia) {
        return { ok: false, reason: 'camera-unsupported' };
      }

      if (globalThis.BarcodeDetector) {
        const native = await startNative(video, onCode);
        if (native.ok) return native;
        // A denied camera will be denied for zxing too, so don't ask twice.
        if (native.reason !== 'decoder-failed') return native;
        this.stop();
        stopped = false;
      }

      return startZxing(video, onCode);
    },

    stop() {
      stopped = true;
      release();
    },
  };
}
