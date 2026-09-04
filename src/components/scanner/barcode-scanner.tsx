'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { validateBarcode } from '@/lib/catalogue/barcode';

// Chrome/Android ship BarcodeDetector natively; Safari and desktop Firefox do not,
// so ZXing is loaded lazily as a fallback rather than shipped to everyone.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const SCAN_INTERVAL_MS = 250; // fast enough to feel instant, slow enough not to pin the CPU

type Status = 'idle' | 'starting' | 'scanning' | 'error';

export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (barcode: string) => void;
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [engine, setEngine] = useState<'native' | 'zxing' | null>(null);

  const handleHit = useCallback((raw: string) => {
    const result = validateBarcode(raw);
    // A failed check digit means a misread, not a new product. Keep scanning.
    if (!result.ok) return false;
    stoppedRef.current = true;
    onScan(result.normalised);
    return true;
  }, [onScan]);

  useEffect(() => {
    stoppedRef.current = false;
    let cleanupZxing: (() => void) | undefined;

    async function start() {
      setStatus('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('scanning');

        const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

        if (Ctor) {
          setEngine('native');
          const detector = new Ctor({ formats: FORMATS });
          const tick = async () => {
            if (stoppedRef.current || !videoRef.current) return;
            try {
              const hits = await detector.detect(videoRef.current);
              for (const h of hits) if (handleHit(h.rawValue)) return;
            } catch {
              // A single failed frame is normal (motion blur); keep going.
            }
            setTimeout(tick, SCAN_INTERVAL_MS);
          };
          void tick();
          return;
        }

        setEngine('zxing');
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result && !stoppedRef.current) handleHit(result.getText());
        });
        cleanupZxing = () => controls.stop();
      } catch (e) {
        setStatus('error');
        // Name the cause — "scanner failed" with no reason is undebuggable on a shift.
        const name = e instanceof DOMException ? e.name : '';
        setReason(
          name === 'NotAllowedError' ? 'Camera permission was denied.'
          : name === 'NotFoundError' ? 'No camera found on this device.'
          : name === 'NotReadableError' ? 'The camera is already in use by another app.'
          : e instanceof Error ? e.message
          : 'Could not start the camera.',
        );
      }
    }

    void start();

    return () => {
      stoppedRef.current = true;
      cleanupZxing?.();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [handleHit]);

  return (
    <div className="rounded border border-neutral-300 p-3">
      <div className="relative overflow-hidden rounded bg-black">
        <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/70" />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {status === 'starting' && 'Starting camera…'}
          {status === 'scanning' && `Point at a barcode · ${engine === 'native' ? 'native detector' : 'ZXing'}`}
          {status === 'error' && <span className="text-red-600">{reason}</span>}
        </span>
        {onClose && (
          <button type="button" onClick={onClose} className="underline">Cancel</button>
        )}
      </div>
    </div>
  );
}
