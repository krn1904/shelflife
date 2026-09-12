import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { DocketUpload } from './docket-upload';

export default async function NewDeliveryPage() {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();

  const { data: suppliers } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('active', true)
    .order('name');

  return (
    <div>
      <Link href="/app/deliveries" className="text-sm text-neutral-500 underline">
        ← Deliveries
      </Link>

      <h1 className="mt-3 text-xl font-semibold">New delivery</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {site
          ? `Upload the delivery docket to auto-fill items, or start manually.`
          : 'You are not assigned to a site.'}
      </p>

      <div className="mt-6">
        {site ? (
          <DocketUpload siteId={site.id} suppliers={suppliers ?? []} />
        ) : (
          <p className="text-sm text-neutral-500">Ask your manager to assign you to a site.</p>
        )}
      </div>
    </div>
  );
}
