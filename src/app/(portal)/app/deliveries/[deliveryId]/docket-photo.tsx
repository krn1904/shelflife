'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { attachDocketPhoto } from '@/lib/intake/actions';
import { forUpload } from '@/lib/intake/docket/browser';

// Before shrinking. A phone photo is 2–12 MB; anything far past that is not a photo of a docket.
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
const BUCKET = 'dockets';

/**
 * Uploads straight from the browser to Storage rather than through a Server Action, shrunk
 * on the phone first (forUpload), the same as a photo taken when starting the delivery: a
 * store room's signal is poor, and Textract takes 5 MB at most. The action is told the path
 * afterwards, and checks it points inside this delivery's own folder.
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
    if (file.size > MAX_ORIGINAL_BYTES) {
      setError('That file is too large to be a photo. Take the photo again.');
      return;
    }

    setBusy(true);
    try {
      let photo: Blob;
      try {
        photo = await forUpload(file);
      } catch {
        // Some formats (a HEIC on a desktop browser, say) cannot be decoded here.
        setError('Could not open that photo. Take it again with the camera.');
        return;
      }

      const target = `${orgId}/${siteId}/${deliveryId}/docket-${Date.now()}.jpg`;
      const { error: uploadError } = await createClient().storage
        .from(BUCKET)
        .upload(target, photo, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        return;
      }

      const result = await attachDocketPhoto(deliveryId, target);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      setPath(target);
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="btn btn-outline cursor-pointer">
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
        <p className="text-xs text-good">Docket photo attached.</p>
      )}
      {!path && !error && (
        <p className="text-xs text-muted">
          Optional, but it is what makes a disputed short-delivery arguable.
        </p>
      )}
      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  );
}
