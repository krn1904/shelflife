'use client';

import { useActionState, useState } from 'react';
import { MESSAGE_MAX_LENGTH } from '@/lib/messages/messages';
import { sendMessage, type SendMessageState } from '@/lib/messages/actions';

/** Write and send a note to the site's staff. Clears itself once sent. */
export function MessageForm({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [body, setBody] = useState('');
  const [state, formAction, pending] = useActionState<SendMessageState, FormData>(
    async (prev, formData) => {
      const next = await sendMessage(prev, formData);
      if (next.status === 'sent') setBody('');
      return next;
    },
    { status: 'idle' },
  );

  const length = body.trim().length;
  const over = length > MESSAGE_MAX_LENGTH;

  return (
    <form action={formAction} className="card space-y-3 p-4">
      <input type="hidden" name="site_id" value={siteId} />
      <label className="block space-y-1">
        <span className="block text-sm font-medium">Message to everyone on staff at {siteName}</span>
        <textarea
          name="body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Fridge 3 is being serviced at 2pm. Move the milk to fridge 1 before then."
          aria-invalid={over ? true : undefined}
          className={`field w-full ${over ? 'border-critical' : ''}`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || length === 0 || over}>
          {pending ? 'Sending…' : 'Send'}
        </button>
        <span className={`text-xs ${over ? 'text-critical-ink' : 'text-muted'}`}>
          {length}/{MESSAGE_MAX_LENGTH}
        </span>
        {state.status === 'sent' && !pending && (
          <span role="status" className="text-sm text-good">Sent. Staff see it next time they open ShelfLife.</span>
        )}
        {state.status === 'error' && <span role="alert" className="text-sm text-critical-ink">{state.message}</span>}
      </div>
    </form>
  );
}
