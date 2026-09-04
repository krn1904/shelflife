/* ShelfLife service worker.
 *
 * Push only, for now. The offline outbox in the next batch registers its own handlers
 * here; keeping this file small until then means there is nothing to debug when a push
 * does not arrive.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'ShelfLife', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'ShelfLife', {
      body: payload.body ?? '',
      // A tag replaces an earlier notification with the same tag rather than stacking.
      // Without it, three days away from work means three identical morning digests.
      tag: payload.tag ?? 'shelflife-digest',
      data: { url: payload.url ?? '/app/today' },
      badge: '/icon-badge.png',
      icon: '/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/app/today';

  // Focus an open tab if there is one, rather than opening a duplicate.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
