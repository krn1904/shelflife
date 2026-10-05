import Link from 'next/link';
import { activeSite, requireRole, roleAtLeast } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { firstParam } from '@/lib/search-params';
import { PageHeader } from '@/components/ui';
import { atSite } from '@/lib/deliveries/review';
import { lookAlikes, supplierOrder } from '@/lib/suppliers/upkeep';
import { MergeForm, SupplierForm } from './supplier-forms';

const ALIASES_SHOWN = 3; // the rest are counted, not listed

/**
 * The organisation's suppliers, for tidying up what staff created from dockets: rename,
 * switch off, and (owners) merge duplicates. Delivery counts follow the caller's own sites.
 */
export default async function SuppliersPage(props: PageProps<'/manage/suppliers'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const supabase = await createClient();

  if (!site) return <PageHeader title="Suppliers" subtitle="No site assigned" />;

  const [{ data: suppliers }, { data: aliases }, { data: activity }] = await Promise.all([
    supabase.from('suppliers').select('id, name, abn, active').eq('org_id', site.orgId),
    supabase.from('supplier_aliases').select('supplier_id, alias').eq('org_id', site.orgId).order('alias'),
    supabase.rpc('supplier_activity', { p_org_id: site.orgId }),
  ]);

  const all = supplierOrder(suppliers ?? []);
  const usage = new Map((activity ?? []).map((a) => [a.supplier_id, a]));
  const canMerge = roleAtLeast(session.primaryRole, 'owner');
  const mergedInto = all.find((s) => s.id === firstParam(params.merged));
  const moved = Number(firstParam(params.moved) ?? 0);
  const oneSite = session.memberships.some((m) => m.orgId === site.orgId && m.siteId !== null) && !canMerge;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manage/deliveries" className="text-sm text-muted hover:text-ink">← Deliveries</Link>
        <div className="mt-3">
          <PageHeader title="Suppliers" subtitle="Who delivers to your organisation, as staff added them from dockets." />
        </div>
        <p className="mt-2 text-sm text-muted">
          Renaming keeps the old name recognised on dockets. {canMerge
            ? 'Merging moves one supplier\'s deliveries onto another and removes it.'
            : 'Duplicates can be merged by an owner.'}
          {oneSite && ` Delivery counts are for ${site.name}.`}
        </p>
      </div>

      {mergedInto && (
        <p role="status" className="alert alert-good">
          Merged into {mergedInto.name}: {moved} {moved === 1 ? 'delivery' : 'deliveries'} moved.
        </p>
      )}

      <ul className="space-y-3">
        {all.map((s) => {
          const used = usage.get(s.id);
          const names = (aliases ?? []).filter((a) => a.supplier_id === s.id).map((a) => a.alias);
          const alike = lookAlikes(s, all);
          return (
            <li key={s.id} className="card p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">{s.name}</span>
                {s.abn && <span className="font-mono text-xs text-muted">ABN {s.abn}</span>}
                {!s.active && <span className="badge badge-neutral">switched off</span>}
                <span className="ml-auto text-xs text-muted">
                  {used ? `${used.deliveries} ${Number(used.deliveries) === 1 ? 'delivery' : 'deliveries'} · last ${atSite(used.last_delivered_at, site.timeZone, false)}` : 'No deliveries'}
                </span>
              </div>
              {names.length > 0 && (
                <p className="mt-1 text-xs text-muted">
                  Also recognised as {names.slice(0, ALIASES_SHOWN).map((n) => `“${n}”`).join(', ')}
                  {names.length > ALIASES_SHOWN && ` and ${names.length - ALIASES_SHOWN} more`}
                </p>
              )}
              {alike.length > 0 && (
                <p className="mt-1 text-xs text-warning">Looks like {alike.map((a) => a.name).join(', ')}: the same business?</p>
              )}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium text-brand-text">Edit</summary>
                <div className="mt-3 space-y-5">
                  <SupplierForm supplier={s} />
                  {canMerge && (
                    <div className="border-t border-line pt-4">
                      <MergeForm supplier={s} others={all.filter((o) => o.id !== s.id)} suggested={alike[0]?.id ?? null} />
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        })}
        {all.length === 0 && (
          <li className="card px-4 py-6 text-center text-sm text-muted">No suppliers yet. Staff add them when they receive a docket.</li>
        )}
      </ul>
    </div>
  );
}
