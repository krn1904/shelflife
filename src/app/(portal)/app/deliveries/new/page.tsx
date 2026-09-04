import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupplierPicker } from './supplier-picker';

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

      <h1 className="mt-3 text-xl font-semibold">Who is delivering?</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {site ? `Receiving at ${site.name}.` : 'You are not assigned to a site.'}
      </p>

      <div className="mt-6">
        {site ? (
          <SupplierPicker siteId={site.id} suppliers={suppliers ?? []} />
        ) : (
          <p className="text-sm text-neutral-500">Ask your manager to assign you to a site.</p>
        )}
      </div>
    </div>
  );
}
