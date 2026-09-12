'use client';

import { useRef, useState, useTransition } from 'react';
import { createWorker } from 'tesseract.js';
import { parseDocketText, type DocketParseResult, type ParsedLine } from '@/lib/intake/parse-docket';
import { startDeliveryWithLines, type IntakeState } from '@/lib/intake/actions';

type Step = 'upload' | 'processing' | 'review' | 'expiry';

type DraftLine = ParsedLine & {
  ticked: boolean;
  expiry: string;
};

export function DocketUpload({
  siteId,
  suppliers,
}: {
  siteId: string;
  suppliers: { id: string; name: string }[];
}) {
  const [step, setStep] = useState<Step>('upload');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<DocketParseResult | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, startSubmit] = useTransition();
  const [submitState, setSubmitState] = useState<IntakeState>({ status: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  async function processImage(file: File) {
    setError(null);
    setStep('processing');

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file.');
      setStep('upload');
      return;
    }

    try {
      setProgress('Loading OCR engine…');
      const worker = await createWorker('eng');

      setProgress('Reading docket…');
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      if (!text.trim()) {
        setError('Could not read any text from the image. Try a clearer photo.');
        setStep('upload');
        return;
      }

      setProgress('Matching products…');
      const result = await parseDocketText(text);
      setParseResult(result);

      if (result.supplierId) {
        setSelectedSupplier(result.supplierId);
      }

      setLines(
        result.lines.map((l) => ({
          ...l,
          ticked: true,
          expiry: '',
        })),
      );

      setStep('review');
    } catch (err) {
      setError(`OCR failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setStep('upload');
    }
  }

  function updateLine(productId: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function proceedToExpiry() {
    const active = lines.filter((l) => l.ticked);
    if (active.length === 0) {
      setError('Select at least one product.');
      return;
    }
    if (!selectedSupplier) {
      setError('Select a supplier.');
      return;
    }
    setError(null);
    setStep('expiry');
  }

  function handleSubmit() {
    const active = lines.filter((l) => l.ticked);
    if (!selectedSupplier) return;

    const formData = new FormData();
    formData.set('site_id', siteId);
    formData.set('supplier_id', selectedSupplier);
    formData.set('lines', JSON.stringify(
      active.map((l) => ({
        product_id: l.productId,
        qty_received: l.qty,
        expiry_date: l.expiry || null,
        confirmed: !!l.expiry,
      })),
    ));

    startSubmit(async () => {
      const result = await startDeliveryWithLines({ status: 'idle' }, formData);
      setSubmitState(result);
    });
  }

  if (step === 'upload') {
    return (
      <div className="space-y-6">
        <div className="rounded border-2 border-dashed border-neutral-300 p-8 text-center">
          <p className="text-sm font-medium">Upload or photograph the delivery docket</p>
          <p className="mt-1 text-xs text-neutral-500">
            We'll read the supplier and items automatically
          </p>
          <label className="mt-4 inline-block cursor-pointer rounded bg-neutral-900 px-6 py-3 text-sm font-medium text-white">
            Choose image
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void processImage(file);
              }}
              className="sr-only"
            />
          </label>
        </div>

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (step === 'processing') {
    return (
      <div className="rounded border border-neutral-200 p-8 text-center">
        <div className="mx-auto size-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" />
        <p className="mt-4 text-sm font-medium">{progress}</p>
        <p className="mt-1 text-xs text-neutral-500">This may take a few seconds</p>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Supplier
          </h2>
          {parseResult?.supplierName && (
            <p className="mt-1 text-xs text-green-700">
              Detected: {parseResult.supplierName}
            </p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {suppliers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSupplier(s.id)}
                className={`rounded border px-4 py-3 text-left text-sm font-medium ${
                  selectedSupplier === s.id
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Items found ({lines.length})
          </h2>
          {lines.length === 0 && (
            <p className="mt-2 text-sm text-neutral-500">
              No products could be matched from the docket. Try a clearer photo or start a manual delivery.
            </p>
          )}
          <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
            {lines.map((line) => (
              <li key={line.productId} className={`px-4 py-3 ${line.ticked ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={line.ticked}
                    onChange={(e) => updateLine(line.productId, { ticked: e.target.checked })}
                    className="size-5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{line.name}</p>
                    <p className="text-xs text-neutral-500">
                      {[line.brand, line.size].filter(Boolean).join(' · ')}
                      {line.confidence < 70 && (
                        <span className="ml-2 text-amber-600">Low confidence match</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateLine(line.productId, { qty: Math.max(1, line.qty - 1) })}
                      className="size-8 rounded border border-neutral-300 text-lg leading-none"
                    >
                      −
                    </button>
                    <input
                      value={line.qty}
                      onChange={(e) =>
                        updateLine(line.productId, { qty: Math.max(1, Number(e.target.value) || 1) })
                      }
                      inputMode="numeric"
                      className="w-14 rounded border border-neutral-300 px-2 py-1 text-center text-sm tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => updateLine(line.productId, { qty: line.qty + 1 })}
                      className="size-8 rounded border border-neutral-300 text-lg leading-none"
                    >
                      +
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={proceedToExpiry}
            disabled={lines.filter((l) => l.ticked).length === 0 || !selectedSupplier}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Next: Enter expiry dates
          </button>
          <button
            type="button"
            onClick={() => { setStep('upload'); setError(null); }}
            className="rounded border border-neutral-300 px-4 py-2 text-sm"
          >
            Re-scan
          </button>
        </div>
      </div>
    );
  }

  // Step: expiry — enter expiry date per product
  const activeLines = lines.filter((l) => l.ticked);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Enter expiry for each product
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Check the packaging — items from the same supplier often share an expiry date.
        </p>

        <ul className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-200">
          {activeLines.map((line, index) => (
            <li key={line.productId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{line.name}</p>
                  <p className="text-xs text-neutral-500">
                    {[line.brand, line.size].filter(Boolean).join(' · ')} · Qty: {line.qty}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={line.expiry}
                    onChange={(e) => updateLine(line.productId, { expiry: e.target.value })}
                    className="rounded border border-neutral-300 px-3 py-2 text-sm"
                  />
                  {index > 0 && activeLines[index - 1].expiry && (
                    <button
                      type="button"
                      onClick={() =>
                        updateLine(line.productId, { expiry: activeLines[index - 1].expiry })
                      }
                      className="whitespace-nowrap text-xs text-neutral-500 underline"
                    >
                      Same as above
                    </button>
                  )}
                </div>
              </div>
              {line.expiry && (
                <p className="mt-1 text-xs text-green-700">Expiry set</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {submitState.status === 'error' && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {submitState.message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save delivery'}
        </button>
        <button
          type="button"
          onClick={() => { setStep('review'); setError(null); }}
          className="rounded border border-neutral-300 px-4 py-2 text-sm"
        >
          Back
        </button>
      </div>
    </div>
  );
}
