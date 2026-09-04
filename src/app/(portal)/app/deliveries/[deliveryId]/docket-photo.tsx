'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { attachDocketPhoto } from '@/lib/intake/actions';

const MAX_BYTES = 8 * 1024 * 1024;
const BUCKET = 'dockets';

/**
 * Uploads straight from the browser to Storage rather than through a Server Action:
 * a docket photo is a few megabytes, and routing it through the action would double the
 * transfer and time out on a bad connection. The action is told the path afterwards, and
 * checks it points inside this delivery's own folder.
 */
export function DocketPhoto({
  deliveryId,
  orgId,
  siteId,
  existingPath,
}: {
  deliveryId: string;
  orgId: string;
  siteId: string;
  existingPath: string | null;
}) {
  const [path, setPath] = useState(existingPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('That is not an image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That photo is over 8MB. Try again with a smaller one.');
      return;
    }

    setBusy(true);
    const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const target = `${orgId}/${siteId}/${deliveryId}/docket-${Date.now()}.${extension}`;

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(target, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setBusy(false);
      setError(`Upload failed: ${uploadError.message}`);
      return;
    }

    const result = await attachDocketPhoto(deliveryId, target);
    setBusy(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    setPath(target);
  }

  return (
    <div className="space-y-2">
      <label className="inline-block rounded border border-neutral-300 px-4 py-2 text-sm font-medium">
        {busy ? 'Uploading…' : path ? 'Replace docket photo' : 'Photograph the docket'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="sr-only"
        />
      </label>

      {path && !error && (
        <p className="text-xs text-green-700">Docket photo attached.</p>
      )}
      {!path && !error && (
        <p className="text-xs text-neutral-500">
          Optional, but it is what makes a disputed short-delivery arguable.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
