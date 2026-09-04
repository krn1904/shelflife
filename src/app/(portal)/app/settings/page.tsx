import { requireSession } from '@/lib/auth/session';
import { PushToggle } from '@/components/push-toggle';

export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <div>
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {session.fullName ?? session.email}
      </p>

      <div className="mt-6 max-w-xl">
        <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      </div>
    </div>
  );
}
