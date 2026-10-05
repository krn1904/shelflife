'use client';

import { replayOutboxEntry } from './actions';
import { enqueue, newClientId } from './outbox';
import type { OutboxKind } from './queue';

export type SendResult =
  | { status: 'sent' }
  | { status: 'queued' }                 // saved on this phone, sent when signal returns
  | { status: 'error'; message: string }; // the server refused it; retrying will not help

/**
 * Sends a shelf-side change now, or keeps it on the device when there is no signal.
 *
 * The same id is used for the attempt and the queued copy, so if a request did reach the
 * server before the connection dropped, the replay is a no-op rather than a duplicate.
 */
export async function sendOrQueue(kind: OutboxKind, payload: Record<string, unknown>): Promise<SendResult> {
  const clientId = newClientId();

  if (!navigator.onLine) {
    await enqueue(kind, payload, clientId);
    return { status: 'queued' };
  }

  try {
    const reply = await replayOutboxEntry(clientId, kind, payload);
    if (reply.ok) return { status: 'sent' };
    if (reply.permanent) return { status: 'error', message: reply.message };
  } catch {
    // The request never came back (dropped signal, server unreachable): queue it below.
  }

  await enqueue(kind, payload, clientId);
  return { status: 'queued' };
}
