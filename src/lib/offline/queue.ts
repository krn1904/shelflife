/**
 * Outbox semantics, kept free of Dexie and the network so the rules can be tested.
 *
 * The hard part of an offline queue is not storing things — it is knowing what to do with
 * a write whose fate you never learned. A request that times out may or may not have been
 * applied, so the only safe design is to retry it and make retrying harmless. Every
 * mutation therefore carries a client-generated id the server treats as an idempotency
 * key, and replay order is preserved so a decrement never overtakes the write it depends on.
 */

export type OutboxKind = 'action-state' | 'rotation-check' | 'batch-step';

export type OutboxEntry = {
  /** Generated on the device, before the write is attempted. The idempotency key. */
  clientId: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
};

/** Give up asking the server after this many tries and surface it to the user instead. */
export const MAX_ATTEMPTS = 8;

export type ReplayOutcome =
  | { status: 'done' }
  | { status: 'retry'; reason: string }
  | { status: 'give-up'; reason: string };

/**
 * Whether a failed attempt is worth repeating.
 *
 * A network failure means we never learned the outcome, so retry. A rejection the server
 * actually reasoned about — bad data, gone, not yours — will be rejected identically
 * forever, so retrying it just blocks the queue behind a write that can never land.
 */
export function classifyFailure(entry: OutboxEntry, error: { permanent: boolean; message: string }): ReplayOutcome {
  if (error.permanent) return { status: 'give-up', reason: error.message };
  if (entry.attempts + 1 >= MAX_ATTEMPTS) {
    return { status: 'give-up', reason: `${error.message} (after ${MAX_ATTEMPTS} attempts)` };
  }
  return { status: 'retry', reason: error.message };
}

/** Exponential backoff, capped, so a long outage does not become a tight retry loop. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 5 * 60 * 1000);
}

/**
 * Replay order: oldest first, always.
 *
 * Two answers about the same batch must land in the order they were made: "Reduced price"
 * then "Pulled out" replayed the other way round would close the batch before it was marked down.
 */
export function replayOrder(entries: OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((a, b) => a.queuedAt - b.queuedAt || a.clientId.localeCompare(b.clientId));
}

/** Entries that have run out of road, for the "these did not sync" list. */
export function stuck(entries: OutboxEntry[]): OutboxEntry[] {
  return entries.filter((e) => e.attempts >= MAX_ATTEMPTS);
}

export function pendingCount(entries: OutboxEntry[]): number {
  return entries.filter((e) => e.attempts < MAX_ATTEMPTS).length;
}
