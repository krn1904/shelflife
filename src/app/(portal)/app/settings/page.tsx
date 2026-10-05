import { requireSession } from '@/lib/auth/session';
import { currentTheme } from '@/lib/theme/server';
import { ThemePicker } from '@/components/theme-picker';
import { PageHeader, SectionTitle } from '@/components/ui';

export default async function SettingsPage() {
  const session = await requireSession();
  const theme = await currentTheme();

  return (
    <div className="max-w-xl space-y-8">
      <PageHeader title="Settings" subtitle={session.fullName ?? session.email} />

      <section>
        <SectionTitle>Appearance</SectionTitle>
        <div className="card space-y-3 p-4">
          <p className="text-sm text-muted">
            System follows this device’s light or dark setting. The choice is kept on this
            device only.
          </p>
          <ThemePicker initial={theme} />
        </div>
      </section>
    </div>
  );
}
