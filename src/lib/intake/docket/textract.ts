import 'server-only';
import { AnalyzeDocumentCommand, TextractClient } from '@aws-sdk/client-textract';
import { tablesFromBlocks, textLinesFromBlocks, type Table } from './textract-shape';

/** Raised when the server does not have the AWS credentials needed to call Textract. */
export class TextractNotConfigured extends Error {}

/**
 * Credentials come from TEXTRACT_* first. Vercel runs functions on AWS and reserves the
 * AWS_* names for its own use, so a key set under them can be replaced at runtime by the
 * platform's — and the client must never fall back to whatever identity it finds lying
 * around, which is why the credentials are passed explicitly.
 */
function client(): TextractClient {
  // Prefer app-specific names so hosting platforms cannot replace them with their own AWS identity.
  const accessKeyId = process.env.TEXTRACT_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TEXTRACT_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  // Sydney is the closest Textract region to the app's Australian users.
  const region = process.env.TEXTRACT_REGION ?? 'ap-southeast-2';
  if (!accessKeyId || !secretAccessKey) {
    throw new TextractNotConfigured(
      'Set TEXTRACT_ACCESS_KEY_ID, TEXTRACT_SECRET_ACCESS_KEY and TEXTRACT_REGION in the environment.',
    );
  }
  return new TextractClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

/**
 * The intake read: one billed call. The table call returns the printed lines as well, which
 * is all the letterhead needs, so the invoice model's second charge is not paid for here.
 */
export async function readDocketTables(bytes: Uint8Array): Promise<{ text: string[]; tables: Table[] }> {
  const document = await client().send(
    new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ['TABLES'] }),
  );
  const blocks = document.Blocks ?? [];
  return { text: textLinesFromBlocks(blocks), tables: tablesFromBlocks(blocks) };
}

/** Whether the server has the credentials to call Textract at all. */
export function textractConfigured(): boolean {
  return Boolean(
    (process.env.TEXTRACT_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID)
    && (process.env.TEXTRACT_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY),
  );
}
