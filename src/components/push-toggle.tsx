'use client';

import { useEffect, useState } from 'react';
import { removePushSubscription, savePushSubscription } from '@/lib/push/actions';

type State = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on' | 'working';

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes.
 *
 * Backed by an explicit ArrayBuffer: `Uint8Array.from` yields `Uint8Array<ArrayBufferLike>`,
 * which no longer satisfies the BufferSource that applicationServerKey requires.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Turns morning digests on for this device.
 *
 * Per device, not per account: someone signs in on the store tablet and their own phone,
 * and only one of those should buzz at 6am. The subscription belongs to the browser, so
 * the switch does too.
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (!vapidPublicKey) return setState('unsupported');
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return setState('unsupported');
      }
      if (Notification.permission === 'denied') return setState('blocked');

      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      setState(existing ? 'on' : 'off');
    }
    void check();
  }, [vapidPublicKey]);

  async function enable() {
    setError(null);
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      });

      const json = subscription.toJSON();
      const result = await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
        userAgent: navigator.userAgent.slice(0, 300),
      });

      if (result.status === 'error') {
        // Don't leave a live browser subscription pointing at a row we failed to store,
        // or the push service will deliver to an endpoint nothing knows about.
        await subscription.unsubscribe();
        setError(result.message);
        setState('off');
        return;
      }
      setState('on');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn notifications on.');
      setState('off');
    }
  }

  async function disable() {
    setState('working');
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await removePushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
    }
    setState('off');
  }

  return (
    <div className="rounded border border-neutral-200 p-4">
      <h2 className="text-sm font-medium">Morning digest on this device</h2>
      <p className="mt-1 text-xs text-neutral-500">
        What needs pulling or marking down, at 6am. Per device, not per account — the store
        tablet and your own phone are separate switches.
      </p>

      <div className="mt-3">
        {state === 'checking' && <p className="text-sm text-neutral-500">Checking…</p>}

        {state === 'unsupported' && (
          <p className="text-sm text-neutral-500">
            This browser cannot receive push notifications. On iPhone, add ShelfLife to your
            home screen first — Safari only allows push for installed apps.
          </p>
        )}

        {state === 'blocked' && (
          <p className="text-sm text-amber-700">
            Notifications are blocked for this site. Allow them in your browser settings,
            then come back.
          </p>
        )}

        {(state === 'off' || state === 'working') && (
          <button
            type="button"
            onClick={enable}
            disabled={state === 'working'}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {state === 'working' ? 'Just a moment…' : 'Turn on'}
          </button>
        )}

        {state === 'on' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-green-700">On for this device.</span>
            <button type="button" onClick={disable} className="text-sm text-neutral-600 underline">
              Turn off
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
