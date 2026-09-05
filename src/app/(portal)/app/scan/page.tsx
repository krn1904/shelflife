import { activeSite, requireSession } from '@/lib/auth/session';
import { ScanClient } from './scan-client';

export default async function ScanPage() {
  const session = await requireSession();
  const site = activeSite(session);

  return <ScanClient siteId={site?.id ?? null} siteName={site?.name ?? null} />;
}
