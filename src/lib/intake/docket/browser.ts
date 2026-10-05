/**
 * Docket photos in the browser: shrinking them for upload, and the free OCR engine, which
 * reads the photo on the device so the image never leaves it. Browser-only (canvas, workers).
 */

const TARGET_WIDTH = 2400;     // OCR width: wide enough for Tesseract to separate digits from table rules
const MAX_UPLOAD_HEIGHT = 4800; // a long receipt photographed whole; Textract takes up to 10000 px
const UPLOAD_QUALITY = 0.88;
const FALLBACK_QUALITY = 0.7;   // only when a very detailed photo is still over the limit
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // Textract's limit for a synchronous call

/** The size a photo is stored at: never enlarged, at most TARGET_WIDTH wide and MAX_UPLOAD_HEIGHT tall. */
export function uploadSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, TARGET_WIDTH / width, MAX_UPLOAD_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The 1st and 99th percentile grey levels. Counted in a 256-slot histogram rather than by
 * sorting a copy: same answer, without a second photo-sized array on a phone.
 */
export function contrastRange(grey: Uint8ClampedArray): { lo: number; hi: number } {
  const counts = new Uint32Array(256);
  for (const v of grey) counts[v]++;
  const valueAt = (index: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += counts[v];
      if (seen > index) return v;
    }
    return 255;
  };
  return { lo: valueAt(Math.floor(grey.length * 0.01)), hi: valueAt(Math.floor(grey.length * 0.99)) };
}

/**
 * Enlarge, greyscale and stretch the contrast before OCR. On a real docket photo this took
 * the printed quantities from partly read to all read: phone photos are often too small
 * for Tesseract to separate digits from the table rules beside them.
 */
async function cleanUp(file: Blob): Promise<Blob> {
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
  const { lo, hi } = contrastRange(grey);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < grey.length; i++) {
    const v = ((grey[i] - lo) * 255) / range;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not prepare the photo'))), 'image/png'));
}

/**
 * A JPEG small enough for Textract (5 MB) and a store room's signal, big enough to read.
 * Every docket photo goes through this before upload, whichever screen took it.
 */
export async function forUpload(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    const size = uploadSize(bitmap.width, bitmap.height);
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  const encode = (quality: number) => new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not prepare the photo'))), 'image/jpeg', quality));
  try {
    const blob = await encode(UPLOAD_QUALITY);
    return blob.size <= MAX_UPLOAD_BYTES ? blob : await encode(FALLBACK_QUALITY);
  } finally {
    // Releases the pixel buffer now rather than whenever the canvas is collected.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Tesseract reads the photo in the browser: free, and the image never leaves the device. */
export async function readText(file: Blob, onProgress: (p: number) => void): Promise<string[]> {
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

