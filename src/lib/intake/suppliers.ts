import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { Session, SessionSite } from '@/lib/auth/session';
import type { Customer, KnownSupplier } from './docket/supplier';

type Db = Awaited<ReturnType<typeof createClient>>;

/** The organisation's active suppliers with their ABNs and confirmed docket names. */
export async function knownSuppliers(supabase: Db, orgId: string): Promise<KnownSupplier[]> {
  const [{ data: suppliers }, { data: aliases }] = await Promise.all([
    supabase.from('suppliers').select('id, name, abn').eq('org_id', orgId).eq('active', true),
    supabase.from('supplier_aliases').select('supplier_id, alias').eq('org_id', orgId),
  ]);
  return (suppliers ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    abn: s.abn,
    aliases: (aliases ?? []).filter((a) => a.supplier_id === s.id).map((a) => a.alias),
  }));
}

/** The store a docket is addressed to, so its name is never taken for the supplier's. */
export async function customerFor(supabase: Db, session: Session, site: SessionSite): Promise<Customer> {
  const { data: org } = await supabase.from('orgs').select('name').eq('id', site.orgId).maybeSingle();
  return {
    orgName: org?.name ?? '',
    siteNames: session.sites.filter((s) => s.orgId === site.orgId).map((s) => s.name),
  };
}
