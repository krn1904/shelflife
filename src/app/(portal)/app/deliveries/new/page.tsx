import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { textractConfigured } from '@/lib/intake/docket/textract';
import { ReceiveDelivery } from './receive-delivery';

export default async function NewDeliveryPage() {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();

  const { data: suppliers } = site
    ? await supabase
      .from('suppliers')
      .select('id, name')
      .eq('org_id', site.orgId)
      .eq('active', true)
      .order('name')
    : { data: [] };

  return (
    <div>
      <Link href="/app/deliveries" className="text-sm text-muted underline">
        ← Deliveries
      </Link>

      <h1 className="mt-3 text-xl font-semibold">Receive a delivery</h1>
      <p className="mt-1 text-sm text-muted">
        {site ? `Receiving at ${site.name}.` : 'You are not assigned to a site.'}
      </p>

      <div className="mt-6">
        {site ? (
          <ReceiveDelivery
            orgId={site.orgId}
            siteId={site.id}
            suppliers={suppliers ?? []}
            textractReady={textractConfigured()}
          />
        ) : (
          <p className="text-sm text-muted">Ask your manager to assign you to a site.</p>
        )}
      </div>
    </div>
  );
}
