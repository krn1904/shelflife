'use client';

import { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { ProductForm } from '@/components/product-form';
import { lookupBarcode, type BarcodeLookup } from '@/lib/products/actions';
import { TRACKING_LABEL, effectiveTrackingMode } from '@/lib/products/tracking';

export function ScanClient({ siteId, siteName }: { siteId: string | null; siteName: string | null }) {
  const [lookup, setLookup] = useState<BarcodeLookup | null>(null);
  const [pending, startTransition] = useTransition();

  const onScan = useCallback(
    (barcode: string) => {
      startTransition(async () => {
        setLookup(await lookupBarcode(barcode, siteId));
      });
    },
    [siteId],
  );

  const onSaved = useCallback(() => {
    // Re-run the lookup rather than patching state by hand: the freshly created row is
    // now the source of truth, and this shows it exactly as a second scan would.
    if (lookup) onScan(lookup.barcode);
  }, [lookup, onScan]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">Scan</h1>
        <p className="mt-1 text-sm text-muted">
          {siteName ? `Checking against ${siteName}.` : 'No site assigned to you yet.'}
        </p>
      </div>

      <BarcodeScanner onScan={onScan} disabled={pending} />

      {pending && <p className="text-sm text-muted">Looking that up…</p>}

      {!pending && lookup?.status === 'invalid' && (
        <p className="alert alert-critical">
          <span className="font-mono tabular-nums">{lookup.barcode}</span> is not a valid product
          barcode. Try scanning again.
        </p>
      )}

      {!pending && lookup?.status === 'unknown' && (
        <section className="card p-4">
          <h2 className="text-sm font-medium">New to the catalogue</h2>
          <p className="mt-1 text-sm text-muted">
            Nobody has added this barcode yet. Fill it in once and every site gets it.
          </p>
          <div className="mt-4">
            <ProductForm barcode={lookup.barcode} onSaved={onSaved} />
          </div>
        </section>
      )}

      {!pending && lookup?.status === 'found' && (
        <section className="card p-4">
          <h2 className="text-base font-semibold">{lookup.product.name}</h2>
          <p className="text-sm text-muted">
            {[lookup.product.brand, lookup.product.size, lookup.product.category]
              .filter(Boolean)
              .join(' · ') || 'No further details recorded.'}
          </p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-muted">Tracking</dt>
              <dd className="mt-0.5 font-medium">
                {TRACKING_LABEL[
                  effectiveTrackingMode(
                    lookup.product.tracking_mode,
                    lookup.ranged?.tracking_mode_override,
                  )
                ]}
                {lookup.ranged?.tracking_mode_override && (
                  <span className="ml-1 font-normal text-muted">(set by your site)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">At {lookup.siteName ?? 'your site'}</dt>
              <dd className="mt-0.5 font-medium">
                {lookup.ranged
                  ? lookup.ranged.active
                    ? `Ranged${lookup.ranged.fixture ? ` · ${lookup.ranged.fixture}` : ''}`
                    : 'Ranged but inactive'
                  : 'Not ranged here'}
              </dd>
            </div>
          </dl>

          {!lookup.ranged && (
            <p className="mt-4 alert alert-warning">
              Your site does not stock this yet. A manager can range it from{' '}
              <Link href={`/manage/products/${lookup.product.id}`} className="underline">
                the product page
              </Link>
              .
            </p>
          )}
        </section>
      )}
    </div>
  );
}
