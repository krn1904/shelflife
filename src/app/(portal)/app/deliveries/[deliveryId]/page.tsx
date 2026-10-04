import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { docketLines, suggestLines } from '@/lib/intake/actions';
import { IntakeClient } from './intake-client';

export default async function DeliveryPage(props: PageProps<'/app/deliveries/[deliveryId]'>) {
  // Gate the route; the delivery's own site check lives in suggestLines/closeDelivery.
  await requireSession();
  const { deliveryId } = await props.params;
  const supabase = await createClient();

  const { data: delivery } = await supabase
    .from('deliveries')
    .select('id, org_id, site_id, status, docket_number, docket_photo_path, suppliers(name)')
    .eq('id', deliveryId)
    .maybeSingle();

  if (!delivery) notFound();

  const supplierName = delivery.suppliers?.name ?? 'this supplier';

  if (delivery.status === 'closed') {
    return (
      <div>
        <Link href="/app/deliveries" className="inline-flex min-h-8 items-center text-sm font-semibold text-muted hover:text-ink">
          ← Deliveries
        </Link>
        <h1 className="mt-3 text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">{supplierName}</h1>
        <p className="mt-2 text-sm text-muted">
          This delivery is closed{delivery.docket_number ? ` (docket #${delivery.docket_number})` : ''}.
          Closed dockets are the audit trail, so they are not edited here.
        </p>
      </div>
    );
  }

  // A docket that was read decides the lines; without one, this supplier's history predicts them.
  const docket = await docketLines(delivery.id);
  const { lines } = docket ? { lines: [] } : await suggestLines(delivery.id);

  // Staff need to know whether an empty list means "first time from this supplier" or
  // "we predicted nothing" — the two call for different amounts of care.
  const historyNote =
    lines.length > 0
      ? `Pre-filled from the last few deliveries from ${supplierName}. Untick anything that did not come, and adjust the counts.`
      : `No history from ${supplierName} at this site yet, so nothing is pre-filled. Add the lines below — the next delivery will fill itself in.`;

  return (
    <div>
      <Link href="/app/deliveries" className="inline-flex min-h-8 items-center text-sm font-semibold text-muted hover:text-ink">
        ← Deliveries
      </Link>
      <h1 className="mt-3 text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">{supplierName}</h1>

      <div className="mt-6">
        <IntakeClient
          deliveryId={delivery.id}
          orgId={delivery.org_id}
          siteId={delivery.site_id}
          supplierName={supplierName}
          docketPhotoPath={delivery.docket_photo_path}
          suggested={lines}
          historyNote={historyNote}
          docket={docket}
        />
      </div>
    </div>
  );
}
