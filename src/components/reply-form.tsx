'use client';

import { useActionState, useState } from 'react';
import { MESSAGE_MAX_LENGTH } from '@/lib/messages/messages';
import { sendReply, type SendReplyState } from '@/lib/messages/actions';

/** A short reply in one thread. Staff omit `staffId`; a manager names whose thread it is. */
export function ReplyForm({
  messageId,
  staffId,
  label = 'Reply',
}: {
  messageId: string;
  staffId?: string;
  label?: string;
}) {
  const [body, setBody] = useState('');
  const [state, formAction, pending] = useActionState<SendReplyState, FormData>(
    async (prev, formData) => {
      const next = await sendReply(prev, formData);
      if (next.status === 'sent') setBody('');
      return next;
    },
    { status: 'idle' },
  );

  const length = body.trim().length;
  const over = length > MESSAGE_MAX_LENGTH;

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="message_id" value={messageId} />
      {staffId && <input type="hidden" name="staff_id" value={staffId} />}
      <label className="block space-y-1">
        <span className="sr-only">{label}</span>
        <textarea
          name="body"
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={label}
          aria-invalid={over ? true : undefined}
          className={`field w-full ${over ? 'border-critical' : ''}`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-outline btn-sm" disabled={pending || length === 0 || over}>
          {pending ? 'Sending…' : 'Reply'}
        </button>
        <span className={`text-xs ${over ? 'text-critical-ink' : 'text-muted'}`}>
          {length}/{MESSAGE_MAX_LENGTH}
        </span>
        {state.status === 'sent' && !pending && length === 0 && (
          <span role="status" className="text-sm text-good">Sent.</span>
        )}
        {state.status === 'error' && <span role="alert" className="text-sm text-critical-ink">{state.message}</span>}
      </div>
    </form>
  );
}
