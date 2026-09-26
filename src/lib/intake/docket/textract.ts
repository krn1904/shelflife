import 'server-only';
import { AnalyzeDocumentCommand, AnalyzeExpenseCommand, TextractClient } from '@aws-sdk/client-textract';
import { expenseFromDocuments, tablesFromBlocks, type TextractReading } from './textract-shape';

export class TextractNotConfigured extends Error {}

/**
 * Credentials come from TEXTRACT_* first. Vercel runs functions on AWS and reserves the
 * AWS_* names for its own use, so a key set under them can be replaced at runtime by the
 * platform's — and the client must never fall back to whatever identity it finds lying
 * around, which is why the credentials are passed explicitly.
 */
function client(): TextractClient {
  const accessKeyId = process.env.TEXTRACT_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TEXTRACT_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.TEXTRACT_REGION ?? 'ap-southeast-2';
  if (!accessKeyId || !secretAccessKey) {
    throw new TextractNotConfigured(
      'Set TEXTRACT_ACCESS_KEY_ID, TEXTRACT_SECRET_ACCESS_KEY and TEXTRACT_REGION in the environment.',
    );
  }
  return new TextractClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

/**
 * Two readings of one photo: the tables exactly as printed, and Textract's invoice model's
 * line items. Two billed pages per photo; both are shown so the better one can be chosen.
 */
export async function readWithTextract(bytes: Uint8Array): Promise<TextractReading> {
  const textract = client();
  const [document, expense] = await Promise.all([
    textract.send(new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ['TABLES'] })),
    textract.send(new AnalyzeExpenseCommand({ Document: { Bytes: bytes } })),
  ]);
  return {
    tables: tablesFromBlocks(document.Blocks ?? []),
    expense: expenseFromDocuments(expense.ExpenseDocuments ?? []),
  };
}
