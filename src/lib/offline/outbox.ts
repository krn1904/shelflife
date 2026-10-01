'use client';

import Dexie, { type Table } from 'dexie';
import { MAX_ATTEMPTS, classifyFailure, replayOrder, type OutboxEntry, type OutboxKind } from './queue';

/**
 * The device-side outbox. Dexie for storage, `queue.ts` for the rules.
 *
 * Only shelf-side mutations are queued — writing off stock and ticking an action. Those
 * are the ones a staff member makes standing in a cold room with one bar of signal, and
 * they are small, additive and safe to replay. Intake is deliberately not queued: it is a
 * multi-step flow whose draft lives on the server, and pretending otherwise would be a
 * much bigger promise than this outbox can keep.
 */
class OutboxDb extends Dexie {
  entries!: Table<OutboxEntry, string>;

  constructor() {
    super('shelflife-outbox');
    this.version(1).stores({ entries: 'clientId, queuedAt, kind' });
  }
}

let db: OutboxDb | null = null;

function database(): OutboxDb {
  db ??= new OutboxDb();
  return db;
}

export function newClientId(): string {
  return crypto.randomUUID();
}

// Fired whenever the queue gains an entry, so the "pending" strip updates at once.
export const OUTBOX_CHANGED = 'shelflife:outbox-changed';

/** Queues a change. Pass the id an online attempt already used, so a retry stays idempotent. */
export async function enqueue(
  kind: OutboxKind,
  payload: Record<string, unknown>,
  clientId: string = newClientId(),
): Promise<string> {
  await database().entries.put({
    clientId,
    kind,
    payload,
    queuedAt: Date.now(),
    attempts: 0,
    lastError: null,
  });
  window.dispatchEvent(new Event(OUTBOX_CHANGED));
  return clientId;
}

export async function allEntries(): Promise<OutboxEntry[]> {
  return database().entries.toArray();
}

export type Sender = (entry: OutboxEntry) => Promise<
  { ok: true } | { ok: false; permanent: boolean; message: string }
>;

/**
 * Replays the queue in order, stopping at the first entry that needs retrying.
 *
 * Stopping rather than skipping ahead is deliberate: later writes can depend on earlier
 * ones (a second write-off against a batch the first has not yet decremented), so racing
 * past a stuck entry would produce failures that look like data errors.
 */
export async function drain(send: Sender): Promise<{ sent: number; failed: number }> {
  const pending = replayOrder(await allEntries()).filter((e) => e.attempts < MAX_ATTEMPTS);
  let sent = 0;
  let failed = 0;

  for (const entry of pending) {
    const result = await send(entry);

    if (result.ok) {
      await database().entries.delete(entry.clientId);
      sent += 1;
      continue;
    }

    const outcome = classifyFailure(entry, result);
    await database().entries.update(entry.clientId, {
      attempts: entry.attempts + 1,
      lastError: outcome.status === 'done' ? null : outcome.reason,
    });
    failed += 1;

    // A transient failure means the network is down; the rest of the queue will fail the
    // same way, so stop and let the next reconnect try again.
    if (outcome.status === 'retry') break;
  }

  return { sent, failed };
}

export async function forget(clientId: string): Promise<void> {
  await database().entries.delete(clientId);
}
