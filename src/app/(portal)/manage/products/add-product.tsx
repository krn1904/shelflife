'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BarcodeScanner } from '@/components/scanner/barcode-scanner';
import { lookupBarcode, createProduct, rangeProduct, type BarcodeLookup } from '@/lib/catalogue/actions';

type Step =
  | { kind: 'closed' }
  | { kind: 'entry' }
  | { kind: 'found'; lookup: BarcodeLookup }
  | { kind: 'unknown'; barcode: string };

export function AddProduct({ siteId }: { siteId: string }) {
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submitBarcode(raw: string) {
    setError(null);
    setScanning(false);
    startTransition(async () => {
      const result = await lookupBarcode(siteId, raw);
      if (!result.ok) { setError(result.error); return; }
      setStep(result.data.product
        ? { kind: 'found', lookup: result.data }
        : { kind: 'unknown', barcode: result.data.barcode });
    });
  }

  function range(productId: string) {
    startTransition(async () => {
      const result = await rangeProduct(siteId, productId);
      if (!result.ok) { setError(result.error); return; }
      setStep({ kind: 'closed' });
      router.refresh();
    });
  }

  function submitNewProduct(formData: FormData) {
    startTransition(async () => {
      const created = await createProduct(formData);
      if (!created.ok) { setError(created.error); return; }
      const ranged = await rangeProduct(siteId, created.data.id);
      if (!ranged.ok) { setError(ranged.error); return; }
      setStep({ kind: 'closed' });
      router.refresh();
    });
  }

  if (step.kind === 'closed') {
    return (
      <button
        type="button"
        onClick={() => { setError(null); setStep({ kind: 'entry' }); }}
        className="mt-4 rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
      >
        Add product
      </button>
    );
  }

  return (
    <div className="mt-4 rounded border border-neutral-300 p-4">
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {step.kind === 'entry' && (
        <div className="flex flex-col gap-3">
          {scanning ? (
            <BarcodeScanner onScan={submitBarcode} onClose={() => setScanning(false)} />
          ) : (
            <button type="button" onClick={() => setScanning(true)}
              className="rounded border border-neutral-300 px-3 py-2 text-sm">
              Scan with camera
            </button>
          )}

          <form
            action={(fd) => submitBarcode(String(fd.get('barcode') ?? ''))}
            className="flex gap-2"
          >
            <input
              name="barcode" inputMode="numeric" placeholder="Or type the barcode"
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={pending}
              className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
              Look up
            </button>
          </form>

          <button type="button" onClick={() => setStep({ kind: 'closed' })}
            className="self-start text-sm text-neutral-500 underline">
            Cancel
          </button>
        </div>
      )}

      {step.kind === 'found' && (
        <div>
          <p className="text-sm">
            <strong>{step.lookup.product!.name}</strong>{' '}
            <span className="text-neutral-500">{step.lookup.product!.brand} {step.lookup.product!.size}</span>
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-500">{step.lookup.barcode}</p>

          {step.lookup.rangedAtSite ? (
            <p className="mt-3 text-sm text-neutral-600">Already ranged at this site.</p>
          ) : (
            <button type="button" disabled={pending} onClick={() => range(step.lookup.product!.id)}
              className="mt-3 rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
              {pending ? 'Adding…' : 'Range at this site'}
            </button>
          )}
          <button type="button" onClick={() => setStep({ kind: 'closed' })}
            className="ml-3 text-sm text-neutral-500 underline">Done</button>
        </div>
      )}

      {step.kind === 'unknown' && (
        <form action={submitNewProduct} className="flex flex-col gap-3">
          <p className="text-sm">
            Not in the catalogue yet. Adding it here makes it available to every site.
          </p>
          <input type="hidden" name="barcode" value={step.barcode} />
          <p className="font-mono text-xs text-neutral-500">{step.barcode}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">Name
              <input name="name" required className="rounded border border-neutral-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Brand
              <input name="brand" className="rounded border border-neutral-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Size
              <input name="size" placeholder="600ml" className="rounded border border-neutral-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Category
              <input name="category" placeholder="Soft drinks" className="rounded border border-neutral-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Shelf life (days)
              <input name="defaultShelfLifeDays" type="number" min="1"
                className="rounded border border-neutral-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">Tracking
              <select name="trackingMode" defaultValue="batch"
                className="rounded border border-neutral-300 px-3 py-2">
                <option value="batch">Date tracked — capture expiry at intake</option>
                <option value="rotation">Rotation — daily fixture check, no dates</option>
                <option value="none">Untracked — quantity only</option>
              </select>
            </label>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={pending}
              className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
              {pending ? 'Saving…' : 'Add and range'}
            </button>
            <button type="button" onClick={() => setStep({ kind: 'closed' })}
              className="text-sm text-neutral-500 underline">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
