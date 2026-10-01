'use client';

import { useActionState, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { startDelivery, type IntakeState } from '@/lib/intake/actions';
import {
  addSupplierFromDocket,
  identifyDocketSupplier,
  readDocketWithTextract,
  type SupplierLookup,
} from '@/lib/intake/docket-actions';
import { forUpload, readText } from '@/lib/intake/docket/browser';
import { formatAbn } from '@/lib/intake/docket/abn';
import {
  describeTables,
  docketPhotoPath,
  likelyProductTable,
  type DocketReading,
  type FoundTable,
  type OcrEngine,
} from '@/lib/intake/docket/reading';

type Supplier = { id: string; name: string };

type Stage =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'reading'; progress: number | null }
  | { status: 'error'; message: string };

const VIA: Record<'abn' | 'alias' | 'name', string> = {
  abn: 'Recognised by the ABN on the docket.',
  alias: 'Recognised by a docket name confirmed before.',
  name: 'Recognised by its name on the docket.',
};

const PREVIEW_ROWS = 4;

/** A table as the reader found it: headings, then the first few rows, with the rest on request. */
function TablePreview({ rows }: { rows: FoundTable['rows'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
  return (
    <div>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-max min-w-full text-xs">
          <tbody className="divide-y divide-line">
            {shown.map((row, r) => (
              <tr key={r} className={row.some((c) => c.header) ? 'bg-surface-2 font-medium' : ''}>
                {row.map((cell, c) => (
                  <td key={c} className="max-w-64 truncate border-r border-line px-2 py-1 last:border-r-0" title={cell.text}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW_ROWS && (
        <button
          type="button"
          className="mt-1 text-xs text-muted underline"
          onClick={(e) => { e.stopPropagation(); setAll((v) => !v); }}
        >
          {all ? 'Show fewer rows' : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  );
}

/**
 * Receiving starts at the docket, not a supplier list: photograph it, read it, and the
 * supplier it came from is recognised from what it prints. The operator confirms (or
 * corrects) before anything is saved; the delivery itself is created only on Start.
 */
export function ReceiveDelivery({
  orgId,
  siteId,
  suppliers: initialSuppliers,
  textractReady,
}: {
  orgId: string;
  siteId: string;
  suppliers: Supplier[];
  textractReady: boolean;
}) {
  // The delivery's id is chosen now so the photo can be filed in its folder before it exists.
  const [deliveryId] = useState(() => crypto.randomUUID());
  const photoPath = docketPhotoPath(orgId, siteId, deliveryId);

  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [engine, setEngine] = useState<OcrEngine>(textractReady ? 'textract' : 'tesseract');
  const [stage, setStage] = useState<Stage>({ status: 'idle' });
  const [text, setText] = useState<string[] | null>(null);
  const [readWith, setReadWith] = useState<OcrEngine>(engine);
  const [tables, setTables] = useState<FoundTable[]>([]);
  const [tableIndex, setTableIndex] = useState(-1);
  const [lookup, setLookup] = useState<SupplierLookup | null>(null);

  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAbn, setNewAbn] = useState('');
  const [addNote, setAddNote] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [savingSupplier, setSavingSupplier] = useState(false);

  const [state, formAction, starting] = useActionState<IntakeState, FormData>(startDelivery, { status: 'idle' });

  const busy = stage.status === 'uploading' || stage.status === 'reading';
  const reading: DocketReading | null = useMemo(() => text && {
    engine: readWith,
    text,
    table: tableIndex >= 0 ? tables[tableIndex].rows : null,
  }, [readWith, text, tables, tableIndex]);
  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? null;

  function resetReading() {
    setText(null);
    setTables([]);
    setTableIndex(-1);
    setLookup(null);
    setChosen(null);
    setPicking(false);
    setAdding(false);
    setAddNote(null);
  }

  async function takePhoto(file: File) {
    resetReading();
    setStage({ status: 'uploading' });
    try {
      // Stored small: Textract takes JPEG up to 5 MB, and a store room's signal is poor.
      const blob = await forUpload(file);
      const { error } = await createClient().storage
        .from('dockets')
        .upload(photoPath, blob, { upsert: true, contentType: 'image/jpeg' });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.preview);
        return { blob, preview: URL.createObjectURL(blob) };
      });
      setStage({ status: 'idle' });
    } catch (e) {
      setStage({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function read() {
    if (!photo) return;
    resetReading();
    setStage({ status: 'reading', progress: engine === 'tesseract' ? 0 : null });
    try {
      let lines: string[];
      if (engine === 'textract') {
        const result = await readDocketWithTextract(photoPath);
        if (result.status === 'error') throw new Error(result.message);
        const found = describeTables(result.tables);
        const likely = likelyProductTable(found);
        setTables(found);
        setTableIndex(likely >= 0 && found[likely].products ? likely : -1);
        lines = result.text;
      } else {
        lines = await readText(photo.blob, (progress) => setStage({ status: 'reading', progress }));
      }
      setText(lines);
      setReadWith(engine);

      const found = await identifyDocketSupplier(siteId, lines);
      setLookup(found);
      setNewName(found.clues.printedName ?? '');
      setNewAbn(found.clues.abn ? formatAbn(found.clues.abn) : '');
      if (found.identity.kind === 'matched') setChosen(found.identity.supplierId);
      if (found.identity.kind === 'unknown') setAdding(true);
      setStage({ status: 'idle' });
    } catch (e) {
      setStage({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function addSupplier() {
    setSavingSupplier(true);
    setAddError(null);
    const result = await addSupplierFromDocket(siteId, newName, newAbn);
    setSavingSupplier(false);
    if (result.status === 'error') {
      setAddError(result.message);
      return;
    }
    const { supplier } = result;
    setSuppliers((all) => (all.some((s) => s.id === supplier.id) ? all : [...all, supplier].sort((a, b) => a.name.localeCompare(b.name))));
    setChosen(supplier.id);
    setAdding(false);
    setPicking(false);
    setAddNote(result.status === 'existing'
      ? `Already on your list as ${supplier.name}, so that one is used.`
      : 'Added to your suppliers from this docket.');
  }

  function pick(id: string) {
    setChosen(id);
    setPicking(false);
    setAdding(false);
    setAddNote(null);
  }

  const identity = lookup?.identity;
  const showSupplier = text !== null || picking;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="section-title">1 · The docket</h2>
        <p className="text-sm text-muted">
          Photograph it flat and in good light. It is kept as the evidence for any dispute.
        </p>

        <div className="flex flex-wrap items-start gap-4">
          <label className={`btn ${photo ? 'btn-outline' : 'btn-primary'} ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
            {stage.status === 'uploading' ? 'Uploading…' : photo ? 'Retake photo' : 'Photograph the docket'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void takePhoto(f); e.target.value = ''; }}
            />
          </label>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimisable asset
            <img src={photo.preview} alt="The docket photo" className="h-24 w-auto rounded border border-line object-cover" />
          )}
        </div>

        {photo && (
          <div className="card space-y-3 p-4">
            <fieldset className="space-y-2 text-sm" disabled={busy}>
              <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Read with</legend>
              <label className={`flex items-start gap-2 ${textractReady ? '' : 'text-faint'}`}>
                <input type="radio" name="engine" className="mt-1" checked={engine === 'textract'}
                  disabled={!textractReady} onChange={() => setEngine('textract')} />
                <span>
                  AWS Textract <span className="text-muted">— reads printed tables column by column (about 1.5 cents a photo)</span>
                  {!textractReady && <span className="block text-xs">Not set up on this server.</span>}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="engine" className="mt-1" checked={engine === 'tesseract'} onChange={() => setEngine('tesseract')} />
                <span>Free reader <span className="text-muted">— on this device; weaker on tables and faint print</span></span>
              </label>
            </fieldset>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void read()}>
              {stage.status === 'reading'
                ? stage.progress === null ? 'Reading…' : `Reading… ${Math.round(stage.progress * 100)}%`
                : text ? 'Read it again' : 'Read docket'}
            </button>
            {stage.status === 'reading' && engine === 'tesseract' && (
              <p className="text-xs text-faint">The first read downloads the reader, about 10 MB.</p>
            )}
          </div>
        )}

        {stage.status === 'error' && (
          <p className="rounded border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">{stage.message}</p>
        )}

        {text && (
          <p className="text-sm text-muted">
            Read {text.length} lines{readWith === 'textract' ? ` and ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}` : ''}.
            {' '}The products are listed on the next screen, where every line can be checked.
          </p>
        )}

        {tables.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Which table lists the products?</legend>
            <p className="text-xs text-muted">
              Pick the one with a row per product. Its headings and first rows are shown as the reader found them.
            </p>
            {tables.map((t, i) => (
              <div
                key={i}
                onClick={() => setTableIndex(i)}
                className={`card cursor-pointer space-y-2 p-3 text-sm ${tableIndex === i ? 'ring-2 ring-brand' : ''}`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="radio" name="table" checked={tableIndex === i} onChange={() => setTableIndex(i)} />
                  <span>
                    <span className="font-medium">Table {i + 1}</span>
                    <span className="text-muted"> · {t.rows.length} rows</span>
                    {t.products && <span className="badge badge-brand ml-2">looks like products</span>}
                  </span>
                </label>
                <TablePreview rows={t.rows} />
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="radio" name="table" checked={tableIndex === -1} onChange={() => setTableIndex(-1)} />
              None of these: read the products from the text instead
            </label>
          </fieldset>
        )}

        {!text && !picking && (
          <button type="button" className="text-sm text-muted underline" onClick={() => setPicking(true)}>
            No docket, or cannot read it? Choose the supplier yourself
          </button>
        )}
      </section>

      {showSupplier && (
        <section className="space-y-4">
          <h2 className="section-title">2 · Who delivered it</h2>

          {chosen && !picking && !adding && (
            <div className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{supplierName(chosen)}</p>
                <p className="text-xs text-muted">
                  {addNote ?? (identity?.kind === 'matched' && identity.supplierId === chosen ? VIA[identity.via] : 'Chosen by you.')}
                </p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setPicking(true)}>Change</button>
            </div>
          )}

          {!chosen && !picking && !adding && identity?.kind === 'suggested' && (
            <div className="space-y-2">
              <p className="text-sm">Is it one of these?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {identity.supplierIds.map((id) => (
                  <button key={id} type="button" className="btn btn-outline justify-start" onClick={() => pick(id)}>
                    {supplierName(id)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <button type="button" className="text-muted underline" onClick={() => setAdding(true)}>None of these: add a new supplier</button>
                <button type="button" className="text-muted underline" onClick={() => setPicking(true)}>Show every supplier</button>
              </div>
            </div>
          )}

          {picking && !adding && (
            <div className="space-y-2">
              {suppliers.length === 0 && <p className="text-sm text-muted">No suppliers yet. Add the first one below.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {suppliers.map((s) => (
                  <button key={s.id} type="button" onClick={() => pick(s.id)}
                    className={`btn justify-start ${chosen === s.id ? 'btn-primary' : 'btn-outline'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
              <button type="button" className="text-sm text-muted underline" onClick={() => setAdding(true)}>
                Not listed? Add a new supplier
              </button>
            </div>
          )}

          {adding && (
            <div className="card space-y-3 p-4">
              <p className="text-sm">
                {identity?.kind === 'unknown' && !picking
                  ? 'This supplier is not on your list yet. Check the details read from the docket, then add it.'
                  : 'Add the supplier. The ABN, when the docket prints one, is what recognises them next time.'}
              </p>
              <label className="block text-sm">
                <span className="font-medium">Supplier name</span>
                <input className="field mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} />
              </label>
              <label className="block text-sm">
                <span className="font-medium">ABN</span> <span className="text-muted">(optional)</span>
                <input className="field mt-1 block font-mono sm:max-w-56" value={newAbn} onChange={(e) => setNewAbn(e.target.value)}
                  inputMode="numeric" placeholder="11 digits" />
              </label>
              {addError && <p className="text-sm text-critical">{addError}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" disabled={savingSupplier || newName.trim().length < 2}
                  onClick={() => void addSupplier()}>
                  {savingSupplier ? 'Adding…' : 'Add supplier'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => { setAdding(false); setPicking(true); }}>
                  Choose from the list instead
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {chosen && !picking && !adding && (
        <form action={formAction} className="space-y-3 border-t border-line pt-6">
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="supplier_id" value={chosen} />
          <input type="hidden" name="delivery_id" value={deliveryId} />
          <input type="hidden" name="docket_photo_path" value={photo ? photoPath : ''} />
          <input type="hidden" name="docket_reading" value={reading ? JSON.stringify(reading) : ''} />
          {state.status === 'error' && (
            <p className="rounded border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">{state.message}</p>
          )}
          <button type="submit" className="btn btn-primary" disabled={starting || busy}>
            {starting ? 'Starting…' : `Start delivery from ${supplierName(chosen)}`}
          </button>
        </form>
      )}
    </div>
  );
}
