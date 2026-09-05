/**
 * Builds the pre-populated line list for a delivery from what this supplier actually
 * sent to this site before.
 *
 * This is why there is no delivery-template table to maintain: the last few dockets
 * already describe what a normal delivery looks like, and they stay current for free.
 * The first delivery from a supplier is manual; every one after is a tick-list.
 */

export type HistoryLine = {
  deliveryId: string;
  productId: string;
  qtyReceived: number;
};

export type ExpectedLine = {
  productId: string;
  qtyDocketed: number;
  seenInDeliveries: number;
};

/**
 * `history` must be ordered newest delivery first — the most recent quantity is the one
 * worth pre-filling, since ranging changes over time and an average would drift behind.
 *
 * Ordering is by how often a product appears, so the reliable weekly lines float to the
 * top and a one-off someone ordered once sinks. Ties break on the recent quantity, then
 * on product id, so the list is stable rather than dependent on row order.
 */
export function expectedLines(history: HistoryLine[]): ExpectedLine[] {
  const byProduct = new Map<string, { qtyDocketed: number; deliveries: Set<string> }>();

  for (const line of history) {
    const existing = byProduct.get(line.productId);
    if (existing) {
      existing.deliveries.add(line.deliveryId);
    } else {
      // First sighting wins the quantity because history arrives newest-first.
      byProduct.set(line.productId, {
        qtyDocketed: line.qtyReceived,
        deliveries: new Set([line.deliveryId]),
      });
    }
  }

  return [...byProduct.entries()]
    .map(([productId, seen]) => ({
      productId,
      qtyDocketed: seen.qtyDocketed,
      seenInDeliveries: seen.deliveries.size,
    }))
    .sort(
      (a, b) =>
        b.seenInDeliveries - a.seenInDeliveries ||
        b.qtyDocketed - a.qtyDocketed ||
        a.productId.localeCompare(b.productId),
    );
}
