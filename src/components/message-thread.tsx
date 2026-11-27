'use client';

import { startTransition, useEffect, useRef } from 'react';
import { formatSentAt } from '@/lib/messages/messages';
import { markThreadsSeen } from '@/lib/messages/actions';
import type { ThreadReply } from '@/lib/messages/data';

/** One thread the reader has on screen, marked seen up to its newest reply. */
export type SeenThread = { messageId: string; staffId: string | null; seenUpTo: string };

/**
 * Records that these threads were opened, once per set of newest replies. The page is not
 * refreshed, so what was new stays highlighted until the reader leaves and comes back.
 */
export function MarkThreadsSeen({ threads }: { threads: SeenThread[] }) {
  const key = threads.map((thread) => `${thread.messageId}:${thread.staffId ?? ''}:${thread.seenUpTo}`).join('|');
  const marked = useRef('');

  useEffect(() => {
    if (!key || marked.current === key) return;
    marked.current = key;
    startTransition(() => {
      void markThreadsSeen(threads);
    });
  }, [key, threads]);

  return null;
}

/** A thread, oldest first. Replies in `newIds` are the ones this reader had not opened. */
export function ReplyList({
  replies,
  newIds,
  timeZone,
}: {
  replies: ThreadReply[];
  newIds: ReadonlySet<string>;
  timeZone: string;
}) {
  if (replies.length === 0) return null;

  return (
    <ol className="mt-3 space-y-2 border-t border-line pt-3">
      {replies.map((reply) => {
        const isNew = newIds.has(reply.id);
        return (
          <li key={reply.id} className={`rounded-[10px] px-3 py-2 ${isNew ? 'bg-brand-soft' : 'bg-surface-2'}`}>
            <div className="text-xs text-muted">
              {reply.author} · {formatSentAt(reply.sentAt, timeZone)}
              {isNew && <span className="ml-2 font-medium text-brand-text">New</span>}
            </div>
            <p className="mt-0.5 whitespace-pre-line text-sm">{reply.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
