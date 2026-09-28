import { getSession } from '@/lib/auth/session';
import { readWithTextract, TextractNotConfigured } from '@/lib/intake/docket/textract';

// Textract's synchronous calls take images up to 5 MB; the page sends a resized JPEG.
const MAX_BYTES = 5 * 1024 * 1024;

/** Reads a docket photo with AWS Textract. Nothing is stored, here or at AWS. */
export async function POST(request: Request) {
  // Every call is billed, so it is for signed-in users only.
  if (!(await getSession())) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const photo = form?.get('photo');
  if (!(photo instanceof File)) return Response.json({ error: 'No photo was sent.' }, { status: 400 });
  if (!/^image\/(jpeg|png)$/.test(photo.type)) {
    return Response.json({ error: 'Textract reads JPEG or PNG photos.' }, { status: 415 });
  }
  if (photo.size > MAX_BYTES) return Response.json({ error: 'That photo is over 5 MB.' }, { status: 413 });

  try {
    const reading = await readWithTextract(new Uint8Array(await photo.arrayBuffer()));
    return Response.json(reading);
  } catch (error) {
    if (error instanceof TextractNotConfigured) {
      return Response.json({ error: `AWS Textract is not set up: ${error.message}` }, { status: 503 });
    }
    // AWS names its failures (UnrecognizedClientException, AccessDeniedException, …),
    // which is what someone setting up the key needs to see.
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `AWS Textract refused the request (${name}): ${message}` }, { status: 502 });
  }
}
