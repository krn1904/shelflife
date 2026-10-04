'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createBarcodeReader,
  SCAN_FAILURE_MESSAGE,
  type BarcodeReader,
  type ReaderKind,
  type ScanFailure,
} from '@/lib/barcode/reader';
import { isValidGtin, normaliseBarcode } from '@/lib/barcode/gtin';

const KIND_NOTE: Record<ReaderKind, string> = {
  native: 'Using this phone’s built-in scanner.',
  zxing: 'Using the fallback scanner — hold the barcode steady.',
};

/**
 * Camera scanning with a typed keyboard as a permanent equal, not a hidden fallback.
 * A servo store room has bad light and cracked phone lenses; the manual field is
 * often genuinely faster, and it is the only path on a desktop.
 *
 * The camera is never opened on mount — a permission prompt nobody asked for is the
 * fastest way to get the permission denied for good.
 */
export function BarcodeScanner({
  onScan,
  disabled = false,
}: {
  onScan: (barcode: string) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BarcodeReader | null>(null);
  const [kind, setKind] = useState<ReaderKind | null>(null);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      readerRef.current?.stop();
      readerRef.current = null;
    };
  }, []);

  async function startCamera() {
    if (!videoRef.current || readerRef.current) return;
    setFailure(null);

    const reader = createBarcodeReader();
    readerRef.current = reader;

    const result = await reader.start(videoRef.current, onScan);
    if (result.ok) {
      setKind(result.kind);
    } else {
      setFailure(result.reason);
      reader.stop();
      readerRef.current = null;
    }
  }

  function stopCamera() {
    readerRef.current?.stop();
    readerRef.current = null;
    setKind(null);
  }

  function submitTyped(event: React.FormEvent) {
    event.preventDefault();
    const barcode = normaliseBarcode(typed);
    if (!isValidGtin(barcode)) {
      setTypedError('That barcode failed its check digit. Re-read the digits under the bars.');
      return;
    }
    setTypedError(null);
    setTyped('');
    onScan(barcode);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[0.875rem] border border-line bg-black">
        <video
          ref={videoRef}
          className={`aspect-[4/3] w-full object-cover ${kind ? '' : 'hidden'}`}
          playsInline
          muted
        />
        {!kind && (
          <div className="flex aspect-[4/3] w-full items-center justify-center">
            <button
              type="button"
              onClick={startCamera}
              disabled={disabled}
              className="btn btn-primary"
            >
              Start camera
            </button>
          </div>
        )}
      </div>

      {kind && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{KIND_NOTE[kind]}</span>
          <button type="button" onClick={stopCamera} className="underline">
            Stop camera
          </button>
        </div>
      )}

      {failure && (
        <p className="alert alert-warning">
          {SCAN_FAILURE_MESSAGE[failure]}
        </p>
      )}

      <form onSubmit={submitTyped} className="space-y-1">
        <label htmlFor="typed-barcode" className="block text-sm font-medium">
          Or type the barcode
        </label>
        <div className="flex gap-2">
          <input
            id="typed-barcode"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="9300675024235"
            className="w-full field tabular-nums"
          />
          <button
            type="submit"
            disabled={disabled || typed.trim() === ''}
            className="btn btn-primary"
          >
            Look up
          </button>
        </div>
        {typedError && <p className="text-sm text-critical-ink">{typedError}</p>}
      </form>
    </div>
  );
}
