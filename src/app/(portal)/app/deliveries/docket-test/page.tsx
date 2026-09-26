import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/pagination';
import type { CatalogueItem } from '@/lib/intake/docket/parse';
import { DocketTest } from './docket-test';

/**
 * A bench for trying docket OCR on real photos. Nothing here is saved: it shows what the
 * parser would put on a delivery, and which parts of the docket it threw away and why.
 */
export default async function DocketTestPage() {
  await requireSession();
  const supabase = await createClient();

  const catalogue = await fetchAllPages<CatalogueItem>((from, to) =>
    supabase.from('products').select('id, name, barcode').order('id').range(from, to),
  );

  return (
    <div>
      <Link href="/app/deliveries" className="text-sm text-neutral-500 underline">
        ← Deliveries
      </Link>
      <h1 className="mt-3 text-xl font-semibold">Docket OCR test</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upload a photo of a supplier docket. It is read on this device and nothing is saved.
        Matching uses the {catalogue.length} products in the catalogue.
      </p>
      <div className="mt-6">
        <DocketTest catalogue={catalogue} />
      </div>
    </div>
  );
}
