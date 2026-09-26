'use client';

import { useState } from 'react';
import { parseDocket, type CatalogueItem, type DocketParse } from '@/lib/intake/docket/parse';
import type { TextractReading } from '@/lib/intake/docket/textract-shape';
import { TextractView } from './textract-view';

type Engine = 'free' | 'textract';

type Stage = { status: 'idle' } | { status: 'reading'; progress: number } | { status: 'error'; message: string };

const TARGET_WIDTH = 2400;

/**
 * Enlarge, greyscale and stretch the contrast before OCR. On a real docket photo this took
 * the printed quantities from partly read to all read: phone photos are often too small
 * for Tesseract to separate digits from the table rules beside them.
 */
async function cleanUp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, TARGET_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const grey = new Uint8ClampedArray(px.length / 4);
  for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  // Stretch between the 1st and 99th percentile, so shadows and grey paper stop muting ink.
  const sorted = Uint8ClampedArray.from(grey).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.floor(sorted.length * 0.99)];
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < grey.length; i++) {
    const v = ((grey[i] - lo) * 255) / range;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not prepare the photo'))), 'image/png'));
}

/** A JPEG small enough for Textract (5 MB) and the upload, big enough to read. */
async function forUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not prepare the photo'))), 'image/jpeg', 0.88));
}

async function readWithTextract(file: File): Promise<TextractReading> {
  const form = new FormData();
  form.set('photo', new File([await forUpload(file)], 'docket.jpg', { type: 'image/jpeg' }));
  const response = await fetch('/app/deliveries/docket-test/textract', { method: 'POST', body: form });
  const body = await response.json().catch(() => ({ error: `The server answered ${response.status}.` }));
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body as TextractReading;
}

/** Tesseract reads the photo in the browser: free, and the image never leaves the device. */
async function readText(file: File, onProgress: (p: number) => void): Promise<string[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress); },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(await cleanUp(file));
    return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
  } finally {
    await worker.terminate();
  }
}

export function DocketTest({ catalogue }: { catalogue: CatalogueItem[] }) {
  const [stage, setStage] = useState<Stage>({ status: 'idle' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<(DocketParse & { ms: number }) | null>(null);
  const [engine, setEngine] = useState<Engine>('textract');
  const [textract, setTextract] = useState<{ reading: TextractReading; ms: number } | null>(null);

  async function run(file: File) {
    setResult(null);
    setTextract(null);
    setPhoto((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setStage({ status: 'reading', progress: 0 });
    const started = performance.now();
    try {
      if (engine === 'textract') {
        setTextract({ reading: await readWithTextract(file), ms: Math.round(performance.now() - started) });
      } else {
        const text = await readText(file, (progress) => setStage({ status: 'reading', progress }));
        setResult({ ...parseDocket(text, catalogue), ms: Math.round(performance.now() - started) });
      }
      setStage({ status: 'idle' });
    } catch (error) {
      setStage({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  const dropped = result?.verdicts.filter((v) => v.kept === false).length ?? 0;

  return (
    <div className="space-y-6">
      <fieldset className="flex flex-wrap gap-4 text-sm" disabled={stage.status === 'reading'}>
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Read with</legend>
        {([['textract', 'AWS Textract (tables as printed; about 2.5 cents a photo)'], ['free', 'Free OCR on this device']] as const).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="engine" value={value} checked={engine === value} onChange={() => setEngine(value)} />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="inline-block cursor-pointer rounded btn btn-primary">
        {photo ? 'Try another photo' : 'Choose a docket photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={stage.status === 'reading'}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ''; }}
        />
      </label>

      {stage.status === 'reading' && (
        <p className="text-sm text-muted">
          {engine === 'textract' ? 'Sending the photo to AWS Textract…' : <>
            Reading the docket… {Math.round(stage.progress * 100)}%
            <span className="text-faint"> (the first run downloads the OCR engine, about 10 MB)</span>
          </>}
        </p>
      )}
      {stage.status === 'error' && (
        <p className="rounded border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          Could not read the photo: {stage.message}
        </p>
      )}

      {textract && <TextractView reading={textract.reading} ms={textract.ms} />}

      {result && (
        <>
          <p className="text-sm text-muted">
            {result.lines.length} delivery lines from {result.verdicts.length} lines of text ·{' '}
            {dropped} dropped as not part of the delivery · {(result.ms / 1000).toFixed(1)}s
          </p>

          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">What was delivered</h2>
            <div className="mt-2 overflow-x-auto rounded border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Pack</th>
                    <th className="px-3 py-2 text-right">Cartons + each</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-right">Supplied</th>
                    <th className="px-3 py-2">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.lines.map((line, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2">
                        <p className="font-medium">{line.productName ?? 'New product?'}</p>
                        <p className="font-mono text-xs text-muted">{line.text}</p>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {line.pack ? `${line.pack} × ` : ''}{line.size ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        {line.cartons !== null || line.eaches !== null ? `${line.cartons ?? '?'} + ${line.eaches ?? '?'}` : '—'}
                        {line.check && (
                          <p className={`text-xs ${line.check === 'agrees' ? 'text-good' : 'text-warning'}`}>
                            {line.check === 'agrees' ? 'matches qty' : 'does not match qty'}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.ordered ?? '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${
                        line.supplied === null || line.check === 'disagrees' || (line.ordered !== null && line.ordered !== line.supplied) ? 'bg-warning-soft font-semibold text-warning' : ''}`}>
                        <input
                          defaultValue={line.supplied ?? ''}
                          placeholder="?"
                          inputMode="numeric"
                          aria-label={`Supplied, line ${i + 1}`}
                          className="w-14 rounded border border-transparent bg-transparent px-1 text-right hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {line.via === 'new product?' ? (
                          <span className="text-critical">not in catalogue</span>
                        ) : (
                          <span className={line.confidence >= 0.8 ? 'text-good' : 'text-warning'}>
                            {line.via} · {Math.round(line.confidence * 100)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {result.lines.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-muted">No product lines found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-muted">Amber quantity: unreadable, ordered and supplied differ, or cartons × pack + each disagree — check it.
              Quantities come from the printed columns; handwritten ticks are not read.</p>
          </section>

          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Every line the OCR read</h2>
            <ol className="mt-2 divide-y divide-line rounded border border-line font-mono text-xs">
              {result.verdicts.map((v) => (
                <li key={v.index} className={`flex gap-3 px-3 py-1.5 ${v.kept === false ? 'text-faint' : ''}`}>
                  <span className="w-40 shrink-0 font-sans">
                    {v.kept === true && <span className="text-good">kept</span>}
                    {v.kept === 'merged' && <span className="text-good">kept · {v.what} of line above</span>}
                    {v.kept === false && <span>dropped · {v.reason}</span>}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{v.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {photo && (result || textract) && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Photo</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimisable asset */}
          <img src={photo} alt="The docket photo that was read" className="mt-2 max-w-full rounded border border-line" />
        </section>
      )}
    </div>
  );
}
