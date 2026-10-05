import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';
import { PageHeader, SectionTitle, QuickAction } from '@/components/ui';
import { DemoJump } from '@/components/demo-jump';
import { demoEnabled } from '@/lib/demo/actions';

export default async function ShiftPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // RLS scopes all of these to what this user may see, so no explicit filter is needed.
  const [{ count: catalogue }, { data: sites }, { count: openDeliveries }, { count: openActions }] =
    await Promise.all([
      supabase.from('site_products').select('*', { count: 'exact', head: true }),
      supabase.from('sites').select('name'),
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('expiry_actions').select('*', { count: 'exact', head: true }).eq('state', 'open'),
    ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Shift"
        subtitle={`${session.fullName ?? session.email} · ${
          sites?.map((s) => s.name).join(', ') || 'no site assigned'
        }`}
        actions={
          <a href="/app/today" className="btn btn-primary">
            Today’s list
          </a>
        }
      />

      {(await demoEnabled()) && <DemoJump />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="To action today" value={openActions ?? 0} tone={openActions ? 'brand' : 'default'} hint="dated stock needing a decision" />
        <Stat label="Open deliveries" value={openDeliveries ?? 0} hint="started but not closed" />
        <Stat label="Ranged products" value={catalogue ?? 0} hint="active at your site" />
      </div>

      <div>
        <SectionTitle>Do something</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickAction href="/app/deliveries" title="Receive a delivery" hint="Work down the docket from a supplier" />
          <QuickAction href="/app/board" title="Expiry board" hint="All dated stock, and what is coming up" />
          <QuickAction href="/app/scan" title="Look up a product" hint="Scan a barcode to find or add it" />
          <QuickAction href="/app/settings" title="Settings" hint="Notifications and light or dark theme" />
        </div>
      </div>
    </div>
  );
}
