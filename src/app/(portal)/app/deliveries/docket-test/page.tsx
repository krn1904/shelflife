import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/pagination';
import type { CatalogueItem } from '@/lib/intake/docket/parse';
import { DocketTest } from './docket-test';
import { SavedScans } from './saved-scans';

/**
 * A bench for docket OCR on real photos: read a docket, choose its product table, date
 * each line and save it as a docket scan. Scans are kept apart from deliveries until
 * their lines can be matched to catalogue products.
 */
export default async function DocketTestPage() {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();

  const catalogue = await fetchAllPages<CatalogueItem>((from, to) =>
    supabase.from('products').select('id, name, barcode').order('id').range(from, to),
  );

  return (
    <div>
      <Link href="/app/deliveries" className="text-sm text-muted underline">
        ← Deliveries
      </Link>
      <h1 className="mt-3 text-xl font-semibold">Docket OCR test</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a photo of a supplier docket, choose the table that lists the products, add
        expiry dates and save it. The free OCR option matches against the {catalogue.length} catalogue products.
      </p>
      <div className="mt-6">
        <DocketTest catalogue={catalogue} />
      </div>
      {site && (
        <div className="mt-10">
          <SavedScans siteId={site.id} />
        </div>
      )}
    </div>
  );
}
